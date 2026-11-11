import {paneLayoutSchema} from "../shared/reader-layout.js";
import { randomUUID } from "node:crypto";

type Request = {
  id:string;action:string;args:Record<string,any>;client:Client;
  resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;
};
type Client = {
  id:string;send:(event:unknown)=>void;state:Record<string,any>;active:number;
  queue:Request[];running?:Request;closed:boolean;
};
export class ReaderBridge {
  private clients=new Map<string,Client>();
  private pending=new Map<string,Request>();
  private activity=0;
  constructor(private timing={executionTimeoutMs:12000,queueTimeoutMs:30000,maxQueue:16}){}
  private retire(client:Client,error:Error) {
    client.closed=true;
    if(this.clients.get(client.id)===client)this.clients.delete(client.id);
    for(const request of [...this.pending.values()])if(request.client===client){
      clearTimeout(request.timer);this.pending.delete(request.id);request.reject(error);
    }
    client.queue=[];client.running=undefined;
  }
  register(clientId:string,send:Client["send"]){
    const previous=this.clients.get(clientId);
    if(previous)this.retire(previous,new Error("阅读界面已重新连接，未完成的操作不会自动重放，请重试"));
    const client:Client={id:clientId,send,state:{},active:++this.activity,queue:[],closed:false};
    this.clients.set(clientId,client);
    return()=>this.retire(client,new Error("操作中的阅读界面已断开，请重试"));
  }
  update(clientId:string,state:Record<string,any>,active=false){
    const client=this.clients.get(clientId);if(!client)return false;
    client.state=state;if(active)client.active=++this.activity;return true;
  }
  private finish(request:Request,result?:any,error?:Error){
    if(!this.pending.delete(request.id))return;
    clearTimeout(request.timer);
    const client=request.client;
    client.queue=client.queue.filter(item=>item!==request);
    if(client.running===request)client.running=undefined;
    if(error)request.reject(error);else request.resolve({...result,clientId:client.id});
    this.drain(client);
  }
  private drain(client:Client){
    if(client.closed||client.running||!client.queue.length)return;
    const request=client.queue.shift()!;client.running=request;clearTimeout(request.timer);
    const expiresAt=Date.now()+this.timing.executionTimeoutMs;
    request.timer=setTimeout(()=>{
      try{client.send({kind:"cancel",clientId:client.id,commandId:request.id})}
      catch{this.retire(client,new Error("阅读界面连接失败，请重试"));return;}
      this.finish(request,undefined,new Error("界面操作超时，可能已部分执行；请读取当前状态后重试"));
    },this.timing.executionTimeoutMs);
    try{client.send({...request.args,kind:"command",id:request.id,action:request.action,clientId:client.id,expiresAt})}
    catch(error){this.retire(client,new Error(`界面操作发送失败：${String(error)}`))}
  }
  acknowledge(clientId:string,id:string,result:any){
    const request=this.pending.get(id);
    if(!request||request.client.id!==clientId||request.client!==this.clients.get(clientId)||request.client.running!==request||typeof result?.ok!=="boolean")return false;
    this.finish(request,result);return true;
  }
  snapshots(){return [...this.clients].map(([clientId,client])=>({...client.state,clientId}))}
  async readStates(){
    const states=await Promise.allSettled(this.snapshots().map(tab=>this.command("get_state",{clientId:tab.clientId})));
    return states.flatMap(state=>state.status==="fulfilled"&&state.value.ok?[{...state.value.state,clientId:state.value.clientId}]:[]);
  }
  async command(action:string,args:Record<string,any>={}){
    if(typeof action!=="string"||!action)throw new Error("缺少界面操作");
    const candidates=[...this.clients].filter(([clientId])=>!args.clientId||clientId===args.clientId);
    candidates.sort(([,a],[,b])=>Number(Boolean(b.state.visible))-Number(Boolean(a.state.visible))||b.active-a.active);
    const selected=candidates[0];if(!selected)throw new Error("阅读界面未连接");
    const [,client]=selected;
    if(client.queue.length+Number(Boolean(client.running))>=this.timing.maxQueue)throw new Error("阅读界面排队操作过多，请等待后重试");
    const id=randomUUID(),copy=structuredClone(args);
    return new Promise<any>((resolve,reject)=>{
      const request:Request={id,action,args:copy,client,resolve,reject,timer:setTimeout(()=>this.finish(request,undefined,new Error("界面操作排队超时，未执行")),this.timing.queueTimeoutMs)};
      this.pending.set(id,request);client.queue.push(request);this.drain(client);
    });
  }
}
export const readerBridge = new ReaderBridge();
export const uiTools = [
  {
    name: "get_reader_state",
    description:
      "Read connected LitAnvil tabs, active document, current page, loaded pages, zoom and panels. clientId identifies a specific tab for control_reader.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "control_reader",
    description:
      "Control one LitAnvil tab (the most recently used visible tab by default). open_document waits until the document is ready. preview_text uses temporary colored overlays and never saves annotations. Its result includes quote/location for the nearest match, usable by manage_annotation to save only when requested. close_document returns to the document library. set_layout changes persisted pane preferences within bounds; renderedLayout reports the responsive dimensions. reset_layout restores defaults. download_annotations requests a JSON/Markdown browser download, without claiming the file has finished saving.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "get_state",
            "open_document",
            "close_document",
            "go_to_page",
            "preview_text",
            "clear_preview",
            "set_zoom",
            "set_layout",
            "reset_layout",
            "download_annotations",
            "toggle_left",
            "toggle_right",
          ],
        },
        layout:paneLayoutSchema,
        format:{type:"string",enum:["json","markdown"]},
        clientId: { type: "string" },
        documentId: { type: "string" },
        page: { type: "integer", minimum: 1 },
        text: { type: "string" },
        append: { type: "boolean", description: "Keep earlier temporary previews when marking another passage; default false." },
        color: { type: "string", enum: ["cyan", "pink", "blue"] },
        zoom: { type: "number", minimum: 0.75, maximum: 1.8 },
        open: { type: "boolean" },
      },
      required: ["action"],
    },
  },
];
