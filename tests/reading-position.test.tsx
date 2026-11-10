// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReadingPosition } from '../src/useReadingPosition';
import { PageNavigation } from '../src/PageNavigation';
let root: Root, host: HTMLDivElement;
const persist = vi.fn(async () => {});
function Harness({id = 'paper', source = '/paper.pdf'}: {id?: string; source?: string}) {
  const reader = useRef<HTMLElement>(null);
  const navigation = useReadingPosition({id, source, initialProgress: 0.3, reader, persist});
  return <><PageNavigation {...navigation}/><article ref={reader}><div className="pdf-reader" data-source={source}><div className="pdf-pages"/></div></article></>;
}
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); persist.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(3200);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const reader = host.querySelector('article')!;
    const top = this.dataset.page ? (Number(this.dataset.page) - 1) * 1000 - reader.scrollTop : 0;
    const height = this.dataset.page ? parseFloat(this.style.height) || 0 : 500;
    return {top, bottom: top + height, height} as DOMRect;
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function load() {
  await act(async () => root.render(<Harness/>));
  await act(async () => { host.querySelector('.pdf-pages')!.innerHTML = [1,2,3].map(page => `<section class="pdf-page" data-page="${page}"></section>`).join(''); });
}
async function dimensions() {
  await act(async () => host.querySelectorAll<HTMLElement>('.pdf-page').forEach(page => page.style.height = '980px'));
}
it('waits for actual page dimensions before restoring a page-relative position', async () => {
  localStorage.setItem('litanvil-reading-position:paper', JSON.stringify({page: 2, fraction: 0.4, progress: 0.51}));
  await load();
  const reader = host.querySelector('article')!;
  expect(reader.scrollTop).toBe(0);
  await dimensions();
  expect(reader.scrollTop).toBe(1392);
  expect((host.querySelector('input') as HTMLInputElement).value).toBe('2');
});
it('persists small scrolls after debounce, flushes on close, and restores the same anchor on reopening', async () => {
  await load(); await dimensions();
  const reader = host.querySelector('article')!;
  await act(async () => {
    for (const top of [1001, 1011, 1021]) { reader.scrollTop = top; reader.dispatchEvent(new Event('scroll')); }
    vi.advanceTimersByTime(599);
  });
  expect(persist).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(persist).toHaveBeenCalledTimes(1);
  expect(persist).toHaveBeenLastCalledWith('paper', 1021 / 2700);
  await act(async () => { reader.scrollTop = 1030; reader.dispatchEvent(new Event('scroll')); root.render(<div/>); });
  expect(persist).toHaveBeenLastCalledWith('paper', 1030 / 2700);
  await load(); await dimensions();
  expect(host.querySelector('article')!.scrollTop).toBeCloseTo(1030);
});
it('validates typed page numbers and navigates without changing the document', async () => {
  await load(); await dimensions();
  const input = host.querySelector('input')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { set.call(input, '3'); input.dispatchEvent(new Event('input', {bubbles:true})); });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true})));
  expect(host.querySelector('article')!.scrollTop).toBe(2000);
  await act(async () => host.querySelector('article')!.dispatchEvent(new Event('scroll')));
  expect(input.value).toBe('3');
  await act(async () => { set.call(input, '999'); input.dispatchEvent(new Event('input', {bubbles:true})); });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true})));
  expect(input.value).toBe('3');
  expect(host.querySelector('article')!.scrollTop).toBe(2000);
});
it('uses server progress when local storage is malformed and waits for the correct PDF source', async () => {
  localStorage.setItem('litanvil-reading-position:paper', '{broken');
  await load();
  await act(async () => { host.querySelector<HTMLElement>('.pdf-reader')!.dataset.source = '/previous.pdf'; });
  await dimensions();
  expect(host.querySelector('article')!.scrollTop).toBe(0);
  await act(async () => { host.querySelector<HTMLElement>('.pdf-reader')!.dataset.source = '/paper.pdf'; });
  expect(host.querySelector('article')!.scrollTop).toBe(810);
});
it('keeps separate positions for different documents and does not save one document under another ID', async () => {
  await load(); await dimensions();
  const reader = host.querySelector('article')!;
  await act(async () => { reader.scrollTop = 1300; reader.dispatchEvent(new Event('scroll')); root.render(<Harness id="other" source="/other.pdf"/>); });
  expect(persist).toHaveBeenCalledWith('paper', 1300 / 2700);
  expect(reader.scrollTop).toBe(810);
  await act(async () => { reader.scrollTop = 2100; reader.dispatchEvent(new Event('scroll')); root.render(<Harness/>); });
  expect(persist).toHaveBeenCalledWith('other', 2100 / 2700);
  expect(reader.scrollTop).toBe(1300);
});
