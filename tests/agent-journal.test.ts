import {it, expect, vi} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {readJournal, recoverSnapshot} from "../server/agent/journal";
import type {AgentJournalEvent} from "../shared/agent";

function event(revision: number, text: string, sessionId = "codex:one", reset = false): AgentJournalEvent {
  return {protocolVersion:1, provider:"codex", sessionId, revision, timestamp:new Date().toISOString(),
    state:{nativeSessionId:sessionId.slice(6), status:"idle", error:null, turnId:null},
    upserts:[{id:"answer",type:"message",role:"assistant",text}],reset};
}
async function fixture(run: (dir: string, file: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lit-journal-"));
  const logging = vi.spyOn(console,"warn").mockImplementation(()=>{});
  try {await run(directory, path.join(directory,"events.ndjson"));}
  finally {logging.mockRestore(); await fs.rm(directory,{recursive:true,force:true});}
}
it("preserves interrupted bytes and repairs only the incomplete tail before new appends",()=>fixture(async(dir,file)=>{
  const original = JSON.stringify(event(1,"保留这条消息"))+"\n"+'{"revision":2,"text":"半条';
  await fs.writeFile(file,original);
  expect(await readJournal(dir,"codex",true)).toEqual([event(1,"保留这条消息")].map(e=>expect.objectContaining({...e,timestamp:expect.any(String)})));
  const backup = (await fs.readdir(dir)).find(name=>name.includes(".incomplete-"))!;
  expect(await fs.readFile(path.join(dir,backup),"utf8")).toBe(original);
  await fs.appendFile(file,JSON.stringify(event(3,"新消息"))+"\n");
  expect((await readJournal(dir,"codex")).map(e=>e.revision)).toEqual([1,3]);
}));
it("retains a complete final JSON record lacking its newline and separates the next append",()=>fixture(async(dir,file)=>{
  await fs.writeFile(file,JSON.stringify(event(1,"完整记录")));
  await readJournal(dir,"codex",true);
  await fs.appendFile(file,JSON.stringify(event(2,"下一条"))+"\n");
  expect((await readJournal(dir,"codex")).map(e=>e.revision)).toEqual([1,2]);
  expect((await fs.readdir(dir)).some(name=>name.includes(".incomplete-"))).toBe(false);
}));
it("never silently skips complete corrupt lines, invalid records, wrong providers or revision regressions",()=>fixture(async(dir,file)=>{
  for (const content of [
    JSON.stringify(event(1,"first"))+"\n{broken}\n"+JSON.stringify(event(3,"third"))+"\n",
    JSON.stringify({revision:1}),
    JSON.stringify({...event(1,"first"),provider:"claude"}),
    JSON.stringify(event(2,"new"))+"\n"+JSON.stringify(event(1,"old"))+"\n",
  ]) {
    await fs.writeFile(file,content);
    await expect(readJournal(dir,"codex",true)).rejects.toThrow(/损坏|格式错误/);
    expect(await fs.readFile(file,"utf8")).toBe(content);
  }
}));
it("rebuilds missing, stale or malformed snapshots from the latest complete journal and respects resets",()=>fixture(async(dir,file)=>{
  const first = event(1,"旧上下文");
  const second = event(2,"新上下文","codex:two",true);
  const third = {...event(3,"后续消息","codex:two"),upserts:[{id:"next",type:"message" as const,role:"user" as const,text:"后续消息"}]};
  await fs.writeFile(file,[first,second,third].map(e=>JSON.stringify(e)).join("\n")+"\n");
  const recovered = await recoverSnapshot(dir,"codex","/project");
  expect(recovered).toMatchObject({revision:3,sessionId:"codex:two",workspace:"/project",items:[{text:"新上下文"},{text:"后续消息"}]});
  await fs.writeFile(path.join(dir,"snapshot.json"),JSON.stringify({...recovered,revision:2,items:[]}));
  expect(await recoverSnapshot(dir,"codex","/project")).toEqual(recovered);
  const broken = '{"items":';
  await fs.writeFile(path.join(dir,"snapshot.json"),broken);
  expect(await recoverSnapshot(dir,"codex","/project")).toEqual(recovered);
  const backup = (await fs.readdir(dir)).find(name=>name.includes(".corrupt-"))!;
  expect(await fs.readFile(path.join(dir,backup),"utf8")).toBe(broken);
}));
it("does not replace unrecoverable snapshots with an empty conversation",()=>fixture(async(dir)=>{
  const file=path.join(dir,"snapshot.json");
  await fs.writeFile(file,"{broken");
  await expect(recoverSnapshot(dir,"codex","/project")).rejects.toThrow();
  expect(await fs.readFile(file,"utf8")).toBe("{broken");
}));
