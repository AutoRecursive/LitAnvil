import { ResizeHandle } from "./ResizeHandle";
import { usePaneLayout } from "./usePaneLayout";
import { Markdown } from "./Markdown";
import { Chat } from "./Chat";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useReaderBridge } from "./useReaderBridge";
import { PdfReader } from "./PdfReader";

type Doc = {
  id: string;
  title: string;
  author: string;
  source: string;
  sourceType: string;
  tags: string[];
  createdAt: string;
  progress: number;
  content: string;
  htmlSnapshot?: string;
  fileUrl?: string;
};
type Ann = {
  id: string;
  documentId: string;
  quote: string;
  note: string;
  aiAnswer?: string;
  color: string;
  location: string;
  createdAt: string;
};
type QueueItem = {
  id: string;
  url: string;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  message: string;
};
const API = "http://localhost:8787/api";

async function api(path: string, init?: RequestInit) {
  const r = await fetch(API + path, init);
  if (!r.ok) {
    const text = await r.text();
    let message = text;
    try {
      message = JSON.parse(text).error || text;
    } catch {}
    throw new Error(message);
  }
  return r.json();
}
export function App() {
  const sidebarSections = useRef<HTMLDivElement>(null);
  const readerLayout = useRef<HTMLDivElement>(null);
  const readerToolbar = useRef<HTMLDivElement>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [dark, setDark] = useState(
    () => localStorage.getItem("litanvil-theme") === "dark",
  );
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 900);
  const [documentsOpen, setDocumentsOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const panes = usePaneLayout(leftOpen, rightOpen);
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState("");
  const [selectionLocation, setSelectionLocation] = useState("");
  const [note, setNote] = useState("");
  const [editingAnn, setEditingAnn] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [annotationPending, setAnnotationPending] = useState(false);
  const [dir, setDir] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [projectError, setProjectError] = useState("");
  const reader = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api("/documents")
      .then((items: Doc[]) => {
        setDocs(items);
        const saved = sessionStorage.getItem("litanvil-open-document");
        const doc = items.find((d) => d.id === saved);
        if (doc) setSelected(doc);
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (selected) sessionStorage.setItem("litanvil-open-document", selected.id);
  }, [selected?.id]);
  useEffect(() => {
    localStorage.setItem("litanvil-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    let active = true;
    setAnns([]);
    setSelection("");
    setNote("");
    setSelectionLocation("");
    setEditingAnn(null);
    if (selected)
      api(`/documents/${selected.id}/annotations`)
        .then((items) => {
          if (active) setAnns(items);
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [selected?.id]);
  useEffect(() => {
    const media = window.matchMedia("(max-width:900px)");
    const change = () => setLeftOpen(!media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!projectOpen) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [projectOpen]);
  useReaderBridge({
    docs,
    selected,
    leftOpen,
    rightOpen,
    zoom,
    reader,
    openDocument,
    setZoom,
    setLeftOpen,
    setRightOpen,
  });
  function jumpToAnnotation(a: Ann) {
    try {
      const anchor = JSON.parse(a.location);
      const page = reader.current?.querySelector<HTMLElement>(
        `.pdf-page[data-page="${anchor.rects?.[0]?.page}"]`,
      );
      if (page) {
        page.scrollIntoView({ behavior: "smooth", block: "start" });
        if (window.innerWidth <= 900) setLeftOpen(false);
      } else setError("批注页面尚未加载，请稍后再试");
    } catch {}
  }
  const filtered = useMemo(
    () =>
      docs.filter((d) =>
        `${d.title} ${d.source}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [docs, query],
  );
  async function importUrl(inputUrl = url) {
    if (!inputUrl) return;
    const item = {
      id: crypto.randomUUID(),
      url: inputUrl,
      status: "queued" as const,
      progress: 0,
      message: "等待处理",
    };
    setQueue((q) => [item, ...q]);
    setError("");
    setUrl("");
    setImporting(true);
    setQueue((q) =>
      q.map((x) =>
        x.id === item.id
          ? {
              ...x,
              status: "downloading",
              progress: 35,
              message: "正在获取正文或 PDF…",
            }
          : x,
      ),
    );
    try {
      const d = await api("/import/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url }),
      });
      setDocs((x) => [d, ...x.filter((item) => item.id !== d.id)]);
      openDocument(d);
      setQueue((q) =>
        q.map((x) =>
          x.id === item.id
            ? { ...x, status: "done", progress: 100, message: "已完成" }
            : x,
        ),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "导入失败";
      setError(message);
      setQueue((q) =>
        q.map((x) =>
          x.id === item.id
            ? { ...x, status: "error", progress: 0, message }
            : x,
        ),
      );
    } finally {
      setImporting(false);
    }
  }
  async function deleteDocument(id: string) {
    if (!window.confirm("删除这篇文档及其批注？")) return;
    try {
      await api(`/documents/${id}`, { method: "DELETE" });
      setDocs((xs) => xs.filter((x) => x.id !== id));
      if (selected?.id === id) closeDocument();
    } catch (e) {
      setError(String(e));
    }
  }
  async function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const f = new FormData();
      f.append("file", file);
      const d = await api("/import/file", { method: "POST", body: f });
      setDocs((x) => [d, ...x.filter((item) => item.id !== d.id)]);
      openDocument(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }
  function capture() {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !reader.current?.contains(sel.anchorNode)) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    const rects: any[] = [];
    reader.current
      .querySelectorAll<HTMLElement>(".pdf-page")
      .forEach((page) => {
        const bounds = page.getBoundingClientRect();
        for (const r of range.getClientRects()) {
          const x = Math.max(r.left, bounds.left),
            y = Math.max(r.top, bounds.top),
            right = Math.min(r.right, bounds.right),
            bottom = Math.min(r.bottom, bounds.bottom);
          if (right > x && bottom > y)
            rects.push({
              page: Number(page.dataset.page),
              x: (x - bounds.left) / bounds.width,
              y: (y - bounds.top) / bounds.height,
              w: (right - x) / bounds.width,
              h: (bottom - y) / bounds.height,
            });
        }
      });
    setSelection(text);
    setSelectionLocation(JSON.stringify({ version: 1, rects }));
    setNote("");
    setRightOpen(true);
  }
  async function saveAnnotation(noteOverride = note) {
    if (!selected || !selection || annotationPending) return;
    const documentId = selected.id;
    setAnnotationPending(true);
    try {
      const a = await api("/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          quote: selection,
          note: noteOverride,
          location: selectionLocation || "reader-selection",
          color: "#f0b429",
        }),
      });
      if (sessionStorage.getItem("litanvil-open-document") === documentId) {
        setAnns((x) => [...x, a]);
        setSelection("");
        setSelectionLocation("");
        setNote("");
        window.getSelection()?.removeAllRanges();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAnnotationPending(false);
    }
  }
  function openDocument(document: Doc) {
    setSelected(document);
    if (window.innerWidth <= 900) setLeftOpen(false);
  }
  function closeDocument() {
    sessionStorage.removeItem("litanvil-open-document");
    setSelected(null);
  }
  async function deleteAnnotation(id: string) {
    try {
      await api(`/annotations/${id}`, { method: "DELETE" });
      setAnns((items) => items.filter((a) => a.id !== id));
      if (editingAnn === id) setEditingAnn(null);
    } catch (e) {
      setError(String(e));
    }
  }
  async function updateAnnotation(id: string) {
    if (annotationPending) return;
    setAnnotationPending(true);
    try {
      const a = await api(`/annotations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: editNote }),
      });
      setAnns((xs) => xs.map((x) => (x.id === id ? { ...x, ...a } : x)));
      setEditingAnn(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setAnnotationPending(false);
    }
  }
  function exportJson() {
    if (!selected) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            document: selected.title,
            documentId: selected.id,
            annotations: anns,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selected.title}-annotations.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  useEffect(() => {
    api("/project")
      .then((result) => {
        setDir(result.directory);
        setProjectDraft(result.directory);
      })
      .catch((e) => setError(String(e)));
  }, []);
  async function chooseDir() {
    setProjectDraft(dir);
    setProjectError("");
    setProjectOpen(true);
  }
  async function saveProject() {
    try {
      const result = await api("/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: projectDraft }),
      });
      setDir(result.directory);
      setProjectOpen(false);
    } catch (e) {
      setProjectError(String(e));
    }
  }
  async function exportMd() {
    if (selected)
      window.open(`${API}/documents/${selected.id}/export.md`, "_blank");
  }
  function saveProgress(e: React.UIEvent<HTMLElement>) {
    if (!selected) return;
    const el = e.currentTarget;
    const progress = Math.min(
      1,
      Math.max(
        0,
        el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
      ),
    );
    if (Math.abs(progress - selected.progress) > 0.02) {
      const next = { ...selected, progress };
      setSelected(next);
      setDocs((x) => x.map((d) => (d.id === next.id ? next : d)));
      api(`/documents/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress }),
      }).catch(() => {});
    }
  }
  return (
    <div className={dark ? "app dark" : "app"} style={panes.style}>
      {projectOpen && (
        <div className="modal-backdrop">
          <section
            className="project-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="笔记目录"
          >
            <h2>笔记目录</h2>
            <input
              autoFocus
              aria-label="目录路径"
              value={projectDraft}
              onChange={(e) => setProjectDraft(e.target.value)}
            />
            {projectError && <p role="alert">{projectError}</p>}
            <div>
              <button onClick={() => setProjectOpen(false)}>取消</button>
              <button onClick={saveProject}>保存</button>
            </div>
          </section>
        </div>
      )}
      {error && (
        <div className="app-error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭错误提示" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <header>
        <div className="brand">
          <span className="anvil">✦</span>
          <div>
            <b>LitAnvil</b>
          </div>
        </div>
        <div className="header-actions">
          <button className="ghost" onClick={chooseDir}>
            ⌂ 笔记目录
          </button>
          <button
            className="icon"
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
            onClick={() => setDark(!dark)}
          >
            {dark ? "☀" : "◐"}
          </button>
        </div>
        <ResizeHandle
          className="header-resize"
          orientation="horizontal"
          label="顶部栏高度"
          value={panes.layout.headerHeight}
          min={48}
          max={96}
          defaultValue={64}
          onChange={(value) => panes.set("headerHeight", value)}
        />
      </header>
      <div className={`layout ${selected ? "reader-shell" : "home-shell"}`}>
        {selected && leftOpen && (
          <button
            className="rail-backdrop"
            aria-label="收起目录"
            onClick={() => setLeftOpen(false)}
          />
        )}
        <aside aria-label="文档与批注" className={leftOpen ? "" : "collapsed"}>
          <div className="import-card">
            <div className="label">导入文档</div>
            <div className="url-row">
              <input
                aria-label="导入链接"
                placeholder="粘贴 arXiv 或网页链接"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && importUrl()}
              />
              <button
                aria-label="导入链接"
                onClick={() => importUrl()}
                disabled={importing || !url.trim()}
              >
                ↗
              </button>
            </div>
            <label className="upload">
              ＋ 上传文档
              <input
                aria-label="上传文档"
                type="file"
                accept=".pdf,.txt,.md"
                disabled={importing}
                onChange={importFile}
              />
            </label>
          </div>
          {queue.length > 0 && (
            <div className="queue">
              <div className="queue-title">
                下载队列{" "}
                <span>
                  {
                    queue.filter(
                      (x) =>
                        x.status === "downloading" || x.status === "queued",
                    ).length
                  }{" "}
                  处理中
                </span>
              </div>
              {queue.slice(0, 4).map((x) => (
                <div className="queue-item" key={x.id}>
                  <div className="queue-line">
                    <span>
                      {x.status === "done"
                        ? "✓"
                        : x.status === "error"
                          ? "!"
                          : "↻"}
                    </span>
                    <b>{x.url.replace(/^https?:\/\//, "").slice(0, 26)}</b>
                    <small>{x.message}</small>
                  </div>
                  <div className="queue-bar">
                    <i
                      style={{
                        width: `${x.status === "downloading" ? "55" : x.progress}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="search">
            <input
              placeholder="搜索文档"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="sidebar-sections" ref={sidebarSections}>
            <nav className="document-nav">
              <button
                aria-expanded={documentsOpen}
                className="document-toggle"
                onClick={() => setDocumentsOpen((open) => !open)}
              >
                <span>{documentsOpen ? "▾" : "▸"} 全部文档</span>
                <em>{docs.length}</em>
              </button>
              {documentsOpen && (
                <div className="sidebar-documents">
                  {filtered.map((d) => (
                    <button
                      key={d.id}
                      title={d.title}
                      className={selected?.id === d.id ? "active" : ""}
                      onClick={() => openDocument(d)}
                    >
                      {d.title}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="sidebar-empty">暂无文档</p>
                  )}
                </div>
              )}
            </nav>
            {documentsOpen && (
              <ResizeHandle
                orientation="horizontal"
                label="文档与批注分区"
                value={panes.layout.documentShare}
                min={15}
                max={80}
                defaultValue={40}
                step={2}
                pixelsPerUnit={() =>
                  Math.max(
                    1,
                    (sidebarSections.current?.clientHeight || 100) / 100,
                  )
                }
                onChange={(value) => panes.set("documentShare", value)}
              />
            )}
            <div className="ann-list">
              <div className="ann-head">
                本篇批注 <span>{anns.length}</span>
              </div>
              {anns.map((a) => (
                <div className="ann" key={a.id}>
                  <blockquote
                    role="button"
                    tabIndex={0}
                    onClick={() => jumpToAnnotation(a)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") jumpToAnnotation(a);
                    }}
                    title="跳转到批注位置"
                  >
                    {a.quote || "高亮"}
                  </blockquote>
                  {editingAnn === a.id ? (
                    <>
                      <textarea
                        className="ann-editor"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                      />
                      <div className="ann-actions">
                        <button
                          disabled={annotationPending}
                          onClick={() => updateAnnotation(a.id)}
                        >
                          保存
                        </button>
                        <button onClick={() => setEditingAnn(null)}>
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Markdown className="annotation-content">
                        {a.note || a.aiAnswer || "高亮"}
                      </Markdown>
                      <button
                        className="ann-delete"
                        onClick={() => deleteAnnotation(a.id)}
                      >
                        删除
                      </button>
                      <button
                        className="ann-edit"
                        onClick={() => {
                          setEditingAnn(a.id);
                          setEditNote(a.note || "");
                        }}
                      >
                        编辑
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <ResizeHandle
            className="sidebar-width-resize"
            orientation="vertical"
            label="左侧栏宽度"
            value={panes.leftWidth}
            min={180}
            max={
              panes.narrow
                ? Math.min(500, panes.width * 0.85)
                : Math.max(
                    180,
                    Math.min(
                      500,
                      panes.width - (rightOpen ? panes.rightWidth : 0) - 268,
                    ),
                  )
            }
            defaultValue={240}
            onChange={(value) => panes.set("leftWidth", value)}
          />
        </aside>
        <main>
          {!selected ? (
            <>
              <div className="welcome chat-home">
                <h1>
                  把链接交给我，
                  <br />
                  <i>开始共读</i>
                </h1>
                <div className="home-chat-panel">
                  <Chat onImport={importUrl} />
                </div>
                <div className="home-import-state" aria-live="polite">
                  {importing && <span>正在导入文档…</span>}
                </div>
                <section className="home-library">
                  <div className="library-head">
                    <b>
                      全部文档 <span>{docs.length}</span>
                    </b>
                    <label className="upload">
                      ＋ 上传文档
                      <input
                        aria-label="上传文档"
                        type="file"
                        accept=".pdf,.txt,.md"
                        disabled={importing}
                        onChange={importFile}
                      />
                    </label>
                  </div>
                  <input
                    className="library-search"
                    aria-label="搜索文档"
                    placeholder="搜索文档"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {filtered.length === 0 ? (
                    <div className="library-empty">
                      {query ? "未找到文档" : "暂无文档"}
                    </div>
                  ) : (
                    <div className="library-grid">
                      {filtered.map((d) => (
                        <div className="library-card" key={d.id}>
                          <button
                            className="library-open"
                            onClick={() => openDocument(d)}
                          >
                            <span>{d.sourceType}</span>
                            <b>{d.title}</b>
                            <small>{Math.round(d.progress * 100)}% 已读</small>
                          </button>
                          <button
                            className="document-delete"
                            aria-label={`删除 ${d.title}`}
                            onClick={() => deleteDocument(d.id)}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <>
              <div className="reader-top" ref={readerToolbar}>
                <button className="back" onClick={() => closeDocument()}>
                  ← 文档库
                </button>
                <button
                  className="panel-toggle"
                  aria-expanded={leftOpen}
                  onClick={() => setLeftOpen((v) => !v)}
                >
                  {leftOpen ? "收起目录" : "展开目录"}
                </button>
                <div className="reader-title">
                  <span className="pill">{selected.sourceType}</span>
                  <b>{selected.title}</b>
                </div>
                <div className="reader-actions">
                  <button
                    className="panel-toggle"
                    aria-expanded={rightOpen}
                    onClick={() => setRightOpen((v) => !v)}
                  >
                    {rightOpen ? "收起 Agent" : "展开 Agent"}
                  </button>
                  <button
                    aria-label="缩小"
                    disabled={zoom <= 0.75}
                    onClick={() =>
                      setZoom((z) =>
                        Math.max(0.75, Number((z - 0.1).toFixed(2))),
                      )
                    }
                  >
                    −
                  </button>
                  <span className="zoom-label">{Math.round(zoom * 100)}%</span>
                  <button
                    aria-label="放大"
                    disabled={zoom >= 1.8}
                    onClick={() =>
                      setZoom((z) =>
                        Math.min(1.8, Number((z + 0.1).toFixed(2))),
                      )
                    }
                  >
                    ＋
                  </button>
                  <button onClick={exportMd}>↓ Markdown</button>
                  <button onClick={exportJson}>JSON</button>
                </div>
                <ResizeHandle
                  className="toolbar-resize"
                  orientation="horizontal"
                  label="阅读工具栏高度"
                  value={panes.layout.toolbarHeight}
                  startValue={() =>
                    readerToolbar.current?.clientHeight ||
                    panes.layout.toolbarHeight
                  }
                  min={56}
                  max={140}
                  defaultValue={56}
                  onChange={(value) => panes.set("toolbarHeight", value)}
                />
              </div>
              <div className="reader-layout" ref={readerLayout}>
                <article
                  className="paper"
                  data-document-id={selected.id}
                  ref={reader}
                  onMouseUp={capture}
                  onScroll={saveProgress}
                >
                  <div className="paper-meta">
                    <div className="eyebrow">
                      {selected.sourceType === "arxiv"
                        ? "ARXIV PAPER"
                        : "READING DOCUMENT"}
                    </div>
                    <h1>{selected.title}</h1>
                    <a
                      href={
                        /^https?:\/\//.test(selected.source)
                          ? selected.source
                          : selected.fileUrl
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      {selected.source}
                    </a>
                  </div>
                  {selected.sourceType === "arxiv" ? (
                    selected.fileUrl ? (
                      <PdfReader
                        src={selected.fileUrl}
                        scale={1.25 * zoom}
                        onSelection={capture}
                        annotations={anns}
                      />
                    ) : (
                      <div className="pdf-error">
                        PDF 未准备好，无法打开阅读器。
                      </div>
                    )
                  ) : selected.sourceType === "pdf" ? (
                    selected.fileUrl ? (
                      <PdfReader
                        src={selected.fileUrl}
                        scale={1.25 * zoom}
                        onSelection={capture}
                        annotations={anns}
                      />
                    ) : (
                      <div className="pdf-error">
                        PDF 文件缺失，无法打开阅读器。
                      </div>
                    )
                  ) : (
                    <div
                      className="paper-body"
                      style={{ fontSize: `${zoom}em` }}
                    >
                      {selected.content.split(/\n+/).map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </div>
                  )}
                </article>
                {rightOpen && (
                  <ResizeHandle
                    className="reader-agent-resize"
                    orientation={panes.narrow ? "horizontal" : "vertical"}
                    label={
                      panes.narrow ? "PDF 与 Agent 上下分区" : "右侧栏宽度"
                    }
                    value={
                      panes.narrow ? panes.layout.readerShare : panes.rightWidth
                    }
                    min={panes.narrow ? 25 : 260}
                    max={
                      panes.narrow
                        ? 80
                        : Math.max(
                            260,
                            Math.min(
                              700,
                              panes.width -
                                (leftOpen ? panes.leftWidth : 0) -
                                268,
                            ),
                          )
                    }
                    defaultValue={panes.narrow ? 60 : 360}
                    direction={panes.narrow ? 1 : -1}
                    step={panes.narrow ? 2 : 10}
                    pixelsPerUnit={() =>
                      panes.narrow
                        ? Math.max(
                            1,
                            (readerLayout.current?.clientHeight || 100) / 100,
                          )
                        : 1
                    }
                    onChange={(value) =>
                      panes.set(
                        panes.narrow ? "readerShare" : "rightWidth",
                        value,
                      )
                    }
                  />
                )}
                <section className={`ai-panel ${rightOpen ? "" : "collapsed"}`}>
                  <Chat
                    documentId={selected.id}
                    quote={selection}
                    onImport={importUrl}
                  >
                    {selection && (
                      <div className="selection-actions">
                        <textarea
                          aria-label="批注内容"
                          placeholder="添加评论（留空即为高亮）"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <button
                          disabled={annotationPending}
                          onClick={() => saveAnnotation(note)}
                        >
                          {note.trim() ? "保存批注" : "保存高亮"}
                        </button>
                        <button
                          onClick={() => {
                            setSelection("");
                            setSelectionLocation("");
                            setNote("");
                          }}
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </Chat>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
