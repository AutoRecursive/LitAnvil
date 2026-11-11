import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { QmdIndex, qmdToolResults } from "../server/qmd";

it("creates a project-scoped QMD collection and returns normalized paper hits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-qmd-"));
  const bin = path.join(root, "qmd-fixture.mjs");
  await fs.writeFile(bin, `#!/usr/bin/env node
const args=process.argv.slice(2);
if(args.includes('search') || args.includes('vsearch') || args.includes('query')) process.stdout.write(JSON.stringify([{docid:'#abc',score:.87,file:'${root}/papers/other/paper.md',line:12,title:'Other paper',snippet:'similar evidence'}]));
`, { mode: 0o700 });
  const previous = process.env.QMD_BIN;
  const previousMode = process.env.LITANVIL_QMD;
  process.env.QMD_BIN = bin;
  delete process.env.LITANVIL_QMD;
  try {
    const index = new QmdIndex(path.join(root, "data"), async () => root);
    expect(await index.search("attention mechanism")).toMatchObject([{ documentId: "other", score: .87 }]);
    await fs.mkdir(path.join(root, "papers", "current"), { recursive: true });
    await fs.writeFile(path.join(root, "papers", "current", "paper.md"), "# Current\n\nattention mechanism");
    expect(await index.similar("current")).toMatchObject([{ documentId: "other", title: "Other paper" }]);
    expect(qmdToolResults([{file:"/x/papers/other/paper.md",title:"Other paper",score:.5}])).toEqual([{documentId:"other",title:"Other paper",score:.5,line:undefined,source:"/x/papers/other/paper.md",snippet:undefined}]);
    expect(JSON.parse(await fs.readFile(path.join(root, "data", "qmd.json"), "utf8"))).toMatchObject({workspace:root});
  } finally {
    if (previous === undefined) delete process.env.QMD_BIN; else process.env.QMD_BIN = previous;
    if (previousMode === undefined) delete process.env.LITANVIL_QMD; else process.env.LITANVIL_QMD = previousMode;
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("fails closed when QMD is explicitly disabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-qmd-off-"));
  const previous = process.env.LITANVIL_QMD;
  process.env.LITANVIL_QMD = "off";
  try { await expect(new QmdIndex(path.join(root, "data"), async () => root).search("anything")).rejects.toThrow("QMD 已禁用"); }
  finally { if (previous === undefined) delete process.env.LITANVIL_QMD; else process.env.LITANVIL_QMD = previous; await fs.rm(root, { recursive: true, force: true }); }
});
