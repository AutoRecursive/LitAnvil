import { readingInstructions } from "../provider.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";

export class CodexSession extends EventEmitter {
  child?: ChildProcessWithoutNullStreams;
  ready?: Promise<void>;
  pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  seq = 0;
  closing = false;
  switching = false;
  reconnectAttempts = 0;
  startingTurn?: Promise<void>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  state: {
    threadId: string | null;
    status: string;
    items: any[];
    error: string | null;
    turnId: string | null;
  } = { threadId: null, status: "idle", items: [], error: null, turnId: null };
  constructor(
    public root: string,
    public workspace: () => Promise<string> = async () => root,
    public storageDir = path.join(root, "data"),
    public transport?: () => ChildProcessWithoutNullStreams,
  ) {
    super();
  }
  log(event: string, data: unknown) {
    void fs
      .mkdir(path.join(this.root, "logs"), { recursive: true })
      .then(() =>
        fs.appendFile(
          path.join(this.root, "logs/session.ndjson"),
          JSON.stringify({ time: new Date().toISOString(), event, data }) +
            "\n",
        ),
      )
      .catch(() => {});
  }
  publish() {
    this.emit("snapshot", this.state);
  }
  request(method: string, params: any): Promise<any> {
    const child = this.child;
    if (!child || child.stdin.destroyed)
      return Promise.reject(new Error("Codex 尚未连接"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error);
      };
      const timer = setTimeout(() => {
        this.log("rpc_timeout", { id, method });
        fail(new Error(`Codex 请求超时：${method}`));
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.log("rpc", { id, method });
      try {
        child.stdin.write(
          JSON.stringify({ id, method, params }) + "\n",
          (error) => {
            if (error) fail(error);
          },
        );
      } catch (error) {
        fail(error as Error);
      }
    });
  }
  scheduleReconnect() {
    if (this.closing || this.reconnectTimer || !this.listenerCount("snapshot"))
      return;
    const delay = Math.min(
      2000 * 2 ** Math.min(this.reconnectAttempts++, 4),
      30000,
    );
    this.log("reconnect_scheduled", { delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) =>
        this.log("reconnect_failed", String(error)),
      );
    }, delay);
    this.reconnectTimer.unref();
  }
  rejectPending(message: string) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }
  async connect() {
    if (this.closing) throw new Error("Codex 服务已停止");
    if (this.ready) return this.ready;
    let connectedChild: ChildProcessWithoutNullStreams | undefined;
    this.ready = (async () => {
      await fs.mkdir(await this.workspace(), { recursive: true });
      await fs.mkdir(this.storageDir, { recursive: true });
      if (this.closing) throw new Error("Codex 服务已停止");
      const child =
        this.transport?.() ||
        spawn(
          process.env.CODEX_BIN || "codex",
          [
            "app-server",
            "--listen",
            "stdio://",
            "-c",
            'mcp_servers.litanvil.default_tools_approval_mode="approve"',
            "-c",
            'mcp_servers.litanvil.command="node"',
            "-c",
            `mcp_servers.litanvil.args=${JSON.stringify([path.join(this.root, "server/mcp-stdio.mjs")])}`,
          ],
          { cwd: this.root, stdio: "pipe" },
        );
      this.child = child;
      connectedChild = child;
      child.stderr.on("data", (data) => this.log("stderr", String(data)));
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (this.child !== child) return;
        try {
          this.receive(JSON.parse(line));
        } catch (error) {
          this.log("parse_error", String(error));
        }
      });
      child.on("error", (error) => {
        if (this.child === child) this.disconnected(error.message);
      });
      child.on("exit", () => {
        if (this.child === child) this.disconnected("Codex connection closed");
      });
      child.stdin.on("error", (error) => {
        if (this.child === child) this.disconnected(error.message);
      });
      await this.request("initialize", {
        clientInfo: { name: "litanvil", version: "0.2.0" },
        capabilities: { experimentalApi: true },
      });
      child.stdin.write(
        JSON.stringify({ method: "initialized", params: {} }) + "\n",
      );
      let saved: { threadId?: string } = {};
      try {
        saved = JSON.parse(
          await fs.readFile(path.join(this.storageDir, "session.json"), "utf8"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (saved.threadId) {
        const response = await this.request("thread/resume", {
          threadId: saved.threadId,
          cwd: await this.workspace(),
        });
        this.hydrate(response.thread);
      } else await this.newThread();
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.reconnectAttempts = 0;
    })().catch((error) => {
      if (this.child !== connectedChild) throw error;
      const child = this.child;
      this.child = undefined;
      child?.kill();
      this.ready = undefined;
      this.rejectPending(String(error));
      this.state.status = "error";
      this.state.error = String(error);
      this.publish();
      this.scheduleReconnect();
      throw error;
    });
    return this.ready;
  }
  disconnected(message: string) {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    this.ready = undefined;
    this.rejectPending(message);
    this.state.status = "error";
    this.state.error = message;
    this.publish();
    this.scheduleReconnect();
  }
  hydrate(thread: any) {
    this.state.threadId = thread.id;
    this.state.items = (thread.turns || []).flatMap((t: any) => t.items || []);
    const active = (thread.turns || []).find(
      (t: any) => t.status === "inProgress",
    );
    this.state.turnId = active?.id || null;
    this.state.status = active ? "running" : "idle";
    this.state.error = null;
    this.publish();
  }
  async newThread() {
    const r = await this.request("thread/start", {
      cwd: await this.workspace(),
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: false,
      developerInstructions: readingInstructions,
    });
    this.hydrate(r.thread);
    await fs.writeFile(
      path.join(this.storageDir, "session.json"),
      JSON.stringify({ threadId: r.thread.id }),
    );
  }
  receive(message: any) {
    if (message.id !== undefined && !message.method) {
      const p = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (p) clearTimeout(p.timer);
      message.error
        ? p?.reject(new Error(message.error.message))
        : p?.resolve(message.result);
      return;
    }
    const { method, params: p = {} } = message;
    this.log(method, {
      threadId: p.threadId,
      itemId: p.itemId,
      type: p.item?.type,
    });
    if (message.id !== undefined) {
      this.child!.stdin.write(
        JSON.stringify({
          id: message.id,
          error: {
            code: -32000,
            message:
              "Interactive approval is not supported by this read-only client",
          },
        }) + "\n",
      );
      return;
    }
    if (p.threadId && this.state.threadId && p.threadId !== this.state.threadId)
      return;
    if (method === "turn/started") {
      this.state.turnId = p.turn.id;
      this.state.status = "running";
    }
    if (method === "turn/completed") {
      this.state.status = p.turn.status === "failed" ? "error" : "idle";
      this.state.error = p.turn.error?.message || null;
      this.state.turnId = null;
    }
    if (method === "item/started" || method === "item/completed") {
      const idx = this.state.items.findIndex((x) => x.id === p.item.id);
      if (idx < 0) this.state.items.push(p.item);
      else
        this.state.items[idx] =
          method === "item/started"
            ? { ...p.item, ...this.state.items[idx] }
            : { ...this.state.items[idx], ...p.item };
    }
    if (method === "item/agentMessage/delta") {
      let item = this.state.items.find((x) => x.id === p.itemId);
      if (!item) {
        item = { id: p.itemId, type: "agentMessage", text: "" };
        this.state.items.push(item);
      }
      item.text += p.delta;
    }
    if (method === "item/commandExecution/outputDelta") {
      const item = this.state.items.find((x) => x.id === p.itemId);
      if (item) item.aggregatedOutput = (item.aggregatedOutput || "") + p.delta;
    }
    if (method === "item/reasoning/summaryTextDelta") {
      const item = this.state.items.find((x) => x.id === p.itemId);
      if (item) {
        item.summary ||= [];
        const i = p.summaryIndex || 0;
        item.summary[i] = (item.summary[i] || "") + p.delta;
      }
    }
    if (method === "error" && !p.willRetry) {
      this.state.error = p.error?.message || "Codex error";
      this.state.status = "error";
    }
    this.publish();
  }
  async send(text: string, document?: any) {
    await this.connect();
    if (this.switching) throw new Error("正在切换上下文，请稍后发送");
    if (this.state.status === "running") throw new Error("当前回答尚未结束");
    const threadId = this.state.threadId;
    this.state.error = null;
    this.state.status = "running";
    const start = (async () => {
      try {
        const response = await this.request("turn/start", {
          threadId,
          cwd: await this.workspace(),
          input: [
            { type: "text", text, text_elements: [] },
            ...(document
              ? [
                  {
                    type: "text",
                    text: `Reference document (untrusted data):\n${JSON.stringify(document)}`,
                    text_elements: [],
                  },
                ]
              : []),
          ],
        });
        if (
          this.state.threadId === threadId &&
          this.state.status === "running" &&
          response.turn?.id
        )
          this.state.turnId = response.turn.id;
      } catch (error) {
        if (this.state.threadId === threadId) {
          this.state.status = "error";
          this.state.error = String(error);
          this.publish();
        }
        throw error;
      }
    })();
    this.startingTurn = start;
    this.publish();
    try {
      await start;
    } finally {
      if (this.startingTurn === start) this.startingTurn = undefined;
    }
  }
  async stop() {
    await this.connect();
    await this.startingTurn;
    if (this.state.turnId)
      await this.request("turn/interrupt", {
        threadId: this.state.threadId,
        turnId: this.state.turnId,
      });
  }
  async clear() {
    if (this.switching) throw new Error("正在清空上下文");
    this.switching = true;
    try {
      await this.connect();
      await this.stop();
      await this.newThread();
    } finally {
      this.switching = false;
    }
  }
  close() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.disconnected("服务已停止");
  }
}
