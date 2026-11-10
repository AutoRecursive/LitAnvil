import { it, expect } from "vitest";
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
