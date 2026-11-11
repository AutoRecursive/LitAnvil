import { useEffect, useState, type CSSProperties } from "react";
import { paneDefaults as defaults, paneBounds as bounds, validateLayoutPatch, type PaneLayout } from "../shared/reader-layout";
export type {PaneLayout} from "../shared/reader-layout";
export function usePaneLayout(leftOpen = true, rightOpen = true) {
  const [layout, setLayout] = useState<PaneLayout>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("litanvil-pane-layout") || "{}",
      );
      return Object.fromEntries(
        Object.entries(defaults).map(([key, value]) => {
          const [min, max] = bounds[key as keyof PaneLayout];
          const next = saved[key];
          return [
            key,
            typeof next === "number" && Number.isFinite(next)
              ? Math.min(max, Math.max(min, next))
              : value,
          ];
        }),
      ) as PaneLayout;
    } catch {
      return defaults;
    }
  });
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    localStorage.setItem("litanvil-pane-layout", JSON.stringify(layout));
  }, [layout]);
  const narrow = width <= 900;
  const rightWidth = Math.min(
    layout.rightWidth,
    Math.max(260, width - (leftOpen ? 180 : 0) - 268),
  );
  const leftWidth = Math.min(
    layout.leftWidth,
    narrow
      ? width * 0.85
      : Math.max(180, width - (rightOpen ? rightWidth : 0) - 268),
  );
  const set = (key: keyof PaneLayout, value: number) =>
    setLayout((previous) => ({
      ...previous,
      [key]: Math.max(bounds[key][0], Math.min(bounds[key][1], value)),
    }));
  const apply = (input: unknown) => {
    const patch = validateLayoutPatch(input);
    setLayout(previous=>({...previous,...patch}));
  };
  const style = {
    "--left-width": `${leftWidth}px`,
    "--right-width": `${rightWidth}px`,
    "--documents-top": `${layout.documentShare}fr`,
    "--documents-bottom": `${100 - layout.documentShare}fr`,
    "--reader-top": `${layout.readerShare}fr`,
    "--reader-bottom": `${100 - layout.readerShare}fr`,
    "--header-height": `${layout.headerHeight}px`,
    "--toolbar-height": `${layout.toolbarHeight}px`,
  } as CSSProperties;
  return { layout, set, apply, style, narrow, width, leftWidth, rightWidth, defaults };
}
