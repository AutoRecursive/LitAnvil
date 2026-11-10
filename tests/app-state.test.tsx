// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
vi.mock('../src/Chat', () => ({Chat: ({children}: {children?: React.ReactNode}) => <div>{children}</div>}));
vi.mock('../src/PdfReader', () => ({PdfReader: () => <div/>}));
import {App} from '../src/App';

const documents = ['A', 'B'].map(id => ({id, title: `Paper ${id}`, source: id, sourceType: 'text', content: 'body', progress: 0}));
let container: HTMLDivElement;
let root: Root;
let request: ReturnType<typeof vi.fn>;
let streams: Map<string, any>;
function result(body: unknown, ok = true) {return {ok, json: async () => body, text: async () => JSON.stringify(body)}}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  streams = new Map();
  vi.stubGlobal('EventSource', class {constructor(url: string) {streams.set(url, this)} close() {}});
  request = vi.fn(async (url: string) => result(url.endsWith('/documents') ? documents : url.endsWith('/project') ? {directory: '/notes'} : []));
  vi.stubGlobal('fetch', request);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()});

it('ignores annotation responses from a document that was closed or switched', async () => {
  let resolveA!: (value: unknown) => void;
  let resolveB!: (value: unknown) => void;
  request.mockImplementation(async (url: string) => {
    if (url.endsWith('/A/annotations')) return new Promise(resolve => {resolveA = resolve});
    if (url.endsWith('/B/annotations')) return new Promise(resolve => {resolveB = resolve});
    return result(url.endsWith('/documents') ? documents : {directory: '/notes'});
  });
  sessionStorage.setItem('litanvil-open-document', 'A');
  await act(async () => root.render(<App/>));
  await act(async () => container.querySelector<HTMLButtonElement>('.sidebar-documents button[title="Paper B"]')!.click());
  await act(async () => resolveB(result([{id: 'b', quote: 'B quote', note: 'B note', location: '{}'}])));
  expect(container.querySelector('.ann-list')?.textContent).toContain('B note');
  await act(async () => resolveA(result([{id: 'a', quote: 'A quote', note: 'stale A note', location: '{}'}])));
  expect(container.querySelector('.ann-list')?.textContent).not.toContain('stale A');
  expect(container.querySelector('.ann-list')?.textContent).toContain('B note');
  await act(async () => container.querySelector<HTMLButtonElement>('.sidebar-documents button[title="Paper B"]')!.click());
  expect(container.querySelector('.ann-list')?.textContent).toContain('B note');
});

it('keeps library data and displays failed document deletion errors', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return result({error: 'Deletion unavailable'}, false);
    return result(url.endsWith('/documents') ? documents : {directory: '/notes'});
  });
  await act(async () => root.render(<App/>));
  expect(container.querySelectorAll('.library-open')).toHaveLength(2);
  await act(async () => container.querySelector<HTMLButtonElement>('.document-delete')!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Deletion unavailable');
  expect(container.querySelectorAll('.library-open')).toHaveLength(2);
});


it('syncs externally edited annotations without closing or replacing the open reader', async () => {
  vi.useFakeTimers();
  sessionStorage.setItem('litanvil-open-document', 'A');
  let annotations = [{id:'ann',quote:'Evidence',note:'Original',location:'{}'}];
  request.mockImplementation(async (url: string) => result(url.endsWith('/documents') ? documents : url.endsWith('/annotations') ? annotations : {directory:'/notes'}));
  await act(async () => root.render(<App/>));
  const paper = container.querySelector('.paper');
  const stream = [...streams.values()][0];
  annotations = [{id:'ann',quote:'Evidence',note:'Agent edited **note**',location:'{}'}];
  await act(async () => { stream.onmessage({data:'{"type":"library","data":{"revision":1}}'}); vi.advanceTimersByTime(80); });
  expect(container.querySelector('.paper')).toBe(paper);
  expect(container.querySelector('.ann-list')?.textContent).toContain('Agent edited note');
  annotations = [];
  await act(async () => { stream.onmessage({data:'{"type":"library","data":{"revision":2}}'}); vi.advanceTimersByTime(80); });
  expect(container.querySelector('.paper')).toBe(paper);
  expect(container.querySelector('.ann-list')?.textContent).not.toContain('Agent edited');
});
it('closes a deleted document on external changes and cannot reopen it from a late sync response', async () => {
  vi.useFakeTimers();
  sessionStorage.setItem('litanvil-open-document','A');
  await act(async () => root.render(<App/>));
  const stream = [...streams.values()][0];
  let resolve!: (value: unknown) => void;
  request.mockImplementation(async (url: string) => url.endsWith('/documents') ? new Promise(done => { resolve = done; }) : result([]));
  await act(async () => { stream.onmessage({data:'{"type":"library","data":{"revision":1}}'}); vi.advanceTimersByTime(80); });
  await act(async () => container.querySelector<HTMLButtonElement>('.back')!.click());
  await act(async () => resolve(result(documents)));
  expect(container.querySelector('.paper')).toBeNull();
  expect(sessionStorage.getItem('litanvil-open-document')).toBeNull();
  request.mockImplementation(async (url: string) => result(url.endsWith('/documents') ? documents : []));
  await act(async () => container.querySelector<HTMLButtonElement>('.library-open')!.click());
  request.mockImplementation(async (url: string) => result(url.endsWith('/documents') ? [documents[1]] : []));
  await act(async () => { stream.onmessage({data:'{"type":"library","data":{"revision":2}}'}); vi.advanceTimersByTime(80); });
  expect(container.querySelector('.paper')).toBeNull();
  expect(sessionStorage.getItem('litanvil-open-document')).toBeNull();
  expect(container.querySelectorAll('.library-open')).toHaveLength(1);
});
it('restores the saved document when the initial library request fails and the live connection later recovers',async()=>{
 vi.useFakeTimers();sessionStorage.setItem('litanvil-open-document','A');let offline=true;
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 request.mockImplementation(async(url:string)=>{if((url.endsWith('/documents')||url.endsWith('/project'))&&offline)throw Error('offline');return result(url.endsWith('/documents')?documents:url.endsWith('/project')?{directory:'/notes'}:[])});
 await act(async()=>root.render(<App/>));
 expect(container.querySelector('.paper')).toBeNull();expect(container.querySelector('[role="alert"]')?.textContent).toContain('自动重试');
 offline=false;const stream=[...streams.values()][0];
 await act(async()=>{stream.onmessage({data:'{"type":"library","data":{"revision":1}}'});vi.advanceTimersByTime(80)});
 expect(container.querySelector('.paper-meta h1')?.textContent).toBe('Paper A');
 expect(container.querySelector('[role="alert"]')).toBeNull();
 warning.mockRestore();
});
