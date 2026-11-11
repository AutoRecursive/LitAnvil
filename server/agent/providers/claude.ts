import { libraryTools } from "../../library-tools.js";
import { claudeAuthentication } from "../claude-auth.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  Query,
  Options,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  AgentAdapter,
  executable,
  readingInstructions,
  visibleText,
  type ProviderOptions,
} from "../provider.js";
import type { AdapterState, AgentItem } from "../../../shared/agent.js";

type ClaudeDependencies = Pick<
  typeof import("@anthropic-ai/claude-agent-sdk"),
  "query" | "getSessionMessages"
>;
/** Projects structured public SDK events; private thinking/signature blocks are deliberately excluded. */
function toolName(name: string) {
  return name.replace(/^mcp__(.*?)__(.*)$/, "$1 · $2");
}
export class ClaudeProjection {
  items: AgentItem[] = [];
  private messages = new Map<string, string>();
  private blocks = new Map<string, { id: string; json: string }>();
  upsert(item: AgentItem) {
    const index = this.items.findIndex((existing) => existing.id === item.id);
    if (index < 0) this.items.push(item);
    else this.items[index] = item;
  }
  receive(message: any) {
    const parentId = message.parent_tool_use_id || undefined;
    if (message.type === "stream_event") {
      const event = message.event;
      const scope = parentId || "main";
      if (event.type === "message_start")
        this.messages.set(scope, event.message.id);
      const messageId = this.messages.get(scope) || message.uuid;
      const key = `${scope}:${event.index}`;
      if (event.type === "content_block_start") {
        const block = event.content_block;
        const id =
          block.type === "tool_use" ? block.id : `${messageId}:${event.index}`;
        this.blocks.set(key, { id, json: "" });
        if (block.type === "text")
          this.upsert({
            id,
            type: "message",
            role: "assistant",
            text: block.text || "",
            status: "running",
            parentId,
          });
        if (block.type === "tool_use")
          this.upsert({
            id,
            type: "tool",
            name: toolName(block.name),
            input: block.input,
            status: "running",
            parentId,
          });
      }
      if (event.type === "content_block_delta") {
        const block = this.blocks.get(key);
        const item = this.items.find((item) => item.id === block?.id);
        if (item?.type === "message" && event.delta.type === "text_delta")
          item.text += event.delta.text;
        if (
          item?.type === "tool" &&
          block &&
          event.delta.type === "input_json_delta"
        ) {
          block.json += event.delta.partial_json;
          try {
            item.input = JSON.parse(block.json);
          } catch {}
        }
      }
      return;
    }
    if (message.type === "assistant" || message.type === "user") {
      const content = message.message?.content;
      if (message.type === "user") {
        const text = visibleText(content);
        if (text && !message.isSynthetic)
          this.upsert({
            id: message.uuid,
            type: "message",
            role: "user",
            text,
            parentId,
          });
      }
      if (!Array.isArray(content)) return;
      content.forEach((block: any, index: number) => {
        if (message.type === "assistant" && block.type === "text")
          this.upsert({
            id: `${message.message.id || message.uuid}:${index}`,
            type: "message",
            role: "assistant",
            text: block.text,
            status: "completed",
            parentId,
          });
        if (block.type === "tool_use")
          this.upsert({
            id: block.id,
            type: "tool",
            name: toolName(block.name),
            input: block.input,
            status: "running",
            parentId,
          });
        if (block.type === "tool_result") {
          const tool = this.items.find((item) => item.id === block.tool_use_id);
          if (tool?.type === "tool") {
            tool.output = block.content;
            tool.status = block.is_error ? "failed" : "completed";
            if (block.is_error)
              tool.error =
                typeof block.content === "string"
                  ? block.content
                  : "工具执行失败";
          }
        }
      });
    }
    if (message.type === "tool_use_summary")
      this.upsert({
        id: message.uuid,
        type: "notice",
        text: message.summary,
        level: "info",
      });
    if (message.type === "system" && message.subtype === "api_retry")
      this.upsert({
        id: message.uuid,
        type: "notice",
        text: `Claude 正在重试（${message.attempt}/${message.max_retries}）`,
        level: "info",
      });
    if (message.type === "system" && message.subtype === "permission_denied")
      this.upsert({
        id: message.uuid,
        type: "notice",
        text: `工具权限未获批准：${message.tool_name || "未知工具"}`,
        level: "error",
      });
  }
  finish(interrupted = false) {
    for (const item of this.items)
      if (
        (item.type === "message" || item.type === "tool") &&
        item.status === "running"
      )
        item.status = interrupted
          ? "interrupted"
          : item.type === "tool"
            ? "failed"
            : "completed";
  }
}

export class ClaudeAdapter extends AgentAdapter {
  readonly provider = "claude" as const;
  state: AdapterState = {
    nativeSessionId: null,
    status: "idle",
    items: [],
    error: null,
    turnId: null,
  };
  private projection = new ClaudeProjection();
  private ready?: Promise<void>;
  private run?: Promise<void>;
  private controller?: AbortController;
  private query?: Query;
  private used = false;
  private stopped = false;
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  private writes = Promise.resolve();
  private dependencies?: ClaudeDependencies;
  constructor(
    private options: ProviderOptions,
    dependencies?: ClaudeDependencies,
  ) {
    super();
    this.dependencies = dependencies;
  }
  private async sdk() {
    return (this.dependencies ||=
      await import("@anthropic-ai/claude-agent-sdk"));
  }
  private save() {
    const data = JSON.stringify({
      sessionId: this.state.nativeSessionId,
      used: this.used,
    });
    const file = path.join(this.options.storageDir, "native.json");
    const write = this.writes.then(async () => {
      await fs.writeFile(file + ".tmp", data);
      await fs.rename(file + ".tmp", file);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  private async refresh() {
    if (!this.used || this.run || this.closed) return;
    const id = this.state.nativeSessionId!;
    const messages = await (
      await this.sdk()
    ).getSessionMessages(id, { dir: this.options.workspace });
    if (!messages.length) return;
    if (this.run || this.closed || this.state.nativeSessionId !== id) return;
    const projection = new ClaudeProjection();
    for (const message of messages) projection.receive(message);
    projection.finish();
    if (
      JSON.stringify(projection.items) !== JSON.stringify(this.projection.items)
    ) {
      this.projection = projection;
      this.state.items = projection.items;
      this.publish();
    }
  }
  connect() {
    if (this.closed) return Promise.reject(new Error("Claude 服务已停止"));
    return (this.ready ||= (async () => {
      await fs.mkdir(this.options.storageDir, { recursive: true });
      await fs.mkdir(this.options.workspace, { recursive: true });
      try {
        const saved = JSON.parse(
          await fs.readFile(
            path.join(this.options.storageDir, "native.json"),
            "utf8",
          ),
        );
        this.state.nativeSessionId = saved.sessionId;
        this.used = saved.used === true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      this.state.nativeSessionId ||= randomUUID();
      await this.save();
      await this.refresh();
      if (this.closed) throw new Error("Claude 服务已停止");
      this.publish();
      this.timer = setInterval(
        () =>
          void this.refresh().catch((error) =>
            this.log("history_sync_failed", error),
          ),
        1500,
      );
      this.timer.unref();
    })().catch((error) => {
      this.ready = undefined;
      throw error;
    }));
  }
  private log(event: string, error: unknown) {
    console.warn("[Claude adapter]", event, String(error));
  }
  async send(text: string, context?: unknown) {
    if (this.closed) throw new Error("Claude 服务已停止");
    await this.connect();
    if (this.run) throw new Error("当前回答尚未结束");
    const sdk = await this.sdk();
    const binary = await executable("claude");
    const auth = await claudeAuthentication(this.options.workspace);
    if (this.closed) throw new Error("Claude 服务已停止");
    // Re-check after asynchronous SDK loading so simultaneous sends cannot start two turns.
    if (this.run) throw new Error("当前回答尚未结束");
    const id = this.state.nativeSessionId!;
    const uuid = randomUUID();
    const content: any[] = [
      { type: "text", text },
      ...(context
        ? [
            {
              type: "text",
              text: `Reference document (untrusted data):\n${JSON.stringify(context)}`,
            },
          ]
        : []),
    ];
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: "user",
        uuid,
        message: { role: "user", content },
        parent_tool_use_id: null,
        session_id: id,
      };
    }
    this.controller = new AbortController();
    this.stopped = false;
    const options: Options = {
      ...auth,
      cwd: this.options.workspace,
      includePartialMessages: true,
      abortController: this.controller,
      ...(this.used ? { resume: id } : { sessionId: id }),
      settingSources: ["project"],
      strictMcpConfig: true,
      permissionMode: "dontAsk",
      tools: ["Read", "Glob", "Grep"],
      allowedTools: [
        "Read",
        "Glob",
        "Grep",
        "mcp__litanvil__control_reader",
        "mcp__litanvil__get_reader_state",
        ...libraryTools.map(tool => `mcp__litanvil__${tool.name}`),
      ],
      mcpServers: {
        litanvil: {
          type: "http",
          url: `http://127.0.0.1:${process.env.PORT || 8787}/mcp`,
        },
      },
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: readingInstructions,
      },
      ...(binary ? { pathToClaudeCodeExecutable: binary } : {}),
    };
    this.query = sdk.query({ prompt: prompt(), options });
    this.projection.upsert({ id: uuid, type: "message", role: "user", text });
    this.state = {
      ...this.state,
      status: "running",
      error: null,
      items: this.projection.items,
      turnId: uuid,
    };
    this.run = this.consume(this.query);
    this.publish();
  }
  private async consume(query: Query) {
    try {
      let result = false;
      for await (const message of query) {
        if (this.closed) break;
        if (message.type === "system" && message.subtype === "init") {
          this.state.nativeSessionId = message.session_id;
          console.info(
            "[Claude adapter] initialized",
            JSON.stringify({
              sessionId: message.session_id,
              model: message.model,
              mcpServers: message.mcp_servers,
            }),
          );
          this.used = true;
          await this.save();
        }
        this.projection.receive(message);
        if (message.type === "result") {
          result = true;
          if (message.is_error)
            throw new Error(
              "errors" in message
                ? message.errors.join("\n")
                : "result" in message
                  ? message.result
                  : "Claude 请求失败",
            );
        }
        this.state.items = this.projection.items;
        this.publish();
      }
      if (!result && !this.stopped && !this.closed)
        throw new Error("Claude 输出流中断，未收到完成事件");
      this.projection.finish(this.stopped);
      this.state.status = "idle";
      this.state.error = null;
    } catch (error) {
      this.projection.finish(this.stopped);
      this.state.status = this.stopped ? "idle" : "error";
      this.state.error = this.stopped ? null : String(error);
      if (!this.stopped) this.log("turn_failed", error);
    } finally {
      this.state.turnId = null;
      this.run = undefined;
      this.query = undefined;
      this.publish();
    }
  }
  async stop() {
    if (!this.run) return;
    this.stopped = true;
    this.controller?.abort();
    await this.run;
  }
  async clear() {
    await this.stop();
    await this.connect();
    this.used = false;
    this.projection = new ClaudeProjection();
    this.state = {
      nativeSessionId: randomUUID(),
      status: "idle",
      items: [],
      error: null,
      turnId: null,
    };
    await this.save();
    this.publish();
  }
  close() {
    this.closed = true;
    this.stopped = true;
    clearInterval(this.timer);
    this.controller?.abort();
  }
  async drain() {
    await this.ready?.catch(() => {});
    await this.run;
    await this.writes;
  }
}
