import {
  createLibraryRouter,
  activeDocuments,
  documentAnnotations,
  migrateLibrary,
  type LibraryDB,
} from "./library.js";
import { ProjectWorkspace } from "./project.js";
import { readerBridge, uiTools } from "./ui-bridge.js";
import { createAgentRouter } from "./agent/http.js";
import { AgentRuntime } from "./agent/runtime.js";
import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";

const app = express();
const port = Number(process.env.PORT || 8787);
const root = process.cwd();
const dataDir = process.env.LITANVIL_DATA_DIR || path.join(root, "data");
await fs.mkdir(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "db.json");
const workspace = new ProjectWorkspace(
  dataDir,
  path.join(process.env.LITANVIL_DATA_DIR || root, "notes"),
);
const uploadsDir = process.env.LITANVIL_DATA_DIR
  ? path.join(dataDir, "uploads")
  : path.join(root, "uploads");
await fs.mkdir(uploadsDir, { recursive: true });
const logsDir = path.join(root, "logs");
await fs.mkdir(logsDir, { recursive: true });
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadsDir));

type DB = LibraryDB;
let notesSyncError: string | undefined;
async function readDb(): Promise<DB> {
  try {
    return JSON.parse(await fs.readFile(dbPath, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return { documents: [], annotations: [], chats: [], todos: [] };
  }
}
async function syncNotes(db: DB) {
  try {
    await workspace.sync(
      activeDocuments(db),
      db.annotations.filter((annotation) => !annotation.deletedAt),
    );
    notesSyncError = undefined;
  } catch (error) {
    console.error("[Library] notes export failed", error);
    notesSyncError = "数据已保存，但笔记同步失败，请检查笔记目录权限";
  }
  return notesSyncError ? { warning: notesSyncError } : undefined;
}
async function writeDb(db: DB, sync = true) {
  const temporary = dbPath + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(db, null, 2));
  await fs.rename(temporary, dbPath);
  if (sync) return syncNotes(db);
}
app.use(
  "/api",
  createLibraryRouter({ uploads: uploadsDir, read: readDb, write: writeDb }),
);
app.get("/api/ui/events", (req, res) => {
  const clientId = String(req.query.clientId || "");
  if (!clientId || clientId.length > 128)
    return res.status(400).json({ error: "clientId required" });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const disconnect = readerBridge.register(clientId, (event) =>
    res.write(`data: ${JSON.stringify(event)}\n\n`),
  );
  const timer = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(timer);
    disconnect();
  });
});
app.post("/api/ui/state", (req, res) => {
  const ok = readerBridge.update(
    req.body.clientId,
    req.body.state || {},
    req.body.active === true,
  );
  res.status(ok ? 200 : 409).json({ ok });
});
app.post("/api/ui/ack", (req, res) => {
  const ok = readerBridge.acknowledge(
    req.body.clientId,
    req.body.id,
    req.body.result,
  );
  res.status(ok ? 200 : 409).json({ ok });
});
const existingData = await readDb();
if (await migrateLibrary(existingData, uploadsDir)) await writeDb(existingData);
else await syncNotes(existingData);
const session = new AgentRuntime(root, () => workspace.directory(), dataDir);
const agentRoutes = createAgentRouter(session, async (body) => {
  const db = await readDb();
  const doc = activeDocuments(db).find(
    (document) => document.id === body.documentId,
  );
  return doc
    ? {
        title: doc.title,
        content: doc.content,
        quote: body.quote,
        annotations: documentAnnotations(db, doc.id),
      }
    : undefined;
});
app.use("/api/agent", agentRoutes);
app.use("/api/session", agentRoutes);
app.get("/api/project", async (_req, res) =>
  res.json({
    directory: await workspace.directory(),
    syncError: notesSyncError,
  }),
);
app.put("/api/project", async (req, res) => {
  try {
    if (session.state.status === "running")
      return res.status(409).json({ error: "请等待当前回答结束后切换目录" });
    const directory = await workspace.configure(
      String(req.body.directory || ""),
    );
    const db = await readDb();
    await syncNotes(db);
    res.json({ directory, syncError: notesSyncError });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
app.post("/mcp", async (req, res) => {
  const { id, method, params = {} } = req.body;
  const reply = (result: any) => res.json({ jsonrpc: "2.0", id, result });
  try {
    if (method === "initialize")
      return reply({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "LitAnvil", version: "0.2.0" },
      });
    if (method === "ping") return reply({});
    if (id === undefined) return res.status(202).end();
    const db = await readDb();
    if (method === "tools/list")
      return reply({
        tools: [
          {
            name: "list_documents",
            description: "List imported documents and their IDs.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "get_annotations",
            description: "Read annotations for a document.",
            inputSchema: {
              type: "object",
              properties: { documentId: { type: "string" } },
              required: ["documentId"],
            },
          },
          ...uiTools,
        ],
      });
    if (method === "tools/call") {
      let result: any;
      if (params.name === "control_reader")
        result = await readerBridge.command(
          params.arguments.action,
          params.arguments,
        );
      else if (params.name === "get_reader_state")
        result = await readerBridge.readStates();
      else if (params.name === "list_documents")
        result = activeDocuments(db).map(({ id, title, source }) => ({
          id,
          title,
          source,
        }));
      else if (params.name === "get_annotations")
        result = documentAnnotations(db, params.arguments?.documentId);
      else throw new Error("Unknown tool");
      return reply({
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: result?.ok === false,
      });
    }
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  } catch (e) {
    return reply({
      content: [{ type: "text", text: String(e) }],
      isError: true,
    });
  }
});
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    if (!res.headersSent)
      res
        .status((error as any).code === "LIMIT_FILE_SIZE" ? 413 : 500)
        .json({
          error:
            (error as any).code === "LIMIT_FILE_SIZE"
              ? "文件不能超过 100MB"
              : error.message || "服务器错误",
        });
  },
);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`LitAnvil API listening on http://localhost:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    session.close();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
