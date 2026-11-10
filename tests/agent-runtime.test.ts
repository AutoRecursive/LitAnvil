import { expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentRuntime, type AdapterFactory } from "../server/agent/runtime";
import { AgentAdapter } from "../server/agent/provider";
import type { AdapterState, ProviderId } from "../shared/agent";
class FakeAdapter extends AgentAdapter {
  state: AdapterState;
  constructor(
    readonly provider: ProviderId,
    private directory: string,
  ) {
    super();
    this.state = {
      nativeSessionId: provider + "-session",
      status: "idle",
      items: [],
      error: null,
      turnId: null,
    };
  }
  async connect() {
    try {
      this.state = JSON.parse(
        await fs.readFile(path.join(this.directory, "fake.json"), "utf8"),
      );
    } catch {}
    this.publish();
  }
  async send(text: string) {
    this.state.items.push({
      id: String(this.state.items.length),
      type: "message",
      role: "user",
      text,
    });
    this.state.status = "running";
    await this.save();
    this.publish();
  }
  async stop() {
    this.state.status = "idle";
    await this.save();
    this.publish();
  }
  async clear() {
    this.state.items = [];
    this.state.nativeSessionId += "-new";
    await this.save();
    this.publish();
  }
  private save() {
    return fs.writeFile(
      path.join(this.directory, "fake.json"),
      JSON.stringify(this.state),
    );
  }
  close() {}
}
const factory: AdapterFactory = (provider, options) =>
  new FakeAdapter(provider, options.storageDir);
it("persists separate providers, replays events and restores selection after restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-runtime-"));
  let runtime = new AgentRuntime(
    root,
    async () => path.join(root, "notes"),
    path.join(root, "data"),
    factory,
  );
  try {
    await runtime.connect();
    await runtime.send("codex history");
    await expect(runtime.select("claude")).rejects.toThrow("停止");
    await runtime.stop();
    await runtime.select("claude");
    expect(runtime.state.items).toEqual([]);
    await runtime.send("claude history");
    await runtime.stop();
    const events = await runtime.history();
    expect(
      events.some((event) =>
        event.upserts.some(
          (item) => item.type === "message" && item.text === "claude history",
        ),
      ),
    ).toBe(true);
    expect(
      events.every(
        (event) => event.protocolVersion === 1 && event.provider === "claude",
      ),
    ).toBe(true);
    const revision = runtime.state.revision;
    expect(await runtime.history(revision)).toEqual([]);
    await runtime.flush();
    runtime.close();
    runtime = new AgentRuntime(
      root,
      async () => path.join(root, "notes"),
      path.join(root, "data"),
      factory,
    );
    await runtime.connect();
    expect(runtime.state.provider).toBe("claude");
    expect(runtime.state.items[0]).toMatchObject({ text: "claude history" });
    await runtime.select("codex");
    expect(runtime.state.items[0]).toMatchObject({ text: "codex history" });
    await runtime.select("claude");
    const old = runtime.state.nativeSessionId;
    await runtime.clear();
    expect(runtime.state.items).toEqual([]);
    expect(runtime.state.nativeSessionId).not.toBe(old);
    await runtime.select("codex");
    expect(runtime.state.items[0]).toMatchObject({ text: "codex history" });
  } finally {
    runtime.close();
    await runtime.flush();
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("isolates provider histories and selections for different project directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-projects-"));
  let workspace = path.join(root, "first");
  const runtime = new AgentRuntime(
    root,
    async () => workspace,
    path.join(root, "data"),
    factory,
  );
  try {
    await runtime.connect();
    await runtime.send("first project");
    await runtime.stop();
    await runtime.select("claude");
    workspace = path.join(root, "second");
    await runtime.connect();
    expect(runtime.state.provider).toBe("codex");
    expect(runtime.state.items).toEqual([]);
    workspace = path.join(root, "first");
    await runtime.connect();
    expect(runtime.state.provider).toBe("claude");
    await runtime.select("codex");
    expect(runtime.state.items[0]).toMatchObject({ text: "first project" });
  } finally {
    runtime.close();
    await runtime.flush();
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("can switch away from a failed provider without requiring that provider to recover", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-failed-provider-"));
  class FailingAdapter extends FakeAdapter {
    async connect() {
      this.state.status = "error";
      throw new Error("native provider unavailable");
    }
  }
  const runtime = new AgentRuntime(
    root,
    async () => root,
    path.join(root, "data"),
    (provider, options) =>
      provider === "codex"
        ? new FailingAdapter(provider, options.storageDir)
        : new FakeAdapter(provider, options.storageDir),
  );
  try {
    await expect(runtime.connect()).rejects.toThrow("unavailable");
    await runtime.select("claude");
    expect(runtime.state.provider).toBe("claude");
    expect(runtime.state.status).toBe("idle");
  } finally {
    runtime.close();
    await runtime.flush();
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("reports persistence failures to clients and recovers when storage becomes writable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-storage-error-"));
  const runtime = new AgentRuntime(
    root,
    async () => root,
    path.join(root, "data"),
    factory,
  );
  const logging = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await runtime.connect();
    await runtime.flush();
    const scopes = await fs.readdir(path.join(root, "data", "agents"));
    const file = path.join(
      root,
      "data",
      "agents",
      scopes[0],
      "codex",
      "snapshot.json",
    );
    await fs.unlink(file);
    await fs.mkdir(file);
    await runtime.send("preserve this message");
    await expect(runtime.flush()).rejects.toThrow("保存");
    expect(runtime.state.error).toContain("保存");
    await fs.rmdir(file);
    await runtime.stop();
    await runtime.flush();
    expect(runtime.state.error).toBeNull();
  } finally {
    runtime.close();
    logging.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});
