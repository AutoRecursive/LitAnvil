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

it('rejects stale-session send/stop/clear/provider actions without changing the current context',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-stale-action-'));
 const runtime=new AgentRuntime(root,async()=>root,path.join(root,'data'),factory);
 try{
  await runtime.connect();const previous={sessionId:runtime.state.sessionId,workspace:runtime.state.workspace};
  await runtime.clear();const current=runtime.state.sessionId;
  await expect(runtime.send('wrong context',undefined,previous)).rejects.toThrow('会话已切换');
  await expect(runtime.stop(previous)).rejects.toThrow('会话已切换');
  await expect(runtime.clear(previous)).rejects.toThrow('会话已切换');
  await expect(runtime.select('claude',previous)).rejects.toThrow('会话已切换');
  expect(runtime.state.sessionId).toBe(current);expect(runtime.state.items).toEqual([]);expect(runtime.state.provider).toBe('codex');
  await runtime.send('current context',undefined,{sessionId:current,workspace:root});
  await expect(runtime.send('second concurrent message')).rejects.toThrow('尚未结束');
  expect(runtime.state.items).toHaveLength(1);
 }finally{runtime.close();await runtime.flush();await fs.rm(root,{recursive:true,force:true})}
});
it('serializes message admission before an adapter publishes its running state',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-submit-race-'));let release!:()=>void;
 class SlowAdapter extends FakeAdapter{async send(text:string){await new Promise<void>(resolve=>{release=resolve});await super.send(text)}}
 const runtime=new AgentRuntime(root,async()=>root,path.join(root,'data'),(provider,options)=>new SlowAdapter(provider,options.storageDir));
 try{
  await runtime.connect();const sending=runtime.send('first');
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  await expect(runtime.send('duplicate')).rejects.toThrow('重复发送');
  await expect(runtime.select('claude')).rejects.toThrow('正在提交');
  release();await sending;expect(runtime.state.items).toHaveLength(1);
 }finally{runtime.close();await runtime.flush();await fs.rm(root,{recursive:true,force:true})}
});
it('switches project configuration and authoritative session together while rejecting concurrent sends',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-workspace-change-'));let workspace=path.join(root,'first');
 const runtime=new AgentRuntime(root,async()=>workspace,path.join(root,'data'),factory);
 try{
  await runtime.connect();const old=runtime.state.sessionId;let release!:()=>void;
  const changing=runtime.changeWorkspace(async()=>{await new Promise<void>(resolve=>{release=resolve});workspace=path.join(root,'second');return workspace});
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  await expect(runtime.send('must wait')).rejects.toThrow('切换上下文');
  release();const result=await changing;
  expect(result.agentError).toBeUndefined();expect(runtime.state.workspace).toBe(workspace);
  expect(result.value).toBe(workspace);
  await runtime.send('first message in new project',undefined,{sessionId:runtime.state.sessionId,workspace});
  expect(runtime.state.items[0]).toMatchObject({text:'first message in new project'});
  await expect(runtime.changeWorkspace(async()=>{throw Error('should not execute')})).rejects.toThrow('当前操作');
  await runtime.stop();
 }finally{runtime.close();await runtime.flush();await fs.rm(root,{recursive:true,force:true})}
});
