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
function result(body: unknown, ok = true) {return {ok, json: async () => body, text: async () => JSON.stringify(body)}}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  vi.stubGlobal('EventSource', class {close() {}});
  request = vi.fn(async (url: string) => result(url.endsWith('/documents') ? documents : url.endsWith('/project') ? {directory: '/notes'} : []));
  vi.stubGlobal('fetch', request);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()});

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
