import { useEffect, useRef, useState, type RefObject } from "react";
import { currentPdfPage, scrollReaderTo } from "./reader-position";

type Position = { progress: number; page?: number; fraction?: number };
const bounded = (value: number) => Math.max(0, Math.min(1, value));

/** Restore only after page dimensions exist; save independently of React render frequency. */
export function useReadingPosition({ id, source, initialProgress, reader, persist }: {
  id?: string;
  source?: string;
  initialProgress: number;
  reader: RefObject<HTMLElement | null>;
  persist: (id: string, progress: number) => Promise<void>;
}) {
  const [pagination, setPagination] = useState({ page: 1, total: 0 });
  const latestPersist = useRef(persist);
  latestPersist.current = persist;
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    const element = reader.current;
    setPagination({ page: 1, total: 0 });
    if (!id || !element) return;
    const key = `litanvil-reading-position:${id}`;
    let saved: Position = { progress: bounded(initialProgress || 0) };
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      if (value && Number.isFinite(value.progress)) saved = {
        progress: bounded(value.progress),
        page: Number.isInteger(value.page) && value.page > 0 ? value.page : undefined,
        fraction: Number.isFinite(value.fraction) ? bounded(value.fraction) : 0,
      };
    } catch { /* Storage may be unavailable; backend progress still works. */ }
    let restored = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: number | undefined;
    let lastPersisted = saved.progress;
    const flush = () => {
      clearTimeout(timer);
      if (pending === undefined) return;
      const progress = pending;
      pending = undefined;
      if (Math.abs(lastPersisted - progress) < 0.001) return;
      lastPersisted = progress;
      writes.current = writes.current.catch(() => {}).then(() => latestPersist.current(id, progress));
      void writes.current.catch(error => console.error("[Reader] position save failed", { id, error }));
    };
    const update = () => {
      if (!restored) return;
      const pages = element.querySelectorAll<HTMLElement>(".pdf-page");
      const page = currentPdfPage(element);
      setPagination(previous => {
        const next = { page: Number(page?.dataset.page) || 1, total: pages.length };
        return previous.page === next.page && previous.total === next.total ? previous : next;
      });
      const progress = bounded(element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight));
      const viewport = element.getBoundingClientRect();
      // The page crossing the top edge is a stable anchor even when another page is more visible.
      const anchor = [...pages].find(page => {
        const box = page.getBoundingClientRect();
        return box.top <= viewport.top && box.bottom > viewport.top;
      });
      const box = anchor?.getBoundingClientRect();
      const position: Position = { progress,
        page: anchor ? Number(anchor.dataset.page) : undefined,
        fraction: box?.height ? bounded((viewport.top - box.top) / box.height) : undefined,
      };
      try { localStorage.setItem(key, JSON.stringify(position)); } catch {}
      pending = progress;
      clearTimeout(timer);
      timer = setTimeout(flush, 600);
    };
    const restore = () => {
      if (restored) return;
      const pdf = element.querySelector<HTMLElement>(".pdf-reader");
      const pages = [...element.querySelectorAll<HTMLElement>(".pdf-page")];
      if (source && (pdf?.dataset.source !== source || !pages.length || pages.some(page => !parseFloat(page.style.height)))) return;
      restored = true;
      const anchor = pages.find(page => Number(page.dataset.page) === saved.page);
      if (anchor) {
        scrollReaderTo(element, anchor);
        element.scrollTop += anchor.getBoundingClientRect().height * (saved.fraction || 0);
      } else element.scrollTop = saved.progress * Math.max(0, element.scrollHeight - element.clientHeight);
      update();
    };
    element.scrollTop = 0;
    const observer = new MutationObserver(restore);
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "data-source"] });
    element.addEventListener("scroll", update, { passive: true });
    const resize=typeof ResizeObserver!=="undefined"?new ResizeObserver(update):undefined;
    resize?.observe(element);
    window.addEventListener("pagehide", flush);
    restore();
    return () => {
      observer.disconnect();
      resize?.disconnect();
      element.removeEventListener("scroll", update);
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // Progress changes from scrolling must not reinitialize this document's position.
  }, [id, source, reader]);
  const jump = (page: number) => {
    const element = reader.current;
    if (!element || !Number.isInteger(page) || page < 1 || page > pagination.total) return false;
    const target = element.querySelector<HTMLElement>(`.pdf-page[data-page="${page}"]`);
    if (!target) return false;
    scrollReaderTo(element, target);
    return true;
  };
  return { ...pagination, jump };
}
