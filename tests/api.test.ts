import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let proc: ChildProcess, dir: string;
const base = "http://127.0.0.1:18787";
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "litanvil-test-"));
  const transport = path.join(dir, "codex-fixture");
  await fs.writeFile(transport, "#!/usr/bin/env node\n" + await fs.readFile("tests/fixtures/app-server.mjs", "utf8"));
  await fs.chmod(transport, 0o700);
  proc = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: "18787", LITANVIL_DATA_DIR: dir, CODEX_BIN: transport, LITANVIL_CODEX_ACCOUNT_HOME: path.join(dir,"test-account"), LITANVIL_USER_HOME: path.join(dir,"test-user") },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/documents")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Isolated API failed to start");
});
afterAll(async () => {
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise<void>(resolve => proc.once("exit", () => resolve()));
    proc.kill();
    await exited;
  }
  await fs.rm(dir, { recursive: true, force: true });
});
describe("isolated document API", () => {
  it("retains every document across concurrent imports", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fetch(base + "/api/import/url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: `data:text/html,<title>Concurrent${i}</title><p>body${i}</p>`,
          }),
        }).then((r) => r.json()),
      ),
    );
    const docs = await (await fetch(base + "/api/documents")).json();
    for (const d of results)
      expect(docs.some((x: any) => x.id === d.id)).toBe(true);
  });

  it("reuses imported links and persists editable annotations", async () => {
    const url =
      "data:text/html,<title>Test%20Paper</title><p>Evidence%20and%20methods.</p>";
    const post = async (route: string, body: any, method = "POST") =>
      (
        await fetch(base + route, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();
    const d = await post("/api/import/url", { url });
    expect(d.title).toBe("Test Paper");
    const cached = await post("/api/import/url", { url });
    expect(cached.id).toBe(d.id);
    expect(cached.cached).toBe(true);
    const a = await post("/api/annotations", {
      documentId: d.id,
      quote: "Evidence",
      note: "Check sample",
    });
    await post(
      "/api/annotations/" + a.id,
      { note: "Updated comment" },
      "PATCH",
    );
    const md = await (
      await fetch(base + `/api/documents/${d.id}/export.md`)
    ).text();
    expect(md).toContain("Updated comment");
    const removed = await fetch(base + "/api/annotations/" + a.id, {
      method: "DELETE",
    });
    expect(removed.ok).toBe(true);
    expect(
      await (await fetch(base + `/api/documents/${d.id}/annotations`)).json(),
    ).toEqual([]);
    expect(
      (await (await fetch(base + "/api/documents")).json()).filter(
        (x: any) => x.id === d.id,
      ),
    ).toHaveLength(1);
  });
});

it("moves documents and annotations to recoverable trash and preserves their IDs and locations", async () => {
  const post = async (route: string, body?: unknown) =>
    (
      await fetch(base + route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      })
    ).json();
  const d = await post("/api/import/url", {
    url: "data:text/html,<title>Recovery</title><p>Preserved evidence</p>",
  });
  const location = JSON.stringify({
    version: 1,
    rects: [{ page: 2, x: 0.2, y: 0.3, w: 0.4, h: 0.01 }],
  });
  const a = await post("/api/annotations", {
    documentId: d.id,
    quote: "evidence",
    note: "**Markdown** $x^2$",
    location,
  });
  await fetch(base + "/api/annotations/" + a.id, { method: "DELETE" });
  expect(
    await (await fetch(base + `/api/documents/${d.id}/annotations`)).json(),
  ).toEqual([]);
  await post("/api/annotations/" + a.id + "/restore");
  await fetch(base + "/api/documents/" + d.id, { method: "DELETE" });
  expect((await fetch(base + "/api/documents/" + d.id)).status).toBe(404);
  expect(
    (await (await fetch(base + "/api/documents")).json()).some(
      (item: any) => item.id === d.id,
    ),
  ).toBe(false);
  const trash = await (await fetch(base + "/api/trash")).json();
  expect(trash.documents.some((item: any) => item.id === d.id)).toBe(true);
  const restored = await post("/api/documents/" + d.id + "/restore");
  expect(restored.id).toBe(d.id);
  const annotations = await (
    await fetch(base + `/api/documents/${d.id}/annotations`)
  ).json();
  expect(annotations[0]).toMatchObject({
    id: a.id,
    note: "**Markdown** $x^2$",
    location,
  });
  const patch = await fetch(base + "/api/annotations/" + a.id, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "overwritten",
      documentId: "missing",
      note: "edited",
    }),
  });
  expect((await patch.json()).id).toBe(a.id);
  expect(
    (
      await fetch(base + "/api/annotations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: "missing", quote: "orphan" }),
      })
    ).status,
  ).toBe(404);
});

it("exports real Markdown line breaks, source formulas and safely quoted frontmatter", async () => {
  const post = async (route: string, body: unknown) =>
    (
      await fetch(base + route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json();
  const d = await post("/api/import/url", {
    url: "data:text/html,<title>Export</title><p>content</p>",
  });
  const note = "**重点**\n\n$$\n\\frac{1}{N}\\sum_i x_i\n$$\n\n- item";
  await post("/api/annotations", {
    documentId: d.id,
    quote: "line one\nline two",
    note,
  });
  const exported = await fetch(base + `/api/documents/${d.id}/export.md`);
  const text = await exported.text();
  expect(text).toContain("> line one\n> line two\n\n" + note);
  expect(text).not.toContain("**\\n");
  expect(exported.headers.get("content-disposition")).toContain(
    "filename*=UTF-8''",
  );
});

it("rejects invalid PDF uploads and cleans temporary files without adding bad records", async () => {
  const before = await fs.readdir(path.join(dir, "uploads"));
  const docs = await (await fetch(base + "/api/documents")).json();
  const form = new FormData();
  form.append(
    "file",
    new Blob(["not a pdf"], { type: "application/pdf" }),
    "invalid.pdf",
  );
  const response = await fetch(base + "/api/import/file", {
    method: "POST",
    body: form,
  });
  expect(response.status).toBe(400);
  expect(await fs.readdir(path.join(dir, "uploads"))).toEqual(before);
  expect(await (await fetch(base + "/api/documents")).json()).toHaveLength(
    docs.length,
  );
});

it("parses valid PDFs, fills legacy hashes, and restores a cached deleted upload", async () => {
  const { fixturePdf } = await import("./fixtures/pdf");
  const buffer = fixturePdf();
  const upload = async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: "application/pdf" }),
      "random-name.pdf",
    );
    return (
      await fetch(base + "/api/import/file", { method: "POST", body: form })
    ).json();
  };
  const d = await upload();
  expect(d.title).toBe("Meaningful PDF title");
  expect(d.content).toContain("Meaningful PDF title");
  const files = await fs.readdir(path.join(dir, "uploads"));
  const file = path.join(dir, "db.json");
  const db = JSON.parse(await fs.readFile(file, "utf8"));
  delete db.documents.find((item: any) => item.id === d.id).contentHash;
  await fs.writeFile(file, JSON.stringify(db));
  expect((await upload()).id).toBe(d.id);
  expect(await fs.readdir(path.join(dir, "uploads"))).toEqual(files);
  await fetch(base + "/api/documents/" + d.id, { method: "DELETE" });
  expect((await upload()).id).toBe(d.id);
  expect((await fetch(base + "/api/documents/" + d.id)).ok).toBe(true);
});

it("caches PDF aliases and upgrades a legacy metadata-only record without changing its annotations", async () => {
  const { createServer } = await import("node:http");
  const { fixturePdf } = await import("./fixtures/pdf");
  const pdf = fixturePdf("Alias PDF");
  let requests = 0;
  let legacyHtml = true;
  const upstream = createServer((req, res) => {
    requests++;
    if (req.url === "/legacy" && legacyHtml) {
      res.setHeader("content-type", "text/html");
      res.end("<title>Legacy metadata</title><p>old abstract</p>");
    } else {
      res.setHeader("content-type", "application/pdf");
      res.end(pdf);
    }
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address() as import("node:net").AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const post = async (route: string, body: unknown) =>
    (
      await fetch(base + route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json();
  try {
    const legacy = await post("/api/import/url", { url: origin + "/legacy" });
    const annotation = await post("/api/annotations", {
      documentId: legacy.id,
      quote: "old evidence",
      note: "keep me",
    });
    const dbFile = path.join(dir, "db.json");
    const db = JSON.parse(await fs.readFile(dbFile, "utf8"));
    db.documents.find((item: any) => item.id === legacy.id).sourceType =
      "arxiv";
    await fs.writeFile(dbFile, JSON.stringify(db));
    legacyHtml = false;
    const upgraded = await post("/api/import/url", { url: origin + "/legacy" });
    expect(upgraded.id).toBe(legacy.id);
    expect(upgraded.fileUrl).toBeTruthy();
    expect(upgraded.title).toBe("Alias PDF");
    expect(
      (
        await (
          await fetch(base + `/api/documents/${legacy.id}/annotations`)
        ).json()
      )[0].id,
    ).toBe(annotation.id);
    const alias = await post("/api/import/url", { url: origin + "/other.pdf" });
    expect(alias.id).toBe(legacy.id);
    const count = requests;
    const cached = await post("/api/import/url", {
      url: origin + "/other.pdf",
    });
    expect(cached.id).toBe(legacy.id);
    expect(requests).toBe(count);
  } finally {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

it("does not lose later imports when a client disconnects during a download", async () => {
  const { createServer } = await import("node:http");
  const { fixturePdf } = await import("./fixtures/pdf");
  let release!: () => void;
  let started!: () => void;
  const downloading = new Promise<void>((resolve) => (started = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const upstream = createServer(async (_req, res) => {
    started();
    await gate;
    res.setHeader("content-type", "application/pdf");
    res.end(fixturePdf("Cancelled client download"));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address() as import("node:net").AddressInfo;
  const url = `http://127.0.0.1:${address.port}/slow.pdf`;
  const controller = new AbortController();
  try {
    const first = fetch(base + "/api/import/url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    }).catch(() => null);
    await downloading;
    controller.abort();
    await first;
    const later = fetch(base + "/api/import/url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "data:text/html,<title>After%20disconnect</title><p>retained</p>",
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    expect((await later).ok).toBe(true);
    const docs = await (await fetch(base + "/api/documents")).json();
    expect(docs.some((item: any) => item.source === url)).toBe(true);
    expect(docs.some((item: any) => item.title === "After disconnect")).toBe(
      true,
    );
  } finally {
    release();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

it("retains committed PDFs when a notes export fails and reports a recoverable warning", async () => {
  const { fixturePdf } = await import("./fixtures/pdf");
  const blocked = path.join(dir, "blocked-notes");
  await fs.writeFile(blocked, "not a directory");
  await fs.writeFile(
    path.join(dir, "project.json"),
    JSON.stringify({ directory: blocked }),
  );
  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob(
        [new Uint8Array(fixturePdf("Committed despite export failure"))],
        { type: "application/pdf" },
      ),
      "export-failure.pdf",
    );
    const response = await fetch(base + "/api/import/file", {
      method: "POST",
      body: form,
    });
    expect(response.ok).toBe(true);
    const document = await response.json();
    expect(document.warning).toContain("笔记同步失败");
    expect((await fetch(base + "/api/documents/" + document.id)).ok).toBe(true);
    expect(
      (await fs.readFile(path.join(dir, document.fileUrl.replace(/^\//, ""))))
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
  } finally {
    await fs.unlink(path.join(dir, "project.json"));
    await fetch(base + "/api/import/url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "data:text/html,<title>Notes%20sync%20recovered</title><p>recovered</p>",
      }),
    });
  }
});

it('exposes complete recoverable library operations through MCP using the same HTTP validation', async () => {
  const rpc = async (name: string, args: unknown = {}) => {
    const body = await (await fetch(base + '/mcp', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),
    })).json();
    return body.result;
  };
  const call = async (name: string, args: unknown = {}) => {
    const result = await rpc(name,args);
    expect(result.isError).not.toBe(true);
    return JSON.parse(result.content[0].text);
  };
  const listed = await (await fetch(base + '/mcp', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:2,method:'tools/list'})})).json();
  expect(listed.result.tools.map((tool: any) => tool.name)).toEqual(expect.arrayContaining(['get_document','get_trash','manage_document','manage_annotation','control_reader']));
  const document = await call('manage_document', {operation:'import',url:'data:text/html,<title>MCP%20workflow</title><p>test%20quote</p>'});
  expect((await call('list_documents')).some((doc: any) => doc.id === document.id)).toBe(true);
  await call('manage_document', {operation:'rename',documentId:document.id,title:'Renamed from MCP'});
  expect((await call('get_document',{documentId:document.id})).title).toBe('Renamed from MCP');
  const location = JSON.stringify({rects:[{page:1,x:0.1,y:0.2,w:0.3,h:0.02}]});
  const annotation = await call('manage_annotation', {operation:'create',documentId:document.id,quote:'test quote',location,note:''});
  expect(annotation.note).toBe('');
  await call('manage_annotation', {operation:'update',annotationId:annotation.id,note:'**Review** $x^2$',documentId:'wrong-owner'});
  const annotations = await call('get_annotations',{documentId:document.id});
  expect(annotations[0]).toMatchObject({id:annotation.id,documentId:document.id,note:'**Review** $x^2$',location});
  expect((await rpc('manage_annotation',{operation:'update',annotationId:annotation.id,note:42})).isError).toBe(true);
  expect((await rpc('manage_document',{operation:'rename',documentId:document.id,title:''})).isError).toBe(true);
  expect((await rpc('get_annotations')).isError).toBe(true);
  await call('manage_annotation',{operation:'delete',annotationId:annotation.id});
  expect(await call('get_annotations',{documentId:document.id})).toEqual([]);
  expect((await call('get_trash')).annotations.some((item: any) => item.id === annotation.id)).toBe(true);
  await call('manage_annotation',{operation:'restore',annotationId:annotation.id});
  await call('manage_document',{operation:'delete',documentId:document.id});
  expect((await rpc('get_document',{documentId:document.id})).isError).toBe(true);
  await call('manage_document',{operation:'restore',documentId:document.id});
  expect((await call('get_annotations',{documentId:document.id}))[0]).toMatchObject({id:annotation.id,location,note:'**Review** $x^2$'});
});

it('broadcasts committed library changes and gives reconnecting clients a current revision', async () => {
  const controller = new AbortController();
  const response = await fetch(base + '/api/library/events',{signal:controller.signal});
  const reader = response.body!.getReader();
  const revision = async () => {
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    return JSON.parse(text.match(/data: (.*)/)![1]).revision;
  };
  try {
    const before = await revision();
    await fetch(base + '/api/import/url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'data:text/html,<title>Library%20event</title><p>body</p>'})});
    const after = await revision();
    expect(after).toBeGreaterThan(before);
    const reconnect = await fetch(base + '/api/library/events',{signal:controller.signal});
    const next = await reconnect.body!.getReader().read();
    expect(new TextDecoder().decode(next.value)).toContain(`"revision":${after}`);
  } finally { controller.abort(); }
});


it('multiplexes agent snapshots, reader commands and library changes on one connection', async () => {
  const controller = new AbortController();
  const response = await fetch(base + '/api/live/events?clientId=multiplex-test',{signal:controller.signal});
  const reader = response.body!.getReader();
  let buffer = '';
  const next = async (type: string) => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) { buffer += new TextDecoder().decode((await reader.read()).value); continue; }
      const frame = buffer.slice(0,boundary); buffer = buffer.slice(boundary + 2);
      const match = frame.match(/data: (.*)/);
      if (match) { const event = JSON.parse(match[1]); if (event.type === type) return event.data; }
    }
  };
  try {
    expect((await next('agent')).protocolVersion).toBe(1);
    await next('library');
    const command = fetch(base + '/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:1,method:'tools/call',params:{name:'control_reader',arguments:{action:'get_state',clientId:'multiplex-test'}}})});
    const request = await next('reader');
    expect(request.action).toBe('get_state');
    await fetch(base + '/api/ui/ack',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientId:'multiplex-test',id:request.id,result:{ok:true,state:{page:2}}})});
    expect((await (await command).json()).result.isError).toBe(false);
    await fetch(base + '/api/import/url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'data:text/html,<title>Multiplex%20update</title><p>body</p>'})});
    expect((await next('library')).revision).toBeGreaterThan(0);
  } finally { controller.abort(); }
});
