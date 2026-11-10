import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectWorkspace } from "../server/project";
it("persists project directory and syncs edits without touching unrelated files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-project-"));
  try {
    const notes = path.join(root, "notes");
    await fs.mkdir(notes);
    await fs.writeFile(path.join(notes, "personal.md"), "keep");
    const workspace = new ProjectWorkspace(path.join(root, "data"), notes);
    await workspace.configure(notes);
    expect(
      await new ProjectWorkspace(path.join(root, "data"), "other").directory(),
    ).toBe(await fs.realpath(notes));
    const docs = [
      { id: "doc", title: "论文", source: "source", content: "body" },
    ];
    await workspace.sync(docs, [
      { id: "ann", documentId: "doc", quote: "quote", note: "comment" },
    ]);
    const file = path.join(notes, "papers/doc/annotations.json");
    expect(
      JSON.parse(await fs.readFile(file, "utf8")).annotations[0].note,
    ).toBe("comment");
    await workspace.sync(docs, []);
    expect(JSON.parse(await fs.readFile(file, "utf8")).annotations).toEqual([]);
    expect(await fs.readFile(path.join(notes, "personal.md"), "utf8")).toBe(
      "keep",
    );
    await expect(workspace.configure("relative/path")).rejects.toThrow("绝对");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("does not silently switch to a default workspace when project configuration is corrupt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-project-corrupt-"));
  try {
    await fs.writeFile(path.join(root, "project.json"), "{broken");
    const workspace = new ProjectWorkspace(root, "/unexpected-default");
    await expect(workspace.directory()).rejects.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
