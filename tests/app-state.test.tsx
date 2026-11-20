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

it('shows nested colored topics in the reader and moves documents between them',async()=>{
 sessionStorage.setItem('litanvil-open-document','A');
 const categorized=[{...documents[0],topicId:'child'},documents[1]];
 const topics=[{id:'root',name:'视频生成',parentId:null,color:'#91a6b5'},{id:'child',name:'实时生成',parentId:'root',color:'#c99e9e'}];
 request.mockImplementation(async(url:string)=>result(url.endsWith('/topics')?topics:url.endsWith('/documents')?categorized:url.endsWith('/project')?{directory:'/notes'}:[]));
 await act(async()=>root.render(<App/>));
 const sidebar=container.querySelector('.sidebar-documents')!;
 const folders=[...sidebar.querySelectorAll('.topic-name')];
 expect(folders.map(button=>button.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('视频生成'),expect.stringContaining('实时生成')]));
 expect(folders[1].querySelector('svg')?.getAttribute('style')).toContain('rgb(201, 158, 158)');
 expect(sidebar.querySelector('button[title="Paper A"]')).not.toBeNull();
 await act(async()=>sidebar.querySelector<HTMLButtonElement>('button[aria-label="管理 Paper B 的标签"]')!.click());
 const labels=container.querySelectorAll<HTMLInputElement>('.topic-tag-picker input');
 await act(async()=>{labels[0].click();labels[1].click()});
 await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='保存标签')!.click());
 expect(request.mock.calls.some(([url,init])=>url.endsWith('/documents/B')&&init?.method==='PATCH'&&JSON.stringify(JSON.parse(String(init.body)).topicIds)==='["root","child"]')).toBe(true);
 expect(sidebar.querySelector('.topic-branch .topic-branch button[title="Paper B"]')).not.toBeNull();
});

it('keeps a selection while interacting with the comment editor and clears it on a blank reader click', async () => {
 sessionStorage.setItem('litanvil-open-document','A');
 await act(async()=>root.render(<App/>));
 const text=container.querySelector('.paper-body p')!.firstChild!;
 const range=document.createRange();range.selectNodeContents(text);
 window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
 await act(async()=>container.querySelector('.paper-body p')!.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})));
 expect(container.querySelector('[aria-label="批注内容"]')).not.toBeNull();
 await act(async()=>container.querySelector<HTMLTextAreaElement>('[aria-label="批注内容"]')!.focus());
 expect(container.querySelector('[aria-label="批注内容"]')).not.toBeNull();
 window.getSelection()!.removeAllRanges();
 await act(async()=>container.querySelector('.paper')!.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})));
 expect(container.querySelector('[aria-label="批注内容"]')).toBeNull();
});

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
it('restores the last reader document from persistent view state after a fresh session',async()=>{
 localStorage.setItem('litanvil-reader-view',JSON.stringify({documentId:'B',zoom:1.25,leftOpen:false,rightOpen:true,documentsOpen:false}));
 await act(async()=>root.render(<App/>));
 expect(container.querySelector('.paper-meta h1')?.textContent).toBe('Paper B');
 expect(container.querySelector('.reader-shell aside.collapsed')).not.toBeNull();
});
it('does not steal navigation when an earlier link import completes after the user closes the reader',async()=>{
 sessionStorage.setItem('litanvil-open-document','A');let complete!:(value:unknown)=>void;
 request.mockImplementation(async(url:string,init?:RequestInit)=>url.endsWith('/import/url')?new Promise(resolve=>{complete=resolve}):result(url.endsWith('/documents')?documents:url.endsWith('/project')?{directory:'/notes'}:[]));
 await act(async()=>root.render(<App/>));
 const input=container.querySelector<HTMLInputElement>('[aria-label="导入链接"]')!;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
 await act(async()=>{set.call(input,'https://example.test/new-paper');input.dispatchEvent(new Event('input',{bubbles:true}))});
 await act(async()=>container.querySelector<HTMLButtonElement>('button[aria-label="导入链接"]')!.click());
 await act(async()=>container.querySelector<HTMLButtonElement>('.back')!.click());
 await act(async()=>complete(result({id:'new',title:'Imported paper',source:'new',sourceType:'text',content:'body',progress:0})));
 expect(container.querySelector('.paper')).toBeNull();expect(container.querySelectorAll('.library-open')).toHaveLength(3);expect(sessionStorage.getItem('litanvil-open-document')).toBeNull();
});
it('cancels a delayed reader command before allowing the next command and never runs an expired download',async()=>{
 sessionStorage.setItem('litanvil-open-document','A');let aborted=false;
 request.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/documents/Late'))return new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>{aborted=true;reject(init.signal!.reason)},{once:true})});
  return result(url.endsWith('/documents')?documents:url.endsWith('/project')?{directory:'/notes'}:[]);
 });
 await act(async()=>root.render(<App/>));
 const [url,stream]=[...streams.entries()][0];const clientId=new URL(url).searchParams.get('clientId');
 const send=(data:Record<string,unknown>)=>stream.onmessage({data:JSON.stringify({type:'reader',data:{clientId,...data}})});
 await act(async()=>send({kind:'command',id:'first',action:'open_document',documentId:'Late',expiresAt:Date.now()+10000}));
 await act(async()=>{send({kind:'command',id:'second',action:'close_document',expiresAt:Date.now()+10000});send({kind:'cancel',commandId:'first'})});
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,60))});
 expect(aborted).toBe(true);expect(container.querySelector('.paper')).toBeNull();
 const acknowledgements=request.mock.calls.filter(([url])=>url.endsWith('/ui/ack')).map(([,init])=>JSON.parse(init.body));
 expect(acknowledgements.map(value=>value.id)).toEqual(['first','second']);expect(acknowledgements[0].result.ok).toBe(false);expect(acknowledgements[1].result.state.documentId).toBeNull();
 await act(async()=>send({kind:'command',id:'expired',action:'download_annotations',format:'json',expiresAt:Date.now()-1}));
 expect(request.mock.calls.some(([url])=>url.includes('/export.'))).toBe(false);
});
it('edits existing annotations in the shared right composer, retains failed edits and allows converting to a highlight',async()=>{
 sessionStorage.setItem('litanvil-open-document','A');let fail=true;
 const annotation={id:'ann',quote:'Evidence',note:'Original comment',location:'{}'};
 request.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(init?.method==='PATCH')return fail?result({error:'Cannot save'},false):result({...annotation,note:JSON.parse(String(init.body)).note});
  return result(url.endsWith('/documents')?documents:url.endsWith('/annotations')?[annotation]:{directory:'/notes'});
 });
 await act(async()=>root.render(<App/>));
 await act(async()=>Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='收起 Agent')!.click());
 await act(async()=>container.querySelector<HTMLButtonElement>('.ann-edit')!.click());
 const input=container.querySelector<HTMLTextAreaElement>('.ai-panel [aria-label="批注内容"]')!;
 expect(input.value).toBe('Original comment');expect(container.querySelector('.ann-list textarea')).toBeNull();
 expect(container.querySelector('.ai-panel')?.classList.contains('collapsed')).toBe(false);
 const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
 await act(async()=>{set.call(input,'Revised **comment**');input.dispatchEvent(new Event('input',{bubbles:true}))});
 const save=()=>Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='保存修改')!;
 await act(async()=>save().click());expect(input.value).toBe('Revised **comment**');expect(container.querySelector('[role="alert"]')?.textContent).toContain('Cannot save');
 fail=false;await act(async()=>{set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}))});
 await act(async()=>save().click());expect(container.querySelector('[aria-label="批注内容"]')).toBeNull();
 expect(container.querySelector('.ann-list')?.textContent).toContain('高亮');
 const updates=request.mock.calls.filter(([,init])=>init?.method==='PATCH');
 expect(updates.at(-1)?.[0]).toContain('/annotations/ann');expect(JSON.parse(updates.at(-1)?.[1].body)).toEqual({note:''});
});

it('persists a changed annotation color from the editor', async () => {
 sessionStorage.setItem('litanvil-open-document','A');
 const annotation={id:'ann',quote:'Evidence',note:'Note',location:'{}',color:'#c9b58f'};
 request.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(init?.method==='PATCH')return result({...annotation,...JSON.parse(String(init.body))});
  return result(url.endsWith('/documents')?documents:url.endsWith('/annotations')?[annotation]:{directory:'/notes'});
 });
 await act(async()=>root.render(<App/>));
 await act(async()=>container.querySelector<HTMLButtonElement>('.ann-edit')!.click());
 await act(async()=>container.querySelector<HTMLButtonElement>('button[aria-label="雾霾蓝"]')!.click());
 expect(container.querySelector('button[aria-label="雾霾蓝"]')?.getAttribute('aria-pressed')).toBe('true');
 await act(async()=>Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='保存修改')!.click());
 const update=request.mock.calls.find(([url,init])=>url.endsWith('/annotations/ann')&&init?.method==='PATCH');
 expect(JSON.parse(update![1].body)).toMatchObject({note:'Note',color:'#91a6b5'});
 expect(container.querySelector<HTMLElement>('.ann blockquote')?.style.borderLeftColor).toBe('rgb(145, 166, 181)');
});

it('does not duplicate an annotation when live sync arrives before the save response', async () => {
  vi.useFakeTimers();
  sessionStorage.setItem('litanvil-open-document', 'A');
  const saved = {id:'saved',documentId:'A',quote:'body',note:'',location:'{}',color:'#c9b58f'};
  let annotations: typeof saved[] = [];
  let finishSave!: (value: unknown) => void;
  request.mockImplementation(async (url:string, init?:RequestInit) => {
    if (url.endsWith('/annotations') && init?.method === 'POST') return new Promise(resolve => { finishSave = resolve });
    return result(url.endsWith('/documents') ? documents : url.endsWith('/annotations') ? annotations : url.endsWith('/project') ? {directory:'/notes'} : []);
  });
  await act(async () => root.render(<App/>));
  const text = container.querySelector('.paper-body p')!.firstChild!;
  const range = document.createRange(); range.selectNodeContents(text);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  await act(async () => container.querySelector('.paper')!.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})));
  await act(async () => [...container.querySelectorAll('button')].find(button=>button.textContent==='保存高亮')!.click());
  annotations = [saved];
  const stream = [...streams.values()][0];
  await act(async () => {stream.onmessage({data:'{"type":"library","data":{"revision":2}}'}); vi.advanceTimersByTime(80)});
  expect(container.querySelectorAll('.ann')).toHaveLength(1);
  await act(async () => finishSave(result(saved)));
  expect(container.querySelectorAll('.ann')).toHaveLength(1);
  window.getSelection()!.removeAllRanges();
});
