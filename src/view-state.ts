export type ReaderViewState = {
  documentId?: string;
  zoom: number;
  leftOpen: boolean;
  rightOpen: boolean;
  documentsOpen: boolean;
};
const key = "litanvil-reader-view";
const defaults: ReaderViewState = { zoom: 1, leftOpen: true, rightOpen: true, documentsOpen: true };
export function readReaderView(): Partial<ReaderViewState> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}
export function writeReaderView(value: Partial<ReaderViewState>) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
export {defaults as readerViewDefaults};
