import React, {useEffect, useRef, useState} from 'react';
import {api} from './api';
import {Dialog} from './Dialog';
import {topicDescendants, topicPath, type Topic} from '../shared/topics';

type Doc = {id:string; title:string; topicId?:string|null; topicIds?:string[]};
const docTopics = (doc:Doc) => doc.topicIds ?? (doc.topicId ? [doc.topicId] : []);
function TopicTag({color}: {color?: string}) {
 return <svg className="topic-tag-icon" viewBox="0 0 16 16" aria-hidden="true" style={color ? {color} : undefined}><path d="M2.25 2.75h6.13c.43 0 .84.17 1.14.47l4.02 4.02a1.38 1.38 0 0 1 0 1.95l-4.35 4.35a1.38 1.38 0 0 1-1.95 0L3.22 9.52a1.61 1.61 0 0 1-.47-1.14V3.25a.5.5 0 0 1 .5-.5Z" fill="currentColor" fillOpacity=".17" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/></svg>;
}
export function Topics({docs, onOpen, onError, revision, compact=false, selectedId, searching=false, onMove}: {docs:Doc[]; onOpen:(id:string)=>void; onError:(message:string)=>void; revision:number; compact?:boolean; selectedId?:string; searching?:boolean; onMove?:(id:string,topicIds:string[])=>void}) {
 const [topics,setTopics]=useState<Topic[]>([]);
 const [edit,setEdit]=useState<{id?:string; name:string; color:string; parentId:string|null}|null>(null);
 const [expanded,setExpanded]=useState<Set<string>>(new Set());
 const [unfiledOpen,setUnfiledOpen]=useState(compact);
 const [tagging,setTagging]=useState<{id:string;title:string;ids:string[]}|null>(null);
 const [savingTags,setSavingTags]=useState(false);
 const [dragging,setDragging]=useState<{kind:'topic'|'document';id:string}|null>(null);
 const dragRef=useRef<{kind:'topic'|'document';id:string}|null>(null);
 const [dropTarget,setDropTarget]=useState<string|null>(null);
 const dragBusy=useRef(false);
 function beginDrag(event:React.DragEvent,kind:'topic'|'document',id:string){
  if(dragBusy.current){event.preventDefault();return}
  event.stopPropagation();const item={kind,id};dragRef.current=item;setDragging(item);
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id);
 }
 function endDrag(){dragRef.current=null;setDragging(null);setDropTarget(null)}
 function accepts(target:string|null){const item=dragRef.current;if(!item)return false;
  if(item.kind==='document')return target!==null;
  const topic=topics.find(t=>t.id===item.id);
  return !!topic&&topic.parentId!==target&&(!target||!topicDescendants(topics,item.id).has(target));
 }
 function allowDrop(event:React.DragEvent,target:string|null){event.stopPropagation();if(!accepts(target)){setDropTarget(null);return}event.preventDefault();event.dataTransfer.dropEffect='move';setDropTarget(target??'__root__')}
 async function drop(event:React.DragEvent,target:string|null){
  event.stopPropagation();if(!accepts(target)||dragBusy.current)return;event.preventDefault();
  const item=dragRef.current!;endDrag();dragBusy.current=true;
  try{
   if(item.kind==='topic'){
    await api(`/topics/${encodeURIComponent(item.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({parentId:target})});
    setTopics(current=>current.map(topic=>topic.id===item.id?{...topic,parentId:target}:topic));
    if(target)setExpanded(current=>new Set(current).add(target));
   }else if(target){
    const doc=docs.find(d=>d.id===item.id);if(!doc)return;
    const ids=[...new Set([...docTopics(doc),target])];
    if(!docTopics(doc).includes(target)){
     await api(`/documents/${encodeURIComponent(doc.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({topicIds:ids})});
     onMove?.(doc.id,ids);
    }
    setExpanded(current=>new Set(current).add(target));
   }
  }catch(error){onError(String(error))}finally{dragBusy.current=false}
 }
 async function refresh(){const result=await api('/topics'); if(Array.isArray(result)) setTopics(result);}
 useEffect(()=>{void refresh().catch(e=>onError(String(e)))},[revision]);
 const selectedChain:string[]=[];const selectedDoc=docs.find(d=>d.id===selectedId);
 for(const topicId of selectedDoc?docTopics(selectedDoc):[]){let id:string|null=topicId;while(id&&!selectedChain.includes(id)){selectedChain.push(id);id=topics.find(t=>t.id===id)?.parentId||null}}
 const selectedChainKey=JSON.stringify(selectedChain);
 useEffect(()=>{const ids:string[]=JSON.parse(selectedChainKey);if(ids.length)setExpanded(previous=>new Set([...previous,...ids]))},[selectedId,selectedChainKey]);
 async function save(){if(!edit)return; try {await api(edit.id?`/topics/${edit.id}`:'/topics',{method:edit.id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)}); if(edit.parentId)setExpanded(s=>new Set(s).add(edit.parentId!));setEdit(null);await refresh()}catch(e){onError(String(e))}}
 async function remove(topic:Topic){if(!window.confirm(`删除主题「${topic.name}」？其中的文章和子主题会移到上一级。`))return;try{await api(`/topics/${topic.id}`,{method:'DELETE'});await refresh()}catch(e){onError(String(e))}}
 async function saveTags(){if(!tagging||savingTags)return;setSavingTags(true);try{await api(`/documents/${tagging.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({topicIds:tagging.ids})});onMove?.(tagging.id,tagging.ids);setExpanded(s=>new Set([...s,...tagging.ids]));setTagging(null)}catch(e){onError(String(e))}finally{setSavingTags(false)}}
 const docRow=(doc:Doc)=><div className="topic-doc" key={doc.id} draggable onDragStart={event=>beginDrag(event,'document',doc.id)} onDragEnd={endDrag}><div className="topic-doc-main"><button title={doc.title} className={selectedId===doc.id?'active':undefined} onClick={()=>onOpen(doc.id)}>{doc.title}</button><div className="topic-doc-chips">{docTopics(doc).map(id=>topics.find(t=>t.id===id)).filter((t):t is Topic=>Boolean(t)).map(t=><span key={t.id} className="topic-doc-chip" title={topicPath(topics,t.id)}><TopicTag color={t.color}/>{t.name}</span>)}</div></div><button className="topic-doc-tags" aria-label={`管理 ${doc.title} 的标签`} title="管理标签" onClick={()=>setTagging({id:doc.id,title:doc.title,ids:[...docTopics(doc)]})}>＋</button></div>;
 const unfiled=docs.filter(d=>!docTopics(d).some(id=>topics.some(t=>t.id===id)));
 const tree=(parentId:string|null):React.ReactNode=>topics.filter(t=>t.parentId===parentId).map(t=>{const open=searching||expanded.has(t.id);return <div className="topic-branch" key={t.id}><div className={`topic-line${dropTarget===t.id?' topic-drop-target':''}`} draggable onDragStart={event=>beginDrag(event,'topic',t.id)} onDragEnd={endDrag} onDragOver={event=>allowDrop(event,t.id)} onDragLeave={()=>setDropTarget(null)} onDrop={event=>void drop(event,t.id)}><button className="topic-name" onClick={()=>setExpanded(s=>{const n=new Set(s);n.has(t.id)?n.delete(t.id):n.add(t.id);return n})} aria-expanded={open}><span className="topic-chevron">{open?'▾':'▸'}</span><TopicTag color={t.color} /> <span className="topic-label">{t.name}</span><span className="topic-count">{docs.filter(d=>docTopics(d).some(id=>topicDescendants(topics,t.id).has(id))).length}</span></button><button aria-label={`新建 ${t.name} 的子主题`} onClick={()=>setEdit({name:'',color:t.color,parentId:t.id})}>＋</button><button aria-label={`编辑 ${t.name}`} onClick={()=>setEdit({...t})}>⋯</button></div>{open&&<div className="topic-children">{tree(t.id)}{docs.filter(d=>docTopics(d).includes(t.id)).map(docRow)}</div>}</div>});
 return <div className={`topic-tree${compact?' topic-tree-compact':''}`}><div className="topic-heading"><div><b>主题目录</b>{!compact&&<small>整理你的阅读脉络</small>}</div><button onClick={()=>setEdit({name:'',color:'#6366f1',parentId:null})}>＋ 新建</button></div><div className="topic-list">{dragging?.kind==='topic'&&<div className={`topic-root-drop${dropTarget==='__root__'?' topic-drop-target':''}`} onDragOver={event=>allowDrop(event,null)} onDragLeave={()=>setDropTarget(null)} onDrop={event=>void drop(event,null)}>拖到这里移至根目录</div>}{tree(null)}{topics.length===0&&!compact&&<p className="topic-empty">创建主题，开始整理文章</p>}<button className="topic-unfiled" aria-expanded={searching||unfiledOpen} onClick={()=>setUnfiledOpen(!unfiledOpen)}><span className="topic-chevron">{searching||unfiledOpen?'▾':'▸'}</span><TopicTag /><span className="topic-label">未分类</span><span className="topic-count">{unfiled.length}</span></button>{(searching||unfiledOpen)&&<div className="topic-children">{unfiled.map(docRow)}</div>}</div>{edit&&<Dialog title={edit.id?'编辑主题':'新建主题'} onClose={()=>setEdit(null)}><div className="topic-form"><label>名称<input value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})} maxLength={120}/></label><label>标签颜色<input type="color" value={edit.color} onChange={e=>setEdit({...edit,color:e.target.value})}/></label><label>上级主题<select value={edit.parentId||''} onChange={e=>setEdit({...edit,parentId:e.target.value||null})}><option value="">根目录</option>{topics.filter(t=>!edit.id||!topicDescendants(topics,edit.id).has(t.id)).map(t=><option key={t.id} value={t.id}>{topicPath(topics,t.id)}</option>)}</select></label><div className="topic-form-actions">{edit.id&&<button onClick={()=>{const t=topics.find(t=>t.id===edit.id);setEdit(null);if(t)void remove(t)}}>删除主题</button>}<button disabled={!edit.name.trim()} onClick={()=>void save()}>保存</button></div></div></Dialog>}{tagging&&<Dialog title={`管理标签：${tagging.title}`} onClose={()=>{if(!savingTags)setTagging(null)}}><div className="topic-tag-picker"><p>可选择多个领域或细分方向</p>{topics.map(t=><label key={t.id}><input type="checkbox" checked={tagging.ids.includes(t.id)} onChange={event=>setTagging({...tagging,ids:event.target.checked?[...tagging.ids,t.id]:tagging.ids.filter(id=>id!==t.id)})}/><TopicTag color={t.color}/><span>{topicPath(topics,t.id)}</span></label>)}{!topics.length&&<p>请先新建主题。</p>}<div className="topic-form-actions"><button disabled={savingTags} onClick={()=>setTagging(null)}>取消</button><button disabled={savingTags} onClick={()=>void saveTags()}>保存标签</button></div></div></Dialog>}</div>
}
