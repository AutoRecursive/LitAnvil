import { Topics } from "./Topics";
import {paneBounds, paneDefaults} from "../shared/reader-layout";
import { downloadAnnotations } from "./document-download";
import type {ExportFormat} from "../shared/document-export";
import { pdfSelectionLocation } from "./pdf-text";
import { API, api, assetUrl } from "./api";
import { Dialog } from "./Dialog";
import { TrashDialog } from "./TrashDialog";
import { ResizeHandle } from "./ResizeHandle";
import { usePaneLayout } from "./usePaneLayout";
import { Markdown } from "./Markdown";
import { Chat } from "./Chat";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useReaderBridge } from "./useReaderBridge";
import { PdfReader } from "./PdfReader";
import { PageNavigation } from "./PageNavigation";
import { useLibrarySync } from "./useLibrarySync";
import { useReadingPosition } from "./useReadingPosition";
import { Notebook } from './Notebook';
import { selectionReference, referenceMarkdown, type PaperReference } from '../shared/paper-reference';
import { scrollReaderTo } from './reader-position';
import { readReaderView, writeReaderView, readerViewDefaults } from "./view-state";

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
  topicId?: string | null;
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
const annotationPalette = [
  {name: "暖沙", color: "#c9b58f"},
  {name: "豆沙粉", color: "#c99e9e"},
  {name: "鼠尾草绿", color: "#9eafa0"},
  {name: "雾霾蓝", color: "#91a6b5"},
  {name: "灰紫", color: "#afa0b5"},
  {name: "陶土", color: "#bd9a88"},
];
type QueueItem = {
  id: string;
  url: string;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  message: string;
};
export function App() {
  const savedView = useRef(readReaderView()).current;
  const sidebarSections = useRef<HTMLDivElement>(null);
  const homeLayout = useRef<HTMLDivElement>(null);
  const [homeShare, setHomeShare] = useState(() => {
    const value = Number(localStorage.getItem("litanvil-home-share"));
    return value >= 30 && value <= 70 ? value : 50;
  });
  useEffect(() => { localStorage.setItem("litanvil-home-share", String(homeShare)); }, [homeShare]);
  const readerLayout = useRef<HTMLDivElement>(null);
  const readerToolbar = useRef<HTMLDivElement>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [topicRevision, setTopicRevision] = useState(0);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const navigationIntent = useRef(0);
  const importCount = useRef(0);
  const [dark, setDark] = useState(
    () => localStorage.getItem("litanvil-theme") === "dark",
  );
  const [leftOpen, setLeftOpen] = useState(() => savedView.leftOpen ?? window.innerWidth > 900);
  const [documentsOpen, setDocumentsOpen] = useState(() => savedView.documentsOpen ?? readerViewDefaults.documentsOpen);
  const [rightOpen, setRightOpen] = useState(() => savedView.rightOpen ?? readerViewDefaults.rightOpen);
  const panes = usePaneLayout(leftOpen, rightOpen);
  const [zoom, setZoom] = useState(() => typeof savedView.zoom === "number" ? Math.max(.75, Math.min(1.8, savedView.zoom)) : readerViewDefaults.zoom);
  const [selection, setSelection] = useState("");
  const [selectionLocation, setSelectionLocation] = useState("");
  const [note, setNote] = useState("");
  const [sideMode,setSideMode]=useState<'agent'|'notes'>('agent');
  const [insertion,setInsertion]=useState<{id:string;documentId:string;markdown:string}>();
  const [reference,setReference]=useState<PaperReference>();
  const [editingAnn, setEditingAnn] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [annotationColor, setAnnotationColor] = useState(annotationPalette[0].color);
  const [editColor, setEditColor] = useState(annotationPalette[0].color);
  const annotationInput = useRef<HTMLTextAreaElement>(null);
  const editingAnnotation = anns.find(annotation => annotation.id === editingAnn);
  useEffect(() => { if (editingAnn) annotationInput.current?.focus({preventScroll:true}); }, [editingAnn]);
  const [annotationPending, setAnnotationPending] = useState(false);
  const [focusedAnnotation, setFocusedAnnotation] = useState<{id:string; sequence:number} | null>(null);
  useEffect(() => {
    if (!focusedAnnotation || !leftOpen) return;
    const list = sidebarSections.current?.querySelector<HTMLElement>(".ann-list");
    const row = [...(list?.querySelectorAll<HTMLElement>("[data-annotation-id]") || [])].find(item => item.dataset.annotationId === focusedAnnotation.id);
    if (list && row) list.scrollTo({top: list.scrollTop + row.getBoundingClientRect().top - list.getBoundingClientRect().top - 48, behavior: "smooth"});
  }, [focusedAnnotation, leftOpen]);
  function showAnnotation(id: string) {
    setLeftOpen(true);
    setFocusedAnnotation(previous => ({id, sequence: (previous?.sequence || 0) + 1}));
  }
  const [dir, setDir] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [notice, setNotice] = useState<{
    id: string;
    kind: "document" | "annotation";
    message: string;
  } | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [projectError, setProjectError] = useState("");
  const reader = useRef<HTMLDivElement>(null);
  const viewHydrated = useRef(false);
  const [libraryReady, setLibraryReady] = useState(false);
  useEffect(() => {
    const warning = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    window.addEventListener("litanvil-warning", warning);
    return () => window.removeEventListener("litanvil-warning", warning);
  }, []);
  useEffect(() => {
    api("/documents")
      .then((items: Doc[]) => {
        setDocs(items);
        const saved = localStorage.getItem("litanvil-reader-view") ? readReaderView().documentId : sessionStorage.getItem("litanvil-open-document");
        const doc = items.find((d) => d.id === saved);
        if (doc) setSelected(doc);
        viewHydrated.current = true;
        setLibraryReady(true);
      })
      .catch((e) => { console.warn("[Library] initial connection failed",e); if (!savedView.documentId) setLibraryReady(true); setError("暂时无法连接文档库，恢复连接后将自动重试"); });
  }, []);
  useEffect(() => {
    if (selected) {
      sessionStorage.setItem("litanvil-open-document", selected.id);
      if (viewHydrated.current) writeReaderView({ ...readReaderView(), documentId: selected.id, zoom, leftOpen, rightOpen, documentsOpen });
    }
  }, [selected?.id]);
  useEffect(() => {
    if (!viewHydrated.current) return;
    writeReaderView({ ...readReaderView(), documentId: selected?.id, zoom, leftOpen, rightOpen, documentsOpen });
  }, [selected?.id, zoom, leftOpen, rightOpen, documentsOpen]);
  useEffect(() => {
    localStorage.setItem("litanvil-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    let active = true;
    setAnns([]);
    setFocusedAnnotation(null);
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
  useLibrarySync({ selected, setDocuments: setDocs, setSelected, setAnnotations: setAnns,
    onSynced:()=>{
      setLibraryReady(true);
      setTopicRevision(value=>value+1);
      setError(value=>value==="暂时无法连接文档库，恢复连接后将自动重试"?"":value);
      if (!dir) void loadProject();
    },
  });
  useReaderBridge({
    docs,
    selected,
    leftOpen,
    rightOpen,
    zoom,
    reader,
    openDocument,
    closeDocument,
    annotationCount: anns.length,
    paneLayout:panes.layout,
    setPaneLayout:panes.apply,
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
    const intent = ++navigationIntent.current;
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
    importCount.current++;
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
      if (intent === navigationIntent.current) openDocument(d);
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
      importCount.current = Math.max(0, importCount.current - 1);
      setImporting(importCount.current > 0);
    }
  }
  async function refreshLibrary() {
    try {
      setDocs(await api("/documents"));
      if (selected) setAnns(await api(`/documents/${selected.id}/annotations`));
    } catch (error) {
      setError(String(error));
    }
  }
  async function undoDelete() {
    if (!notice || undoPending) return;
    setUndoPending(true);
    try {
      await api(
        `/${notice.kind === "document" ? "documents" : "annotations"}/${notice.id}/restore`,
        { method: "POST" },
      );
      await refreshLibrary();
      setNotice(null);
    } catch (error) {
      setError(String(error));
    } finally {
      setUndoPending(false);
    }
  }
  async function deleteDocument(id: string) {
    try {
      await api(`/documents/${id}`, { method: "DELETE" });
      setDocs((xs) => xs.filter((x) => x.id !== id));
      if (selected?.id === id) closeDocument();
      setNotice({ id, kind: "document", message: "文档已移入回收站" });
    } catch (e) {
      setError(String(e));
    }
  }
  async function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const intent = ++navigationIntent.current;
    importCount.current++;
    setImporting(true);
    setError("");
    try {
      const f = new FormData();
      f.append("file", file);
      const d = await api("/import/file", { method: "POST", body: f });
      setDocs((x) => [d, ...x.filter((item) => item.id !== d.id)]);
      if (intent === navigationIntent.current) openDocument(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      importCount.current = Math.max(0, importCount.current - 1);
      setImporting(importCount.current > 0);
      e.target.value = "";
    }
  }
  function capture() {
    if (annotationPending) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount || !reader.current?.contains(sel.anchorNode)) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    setEditingAnn(null);
    setSelection(text);
    setSelectionLocation(JSON.stringify(pdfSelectionLocation(reader.current, range)));
    setSideMode("agent");
    setNote("");
    setRightOpen(true);
  }
  const selectedReference=selected&&selection?selectionReference(selected.id,selectionLocation):undefined;
  function insertReference(){
    if(!selectedReference)return;
    setInsertion({id:crypto.randomUUID(),documentId:selectedReference.documentId,markdown:referenceMarkdown(selectedReference,selection)});
    setSideMode('notes');setRightOpen(true);
  }
  async function openReference(ref:PaperReference){
    try{
      if(selected?.id!==ref.documentId){
        const doc=docs.find(d=>d.id===ref.documentId)||await api(`/documents/${encodeURIComponent(ref.documentId)}`);
        openDocument(doc);
      }
      setReference(ref);
    }catch(error){setError(String(error));}
  }
  useEffect(()=>{
    if(!reference||selected?.id!==reference.documentId)return;
    const element=reader.current;if(!element)return;
    let done=false;
    const jump=()=>{
      const page=element.querySelector<HTMLElement>(`.pdf-page[data-page="${reference.page}"][data-ready="true"]`);
      if(!page||done)return;
      done=true;scrollReaderTo(element,page);
      const rect=reference.rects.find(r=>r.page===reference.page);
      if(rect)element.scrollTop+=rect.y*page.getBoundingClientRect().height-24;
    };
    const observer=new MutationObserver(jump);observer.observe(element,{subtree:true,childList:true,attributes:true,attributeFilter:['data-ready']});jump();
    return()=>observer.disconnect();
  },[reference,selected?.id]);
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
          color: annotationColor,
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
    navigationIntent.current++;
    setSelected(document);
    if (document.sourceType === "arxiv" && !document.fileUrl && !importing)
      void importUrl(document.source);
    if (window.innerWidth <= 900) setLeftOpen(false);
  }
  function closeDocument() {
    navigationIntent.current++;
    sessionStorage.removeItem("litanvil-open-document");
    writeReaderView({ ...readReaderView(), documentId: undefined });
    setSelected(null);
  }
  async function deleteAnnotation(id: string) {
    try {
      await api(`/annotations/${id}`, { method: "DELETE" });
      setAnns((items) => items.filter((a) => a.id !== id));
      if (editingAnn === id) setEditingAnn(null);
      setNotice({ id, kind: "annotation", message: "批注已移入回收站" });
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
        body: JSON.stringify({ note: editNote, ...(editColor !== (editingAnnotation?.color || annotationPalette[0].color) ? {color: editColor} : {}) }),
      });
      setAnns((xs) => xs.map((x) => (x.id === id ? { ...x, ...a } : x)));
      setEditingAnn(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setAnnotationPending(false);
    }
  }
  async function exportDocument(format:ExportFormat) {
    if (!selected) return;
    try { await downloadAnnotations(selected,format); }
    catch(error) { setError(String(error)); }
  }
  async function loadProject() {
    try {
      const result=await api("/project");
      setDir(result.directory);
      setProjectDraft(result.directory);
      if (result.syncError || result.agentError) setError(result.syncError || result.agentError);
    } catch (error) {
      console.warn("[Project] initial connection failed",error);
      setError("暂时无法连接文档库，恢复连接后将自动重试");
    }
  }
  useEffect(() => { void loadProject(); }, []);
  async function chooseDir(event: React.MouseEvent<HTMLButtonElement>) {
    event.currentTarget.focus();
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
      if (result.syncError || result.agentError) setError(result.syncError || result.agentError);
    } catch (e) {
      setProjectError(String(e));
    }
  }
  const pagination = useReadingPosition({
    id: selected?.id,
    source: selected?.fileUrl ? assetUrl(selected.fileUrl) : undefined,
    initialProgress: selected?.progress || 0,
    reader,
    persist: async (id, progress) => {
      await api(`/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress }),
        keepalive: true,
      });
      setDocs(items => items.map(doc => doc.id === id ? { ...doc, progress } : doc));
      setSelected(doc => doc?.id === id ? { ...doc, progress } : doc);
    },
  });
  return (
    <div className={dark ? "app dark" : "app"} style={panes.style}>
      {projectOpen && (
        <Dialog title="笔记目录" onClose={() => setProjectOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveProject();
            }}
          >
            <input
              autoFocus
              aria-label="目录路径"
              value={projectDraft}
              onChange={(event) => setProjectDraft(event.target.value)}
            />
            {projectError && <p role="alert">{projectError}</p>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setProjectOpen(false)}>
                取消
              </button>
              <button type="submit">保存</button>
            </div>
          </form>
        </Dialog>
      )}
      {trashOpen && (
        <TrashDialog
          onClose={() => setTrashOpen(false)}
          onRestored={async (id) => {
            await refreshLibrary();
            if (notice?.id === id) setNotice(null);
          }}
        />
      )}
      {notice && (
        <div className="undo-notice" role="status">
          <span>{notice.message}</span>
          <button disabled={undoPending} onClick={undoDelete}>
            撤销
          </button>
          <button aria-label="关闭撤销提示" onClick={() => setNotice(null)}>
            ×
          </button>
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
          min={paneBounds.headerHeight[0]}
          max={paneBounds.headerHeight[1]}
          defaultValue={paneDefaults.headerHeight}
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
                min={paneBounds.documentShare[0]}
                max={paneBounds.documentShare[1]}
                defaultValue={paneDefaults.documentShare}
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
                <div className={`ann ${focusedAnnotation?.id === a.id ? "ann-focused" : ""}`} data-annotation-id={a.id} key={a.id}>
                  <blockquote
                    role="button"
                    tabIndex={0}
                    onClick={() => jumpToAnnotation(a)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") jumpToAnnotation(a);
                    }}
                    style={{borderLeftColor: /^#[0-9a-f]{6}$/i.test(a.color || "") ? a.color : undefined}}
                    title="跳转到批注位置"
                  >
                    {a.quote || "高亮"}
                  </blockquote>
                  <Markdown className="annotation-content">
                    {a.note || a.aiAnswer || "高亮"}
                  </Markdown>
                  <button
                    className="ann-delete"
                    disabled={annotationPending}
                    onClick={() => deleteAnnotation(a.id)}
                  >
                    删除
                  </button>
                  <button
                    className="ann-edit"
                    disabled={annotationPending}
                    onClick={() => {
                      window.getSelection()?.removeAllRanges();
                      setSelection("");
                      setSelectionLocation("");
                      setEditingAnn(a.id);
                      setSideMode('agent');
                      setEditNote(a.note || "");
                      setEditColor(a.color || annotationPalette[0].color);
                      setRightOpen(true);
                      if (panes.narrow) setLeftOpen(false);
                    }}
                  >
                    编辑
                  </button>
                </div>
              ))}
            </div>
          </div>
          <ResizeHandle
            className="sidebar-width-resize"
            orientation="vertical"
            label="左侧栏宽度"
            value={panes.leftWidth}
            min={paneBounds.leftWidth[0]}
            max={
              panes.narrow
                ? Math.min(paneBounds.leftWidth[1], panes.width * 0.85)
                : Math.max(
                    paneBounds.leftWidth[0],
                    Math.min(
                      paneBounds.leftWidth[1],
                      panes.width - (rightOpen ? panes.rightWidth : 0) - 268,
                    ),
                  )
            }
            defaultValue={paneDefaults.leftWidth}
            onChange={(value) => panes.set("leftWidth", value)}
          />
        </aside>
        <main>
          {!selected && savedView.documentId && !libraryReady ? (
            <div className="reader-recovery" role="status">正在恢复上次阅读位置…</div>
          ) : !selected ? (
            <>
              <div className="welcome chat-home" ref={homeLayout} style={{"--home-share": `${homeShare}%`} as React.CSSProperties}>
                <section className="home-library">
                  <Topics docs={filtered} revision={topicRevision} onError={setError} onOpen={id=>{const doc=docs.find(d=>d.id===id);if(doc)openDocument(doc)}} />
                  <div className="library-content">
                  <div className="library-head">
                    <b>
                      全部文档 <span>{docs.length}</span>
                    </b>
                    <div className="library-tools">
                      <button
                        className="trash-toggle"
                        onClick={(event) => {
                          event.currentTarget.focus();
                          setTrashOpen(true);
                        }}
                      >
                        回收站
                      </button>
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
                  </div>
                </section>
                <ResizeHandle className="home-resize" orientation="vertical" label="文档库与对话宽度" value={homeShare} min={30} max={70} defaultValue={50} step={2} pixelsPerUnit={() => Math.max(1, (homeLayout.current?.clientWidth || 100) / 100)} onChange={setHomeShare} />
                <div className="home-conversation">
                <h1>
                  把链接交给我，
                  <br />
                  <i>开始共读</i>
                </h1>
                <div className="home-chat-panel">
                  <Chat onImport={importUrl} composerHeight={panes.layout.composerHeight} onComposerResize={(height)=>panes.set("composerHeight",height)} />
                </div>
                <div className="home-import-state" aria-live="polite">
                  {importing && <span>正在导入文档…</span>}
                </div>
                </div>
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
                  data-panel="directory"
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
                  {pagination.total > 0 && <PageNavigation {...pagination} />}
                  <button
                    className="panel-toggle"
                    data-panel="agent"
                    aria-expanded={rightOpen}
                    onClick={() => setRightOpen((v) => !v)}
                  >
                    {rightOpen ? "收起 Agent" : "展开 Agent"}
                  </button>
                  <button onClick={()=>void exportDocument("markdown")}>↓ Markdown</button>
                  <button onClick={()=>void exportDocument("json")}>JSON</button>
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
                  min={paneBounds.toolbarHeight[0]}
                  max={paneBounds.toolbarHeight[1]}
                  defaultValue={paneDefaults.toolbarHeight}
                  onChange={(value) => panes.set("toolbarHeight", value)}
                />
              </div>
              <div className="reader-layout" ref={readerLayout}>
                <article
                  className={`paper ${selected.sourceType === "arxiv" || selected.sourceType === "pdf" ? "paper-pdf" : ""}`}
                  data-document-id={selected.id}
                  ref={reader}
                  onMouseUp={capture}
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
                            ? assetUrl(selected.fileUrl)
                            : undefined
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      {selected.source}
                    </a>
                  </div>
                  {(selected.sourceType === "arxiv" || selected.sourceType === "pdf") && selected.fileUrl && (
                    <div className="pdf-floating-tools" role="toolbar" aria-label="PDF 缩放">
                      <button aria-label="缩小" disabled={zoom <= 0.75} onClick={() => setZoom(z => Math.max(0.75, Number((z - 0.1).toFixed(2))))}>−</button>
                      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
                      <button aria-label="放大" disabled={zoom >= 1.8} onClick={() => setZoom(z => Math.min(1.8, Number((z + 0.1).toFixed(2))))}>＋</button>
                    </div>
                  )}
                  {selected.sourceType === "arxiv" ? (
                    selected.fileUrl ? (
                      <PdfReader
                        src={assetUrl(selected.fileUrl)}
                        scale={1.25 * zoom}
                        onSelection={capture}
                        annotations={anns}
                        onAnnotationClick={showAnnotation}
                      />
                    ) : (
                      <div className="pdf-error">
                        {importing ? (
                          "正在准备 PDF…"
                        ) : (
                          <button onClick={() => importUrl(selected.source)}>
                            重新下载 PDF
                          </button>
                        )}
                      </div>
                    )
                  ) : selected.sourceType === "pdf" ? (
                    selected.fileUrl ? (
                      <PdfReader
                        src={assetUrl(selected.fileUrl)}
                        scale={1.25 * zoom}
                        onSelection={capture}
                        annotations={anns}
                        onAnnotationClick={showAnnotation}
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
                    min={panes.narrow ? paneBounds.readerShare[0] : paneBounds.rightWidth[0]}
                    max={
                      panes.narrow
                        ? paneBounds.readerShare[1]
                        : Math.max(
                            paneBounds.rightWidth[0],
                            Math.min(
                              paneBounds.rightWidth[1],
                              panes.width -
                                (leftOpen ? panes.leftWidth : 0) -
                                268,
                            ),
                          )
                    }
                    defaultValue={panes.narrow ? paneDefaults.readerShare : paneDefaults.rightWidth}
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
                  <div className="sidebar-modes" role="group" aria-label="侧边栏模式">
                    <button aria-pressed={sideMode==='agent'} onClick={()=>setSideMode('agent')}>Agent</button>
                    <button aria-pressed={sideMode==='notes'} onClick={()=>setSideMode('notes')}>笔记</button>
                  </div>
                  <div className="sidebar-view" hidden={sideMode!=='agent'}>
                  <Chat
                    composerHeight={panes.layout.composerHeight}
                    onComposerResize={(height)=>panes.set("composerHeight",height)}
                    documentId={selected.id}
                    quote={editingAnnotation?.quote || selection}
                    onImport={importUrl}
                  >
                    {(selection || editingAnnotation) && (
                      <div className="selection-actions">
                        <div className="annotation-colors" role="group" aria-label="批注颜色">
                          <span>颜色</span>
                          {annotationPalette.map(({name, color}) => <button type="button" key={color} className="annotation-swatch" aria-label={name} aria-pressed={(editingAnnotation ? editColor : annotationColor) === color} title={name} disabled={annotationPending} onClick={() => editingAnnotation ? setEditColor(color) : setAnnotationColor(color)} style={{"--swatch-color": color} as React.CSSProperties} />)}
                        </div>
                        <textarea
                          ref={annotationInput}
                          aria-label="批注内容"
                          placeholder="添加评论（留空即为高亮）"
                          value={editingAnnotation ? editNote : note}
                          onChange={(e) => editingAnnotation ? setEditNote(e.target.value) : setNote(e.target.value)}
                        />
                        {!editingAnnotation && <button type="button" className="highlight-action" disabled={annotationPending} onClick={() => saveAnnotation("")}>保存高亮</button>}
                        <button
                          disabled={annotationPending || (!editingAnnotation && !note.trim())}
                          onClick={() => editingAnnotation ? updateAnnotation(editingAnnotation.id) : saveAnnotation(note)}
                        >
                          {editingAnnotation ? "保存修改" : "保存评论"}
                        </button>
                        <button
                          disabled={!selectedReference || annotationPending}
                          onClick={insertReference}
                        >插入笔记链接</button>
                        <button
                          className="selection-clear"
                          aria-label="清空评论"
                          disabled={annotationPending || !(editingAnnotation ? editNote : note)}
                          onClick={() => editingAnnotation ? setEditNote("") : setNote("")}
                        >
                          清空评论
                        </button>
                        <button
                          disabled={annotationPending}
                          onClick={() => {
                            setEditingAnn(null);
                            window.getSelection()?.removeAllRanges();
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
                  </div>
                  <div className="sidebar-view" hidden={sideMode!=='notes'}>
                    <Notebook key={selected.id} documentId={selected.id} selectionLink={selectedReference?'available':undefined} insertion={insertion?.documentId===selected.id?insertion:undefined} onInsert={insertReference} onReference={openReference}/>
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
