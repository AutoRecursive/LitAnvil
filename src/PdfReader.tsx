import { rectsFromTextRanges, repaintPdfPreviews } from "./pdf-text";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

type Annotation = { location: string; note: string };
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
        mark.title = annotation.note || "高亮";
        Object.assign(mark.style, {
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
        });
        page.append(mark);
      }
    } catch {
      /* Older annotations may not have a PDF location. */
    }
  }
}

export const PdfReader = React.memo(
  function PdfReader({
    src,
    onSelection,
    scale = 1.25,
    annotations = [],
  }: {
    src: string;
    onSelection: () => void;
    scale?: number;
    annotations?: Annotation[];
  }) {
    const host = useRef<HTMLDivElement>(null);
    const annotationsRef = useRef(annotations);
    annotationsRef.current = annotations;
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
      let cancelled = false;
      let rendering: ReturnType<pdfjsLib.PDFPageProxy["render"]> | undefined;
      let textLayer: InstanceType<typeof pdfjsLib.TextLayer> | undefined;
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
            const content = await page.getTextContent();
            if (cancelled) return;
            const layer = document.createElement("div");
            layer.className = "textLayer";
            element.querySelector("canvas")?.remove();
            element.querySelector(".textLayer")?.remove();
            element.prepend(canvas, layer);
            textLayer = new pdfjsLib.TextLayer({
              textContentSource: content,
              container: layer,
              viewport,
            });
            await textLayer.render();
            if (!cancelled) {
              element.dataset.ready = "true";
              paintAnnotations(element, annotationsRef.current);
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
        textLayer?.cancel();
      };
    }, [loaded, src, width, scale]);

    return (
      <div
        className="pdf-reader"
        data-source={loaded?.src === src ? src : undefined}
      >
        {status && <div className="pdf-status" role="status">{status}</div>}
        <div className="pdf-pages" ref={host} onMouseUp={onSelection} />
      </div>
    );
  },
  (a, b) =>
    a.src === b.src && a.scale === b.scale && a.annotations === b.annotations,
);
