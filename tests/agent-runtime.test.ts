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

it('recovers a truncated journal and corrupt snapshot, then continues the same native conversation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-runtime-recovery-'));
 const create=()=>new AgentRuntime(root,async()=>root,path.join(root,'data'),factory);
 let runtime=create();const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  await runtime.connect();await runtime.send('keep my history');await runtime.stop();await runtime.flush();
  const previous=runtime.state.revision;runtime.close();await runtime.flush();
  const scope=(await fs.readdir(path.join(root,'data','agents')))[0];
  const directory=path.join(root,'data','agents',scope,'codex');
  await fs.appendFile(path.join(directory,'events.ndjson'),'{"revision":');
  await fs.writeFile(path.join(directory,'snapshot.json'),'{"items":');
  runtime=create();await runtime.connect();
  expect(runtime.state.items[0]).toMatchObject({text:'keep my history'});
  expect(runtime.state.revision).toBeGreaterThan(previous);
  await runtime.send('new message after recovery');await runtime.stop();await runtime.flush();
  const history=await runtime.history();
  expect(history.at(-1)?.revision).toBe(runtime.state.revision);
  expect(runtime.state.items.map(item=>'text' in item?item.text:'')).toEqual(['keep my history','new message after recovery']);
  expect((await fs.readdir(directory)).some(name=>name.includes('.incomplete-'))).toBe(true);
 }finally{await runtime.shutdown();warning.mockRestore();await fs.rm(root,{recursive:true,force:true})}
});
it('waits for interrupted adapters to finish publishing and persists their final snapshot before shutdown resolves',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-runtime-shutdown-'));
 let release!:()=>void;
 class DrainingAdapter extends FakeAdapter{
  private ending?:Promise<void>;
  close(){this.ending ||= new Promise<void>(resolve=>{release=resolve}).then(()=>{
   this.state.items.push({id:'final',type:'message',role:'assistant',text:'last streamed answer'});
   this.state.status='idle';this.publish();
  })}
  async drain(){await this.ending}
 }
 const runtime=new AgentRuntime(root,async()=>root,path.join(root,'data'),(provider,options)=>new DrainingAdapter(provider,options.storageDir));
 try{
  await runtime.connect();await runtime.flush();let completed=false;
  const ending=runtime.shutdown().then(()=>{completed=true});
  await new Promise(resolve=>setTimeout(resolve,0));expect(completed).toBe(false);
  release();await ending;
  const scope=(await fs.readdir(path.join(root,'data','agents')))[0];
  const snapshot=JSON.parse(await fs.readFile(path.join(root,'data','agents',scope,'codex','snapshot.json'),'utf8'));
  expect(snapshot.items.at(-1)).toMatchObject({text:'last streamed answer'});
  await expect(runtime.connect()).rejects.toThrow('已停止');
 }finally{release?.();await runtime.flush();await fs.rm(root,{recursive:true,force:true})}
});
it('does not launch an adapter when shutdown happens during workspace lookup',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-close-connect-'));let release!:(value:string)=>void;
 const make=vi.fn(factory);
 const runtime=new AgentRuntime(root,()=>new Promise(resolve=>{release=resolve}),path.join(root,'data'),make);
 try{
  const connecting=runtime.connect();const rejected=expect(connecting).rejects.toThrow('已停止');
  const ending=runtime.shutdown();release(root);await rejected;await ending;expect(make).not.toHaveBeenCalled();
 }finally{runtime.close();await fs.rm(root,{recursive:true,force:true})}
});
it('journals removals when native history differs from the recovered snapshot on first connect',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-native-reconcile-'));
 const create=()=>new AgentRuntime(root,async()=>root,path.join(root,'data'),factory);
 let runtime=create();
 try{
  await runtime.connect();await runtime.send('old native item');await runtime.stop();await runtime.shutdown();
  const scope=(await fs.readdir(path.join(root,'data','agents')))[0];
  const directory=path.join(root,'data','agents',scope,'codex');
  const native=JSON.parse(await fs.readFile(path.join(directory,'fake.json'),'utf8'));
  native.items=[];await fs.writeFile(path.join(directory,'fake.json'),JSON.stringify(native));
  runtime=create();await runtime.connect();await runtime.shutdown();
  expect(runtime.state.items).toEqual([]);
  const {recoverSnapshot}=await import('../server/agent/journal');
  expect((await recoverSnapshot(directory,'codex',root))?.items).toEqual([]);
 }finally{runtime.close();await runtime.flush();await fs.rm(root,{recursive:true,force:true})}
});
it('starts a full journal checkpoint after restart even when an older journal is missing',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-journal-checkpoint-'));
 const create=()=>new AgentRuntime(root,async()=>root,path.join(root,'data'),factory);let runtime=create();
 try{
  await runtime.connect();await runtime.send('retained without original journal');await runtime.stop();await runtime.shutdown();
  const scope=(await fs.readdir(path.join(root,'data','agents')))[0];const directory=path.join(root,'data','agents',scope,'codex');
  await fs.unlink(path.join(directory,'events.ndjson'));
  runtime=create();await runtime.connect();await runtime.shutdown();
  await fs.unlink(path.join(directory,'snapshot.json'));
  const {recoverSnapshot}=await import('../server/agent/journal');
  expect((await recoverSnapshot(directory,'codex',root))?.items[0]).toMatchObject({text:'retained without original journal'});
 }finally{runtime.close();await runtime.flush();await fs.rm(root,{recursive:true,force:true})}
});
