import { topicDescendants, type Topic } from "../shared/topics.js";
import { exportFilename, exportFormats, type ExportFormat } from "../shared/document-export.js";
import { Router, type Response, type RequestHandler } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { PDFParse } from "pdf-parse";
import { ProxyAgent } from "undici";
import { canonicalUrl } from "./import-utils.js";
export type LibraryDocument = {
  id: string;
  title: string;
  author: string;
  source: string;
  sourceType: "web" | "arxiv" | "pdf" | "epub";
  tags: string[];
  topicId?: string | null;
  createdAt: string;
  progress: number;
  priority?: "high" | "medium" | "low";
  content: string;
  htmlSnapshot?: string;
  fileUrl?: string;
  mimeType?: string;
  contentHash?: string;
  sourceAliases?: string[];
  deletedAt?: string;
  readerNote?: {markdown:string;revision:number;updatedAt?:string};
};
export type LibraryAnnotation = {
  id: string;
  documentId: string;
  quote: string;
  textHash: string;
  location: string;
  page?: number;
  domPath?: string;
  cfi?: string;
  note: string;
  aiAnswer?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
export type LibraryDB = {
  topics?: Topic[];
  documents: LibraryDocument[];
  annotations: LibraryAnnotation[];
  chats: any[];
  todos: any[];
};
export const activeDocuments = (db: LibraryDB) =>
  db.documents.filter((document) => !document.deletedAt);
export const documentAnnotations = (db: LibraryDB, id: string) =>
  db.documents.some((document) => document.id === id && !document.deletedAt)
    ? db.annotations.filter(
        (annotation) => annotation.documentId === id && !annotation.deletedAt,
      )
    : [];
const digest = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
const maxFileSize = 100 * 1024 * 1024;
const httpProxy = process.env.LITANVIL_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const httpDispatcher = httpProxy ? new ProxyAgent(httpProxy) : undefined;
async function downloadBody(response: globalThis.Response) {
  if (Number(response.headers.get("content-length")) > maxFileSize) {
    await response.body?.cancel();
    throw new Error("文件不能超过 100MB");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  if (response.body)
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxFileSize) throw new Error("文件不能超过 100MB");
      chunks.push(Buffer.from(chunk));
    }
  return Buffer.concat(chunks);
}
export function pdfTitle(metadata: unknown, content: string, fallback: string) {
  const title = typeof metadata === "string" ? metadata.trim() : "";
  const boilerplate = (value: string) =>
    /^(provided proper attribution|all rights reserved|this (?:work|article) is licensed|©)|permission to reproduce|creativecommons\.org/i.test(
      value,
    );
  if (
    title.length > 3 &&
    !/^(untitled(?: document)?|document|unknown|arxiv[:\s\d.]+)$/i.test(
      title,
    ) &&
    !boilerplate(title)
  )
    return title;
  if (
    !/^(?:\d{4}\.\d{4,5}(?:v\d+)?|Imported PDF)$/i.test(fallback) &&
    !boilerplate(fallback)
  )
    return fallback;
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^--|^arXiv:/i.test(line));
  if (/^provided proper attribution/i.test(lines[0] || "")) {
    while (lines.length) {
      const line = lines.shift()!;
      if (line.endsWith(".")) break;
    }
  }
  if (!lines[0]) return fallback;
  let inferred = lines[0];
  for (const line of lines.slice(1, 3)) {
    if (
      inferred.length < 45 ||
      /[,*†∗@]|\d|^abstract$|university|institute/i.test(line) ||
      line.length < 12
    )
      break;
    inferred += " " + line;
  }
  return inferred.length > 6 ? inferred.slice(0, 240) : fallback;
}
function localFile(uploads: string, url?: string) {
  if (!url || !/^\/uploads\/[^/]+$/.test(url)) return undefined;
  return path.join(uploads, path.basename(url));
}
export async function migrateLibrary(db: LibraryDB, uploads: string) {
  let changed = false;
  for (const document of db.documents) {
    if (!document.priority) { document.priority = "medium"; changed = true; }
    if (document.fileUrl && !document.contentHash) {
      const file = localFile(uploads, document.fileUrl);
      if (file)
        try {
          document.contentHash = digest(await fs.readFile(file));
          changed = true;
        } catch {}
    }
    if (document.sourceType === "arxiv" && document.fileUrl) {
      const title = pdfTitle(undefined, document.content, document.title);
      if (title !== document.title) {
        document.title = title;
        changed = true;
      }
    }
  }
  return changed;
}
export function exportMarkdown(
  document: LibraryDocument,
  annotations: LibraryAnnotation[],
) {
  const quote = (value: string) => JSON.stringify(value);
  const notes = annotations
    .map(
      (annotation) =>
        `> ${annotation.quote.replaceAll("\n", "\n> ")}\n\n${annotation.note || "_高亮_"}${annotation.aiAnswer ? "\n\n" + annotation.aiAnswer : ""}`,
    )
    .join("\n\n---\n\n");
  return `---\ntitle: ${quote(document.title)}\nsource: ${quote(document.source)}\ndocument_id: ${quote(document.id)}\ntags: ${JSON.stringify(document.tags)}\n---\n\n# ${document.title}\n\n${notes || "暂无批注。"}\n`;
}
async function parsePdf(buffer: Buffer, fallback: string) {
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    throw new Error("文件内容不是有效的 PDF");
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    if (!info.total) throw new Error("PDF 没有可读取的页面");
    let content = "";
    try {
      content = (await parser.getText()).text;
    } catch {}
    return { content, title: pdfTitle(info.info?.Title, content, fallback) };
  } catch {
    throw new Error("PDF 无法读取，文件可能已损坏或加密");
  } finally {
    await parser.destroy().catch(() => {});
  }
}
function extractHtml(html: string) {
  const dom = new JSDOM(html);
  dom.window.document
    .querySelectorAll("script,style,noscript,nav,footer")
    .forEach((element) => element.remove());
  return {
    title: dom.window.document.title || "未命名网页",
    content:
      (
        dom.window.document.querySelector("article,main") ||
        dom.window.document.body
      )?.textContent
        ?.replace(/\s+/g, " ")
        .trim() || "",
    htmlSnapshot: dom.serialize(),
  };
}
type LibraryOptions = {
  uploads: string;
  onChange?: () => void;
  read: () => Promise<LibraryDB>;
  write: (
    db: LibraryDB,
    sync?: boolean,
  ) => Promise<void | { warning?: string }>;
};
export function createLibraryRouter({ uploads, read, write, onChange }: LibraryOptions) {
  const router = Router();
  let mutationTail = Promise.resolve();
  const mutationRoute =
    (method: "post" | "patch" | "delete") =>
    (route: string, ...handlers: RequestHandler[]) => {
      const handler = handlers.pop()!;
      router[method](route, ...handlers, async (req, res, next) => {
        const previous = mutationTail;
        let release!: () => void;
        mutationTail = new Promise<void>((resolve) => (release = resolve));
        await previous;
        try {
          if (!req.aborted) await handler(req, res, next);
          else if (req.file) await fs.unlink(req.file.path).catch(() => {});
        } catch (error) {
          next(error);
        } finally {
          release();
        }
      });
    };
  const post = mutationRoute("post"),
    patch = mutationRoute("patch"),
    remove = mutationRoute("delete");
  const upload = multer({
    dest: uploads,
    limits: { fileSize: maxFileSize },
  });
  const save = async (
    res: Response,
    db: LibraryDB,
    body: Record<string, unknown>,
    sync = true,
  ) => {
    const result = await write(db, sync);
    if (sync) onChange?.();
    return res.json({
      ...body,
      ...(result?.warning ? { warning: result.warning } : {}),
    });
  };
  const find = (db: LibraryDB, id: unknown) =>
    db.documents.find((document) => document.id === id && !document.deletedAt);
  router.get("/topics", async (_req, res) => res.json((await read()).topics || []));
  const topicFields = (body: Record<string, unknown>, topics: Topic[], current?: Topic) => {
    if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120)) return "主题名称须为 1–120 个字符";
    if (body.color !== undefined && (typeof body.color !== "string" || !/^#[0-9a-f]{6}$/i.test(body.color))) return "主题颜色须为六位十六进制颜色";
    if (body.parentId !== undefined && body.parentId !== null) {
      if (!topics.some(topic => topic.id === body.parentId)) return "上级主题不存在";
      if (current && topicDescendants(topics, current.id).has(body.parentId as string)) return "不能将主题移到自身或子主题下";
    }
  };
  post("/topics", async (req, res) => {
    const db = await read(), topics = db.topics ||= [];
    const error = topicFields(req.body, topics);
    if (error || typeof req.body.name !== "string" || !req.body.name.trim()) return res.status(400).json({error: error || "请输入主题名称"});
    const topic: Topic = {id: randomUUID(), name: req.body.name.trim(), parentId: req.body.parentId ?? null, color: req.body.color || "#6366f1"};
    topics.push(topic);
    await save(res, db, topic);
  });
  patch("/topics/:id", async (req, res) => {
    const db = await read(), topics = db.topics || [];
    const topic = topics.find(topic => topic.id === req.params.id);
    if (!topic) return res.status(404).json({error: "主题不存在"});
    const error = topicFields(req.body, topics, topic);
    if (error) return res.status(400).json({error});
    if (req.body.name !== undefined) topic.name = req.body.name.trim();
    if (req.body.color !== undefined) topic.color = req.body.color;
    if (req.body.parentId !== undefined) topic.parentId = req.body.parentId;
    await save(res, db, topic);
  });
  remove("/topics/:id", async (req, res) => {
    const db = await read(), topics = db.topics || [];
    const topic = topics.find(topic => topic.id === req.params.id);
    if (!topic) return res.status(404).json({error: "主题不存在"});
    for (const child of topics) if (child.parentId === topic.id) child.parentId = topic.parentId;
    for (const document of db.documents) if (document.topicId === topic.id) document.topicId = topic.parentId;
    db.topics = topics.filter(item => item.id !== topic.id);
    await save(res, db, {ok: true});
  });
  router.get("/trash", async (_req, res) => {
    const db = await read();
    res.json({
      documents: db.documents
        .filter((document) => document.deletedAt)
        .map(({ id, title, source, deletedAt }) => ({
          id,
          title,
          source,
          deletedAt,
        }))
        .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!)),
      annotations: db.annotations
        .filter(
          (annotation) =>
            annotation.deletedAt && find(db, annotation.documentId),
        )
        .map((annotation) => ({
          ...annotation,
          documentTitle: find(db, annotation.documentId)!.title,
        }))
        .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!)),
    });
  });
  router.get("/documents", async (_req, res) => {
    const db = await read();
    res.json(
      activeDocuments(db).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    );
  });
  router.get("/documents/:id", async (req, res) => {
    const db = await read();
    const document = find(db, req.params.id);
    if (!document) return res.status(404).json({ error: "文档不存在" });
    res.json({
      ...document,
      annotations: documentAnnotations(db, document.id),
    });
  });
  router.get('/documents/:id/reader-note',async(req,res)=>{
    const document=find(await read(),req.params.id);
    if(!document)return res.status(404).json({error:'文档不存在'});
    res.json(document.readerNote||{markdown:'',revision:0});
  });
  patch('/documents/:id/reader-note',async(req,res)=>{
    const db=await read();const document=find(db,req.params.id);
    if(!document)return res.status(404).json({error:'文档不存在'});
    const {markdown,revision}=req.body;
    if(typeof markdown!=='string'||Buffer.byteLength(markdown,'utf8')>1024*1024||!Number.isSafeInteger(revision)||revision<0)
      return res.status(400).json({error:'笔记格式无效或超过 1MB'});
    const previous=document.readerNote||{markdown:'',revision:0};
    if(revision!==previous.revision)return res.status(409).json({error:'笔记已在其他页面更新，草稿已保留',note:previous});
    document.readerNote={markdown,revision:previous.revision+1,updatedAt:new Date().toISOString()};
    await save(res,db,document.readerNote);
  });
  remove("/documents/:id", async (req, res) => {
    const db = await read();
    const document = find(db, req.params.id);
    if (!document) return res.status(404).json({ error: "文档不存在" });
    document.deletedAt = new Date().toISOString();
    await save(res, db, {
      ok: true,
      id: document.id,
      deletedAt: document.deletedAt,
    });
  });
  post("/documents/:id/restore", async (req, res) => {
    const db = await read();
    const document = db.documents.find(
      (document) => document.id === req.params.id && document.deletedAt,
    );
    if (!document) return res.status(404).json({ error: "回收站中没有该文档" });
    delete document.deletedAt;
    await save(res, db, document);
  });
  patch("/documents/:id", async (req, res) => {
    const db = await read();
    const document = find(db, req.params.id);
    if (!document) return res.status(404).json({ error: "文档不存在" });
    if (req.body.topicId !== undefined && req.body.topicId !== null && !(db.topics || []).some(topic => topic.id === req.body.topicId))
      return res.status(400).json({error: "主题不存在"});
    if (req.body.title !== undefined) {
      if (typeof req.body.title !== "string" || !req.body.title.trim())
        return res.status(400).json({ error: "标题不能为空" });
      document.title = req.body.title.trim();
    }
    if (req.body.progress !== undefined) {
      if (
        typeof req.body.progress !== "number" ||
        !Number.isFinite(req.body.progress)
      )
        return res.status(400).json({ error: "阅读进度无效" });
      document.progress = Math.max(0, Math.min(1, req.body.progress));
    }
    if (req.body.priority !== undefined) {
      if (!["high", "medium", "low"].includes(req.body.priority)) return res.status(400).json({error:"优先级无效"});
      document.priority = req.body.priority;
    }
    if (req.body.topicId !== undefined) document.topicId = req.body.topicId;
    await save(res, db, document, req.body.title !== undefined || req.body.topicId !== undefined);
  });
  router.get("/documents/:id/annotations", async (req, res) => {
    const db = await read();
    if (!find(db, req.params.id))
      return res.status(404).json({ error: "文档不存在" });
    res.json(documentAnnotations(db, req.params.id));
  });
  post("/annotations", async (req, res) => {
    const db = await read();
    const body = req.body;
    if (!find(db, body.documentId))
      return res.status(404).json({ error: "文档不存在" });
    if (typeof body.quote !== "string" || !body.quote.trim())
      return res.status(400).json({ error: "请选择需要批注的内容" });
    if (body.note !== undefined && typeof body.note !== "string")
      return res.status(400).json({ error: "批注内容无效" });
    const now = new Date().toISOString();
    const annotation: LibraryAnnotation = {
      id: randomUUID(),
      documentId: body.documentId,
      quote: body.quote,
      textHash: digest(body.quote).slice(0, 16),
      location: typeof body.location === "string" ? body.location : "",
      page: Number.isInteger(body.page) ? body.page : undefined,
      note: body.note || "",
      aiAnswer: typeof body.aiAnswer === "string" ? body.aiAnswer : undefined,
      color: typeof body.color === "string" ? body.color : "#f0b429",
      createdAt: now,
      updatedAt: now,
    };
    db.annotations.push(annotation);
    await save(res, db, annotation);
  });
  remove("/annotations/:id", async (req, res) => {
    const db = await read();
    const annotation = db.annotations.find(
      (annotation) =>
        annotation.id === req.params.id &&
        !annotation.deletedAt &&
        find(db, annotation.documentId),
    );
    if (!annotation) return res.status(404).json({ error: "批注不存在" });
    annotation.deletedAt = new Date().toISOString();
    await save(res, db, {
      ok: true,
      id: annotation.id,
      deletedAt: annotation.deletedAt,
    });
  });
  post("/annotations/:id/restore", async (req, res) => {
    const db = await read();
    const annotation = db.annotations.find(
      (annotation) =>
        annotation.id === req.params.id &&
        annotation.deletedAt &&
        find(db, annotation.documentId),
    );
    if (!annotation)
      return res
        .status(404)
        .json({ error: "批注不存在，或所属文档仍在回收站中" });
    delete annotation.deletedAt;
    annotation.updatedAt = new Date().toISOString();
    await save(res, db, annotation);
  });
  patch("/annotations/:id", async (req, res) => {
    const db = await read();
    const annotation = db.annotations.find(
      (annotation) =>
        annotation.id === req.params.id &&
        !annotation.deletedAt &&
        find(db, annotation.documentId),
    );
    if (!annotation) return res.status(404).json({ error: "批注不存在" });
    for (const key of ["note", "quote", "location", "color"] as const)
      if (req.body[key] !== undefined) {
        if (typeof req.body[key] !== "string")
          return res.status(400).json({ error: "批注内容无效" });
        annotation[key] = req.body[key];
      }
    if (!annotation.quote.trim())
      return res.status(400).json({ error: "引用内容不能为空" });
    annotation.textHash = digest(annotation.quote).slice(0, 16);
    annotation.updatedAt = new Date().toISOString();
    await save(res, db, annotation);
  });
  for (const format of ["json","markdown"] as ExportFormat[]) router.get(`/documents/:id/export.${exportFormats[format].extension}`, async (req,res)=>{
    const db=await read();const document=find(db,req.params.id);
    if (!document) return res.status(404).json({error:"文档不存在"});
    const filename=exportFilename(document,format);
    const encoded=encodeURIComponent(filename).replace(/['()*]/g,character=>`%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader("Content-Type",exportFormats[format].mimeType);
    res.setHeader("Access-Control-Expose-Headers","Content-Disposition");
    res.setHeader("Content-Disposition",`attachment; filename="annotations.${exportFormats[format].extension}"; filename*=UTF-8''${encoded}`);
    const annotations=documentAnnotations(db,document.id);
    if (format==="json") res.json({document:document.title,documentId:document.id,annotations});
    else res.send(exportMarkdown(document,annotations));
  });
  post("/import/url", async (req, res) => {
    let file: string | undefined;
    let saved = false;
    try {
      if (typeof req.body.url !== "string" || !req.body.url.trim())
        return res.status(400).json({ error: "请输入链接" });
      const normalized = canonicalUrl(req.body.url.trim());
      console.info("[Library] import start", normalized);
      const db = await read();
      if (req.body.topicId !== undefined && req.body.topicId !== null && !(db.topics || []).some(topic => topic.id === req.body.topicId))
        return res.status(400).json({error: "主题不存在"});
      await migrateLibrary(db, uploads);
      let cached = db.documents.find((document) =>
        [document.source, ...(document.sourceAliases || [])].some((source) => {
          try {
            return canonicalUrl(source) === normalized;
          } catch {
            return false;
          }
        }),
      );
      const cachedFile = localFile(uploads, cached?.fileUrl);
      const readable = Boolean(
        cachedFile &&
        (await fs.access(cachedFile).then(
          () => true,
          () => false,
        )),
      );
      if (
        cached &&
        ((cached.sourceType !== "arxiv" && cached.sourceType !== "pdf") ||
          readable)
      ) {
        if (req.body.topicId !== undefined) cached.topicId = req.body.topicId;
        delete cached.deletedAt;
        return await save(res, db, { ...cached, cached: true });
      }
      const response = await fetch(normalized, {
        signal: AbortSignal.timeout(45000),
        ...(httpDispatcher ? { dispatcher: httpDispatcher } : {}),
      } as RequestInit);
      if (!response.ok) throw new Error(`下载失败（${response.status}）`);
      const buffer = await downloadBody(response);
      const hash = digest(buffer);
      let duplicate: LibraryDocument | undefined;
      for (const candidate of db.documents.filter(
        (document) => document.contentHash === hash,
      )) {
        const file = localFile(uploads, candidate.fileUrl);
        if (
          !["pdf", "arxiv"].includes(candidate.sourceType) ||
          (file &&
            (await fs.access(file).then(
              () => true,
              () => false,
            )))
        ) {
          duplicate = candidate;
          break;
        } else cached ||= candidate;
      }
      if (duplicate) {
        if (req.body.topicId !== undefined) duplicate.topicId = req.body.topicId;
        delete duplicate.deletedAt;
        duplicate.sourceAliases = [
          ...new Set([...(duplicate.sourceAliases || []), normalized]),
        ];
        return await save(res, db, { ...duplicate, cached: true });
      }
      const url = new URL(normalized);
      const isPdf =
        (response.headers.get("content-type") || "").includes(
          "application/pdf",
        ) ||
        /\/pdf\//.test(url.pathname) ||
        /\.pdf$/i.test(url.pathname);
      let fields: Partial<LibraryDocument>;
      if (isPdf) {
        const parsed = await parsePdf(
          buffer,
          (url.pathname.match(/\/pdf\/(.+)$/)?.[1] || "Imported PDF").replace(
            /\.pdf$/i,
            "",
          ),
        );
        file = path.join(uploads, randomUUID() + ".pdf");
        await fs.writeFile(file, buffer);
        fields = {
          ...parsed,
          fileUrl: "/uploads/" + path.basename(file),
          mimeType: "application/pdf",
          sourceType: url.hostname === "arxiv.org" ? "arxiv" : "pdf",
        };
      } else
        fields = { ...extractHtml(buffer.toString("utf8")), sourceType: "web" };
      const document: LibraryDocument = {
        topicId: req.body.topicId !== undefined ? req.body.topicId : cached?.topicId,
        id: cached?.id || randomUUID(),
        title: "未命名文档",
        author: "",
        source: normalized,
        sourceType: "web",
        tags: url.hostname === "arxiv.org" ? ["paper"] : [],
        createdAt: cached?.createdAt || new Date().toISOString(),
        progress: cached?.progress || 0,
        priority: cached?.priority || "medium",
        content: "",
        ...fields,
        contentHash: hash,
        sourceAliases: cached
          ? [...new Set([...(cached.sourceAliases || []), cached.source])]
          : [],
      };
      if (cached) db.documents[db.documents.indexOf(cached)] = document;
      else db.documents.push(document);
      await save(res, db, document);
      console.info("[Library] import complete", { id: document.id, source: normalized, sourceType: document.sourceType });
      saved = true;
    } catch (error) {
      console.error("[Library] import failed", { url: req.body?.url, error: String(error) });
      if (!res.headersSent)
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : "导入失败" });
    } finally {
      if (file && !saved) await fs.unlink(file).catch(() => {});
    }
  });
  post("/import/file", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "请选择文件" });
    let saved = false;
    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (![".pdf", ".txt", ".md"].includes(ext))
        return res
          .status(400)
          .json({ error: "暂支持 PDF、TXT、Markdown 文件" });
      const buffer = await fs.readFile(req.file.path);
      const hash = digest(buffer);
      const db = await read();
      if (req.body.topicId !== undefined && req.body.topicId !== null && !(db.topics || []).some(topic => topic.id === req.body.topicId))
        return res.status(400).json({error: "主题不存在"});
      await migrateLibrary(db, uploads);
      const cached = db.documents.find(
        (document) => document.contentHash === hash,
      );
      if (cached) {
        const original = localFile(uploads, cached.fileUrl);
        const readable = Boolean(
          original &&
          (await fs.access(original).then(
            () => true,
            () => false,
          )),
        );
        let repaired = false;
        if (["pdf", "arxiv"].includes(cached.sourceType) && !readable) {
          const parsed = await parsePdf(buffer, cached.title);
          cached.content = parsed.content;
          cached.title = parsed.title;
          cached.fileUrl = "/uploads/" + path.basename(req.file.path);
          cached.mimeType = "application/pdf";
          repaired = true;
        }
        if (req.body.topicId !== undefined) cached.topicId = req.body.topicId;
        delete cached.deletedAt;
        const response = await save(res, db, { ...cached, cached: true });
        saved = repaired;
        return response;
      }
      const fallback = path.basename(req.file.originalname, ext);
      const parsed =
        ext === ".pdf"
          ? await parsePdf(buffer, fallback)
          : { title: fallback, content: buffer.toString("utf8") };
      const document: LibraryDocument = {
        id: randomUUID(),
        topicId: req.body.topicId || null,
        ...parsed,
        author: "",
        source: req.file.originalname,
        sourceType: ext === ".pdf" ? "pdf" : "web",
        tags: [],
        createdAt: new Date().toISOString(),
        progress: 0,
        priority: "medium",
        fileUrl: "/uploads/" + path.basename(req.file.path),
        mimeType: ext === ".pdf" ? "application/pdf" : req.file.mimetype,
        contentHash: hash,
      };
      db.documents.push(document);
      await save(res, db, document);
      saved = true;
    } catch (error) {
      if (!res.headersSent)
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : "导入失败" });
    } finally {
      if (!saved) await fs.unlink(req.file.path).catch(() => {});
    }
  });
  return router;
}
