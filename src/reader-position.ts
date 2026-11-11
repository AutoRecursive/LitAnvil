/** The most visible page is the current page, even when a sliver of the previous page remains above it. */
export function currentPdfPage(reader: HTMLElement | null) {
  if (!reader) return null;
  const viewport = reader.getBoundingClientRect();
  const pages = [...reader.querySelectorAll<HTMLElement>(".pdf-page")];
  let best: HTMLElement | null = null;
  let visible = 0;
  for (const page of pages) {
    const box = page.getBoundingClientRect();
    const height = Math.max(
      0,
      Math.min(box.bottom, viewport.bottom) - Math.max(box.top, viewport.top),
    );
    if (height > visible) {
      best = page;
      visible = height;
    }
  }
  return best;
}
export function scrollReaderTo(
  reader: HTMLElement,
  target: HTMLElement,
  center = false,
) {
  const box = target.getBoundingClientRect();
  const viewport = reader.getBoundingClientRect();
  const page = target.closest<HTMLElement>(".pdf-page") || target;
  const pageTop =
    reader.scrollTop + page.getBoundingClientRect().top - viewport.top;
  const desired =
    reader.scrollTop +
    box.top -
    viewport.top -
    (center ? (reader.clientHeight - box.height) / 2 : 0);
  reader.scrollTop = Math.max(0, center ? Math.max(pageTop, desired) : desired);
}
