import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {paperNotes} from './paper-notes';
import {Markdown} from './Markdown';
import {subscribeLive} from './live';
import type {PaperReference} from '../shared/paper-reference';

export function Notebook({documentId,selectionLink,insertion,onInsert,onReference}:{
  documentId:string;selectionLink?:string;insertion?:{id:string;markdown:string};onInsert:()=>void;onReference:(ref:PaperReference)=>void;
}){
  const store=paperNotes(documentId);
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  const [preview,setPreview]=useState(false);
  const input=useRef<HTMLTextAreaElement>(null);
  const cursor=useRef({start:0,end:0});
  const inserted=useRef<string | undefined>(undefined);
  const [pendingCursor,setPendingCursor]=useState<number>();
  useEffect(()=>{void store.load();return()=>{void store.save()}},[store]);
  useEffect(()=>subscribeLive('library',store.refresh,{onOpen:store.refresh}),[store]);
  useEffect(()=>{
    if(!state.loaded||!insertion||inserted.current===insertion.id)return;
    inserted.current=insertion.id;
    const text=store.getSnapshot().markdown;
    const start=Math.min(cursor.current.start,text.length),end=Math.min(cursor.current.end,text.length);
    const chunk=(start&&text[start-1]!=='\n'?'\n\n':'')+insertion.markdown+'\n\n';
    store.setText(text.slice(0,start)+chunk+text.slice(end));
    cursor.current={start:start+chunk.length,end:start+chunk.length};
    setPendingCursor(start+chunk.length);setPreview(false);
  },[insertion,state.loaded,store]);
  useEffect(()=>{if(pendingCursor===undefined||preview)return;input.current?.focus({preventScroll:true});input.current?.setSelectionRange(pendingCursor,pendingCursor);setPendingCursor(undefined)},[pendingCursor,preview]);
  return <section className="notebook" aria-label="论文笔记">
    <div className="notebook-toolbar">
      <div className="note-mode" role="group" aria-label="笔记显示模式">
        <button aria-pressed={!preview} onClick={()=>setPreview(false)}>编辑</button>
        <button aria-pressed={preview} onClick={()=>setPreview(true)}>预览</button>
      </div>
      <span className="note-save-status" role="status">{!state.loaded?'加载中…':state.saving?'保存中…':state.dirty?'未保存':'已保存'}</span>
    </div>
    <button className="note-insert" disabled={!selectionLink||!state.loaded} onClick={onInsert}>插入选区链接</button>
    {state.error&&<div className="note-error" role="alert">{state.error}<button onClick={()=>void(state.loaded?store.save():store.load())} disabled={state.conflict||state.saving}>重试</button>{state.conflict&&<button onClick={()=>void store.useServerVersion()}>加载已保存版本</button>}</div>}
    {preview?<div className="note-preview"><Markdown onReference={onReference}>{state.markdown||'暂无笔记'}</Markdown></div>:<textarea
      ref={input} className="note-editor" aria-label="Markdown 笔记" placeholder="写下笔记…" value={state.markdown} disabled={!state.loaded}
      onChange={event=>store.setText(event.target.value)} onSelect={event=>{cursor.current={start:event.currentTarget.selectionStart,end:event.currentTarget.selectionEnd}}}
    />}
  </section>;
}
