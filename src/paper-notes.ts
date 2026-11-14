import {api} from './api';
export type NoteSnapshot={markdown:string;revision:number;loaded:boolean;dirty:boolean;saving:boolean;error:string;conflict:boolean};
type ServerNote={markdown:string;revision:number};
export class PaperNotes {
  private listeners=new Set<()=>void>();
  private timer:ReturnType<typeof setTimeout>|undefined;
  private loading?:Promise<void>;
  private state:NoteSnapshot={markdown:'',revision:0,loaded:false,dirty:false,saving:false,error:'',conflict:false};
  constructor(private id:string){
    try{const s=JSON.parse(localStorage.getItem(this.key)||'null');
      if(s&&typeof s.markdown==='string'&&Number.isSafeInteger(s.revision)&&s.revision>=0)this.state={...this.state,markdown:s.markdown,revision:s.revision,dirty:s.dirty===true};
    }catch{}
  }
  private get key(){return 'litanvil-note-draft:'+this.id}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}};
  private update(patch:Partial<NoteSnapshot>){
    this.state={...this.state,...patch};
    try{localStorage.setItem(this.key,JSON.stringify({markdown:this.state.markdown,revision:this.state.revision,dirty:this.state.dirty}))}catch{}
    this.listeners.forEach(fn=>fn());
  }
  load=()=>this.loading ||= this.fetch().finally(()=>{this.loading=undefined});
  private async fetch(){
    try{
      const note:ServerNote=await api(`/documents/${encodeURIComponent(this.id)}/reader-note`);
      if(this.state.dirty&&this.state.markdown!==note.markdown){
        if(this.state.revision!==note.revision){this.update({loaded:true,conflict:true,error:'笔记已有其他版本，本地草稿已保留'});return;}
        this.update({loaded:true,error:'',conflict:false});this.schedule();
      }else this.update({...note,loaded:true,dirty:false,error:'',conflict:false});
    }catch(error){this.update({error:String(error)});}
  }
  setText=(markdown:string)=>{this.update({markdown,dirty:true});this.schedule()};
  private schedule(){clearTimeout(this.timer);if(this.state.loaded&&!this.state.conflict)this.timer=setTimeout(()=>void this.save(),600)}
  save=async()=>{
    clearTimeout(this.timer);
    if(!this.state.loaded||!this.state.dirty||this.state.saving||this.state.conflict)return;
    const {markdown,revision}=this.state;this.update({saving:true,error:''});
    let success=false;
    try{
      const response=await fetch(`http://localhost:8787/api/documents/${encodeURIComponent(this.id)}/reader-note`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({markdown,revision}),
      });
      const result=await response.json();
      if(!response.ok){this.update({conflict:response.status===409});throw new Error(result.error||'笔记保存失败');}
      if(result.warning)window.dispatchEvent(new CustomEvent('litanvil-warning',{detail:result.warning}));
      success=true;
      this.update({revision:result.revision,dirty:this.state.markdown!==markdown});
    }catch(error){this.update({error:String(error)});}
    finally{this.update({saving:false});if(success&&this.state.dirty)this.schedule();}
  };
  useServerVersion=async()=>{
    try{const note:ServerNote=await api(`/documents/${encodeURIComponent(this.id)}/reader-note`);
      // Keep a recovery copy before deliberately replacing a conflicting draft.
      localStorage.setItem(this.key+':recovery',this.state.markdown);
      this.update({...note,loaded:true,dirty:false,conflict:false,error:''});
    }catch(error){this.update({error:String(error)});}
  };
}
const stores=new Map<string,PaperNotes>();
export function paperNotes(id:string){let store=stores.get(id);if(!store){store=new PaperNotes(id);stores.set(id,store)}return store;}
