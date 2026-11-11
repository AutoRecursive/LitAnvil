import {
  AgentAdapter,
  visibleText,
  type ProviderOptions,
} from "../provider.js";
import { CodexSession } from "./codex-native.js";
import type {
  AdapterState,
  AgentItem,
  ItemStatus,
} from "../../../shared/agent.js";
export function codexItems(items: any[]): AgentItem[] {
  const status = (value: string): ItemStatus =>
    value === "inProgress"
      ? "running"
      : value === "failed"
        ? "failed"
        : value === "interrupted"
          ? "interrupted"
          : "completed";
  return items.flatMap((item): AgentItem[] => {
    if (item.type === "userMessage")
      return [
        {
          id: item.id,
          type: "message",
          role: "user",
          text: visibleText(item.content),
        },
      ];
    if (item.type === "agentMessage")
      return [
        {
          id: item.id,
          type: "message",
          role: "assistant",
          text: item.text || "",
        },
      ];
    if (item.type === "reasoning")
      return item.summary?.length
        ? [
            {
              id: item.id,
              type: "reasoning",
              text: item.summary.join("\n"),
              visibility: "summary",
            },
          ]
        : [];
    return [
      {
        id: item.id,
        type: "tool",
        name:
          item.type === "mcpToolCall"
            ? `${item.server} · ${item.tool}`
            : item.type === "commandExecution"
              ? "命令"
              : item.type === "fileChange"
                ? "文件变更"
                : item.type === "webSearch"
                  ? "搜索"
                  : item.type,
        input: item.command || item.arguments || item.changes,
        output: item.aggregatedOutput || item.result,
        error: item.error?.message,
        status: status(item.status),
      },
    ];
  });
}
export class CodexAdapter extends AgentAdapter {
  readonly provider = "codex" as const;
  readonly native: CodexSession;
  constructor(options: ProviderOptions, native?: CodexSession) {
    super();
    this.native =
      native ||
      new CodexSession(
        options.root,
        async () => options.workspace,
        options.storageDir,
      );
    this.native.on("snapshot", () => this.publish());
  }
  get state(): AdapterState {
    const state = this.native.state;
    return {
      nativeSessionId: state.threadId,
      status: state.status as AdapterState["status"],
      items: codexItems(state.items),
      error: state.error,
      turnId: state.turnId,
    };
  }
  connect() {
    return this.native.connect();
  }
  send(text: string, context?: unknown) {
    return this.native.send(text, context);
  }
  stop() {
    return this.native.stop();
  }
  clear() {
    return this.native.clear();
  }
  close() {
    this.native.close();
  }
  drain() {
    return this.native.drain();
  }
}
