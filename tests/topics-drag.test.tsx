// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {Topics} from '../src/Topics';

it('adds document tags, reparents topics and rejects cycles when dragging',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const topics=[{id:'a',name:'领域',parentId:null,color:'#91a6b5'},{id:'b',name:'方向',parentId:'a',color:'#b39482'}];
 const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>({ok:true,json:async()=>init?.method==='PATCH'?{}:topics}));
 vi.stubGlobal('fetch',fetcher);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const moved=vi.fn();
 const docs=[{id:'paper',title:'论文',topicId:'a'}];
 try{
  await act(async()=>root.render(<Topics docs={docs} onOpen={()=>{}} onError={()=>{}} onMove={moved} revision={0} selectedId="paper"/>));
  const transfer={setData:vi.fn(),effectAllowed:'',dropEffect:''};
  const fire=(element:Element,type:string)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:transfer});element.dispatchEvent(event);return event};
  const topic=(name:string)=>[...host.querySelectorAll('.topic-name')].find(button=>button.textContent?.includes(name))!.parentElement!;
  const paper=host.querySelector('.topic-doc')!;
  await act(async()=>{fire(paper,'dragstart');fire(topic('方向'),'dragover');fire(topic('方向'),'drop')});
  expect(moved).toHaveBeenCalledWith('paper',['a','b']);
  expect(fetcher.mock.calls.some(([url,init])=>url.endsWith('/documents/paper')&&JSON.parse(String(init?.body)).topicIds.includes('b'))).toBe(true);
  const before=fetcher.mock.calls.length;
  await act(async()=>{fire(topic('领域'),'dragstart');fire(topic('方向'),'dragover');fire(topic('方向'),'drop');fire(topic('领域'),'dragend')});
  expect(fetcher.mock.calls).toHaveLength(before);
  await act(async()=>{fire(topic('方向'),'dragstart')});
  await act(async()=>{const target=host.querySelector('.topic-root-drop')!;fire(target,'dragover');fire(target,'drop')});
  expect(fetcher.mock.calls.some(([url,init])=>url.endsWith('/topics/b')&&JSON.parse(String(init?.body)).parentId===null)).toBe(true);
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
});
