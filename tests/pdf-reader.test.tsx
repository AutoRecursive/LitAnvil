// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';

const pdf = vi.hoisted(() => ({load: vi.fn(), destroy: vi.fn(), render: vi.fn(), text: '', glyphOffset: 0, resize: undefined as undefined | (() => void)}));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {}, getDocument: pdf.load,
  TextLayer: class {
    constructor(private options: {container: HTMLElement}) {}
    render() {
      if (pdf.text) {
        const span=document.createElement('span'); span.textContent=pdf.text;
        span.getBoundingClientRect=()=>{
          const page=this.options.container.parentElement!.getBoundingClientRect();
          return {left:20,right:60,top:page.top+50+pdf.glyphOffset,bottom:page.top+62+pdf.glyphOffset,width:40,height:12} as DOMRect;
        };
        this.options.container.append(span);
      }
      return Promise.resolve();
    }
    cancel() {}
  },
}));
import {PdfReader} from '../src/PdfReader';

let root: Root;
let article: HTMLElement;
let width: number;
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  width = 600; pdf.text=""; pdf.glyphOffset=0;
  pdf.load.mockReset(); pdf.destroy.mockReset(); pdf.render.mockReset();
  pdf.render.mockImplementation(() => ({promise: Promise.resolve(), cancel: vi.fn()}));
  pdf.load.mockImplementation(() => ({promise: Promise.resolve({numPages: 3, getPage: async () => ({
    getViewport: ({scale}: {scale: number}) => ({width: 600 * scale, height: 800 * scale, scale}),
    render: pdf.render, getTextContent: async () => ({items: []}),
  })}), destroy: pdf.destroy}));
  vi.stubGlobal('ResizeObserver', class {constructor(callback: () => void) {pdf.resize = callback} observe() {} disconnect() {}});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as any);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  article = document.createElement('article'); article.className = 'paper'; document.body.append(article);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this === article) return {top: 0, bottom: 500, height: 500} as DOMRect;
    const previous = Array.from(this.parentElement?.children || []).slice(0, Number(this.dataset.page) - 1) as HTMLElement[];
    const top = previous.reduce((sum, page) => sum + parseFloat(page.style.height) + 14, 0) - article.scrollTop;
    const height = parseFloat(this.style.height) || 0;
    return {left:0,right:parseFloat(this.style.width)||600,width:parseFloat(this.style.width)||600,top, bottom: top + height, height} as DOMRect;
  });
  root = createRoot(article);
});
afterEach(async () => {await act(async () => root.unmount()); article.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()});

async function show(scale = 1.25, annotations: {location:string;note:string}[] = []) {
  await act(async () => root.render(<PdfReader src="/paper.pdf" scale={scale} annotations={annotations} onSelection={() => {}}/>));
  await act(async () => vi.advanceTimersByTime(100));
}

it('keeps every page slot and loads the PDF once across width changes', async () => {
  await show();
  const pages = Array.from(article.querySelectorAll<HTMLElement>('.pdf-page'));
  expect(pages).toHaveLength(3);
  const oldHeight = pages[0].style.height;
  // A slow replacement canvas must not remove page slots or collapse the scroll range.
  pdf.render.mockImplementation(() => ({promise: new Promise(() => {}), cancel: vi.fn()}));
  width = 480;
  await act(async () => {pdf.resize!(); vi.advanceTimersByTime(100)});
  expect(Array.from(article.querySelectorAll('.pdf-page'))).toEqual(pages);
  expect(pages.every(page => parseFloat(page.style.height) > 0)).toBe(true);
  expect(pages[0].style.height).not.toBe(oldHeight);
  expect(pdf.load).toHaveBeenCalledTimes(1);
  expect(pdf.destroy).not.toHaveBeenCalled();
});

it('ignores height-only observer notifications and batches rapid width changes', async () => {
  await show();
  const count = pdf.render.mock.calls.length;
  await act(async () => {pdf.resize!(); vi.advanceTimersByTime(100)});
  expect(pdf.render).toHaveBeenCalledTimes(count);
  await act(async () => {
    for (const next of [590, 580, 570, 560]) {width = next; pdf.resize!(); vi.advanceTimersByTime(20)}
    vi.advanceTimersByTime(100);
  });
  expect(pdf.render).toHaveBeenCalledTimes(count + 3);
  expect(pdf.load).toHaveBeenCalledTimes(1);
});

it('preserves the current page and within-page position when zooming', async () => {
  await show();
  const pages = article.querySelectorAll<HTMLElement>('.pdf-page');
  const firstHeight = parseFloat(pages[0].style.height);
  article.scrollTop = firstHeight + 14 + firstHeight * 0.4;
  await show(1.5);
  const nextHeight = parseFloat(pages[0].style.height);
  expect(article.scrollTop).toBeCloseTo(nextHeight + 14 + nextHeight * 0.4);
  expect(pdf.load).toHaveBeenCalledTimes(1);
});


it('restores saved text-anchored annotations at the rendered glyphs after a font-metric change', async () => {
  pdf.text='anchor';
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:function(this:Range){return [this.startContainer.parentElement!.getBoundingClientRect()]}});
  try {
    const annotations=[{note:'saved note',location:JSON.stringify({version:2,rects:[{page:2,x:0.1,y:0.2,w:0.2,h:0.02}],textRanges:[{page:2,node:0,start:0,end:6}]})}];
    await show(1.25,annotations);
    const page=article.querySelector<HTMLElement>('.pdf-page[data-page="2"]')!;
    let mark=page.querySelector<HTMLElement>('.saved-highlight')!;
    expect(parseFloat(mark.style.top)/100*parseFloat(page.style.height)).toBeCloseTo(50);
    pdf.glyphOffset=3;
    await show(1.5,annotations);
    mark=page.querySelector<HTMLElement>('.saved-highlight')!;
    expect(parseFloat(mark.style.top)/100*parseFloat(page.style.height)).toBeCloseTo(53);
    expect(pdf.load).toHaveBeenCalledTimes(1);
    expect(page.querySelectorAll('.saved-highlight')).toHaveLength(1);
  } finally { delete (Range.prototype as any).getClientRects; }
});
