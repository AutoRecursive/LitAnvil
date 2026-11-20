import { rectsFromTextRanges, repaintPdfPreviews, finishPdfTextSelection } from "./pdf-text";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

type Annotation = { id?: string; location: string; note: string; color?: string };
type PageView = { page: pdfjsLib.PDFPageProxy; element: HTMLElement };
type LoadedDocument = { src: string; pages: PageView[] };

function paintAnnotations(container: HTMLElement, annotations: Annotation[]) {
  container
    .querySelectorAll(".saved-highlight")
    .forEach((node) => node.remove());
  for (const annotation of annotations) {
    try {
      const anchor = JSON.parse(annotation.location);
      const exact = rectsFromTextRanges(container, anchor.textRanges);
      const anchoredPages = new Set(exact.map(rect => rect.page));
      const rects = [...exact, ...(anchor.rects || []).filter((rect: {page:number}) => !anchoredPages.has(rect.page))];
      for (const rect of rects) {
        const page = container.dataset.page === String(rect.page) ? container : container.querySelector<HTMLElement>(`.pdf-page[data-page="${rect.page}"]`);
        if (!page) continue;
        const mark = document.createElement("div");
        mark.className = "saved-highlight";
        if (annotation.id) mark.dataset.annotationId = annotation.id;
        mark.title = annotation.note || "高亮";
        Object.assign(mark.style, {
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
          ...(annotation.color && /^#[0-9a-f]{6}$/i.test(annotation.color) ? { backgroundColor: `${annotation.color}70` } : {}),
        });
        page.append(mark);
      }
    } catch {
      /* Older annotations may not have a PDF location. */
    }
  }
}

function paintSelection(container: HTMLElement, location: string) {
  container.querySelectorAll('.active-pdf-selection').forEach(node => node.remove());
  if (!location) return;
  try {
    const anchor = JSON.parse(location);
    const exact = rectsFromTextRanges(container, anchor.textRanges);
    const pages = new Set(exact.map(rect => rect.page));
    const rects = [...exact, ...(anchor.rects || []).filter((rect: {page:number}) => !pages.has(rect.page))];
    for (const rect of rects) {
      const page = container.dataset.page === String(rect.page) ? container : container.querySelector<HTMLElement>(`.pdf-page[data-page="${rect.page}"]`);
      if (!page) continue;
      const mark = document.createElement('div');
      mark.className = 'active-pdf-selection';
      Object.assign(mark.style, {left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.w*100}%`,height:`${rect.h*100}%`});
      page.append(mark);
    }
  } catch { /* Selections without PDF geometry have no overlay. */ }
}

export const PdfReader = React.memo(
  function PdfReader({
    src,
    onSelection,
    onAnnotationClick,
    scale = 1.25,
    annotations = [],
    selectionLocation = '',
  }: {
    src: string;
    onSelection: () => void;
    onAnnotationClick?: (id: string) => void;
    scale?: number;
    annotations?: Annotation[];
    selectionLocation?: string;
  }) {
    const host = useRef<HTMLDivElement>(null);
    const cycle = useRef<{key:string; index:number} | null>(null);
    function clickHighlight(event: React.MouseEvent<HTMLDivElement>) {
      // A double click is one navigation, not two; dragging text remains selection.
      if (event.detail > 1 || window.getSelection()?.toString()) return;
      const page = (event.target as Element).closest<HTMLElement>(".pdf-page");
      if (!page) return;
      const ids = [...new Set([...page.querySelectorAll<HTMLElement>(".saved-highlight[data-annotation-id]")]
        .filter(mark => { const rect = mark.getBoundingClientRect(); return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom; })
        .map(mark => mark.dataset.annotationId!))];
      if (!ids.length) { cycle.current = null; return; }
      const key = ids.join("|");
      const index = cycle.current?.key === key ? (cycle.current.index + 1) % ids.length : 0;
      cycle.current = {key, index};
      onAnnotationClick?.(ids[index]);
    }
    const annotationsRef = useRef(annotations);
    annotationsRef.current = annotations;
    const selectionRef = useRef(selectionLocation);
    selectionRef.current = selectionLocation;
    const [width, setWidth] = useState(0);
    const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
    const [status, setStatus] = useState("加载中…");

    useEffect(() => {
      const element = host.current!;
      let timer: ReturnType<typeof setTimeout>;
      const measure = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const next = Math.floor(element.clientWidth);
          if (next > 16)
            setWidth((previous) => (previous === next ? previous : next));
        }, 100);
      };
      measure();
      // Only the available inline size matters; page-height changes must not reload the PDF.
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => {
        clearTimeout(timer);
        observer.disconnect();
      };
    }, []);

    useEffect(() => {
      let cancelled = false;
      const container = host.current!;
      const task = pdfjsLib.getDocument({ url: src });
      setLoaded(null);
      setStatus("加载中…");
      container.replaceChildren();
      (async () => {
        try {
          const pdf = await task.promise;
          const pages = await Promise.all(
            Array.from({ length: pdf.numPages }, (_, index) =>
              pdf.getPage(index + 1),
            ),
          );
          if (cancelled) return;
          const views = pages.map((page, index) => {
            const element = document.createElement("section");
            element.className = "pdf-page";
            element.dataset.page = String(index + 1);
            return { page, element };
          });
          container.replaceChildren(...views.map((view) => view.element));
          setLoaded({ src, pages: views });
          setStatus("");
        } catch (error) {
          if (!cancelled) {
            setStatus("PDF 加载失败");
            console.error("[PDF] load failed", error);
          }
        }
      })();
      return () => {
        cancelled = true;
        void task.destroy();
      };
    }, [src]);

    useEffect(() => {
      if (host.current) paintAnnotations(host.current, annotations);
    }, [annotations]);
    useEffect(() => {
      if (host.current) paintSelection(host.current, selectionLocation);
    }, [selectionLocation]);

    useLayoutEffect(() => {
      if (!loaded || loaded.src !== src || !width) return;
      const container = host.current!;
      const scroller = container.closest<HTMLElement>(".paper");
      const top = scroller
        ? scroller.getBoundingClientRect().top + scroller.clientTop
        : 0;
      const anchor =
        scroller &&
        loaded.pages.find(({ element }) => {
          const box = element.getBoundingClientRect();
          return box.height > 0 && box.top <= top && box.bottom > top;
        });
      const fraction = anchor
        ? (top - anchor.element.getBoundingClientRect().top) /
          anchor.element.getBoundingClientRect().height
        : 0;
      const viewports = loaded.pages.map(({ page }) => {
        const base = page.getViewport({ scale: 1 });
        return page.getViewport({
          scale: ((width - 16) / base.width) * (scale / 1.25),
        });
      });
      // Reserve every page's final height synchronously. Never collapse the scroll range while rendering.
      loaded.pages.forEach(({ element }, index) => {
        const viewport = viewports[index];
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        element.style.setProperty(
          "--total-scale-factor",
          String(viewport.scale),
        );
        element.style.setProperty("--scale-round-x", "1px");
        element.style.setProperty("--scale-round-y", "1px");
        element.dataset.ready = "false";
        element
          .querySelector<HTMLElement>(".textLayer")
          ?.style.setProperty("visibility", "hidden");
      });
      if (anchor && scroller) {
        const box = anchor.element.getBoundingClientRect();
        scroller.scrollTop += box.top + box.height * fraction - top;
      }
      paintAnnotations(container, annotationsRef.current);
      paintSelection(container, selectionRef.current);
      let cancelled = false;
      let rendering: ReturnType<pdfjsLib.PDFPageProxy["render"]> | undefined;
      const textLayers: TextLayerBuilder[] = [];
      const selectionEvents = new AbortController();
      console.debug("[PDF] layout", {
        pages: loaded.pages.length,
        width,
        zoom: scale / 1.25,
      });
      (async () => {
        try {
          for (
            let index = 0;
            index < loaded.pages.length && !cancelled;
            index++
          ) {
            const { page, element } = loaded.pages[index];
            const viewport = viewports[index];
            const canvas = document.createElement("canvas");
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(viewport.width * dpr);
            canvas.height = Math.floor(viewport.height * dpr);
            rendering = page.render({
              canvas,
              canvasContext: canvas.getContext("2d")!,
              viewport,
              transform: [dpr, 0, 0, dpr, 0, 0],
            });
            await rendering.promise;
            if (cancelled) return;
            // The viewer builder supplies selection boundary handling in addition to text geometry.
            // Bare TextLayer rendering lets a drag into whitespace select unrelated positioned spans.
            const textLayer = new TextLayerBuilder({pdfPage:page, abortSignal:selectionEvents.signal});
            textLayers.push(textLayer);
            const layer = textLayer.div;
            element.querySelector("canvas")?.remove();
            element.querySelector(".textLayer")?.remove();
            element.prepend(canvas, layer);
            await textLayer.render({
              viewport,
              images: undefined!,
              // Preserve the text-node offsets used by previously saved version-2 anchors.
              textContentParams:{includeMarkedContent:false, disableNormalization:false},
            });
            if (!cancelled) {
              element.dataset.ready = "true";
              paintAnnotations(element, annotationsRef.current);
              paintSelection(element, selectionRef.current);
              repaintPdfPreviews(element);
            }
          }
        } catch (error) {
          if (!cancelled) {
            setStatus("PDF 渲染失败");
            console.error("[PDF] render failed", error);
          }
        }
      })();
      return () => {
        cancelled = true;
        rendering?.cancel();
        textLayers.forEach(layer => layer.cancel());
        selectionEvents.abort();
      };
    }, [loaded, src, width, scale]);

    return (
      <div
        className={`pdf-reader${selectionLocation ? ' has-active-selection' : ''}`}
        data-source={loaded?.src === src ? src : undefined}
      >
        {status && <div className="pdf-status" role="status">{status}</div>}
        <div className="pdf-pages" ref={host} onClick={clickHighlight} onMouseUpCapture={event => finishPdfTextSelection(event.currentTarget,event.target,event.clientX,event.clientY)} onMouseUp={onSelection} />
      </div>
    );
  },
  (a, b) =>
    a.src === b.src && a.scale === b.scale && a.annotations === b.annotations && a.onAnnotationClick === b.onAnnotationClick && a.selectionLocation === b.selectionLocation,
);
