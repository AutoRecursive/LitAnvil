import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
async function atomicWrite(file: string, text: string) {
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temporary, text);
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
export class ProjectWorkspace {
  constructor(
    public dataDir: string,
    public defaultDir: string,
  ) {}
  async directory() {
    try {
      const saved = JSON.parse(
        await fs.readFile(path.join(this.dataDir, "project.json"), "utf8"),
      );
      if (
        typeof saved.directory !== "string" ||
        !path.isAbsolute(saved.directory)
      )
        throw new Error("笔记目录配置无效");
      return saved.directory as string;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return this.defaultDir;
      throw error;
    }
  }
  async configure(directory: string) {
    if (!path.isAbsolute(directory)) throw new Error("请输入绝对目录路径");
    const resolved = await fs.realpath(directory);
    if (!(await fs.stat(resolved)).isDirectory())
      throw new Error("该路径不是目录");
    await fs.access(resolved, fs.constants.R_OK | fs.constants.W_OK);
    await fs.mkdir(this.dataDir, { recursive: true });
    await atomicWrite(
      path.join(this.dataDir, "project.json"),
      JSON.stringify({ directory: resolved }, null, 2),
    );
    return resolved;
  }
  async sync(
    documents: { id: string; title: string; source: string; content: string }[],
    annotations: any[],
  ) {
    const root = await this.directory();
    await fs.mkdir(root, { recursive: true });
    for (const doc of documents) {
      const folder = path.join(root, "papers", doc.id);
      await fs.mkdir(folder, { recursive: true });
      await atomicWrite(
        path.join(folder, "paper.md"),
        `# ${doc.title}\n\nSource: ${doc.source}\n\n${doc.content}`,
      );
      const notes = annotations.filter((a) => a.documentId === doc.id);
      await atomicWrite(
        path.join(folder, "annotations.json"),
        JSON.stringify(
          { documentId: doc.id, title: doc.title, annotations: notes },
          null,
          2,
        ),
      );
      await atomicWrite(
        path.join(folder, "notes.md"),
        `# ${doc.title}\n\n` +
          notes
            .map(
              (a) => `> ${a.quote.replaceAll("\n", "\n> ")}\n\n${a.note || ""}`,
            )
            .join("\n\n"),
      );
    }
  }
}
