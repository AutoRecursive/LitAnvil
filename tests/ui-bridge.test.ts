import { it, expect, vi } from "vitest";
import { ReaderBridge } from "../server/ui-bridge";
it("routes each command to one visible active tab and rejects acknowledgements from another", async () => {
  const bridge = new ReaderBridge();
  const seen: string[] = [];
  bridge.register("first", (event: any) => {
    seen.push("first");
    expect(bridge.acknowledge("second", event.id, { ok: true })).toBe(false);
    bridge.acknowledge("first", event.id, { ok: true, page: event.page });
  });
  bridge.register("second", () => seen.push("second"));
  bridge.update("first", { visible: true, documentId: "A" }, true);
  bridge.update("second", { visible: false, documentId: "B" }, true);
  expect(await bridge.command("go_to_page", { page: 2 })).toEqual({
    ok: true,
    page: 2,
    clientId: "first",
  });
  expect(seen).toEqual(["first"]);
  expect(bridge.snapshots()).toHaveLength(2);
});
it("supports explicit tab targeting and reports a disconnected target", async () => {
  const bridge = new ReaderBridge();
  bridge.register("first", () => {
    throw new Error("wrong tab");
  });
  const disconnect = bridge.register("second", (event: any) =>
    bridge.acknowledge("second", event.id, { ok: true }),
  );
  expect(await bridge.command("get_state", { clientId: "second" })).toEqual({
    ok: true,
    clientId: "second",
  });
  disconnect();
  await expect(
    bridge.command("get_state", { clientId: "second" }),
  ).rejects.toThrow("未连接");
});
it("rejects in-flight work on disconnect and does not remove replacement connections", async () => {
  const bridge = new ReaderBridge();
  const disconnect = bridge.register("first", () => {});
  const pending = bridge.command("get_state");
  disconnect();
  await expect(pending).rejects.toThrow("断开");
  const old = bridge.register("first", () => {});
  bridge.register("first", (event: any) =>
    bridge.acknowledge("first", event.id, { ok: true }),
  );
  old();
  expect(await bridge.command("get_state")).toEqual({
    ok: true,
    clientId: "first",
  });
});
it("reports disconnected UI rather than claiming success", async () => {
  await expect(
    new ReaderBridge().command("go_to_page", { page: 2 }),
  ).rejects.toThrow("未连接");
});
it("reads fresh frontend state rather than a stale heartbeat cache", async () => {
  const bridge = new ReaderBridge();
  bridge.register("reader", (event: any) =>
    bridge.acknowledge("reader", event.id, {
      ok: true,
      state: { page: 2, documentId: "paper" },
    }),
  );
  bridge.update("reader", { page: 1, documentId: "paper" });
  expect(await bridge.readStates()).toEqual([
    { clientId: "reader", page: 2, documentId: "paper" },
  ]);
});

it("serializes operations per tab while letting other tabs work independently",async()=>{
 const bridge=new ReaderBridge();const first:any[]=[];const second:any[]=[];
 bridge.register("first",event=>first.push(event));bridge.register("second",event=>{second.push(event);bridge.acknowledge("second",(event as any).id,{ok:true})});
 const open=bridge.command("open_document",{clientId:"first",documentId:"A"});
 const page=bridge.command("go_to_page",{clientId:"first",page:4});
 const read=bridge.command("get_state",{clientId:"first"});
 expect(first.map(event=>event.action)).toEqual(["open_document"]);
 await bridge.command("get_state",{clientId:"second"});expect(second).toHaveLength(1);
 bridge.acknowledge("first",first[0].id,{ok:true});await open;
 expect(first.map(event=>event.action)).toEqual(["open_document","go_to_page"]);
 bridge.acknowledge("first",first[1].id,{ok:false,error:"bad page"});await page;
 expect(first[2].action).toBe("get_state");bridge.acknowledge("first",first[2].id,{ok:true});await read;
});
it("does not replay in-flight or queued mutations into a replacement connection",async()=>{
 const bridge=new ReaderBridge();const events:any[]=[];const disconnect=bridge.register("same",event=>events.push(event));
 const active=bridge.command("open_document",{clientId:"same"});const queued=bridge.command("download_annotations",{clientId:"same"});
 const settled=Promise.allSettled([active,queued]);let newCount=0;
 bridge.register("same",event=>{newCount++;bridge.acknowledge("same",(event as any).id,{ok:true})});
 expect((await settled).every(value=>value.status==="rejected")).toBe(true);
 expect(bridge.acknowledge("same",events[0].id,{ok:true})).toBe(false);expect(newCount).toBe(0);
 disconnect();await bridge.command("get_state",{clientId:"same"});expect(newCount).toBe(1);
});
it("cancels timed-out work, rejects late acknowledgements and advances the queue",async()=>{
 vi.useFakeTimers();const bridge=new ReaderBridge({executionTimeoutMs:100,queueTimeoutMs:1000,maxQueue:4});const events:any[]=[];bridge.register("one",event=>events.push(event));
 try{
  const first=bridge.command("open_document");const failure=first.catch(error=>error.message);
  const second=bridge.command("get_state");
  await vi.advanceTimersByTimeAsync(100);
  expect(await failure).toContain("可能已部分执行");expect(events[1]).toMatchObject({kind:"cancel",commandId:events[0].id});expect(events[2].action).toBe("get_state");
  expect(bridge.acknowledge("one",events[0].id,{ok:true})).toBe(false);bridge.acknowledge("one",events[2].id,{ok:true});await second;
  expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers()}
});
it("cleans up transport failures and bounds queued requests without running expired work",async()=>{
 vi.useFakeTimers();const bridge=new ReaderBridge({executionTimeoutMs:1000,queueTimeoutMs:50,maxQueue:2});const events:any[]=[];const close=bridge.register("one",event=>events.push(event));
 try{
  const first=bridge.command("open_document");const firstSettled=first.catch(error=>error.message);
  const queued=bridge.command("go_to_page");const queuedSettled=queued.catch(error=>error.message);
  await expect(bridge.command("get_state")).rejects.toThrow("排队操作过多");
  await vi.advanceTimersByTimeAsync(50);expect(await queuedSettled).toContain("未执行");expect(events).toHaveLength(1);
  close();expect(await firstSettled).toContain("断开");expect(vi.getTimerCount()).toBe(0);
  bridge.register("bad",()=>{throw Error("closed transport")});await expect(bridge.command("get_state")).rejects.toThrow("发送失败");expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers()}
});
it("keeps routing identity authoritative over client-reported snapshot fields",async()=>{
 const bridge=new ReaderBridge();bridge.register("real",event=>bridge.acknowledge("real",(event as any).id,{ok:true,state:{clientId:"spoof",page:2}}));bridge.update("real",{clientId:"spoof"});
 expect(bridge.snapshots()[0].clientId).toBe("real");expect((await bridge.readStates())[0].clientId).toBe("real");
});
