import { useSyncExternalStore } from "react";
type Draft = { text: string; unsent: string[] };
let snapshot: Draft = {text:"",unsent:[]};
const listeners = new Set<() => void>();
function read() {
  try {
    const unsent=JSON.parse(sessionStorage.getItem("litanvil-agent-unsent") || "[]");
    snapshot={text:sessionStorage.getItem("litanvil-agent-draft")||"",unsent:Array.isArray(unsent)?unsent.filter(value=>typeof value==="string"):[]};
  } catch { /* Keep in-memory input if storage is unavailable. */ }
}
function update(next: Draft) {
  snapshot=next;
  try { sessionStorage.setItem("litanvil-agent-draft",next.text); sessionStorage.setItem("litanvil-agent-unsent",JSON.stringify(next.unsent)); }
  catch (error) { console.warn("[Chat] draft storage unavailable",error); }
  for (const listener of listeners) listener();
}
export const chatDrafts = {
  getSnapshot:()=>snapshot,
  subscribe:(listener:()=>void)=>{ if(!listeners.size)read(); listeners.add(listener); return ()=>{listeners.delete(listener)}; },
  setText:(text:string)=>update({...snapshot,text}),
  failed:(text:string)=>{
    if (!snapshot.text) update({...snapshot,text});
    else if(snapshot.text!==text && !snapshot.unsent.includes(text)) update({...snapshot,unsent:[...snapshot.unsent,text]});
  },
  restore:(index:number)=>{
    const text=snapshot.unsent[index];if(text===undefined)return;
    const unsent=[...snapshot.unsent];unsent.splice(index,1,...(snapshot.text?[snapshot.text]:[]));
    update({text,unsent});
  },
};
export function useChatDraft() { return useSyncExternalStore(chatDrafts.subscribe,chatDrafts.getSnapshot,chatDrafts.getSnapshot); }
