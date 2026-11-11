import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
type QmdResult = { docid?: string; score?: number; file?: string; line?: number; title?: string; snippet?: string };

export type QmdSearchResult = QmdResult & { documentId?: string; source?: string };

function projectIndex(workspace: string) {
  return `litanvil-${createHash("sha256").update(workspace).digest("hex").slice(0, 16)}`;
}

function documentId(file: string) {
  const match = file.replaceAll("\\", "/").match(/(?:^|\/)papers\/([^/]+)\/paper\.md(?:[?#].*)?$/);
  return match?.[1];
}

export class QmdIndex {
  private initialized?: Promise<boolean>;
  private updateTail: Promise<void> = Promise.resolve();
  constructor(private dataDir: string, private workspace: () => Promise<string>) {}

  private async command(args: string[], timeout = 120_000) {
    if (process.env.LITANVIL_QMD === "off") throw new Error("QMD 已禁用");
    const binary = process.env.QMD_BIN || "qmd";
    await fs.mkdir(this.dataDir, { recursive: true });
    return run(binary, ["--index", projectIndex(await this.workspace()), ...args], {
      cwd: this.dataDir, timeout, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
  }

  async ensure() {
    return (this.initialized ||= this.initialize().catch(error => {
      this.initialized = undefined;
      throw error;
    }));
  }

  private async initialize() {
    const root = await this.workspace();
    await fs.mkdir(root, { recursive: true });
    const marker = path.join(this.dataDir, "qmd.json");
    try {
      const saved = JSON.parse(await fs.readFile(marker, "utf8"));
      if (saved.workspace === root && saved.index === projectIndex(root)) return true;
    } catch {}
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.command(["init"], 30_000).catch((error: any) => {
      if (!String(error?.stderr || error?.message).includes("already")) throw error;
    });
    const papers = path.join(root, "papers");
    await fs.mkdir(papers, { recursive: true });
    await this.command(["collection", "add", papers], 30_000).catch((error: any) => {
      const message = String(error?.stderr || error?.message);
      if (!/already exists|already indexed|exists/i.test(message)) throw error;
    });
    await fs.writeFile(marker, JSON.stringify({ workspace: root, index: projectIndex(root) }, null, 2), { mode: 0o600 });
    return true;
  }

  scheduleUpdate() {
    this.updateTail = this.updateTail.then(async () => {
      try { await this.ensure(); await this.command(["update"], 120_000); }
      catch (error) { console.warn("[QMD] index update failed", String(error)); }
    });
    return this.updateTail;
  }

  async search(query: string, options: { limit?: number; minScore?: number; semantic?: boolean } = {}) {
    if (!query.trim()) throw new Error("检索内容不能为空");
    await this.ensure();
    const args = [options.semantic ? "vsearch" : "search", query, "--format", "json", "-n", String(Math.min(20, Math.max(1, options.limit || 8)))];
    if (options.minScore !== undefined) args.push("--min-score", String(Math.max(0, Math.min(1, options.minScore))));
    const result = await this.command(args, 120_000);
    let rows: QmdResult[];
    try { rows = JSON.parse(result.stdout || "[]"); }
    catch { throw new Error("QMD 返回了无法解析的结果"); }
    return rows.map(row => ({ ...row, documentId: row.file ? documentId(row.file) : undefined, source: row.file }));
  }

  async similar(documentId: string, limit = 6) {
    const root = await this.workspace();
    const paper = path.join(root, "papers", documentId, "paper.md");
    const content = await fs.readFile(paper, "utf8").catch(() => { throw new Error("找不到当前论文的 QMD 文档"); });
    const query = content.replace(/^---[\s\S]*?---\s*/m, "").slice(0, 12_000);
    const semantic = await this.search(query, { limit: Math.min(20, limit + 3), semantic: true });
    let results = semantic;
    if (!results.length) {
      const chunks = [content.slice(0, 900), content.slice(Math.max(0, Math.floor(content.length / 2) - 450), Math.floor(content.length / 2) + 450), content.slice(-900)];
      const lexical = await Promise.all(chunks.map(chunk => this.search(chunk, { limit: Math.min(20, limit + 3) })));
      const seen = new Set<string>();
      results = lexical.flat().filter(result => {
        const key = result.documentId || result.source || result.title || "";
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return results.filter(result => result.documentId !== documentId).slice(0, limit).map(result => ({
      ...result,
      retrieval: semantic.length ? "vector" : "keyword-fallback",
    }));
  }
}

export function qmdToolResults(results: QmdSearchResult[]) {
  return results.map(result => ({
    documentId: result.documentId || (result.file ? documentId(result.file) : undefined),
    title: result.title,
    score: result.score,
    line: result.line,
    source: result.source || result.file,
    snippet: result.snippet,
  }));
}
