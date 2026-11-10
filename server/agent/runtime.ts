import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AgentAdapter, executable, type ProviderOptions } from "./provider.js";
import { CodexAdapter } from "./providers/codex.js";
import { ClaudeAdapter } from "./providers/claude.js";
import type {
  AgentSnapshot,
  AgentJournalEvent,
  ProviderId,
  ProviderInfo,
  AdapterState,
} from "../../shared/agent.js";

type Entry = {
  adapter: AgentAdapter;
  workspace: string;
  provider: ProviderId;
  directory: string;
  snapshot: AgentSnapshot;
  signature: string;
  items: Map<string, string>;
  tail: Promise<void>;
};
export type AdapterFactory = (
  provider: ProviderId,
  options: ProviderOptions,
) => AgentAdapter;
/** A local session daemon: owns provider selection, persistence and the only UI-facing event contract. */
export class AgentRuntime extends EventEmitter {
  state: AgentSnapshot = {
    protocolVersion: 1,
    provider: "codex",
    sessionId: "connecting",
    nativeSessionId: null,
    workspace: "",
    revision: 0,
    status: "connecting",
    items: [],
    error: null,
    turnId: null,
  };
  private entries = new Map<string, Entry>();
  private active?: Entry;
  private preparing?: Promise<void>;
  private switching = false;
  private closed = false;
  private persistenceErrors = new Map<string, Error>();
  private factory: AdapterFactory;
  constructor(
    private root: string,
    private workspace: () => Promise<string>,
    private dataDir = path.join(root, "data"),
    factory?: AdapterFactory,
  ) {
    super();
    this.factory =
      factory ||
      ((provider, options) =>
        provider === "codex"
          ? new CodexAdapter(options)
          : new ClaudeAdapter(options));
  }
  async providers(): Promise<ProviderInfo[]> {
    return Promise.all(
      (["codex", "claude"] as const).map(async (id) => ({
        id,
        label: id === "codex" ? "Codex" : "Claude",
        available: Boolean(await executable(id)),
        capabilities: {
          streaming: true,
          resume: true,
          tools: true,
          interrupt: true,
        },
      })),
    );
  }
  private scope(workspace: string) {
    return path.join(
      this.dataDir,
      "agents",
      createHash("sha256").update(workspace).digest("hex").slice(0, 20),
    );
  }
  private async entry(provider: ProviderId, workspace: string) {
    const key = `${workspace}:${provider}`;
    const existing = this.entries.get(key);
    if (existing) return existing;
    const directory = path.join(this.scope(workspace), provider);
    await fs.mkdir(directory, { recursive: true });
    // Migrate the original default-workspace Codex thread once; never attach it to another notes directory.
    if (provider === "codex" && workspace === path.join(this.root, "notes")) {
      try {
        await fs.copyFile(
          path.join(this.dataDir, "session.json"),
          path.join(directory, "session.json"),
          fs.constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if (
          !["ENOENT", "EEXIST"].includes(
            (error as NodeJS.ErrnoException).code || "",
          )
        )
          throw error;
      }
    }
    const adapter = this.factory(provider, {
      root: this.root,
      workspace,
      storageDir: directory,
    });
    let cached: AgentSnapshot | undefined;
    try {
      cached = JSON.parse(
        await fs.readFile(path.join(directory, "snapshot.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const snapshot: AgentSnapshot = cached || {
      ...adapter.state,
      protocolVersion: 1,
      provider,
      workspace,
      sessionId: `${provider}:pending`,
      revision: 0,
    };
    const entry: Entry = {
      adapter,
      workspace,
      provider,
      directory,
      snapshot,
      signature: "",
      items: new Map(),
      tail: Promise.resolve(),
    };
    this.entries.set(key, entry);
    adapter.on("snapshot", () => this.project(entry));
    return entry;
  }
  private project(entry: Entry) {
    const native = entry.adapter.state;
    // Keep the last persisted transcript visible while the native provider reconnects.
    const state: AdapterState =
      !native.nativeSessionId && entry.snapshot.nativeSessionId
        ? {
            ...native,
            nativeSessionId: entry.snapshot.nativeSessionId,
            items: entry.snapshot.items,
          }
        : native;
    const signature = JSON.stringify(state);
    if (signature === entry.signature) {
      if (entry === this.active) this.state = entry.snapshot;
      return;
    }
    entry.signature = signature;
    const sessionId = `${entry.provider}:${state.nativeSessionId || "pending"}`;
    const reset =
      sessionId !== entry.snapshot.sessionId ||
      [...entry.items.keys()].some(
        (id) => !state.items.some((item) => item.id === id),
      );
    if (reset) entry.items.clear();
    const upserts = state.items.filter(
      (item) => entry.items.get(item.id) !== JSON.stringify(item),
    );
    for (const item of upserts) entry.items.set(item.id, JSON.stringify(item));
    entry.snapshot = {
      ...state,
      protocolVersion: 1,
      provider: entry.provider,
      workspace: entry.workspace,
      sessionId,
      revision: entry.snapshot.revision + 1,
    };
    const { items, ...metadata } = state;
    const event: AgentJournalEvent = {
      protocolVersion: 1,
      provider: entry.provider,
      sessionId,
      revision: entry.snapshot.revision,
      timestamp: new Date().toISOString(),
      state: metadata,
      upserts,
      reset,
    };
    const serialized = JSON.stringify(entry.snapshot);
    const persist = entry.tail.then(async () => {
      await fs.appendFile(
        path.join(entry.directory, "events.ndjson"),
        JSON.stringify(event) + "\n",
      );
      const file = path.join(entry.directory, "snapshot.json");
      await fs.writeFile(file + ".tmp", serialized);
      await fs.rename(file + ".tmp", file);
      this.persistenceErrors.delete(entry.directory);
    });
    entry.tail = persist.catch((error) => {
      console.error("[Agent runtime] persistence failed", error);
      this.persistenceErrors.set(entry.directory, error);
      this.emit("persistence-error", error);
      if (entry === this.active) {
        this.state = {
          ...entry.snapshot,
          error: "无法保存 Agent 会话，请检查磁盘和目录权限",
        };
        this.emit("snapshot", this.state);
      }
    });
    if (entry === this.active) {
      this.state = entry.snapshot;
      this.emit("snapshot", this.state);
    }
  }
  async connect() {
    if (this.closed) throw new Error("Agent 服务已停止");
    return (this.preparing ||= this.prepare().finally(() => {
      this.preparing = undefined;
    }));
  }
  private async prepare() {
    const workspace = await this.workspace();
    if (this.active?.workspace === workspace) {
      await this.active.adapter.connect();
      return;
    }
    if (this.active?.adapter.state.status === "running")
      throw new Error("请等待当前回答结束后切换目录");
    let provider: ProviderId = "codex";
    try {
      const saved = JSON.parse(
        await fs.readFile(
          path.join(this.scope(workspace), "selection.json"),
          "utf8",
        ),
      );
      if (saved.provider === "claude") provider = "claude";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const entry = await this.entry(provider, workspace);
    this.active = entry;
    this.state = { ...entry.snapshot, status: "connecting" };
    this.emit("snapshot", this.state);
    try {
      await entry.adapter.connect();
      this.project(entry);
    } catch (error) {
      this.state = { ...entry.snapshot, status: "error", error: String(error) };
      this.emit("snapshot", this.state);
      throw error;
    }
  }
  async select(provider: ProviderId) {
    if (provider !== "codex" && provider !== "claude")
      throw new Error("未知 Agent 后端");
    if (this.switching) throw new Error("正在切换 Agent");
    this.switching = true;
    try {
      if (!this.active || this.active.workspace !== (await this.workspace())) {
        try {
          await this.connect();
        } catch (error) {
          if (!this.active) throw error;
        }
      }
      if (this.active!.adapter.state.status === "running")
        throw new Error("请先停止当前回答再切换 Agent");
      const entry = await this.entry(provider, this.active!.workspace);
      await entry.adapter.connect();
      await fs.writeFile(
        path.join(this.scope(entry.workspace), "selection.json"),
        JSON.stringify({ provider }),
      );
      this.active = entry;
      this.project(entry);
      this.state = entry.snapshot;
      this.emit("snapshot", this.state);
    } finally {
      this.switching = false;
    }
  }
  async send(text: string, context?: unknown) {
    await this.connect();
    if (this.switching) throw new Error("正在切换上下文");
    await this.active!.adapter.send(text, context);
    this.project(this.active!);
  }
  async stop() {
    await this.connect();
    await this.active!.adapter.stop();
    this.project(this.active!);
  }
  async clear() {
    if (this.switching) throw new Error("正在切换上下文");
    this.switching = true;
    try {
      await this.connect();
      await this.active!.adapter.clear();
      this.project(this.active!);
    } finally {
      this.switching = false;
    }
  }
  async history(after = 0) {
    await this.connect();
    await this.active!.tail;
    try {
      return (
        await fs.readFile(
          path.join(this.active!.directory, "events.ndjson"),
          "utf8",
        )
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AgentJournalEvent)
        .filter((event) => event.revision > after);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async flush() {
    await Promise.all([...this.entries.values()].map((entry) => entry.tail));
    if (this.persistenceErrors.size) throw new Error("无法保存 Agent 会话");
  }
  close() {
    this.closed = true;
    for (const entry of this.entries.values()) entry.adapter.close();
  }
}
