import { Router } from "express";
import type { AgentRuntime } from "./runtime.js";
/** The HTTP surface depends on the common runtime, never on a provider's wire protocol. */
export function createAgentRouter(
  runtime: AgentRuntime,
  context: (body: any) => Promise<unknown> = async () => undefined,
) {
  const router = Router();
  const target = (body: any) => ({sessionId:body?.expectedSessionId,workspace:body?.expectedWorkspace});
  router.get("/providers", async (_req, res) =>
    res.json(await runtime.providers()),
  );
  router.get("/state", async (_req, res) => {
    try {
      await runtime.connect();
      res.json(runtime.state);
    } catch (error) {
      res.status(503).json({ ...runtime.state, error: String(error) });
    }
  });
  router.get("/history", async (req, res) => {
    try {
      res.json(
        await runtime.history(Math.max(0, Number(req.query.after) || 0)),
      );
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
  router.get("/events", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    const send = (state: any) =>
      res.write(
        `id: ${state.sessionId}:${state.revision}\ndata: ${JSON.stringify(state)}\n\n`,
      );
    runtime.on("snapshot", send);
    send(runtime.state);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      runtime.off("snapshot", send);
    });
    try {
      await runtime.connect();
      if (!res.destroyed) send(runtime.state);
    } catch (error) {
      if (!res.destroyed)
        send({ ...runtime.state, status: "error", error: String(error) });
    }
  });
  router.post("/provider", async (req, res) => {
    try {
      await runtime.select(req.body.provider, target(req.body));
      res.json(runtime.state);
    } catch (error) {
      res.status(409).json({ error: String(error) });
    }
  });
  router.post("/message", async (req, res) => {
    try {
      const text = String(req.body.text || "").trim();
      if (!text) return res.status(400).json({ error: "请输入消息" });
      await runtime.send(text, await context(req.body), target(req.body));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });
  for (const action of ["stop", "clear", "compact"] as const)
    router.post("/" + action, async (req, res) => {
      try {
        await runtime[action](target(req.body));
        res.json({ ok: true, state: runtime.state });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });
  return router;
}
