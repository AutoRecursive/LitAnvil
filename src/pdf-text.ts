export type PdfRect = { page: number; x: number; y: number; w: number; h: number };
type Position = { node: Text; start: number; end: number };
export type PdfTextRange = { page: number; node: number; start: number; end: number };
export type PdfTextMatch = { element: HTMLElement; rects: PdfRect[]; textRanges: PdfTextRange[] };
function pagesIn(root: HTMLElement) { return root.matches('.pdf-page') ? [root] : [...root.querySelectorAll<HTMLElement>('.pdf-page')]; }

function textNodes(page: HTMLElement) {
  const layer = page.querySelector('.textLayer');
  if (!layer) return [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest('span') && node.textContent) nodes.push(node);
  }
  return nodes;
}
function normalize(value: string) {
  return value.normalize('NFKD').toLowerCase().replace(/[\s\u00ad]/gu, '');
}
function normalizedRect(page: HTMLElement, rect: DOMRect): PdfRect | undefined {
  const box = page.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const left = Math.max(rect.left, box.left), top = Math.max(rect.top, box.top);
  const right = Math.min(rect.right, box.right), bottom = Math.min(rect.bottom, box.bottom);
  if (right <= left || bottom <= top) return;
  return { page: Number(page.dataset.page), x: (left - box.left) / box.width, y: (top - box.top) / box.height, w: (right - left) / box.width, h: (bottom - top) / box.height };
}
function segmentsToRects(page: HTMLElement, segments: Position[]) {
  const rects: PdfRect[] = [];
  for (const segment of segments) {
    const range = document.createRange();
    range.setStart(segment.node, segment.start);
    range.setEnd(segment.node, segment.end);
    for (const box of range.getClientRects()) {
      const rect = normalizedRect(page, box);
      if (rect && !rects.some(previous => previous.x === rect.x && previous.y === rect.y && previous.w === rect.w && previous.h === rect.h)) rects.push(rect);
    }
  }
  return rects;
}

/** Positioned PDF spans have no useful caret in their surrounding whitespace. */
export function finishPdfTextSelection(root: HTMLElement, target: EventTarget | null, x: number, y: number) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode)) return;
  const element = target instanceof Element ? target : null;
  const layer = element?.closest<HTMLElement>('.textLayer');
  if (!layer || !root.contains(layer) || element?.closest('span')) return;
  const page = layer.closest<HTMLElement>('.pdf-page');
  if (!page) return;
  const distance = (box: DOMRect) => Math.hypot(Math.max(box.left-x,0,x-box.right), Math.max(box.top-y,0,y-box.bottom));
  const nodes = textNodes(page);
  const nearest = nodes.reduce<Text | undefined>((best,node) => {
    if (!best) return node;
    return distance(node.parentElement!.getBoundingClientRect()) < distance(best.parentElement!.getBoundingClientRect()) ? node : best;
  }, undefined);
  if (!nearest) return;
  const box = nearest.parentElement!.getBoundingClientRect();
  // Only correct whitespace beside a line. Do not pull selections across paragraph/page gaps.
  if (y < box.top || y > box.bottom) return;
  const rtl = getComputedStyle(nearest.parentElement!).direction === 'rtl';
  const offset = x <= box.left ? (rtl ? nearest.length : 0) : x >= box.right ? (rtl ? 0 : nearest.length) : undefined;
  if (offset !== undefined) selection.extend(nearest, offset);
}

/** Map normalized search offsets back to original text nodes, including split words and ligatures. */
export function findPdfText(reader: HTMLElement, query: string, pageNumber?: number): PdfTextMatch[] {
  const needle = normalize(query.replace(/[-‐]\s*\n\s*/gu, ''));
  if (!needle) return [];
  const matches: PdfTextMatch[] = [];
  for (const page of pagesIn(reader)) {
    if (pageNumber && Number(page.dataset.page) !== pageNumber) continue;
    const nodes = textNodes(page);
    let text = '';
    const positions: Position[] = [];
    nodes.forEach((node, nodeIndex) => {
      let offset = 0;
      const value = node.data;
      for (const character of value) {
        const start = offset; offset += character.length;
        let part = normalize(character);
        // A printed hyphen at a line break is formatting, rather than part of the word.
        if (/[-‐]/u.test(character) && !value.slice(offset).trim() && nodes[nodeIndex + 1]) {
          const next = nodes[nodeIndex + 1];
          const currentBox = node.parentElement!.getBoundingClientRect();
          const nextBox = next.parentElement!.getBoundingClientRect();
          if (/^\s*\p{L}/u.test(next.data) && Math.abs(nextBox.top - currentBox.top) > Math.min(currentBox.height, nextBox.height) / 2) part = '';
        }
        text += part;
        for (let index = 0; index < part.length; index++) positions.push({node, start, end: offset});
      }
    });
    for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + needle.length)) {
      const segments: Position[] = [];
      for (const position of positions.slice(start, start + needle.length)) {
        const previous = segments.at(-1);
        if (previous?.node === position.node) previous.end = position.end;
        else segments.push({...position});
      }
      const rects = segmentsToRects(page, segments);
      if (rects.length) matches.push({element: segments[0].node.parentElement!, rects,
        textRanges: segments.map(segment => ({page: Number(page.dataset.page), node: nodes.indexOf(segment.node), start: segment.start, end: segment.end})),
      });
    }
  }
  return matches;
}


/** Stable PDF text-item offsets let font rounding change without moving saved marks away from glyphs. */
export function rectsFromTextRanges(root: HTMLElement, ranges: PdfTextRange[]): PdfRect[] {
  if (!Array.isArray(ranges)) return [];
  const result: PdfRect[] = [];
  for (const page of pagesIn(root)) {
    if (page.dataset.ready !== 'true') continue;
    const nodes = textNodes(page);
    const segments: Position[] = [];
    for (const range of ranges) {
      if (range.page !== Number(page.dataset.page)) continue;
      const node = nodes[range.node];
      if (!node || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end > node.length || range.end <= range.start) continue;
      segments.push({node, start:range.start, end:range.end});
    }
    result.push(...segmentsToRects(page, segments));
  }
  return result;
}
export function pdfSelectionLocation(reader: HTMLElement, selection: Range) {
  const textRanges: PdfTextRange[] = [];
  for (const page of pagesIn(reader)) textNodes(page).forEach((node,index) => {
    if (!selection.intersectsNode(node)) return;
    const start = selection.startContainer === node ? selection.startOffset : 0;
    const end = selection.endContainer === node ? selection.endOffset : node.length;
    if (end > start) textRanges.push({page:Number(page.dataset.page),node:index,start,end});
  });
  return {version:2,rects:rectsFromTextRanges(reader,textRanges),textRanges};
}
export function paintPdfPreview(root: HTMLElement, rects: PdfRect[], textRanges: PdfTextRange[], color: string, id: string) {
  for (const rect of rects) {
    const page = pagesIn(root).find(page => Number(page.dataset.page) === rect.page);
    if (!page) continue;
    const mark = document.createElement('div'); mark.className='agent-preview';
    mark.dataset.previewId=id; mark.dataset.textRanges=JSON.stringify(textRanges); mark.dataset.color=color;
    Object.assign(mark.style,{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.w*100}%`,height:`${rect.h*100}%`,background:color});
    page.append(mark);
  }
}
export function repaintPdfPreviews(page: HTMLElement) {
  const groups = new Map<string,HTMLElement[]>();
  page.querySelectorAll<HTMLElement>('.agent-preview').forEach(mark => {
    if (mark.dataset.previewId) groups.set(mark.dataset.previewId,[...(groups.get(mark.dataset.previewId)||[]),mark]);
  });
  for (const [id,marks] of groups) try {
    const textRanges = JSON.parse(marks[0].dataset.textRanges || '[]');
    const rects = rectsFromTextRanges(page,textRanges);
    if (!rects.length) continue;
    marks.forEach(mark => mark.remove());
    paintPdfPreview(page,rects,textRanges,marks[0].dataset.color || '#06b6d455',id);
  } catch { /* Keep the normalized fallback if an older preview has no text offsets. */ }
}
