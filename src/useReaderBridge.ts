import { paneDefaults, validateLayoutPatch, type PaneLayout } from "../shared/reader-layout";
import { downloadAnnotations } from "./document-download";
import { findPdfText, paintPdfPreview } from "./pdf-text";
import { subscribeLive, liveClientId } from "./live";
import { api, assetUrl } from "./api";
import { currentPdfPage, scrollReaderTo } from "./reader-position";
import {
  useEffect,
  useRef,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
const API = "http://localhost:8787/api";
type ReaderDocument = {
  id: string;
  title: string;
  fileUrl?: string;
  sourceType: string;
};
type Options<T extends ReaderDocument> = {
  docs: T[];
  selected: T | null;
  leftOpen: boolean;
  rightOpen: boolean;
  zoom: number;
  annotationCount: number;
  paneLayout: PaneLayout;
  setPaneLayout: (patch:unknown)=>void;
  closeDocument: () => void;
  reader: RefObject<HTMLElement | null>;
  openDocument: (doc: T) => void;
  setZoom: Dispatch<SetStateAction<number>>;
  setLeftOpen: Dispatch<SetStateAction<boolean>>;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
};

export function useReaderBridge<T extends ReaderDocument>(options: Options<T>) {
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    const clientId = liveClientId;
    let disposed = false;
    let connected = false;
    let lastState = "";
    let activityTimer: ReturnType<typeof setTimeout>;
    function snapshot() {
      const state = current.current;
      const reader = state.reader.current;
      const pages = [
        ...(reader?.querySelectorAll<HTMLElement>(".pdf-page") || []),
      ];
      const page = currentPdfPage(reader);
      return {
        documentId: state.selected?.id || null,
        title: state.selected?.title || null,
        page: page ? Number(page.dataset.page) : null,
        loadedPages: pages.length,
        renderedPages: pages.filter((page) => page.dataset.ready === "true")
          .length,
        zoom: state.zoom,
        annotationCount: state.annotationCount,
        layout:state.paneLayout,
        renderedLayout:{
          leftWidth:document.querySelector('aside[aria-label="文档与批注"]')?.getBoundingClientRect().width||0,
          agentWidth:document.querySelector('.ai-panel')?.getBoundingClientRect().width||0,
          readerWidth:reader?.getBoundingClientRect().width||0,
          readerHeight:reader?.getBoundingClientRect().height||0,
          headerHeight:document.querySelector('header')?.getBoundingClientRect().height||0,
          toolbarHeight:document.querySelector('.reader-top')?.getBoundingClientRect().height||0,
        },
        leftOpen: state.leftOpen,
        rightOpen: state.rightOpen,
        visible: document.visibilityState === "visible",
      };
    }
    async function publish(active = false) {
      if (!connected || disposed) return;
      const state = snapshot();
      const serialized = JSON.stringify(state);
      if (!active && serialized === lastState) return;
      lastState = serialized;
      try {
        await fetch(API + "/ui/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, state, active }),
        });
      } catch (error) {
        console.debug("[Reader bridge] state sync failed", error);
      }
    }
    async function waitFor(check: () => boolean) {
      const start = Date.now();
      while (!disposed && !check()) {
        if (Date.now() - start > 10000)
          throw new Error("文档尚未加载完成，请重试");
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (disposed) throw new Error("阅读界面已关闭");
    }
    async function waitReady(documentId: string, page = 1) {
      await waitFor(() => {
        const { selected, reader } = current.current;
        if (
          selected?.id !== documentId ||
          reader.current?.dataset.documentId !== documentId
        )
          return false;
        if (!["pdf", "arxiv"].includes(selected.sourceType)) return true;
        const pdf = reader.current.querySelector<HTMLElement>(".pdf-reader");
        if (
          !selected.fileUrl ||
          pdf?.dataset.source !== assetUrl(selected.fileUrl)
        )
          return false;
        const pages = reader.current.querySelectorAll(".pdf-page");
        if (pages.length && page > pages.length)
          throw new Error(`页码超出范围，共 ${pages.length} 页`);
        return (
          reader.current.querySelector<HTMLElement>(
            `.pdf-page[data-page="${page}"]`,
          )?.dataset.ready === "true"
        );
      });
    }
    async function waitForVisualLayout() {
      let signature="", stableSince=Date.now();
      await waitFor(()=>{
        const state=current.current,reader=state.reader.current;
        const page=currentPdfPage(reader);
        const next=JSON.stringify([snapshot().renderedLayout,page?.style.width,page?.style.height,page?.dataset.ready]);
        if(next!==signature){signature=next;stableSince=Date.now();}
        const ready=!state.selected?.fileUrl || page?.dataset.ready==="true";
        return ready && Date.now()-stableSince>=160;
      });
    }
    const unsubscribe = subscribeLive("reader", async command => {
      if (command.clientId !== clientId) return;
      let result: Record<string, any>;
      let details: Record<string, unknown> = {};
      try {
        const state = current.current;
        switch (command.action) {
          case "get_state":
            break;
          case "open_document": {
            const doc = state.docs.find((doc) => doc.id === command.documentId)
              || await api(`/documents/${encodeURIComponent(String(command.documentId || ""))}`) as T;
            state.openDocument(doc);
            await waitReady(doc.id);
            break;
          }
          case "close_document":
            state.closeDocument();
            await waitFor(() => current.current.selected === null);
            break;
          case "go_to_page": {
            if (!state.selected) throw new Error("请先打开文档");
            if (!Number.isInteger(command.page) || command.page < 1)
              throw new Error("无效页码");
            await waitReady(state.selected.id, command.page);
            const page = state.reader.current?.querySelector<HTMLElement>(
              `.pdf-page[data-page="${command.page}"]`,
            );
            if (!page) throw new Error("该文档不支持 PDF 页码");
            scrollReaderTo(state.reader.current!, page);
            break;
          }
          case "set_layout":
          case "reset_layout": {
            const patch=command.action==="reset_layout"?paneDefaults:validateLayoutPatch(command.layout);
            state.setPaneLayout(patch);
            await waitFor(()=>Object.entries(patch).every(([key,value])=>current.current.paneLayout[key as keyof PaneLayout]===value));
            await waitForVisualLayout();
            break;
          }
          case "download_annotations":
            if (!state.selected) throw new Error("请先打开文档");
            if(command.format!=="json" && command.format!=="markdown")throw new Error("导出格式仅支持 json 或 markdown");
            details={download:await downloadAnnotations(state.selected,command.format)};
            break;
          case "set_zoom": {
            const zoom = Number(command.zoom);
            if (!Number.isFinite(zoom) || zoom < 0.75 || zoom > 1.8)
              throw new Error("缩放范围为 75%–180%");
            state.setZoom(zoom);
            await waitFor(() => current.current.zoom === zoom);
            await waitForVisualLayout();
            break;
          }
          case "toggle_left":
            state.setLeftOpen(command.open ?? !state.leftOpen);
            await waitFor(
              () =>
                current.current.leftOpen === (command.open ?? !state.leftOpen),
            );
            await waitForVisualLayout();
            break;
          case "toggle_right":
            state.setRightOpen(command.open ?? !state.rightOpen);
            await waitFor(
              () =>
                current.current.rightOpen ===
                (command.open ?? !state.rightOpen),
            );
            await waitForVisualLayout();
            break;
          case "clear_preview":
            state.reader.current
              ?.querySelectorAll(".agent-preview")
              .forEach((mark) => mark.remove());
            break;
          case "preview_text": {
            if (command.page !== undefined && (!Number.isInteger(command.page) || command.page < 1)) throw new Error("无效页码");
            if (!state.selected) throw new Error("请先打开文档");
            await waitReady(state.selected.id, command.page || 1);
            const needle = String(command.text || "").trim();
            if (!needle) throw new Error("缺少定位文本");
            if (!command.page) {
              const lastPage = state.reader.current?.querySelectorAll(".pdf-page").length || 1;
              await waitReady(state.selected.id, lastPage);
            }
            const matched = findPdfText(state.reader.current!, needle, command.page);
            matched.sort((a, b) =>
              Math.abs(a.element.getBoundingClientRect().top - state.reader.current!.getBoundingClientRect().top) -
              Math.abs(b.element.getBoundingClientRect().top - state.reader.current!.getBoundingClientRect().top));
            if (!matched.length) throw new Error("未找到文本，请核对原文或指定页码");
            if (!command.append) state.reader.current!.querySelectorAll(".agent-preview").forEach(mark => mark.remove());
            for (const match of matched) paintPdfPreview(state.reader.current!, match.rects, match.textRanges,
              command.color === "pink" ? "#ec489955" : command.color === "blue" ? "#3b82f655" : "#06b6d455", crypto.randomUUID());
            scrollReaderTo(state.reader.current!, matched[0].element, true);
            details = {
              matches: matched.length,
              quote: needle,
              location: JSON.stringify({ version: 2, rects: matched[0].rects, textRanges: matched[0].textRanges }),
              color: command.color || "cyan",
              pages: [...new Set(matched.flatMap(match => match.rects.map(rect => rect.page)))],
            };
            break;
          }
          default:
            throw new Error("未知界面操作");
        }
        result = { ok: true, ...details, state: snapshot() };
      } catch (error) {
        result = { ok: false, error: String(error) };
      }
      await publish();
      if (!disposed) {
        try {
          await fetch(API + "/ui/ack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: command.id, clientId, result }),
          });
        } catch (error) {
          console.warn("[Reader bridge] acknowledgement failed", error);
        }
      }
    }, {
      onOpen: () => { connected = true; lastState = ""; void publish(true); },
      onError: () => { connected = false; },
    });
    const activity = () => {
      clearTimeout(activityTimer);
      activityTimer = setTimeout(() => void publish(true), 100);
    };
    document.addEventListener("pointerdown", activity);
    document.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", activity);
    window.addEventListener("focus", activity);
    const interval = setInterval(() => void publish(), 500);
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(activityTimer);
      unsubscribe();
      document.removeEventListener("pointerdown", activity);
      document.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", activity);
      window.removeEventListener("focus", activity);
    };
  }, []);
}
