// @vitest-environment jsdom
import React,{act} from 'react';import{createRoot,type Root}from'react-dom/client';
import{beforeEach,afterEach,expect,it,vi}from'vitest';
const live=vi.hoisted(()=>({receive:undefined as undefined|((value:any)=>void)}));
vi.mock('../src/live',()=>({subscribeLive:(_channel:string,receive:(value:any)=>void)=>{live.receive=receive;return()=>{}}}));
import{Chat}from'../src/Chat';import{chatDrafts}from'../src/chat-draft';
let root:Root,host:HTMLDivElement,request:ReturnType<typeof vi.fn>,onImport:ReturnType<typeof vi.fn<(url:string)=>void>>;
const state=(extra:any={})=>({protocolVersion:1,provider:'codex',sessionId:'codex:old',nativeSessionId:'old',workspace:'/notes',revision:1,status:'idle',items:[],error:null,turnId:null,...extra});
const response=(body:any={},ok=true)=>({ok,json:async()=>body});
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;sessionStorage.clear();chatDrafts.setText('');request=vi.fn(async()=>response([]));vi.stubGlobal('fetch',request);onImport=vi.fn<(url:string)=>void>();host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()});
async function mount(snapshot=state()){await act(async()=>root.render(<Chat onImport={onImport}/>));await act(async()=>live.receive!(snapshot))}
async function type(text:string){await act(async()=>chatDrafts.setText(text))}
async function enter(){await act(async()=>host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})))}
it('keeps text and sends no request on Enter while reconnecting, but valid arXiv imports remain usable',async()=>{
 await mount(state({status:'connecting'}));await type('keep this draft');await enter();
 expect(chatDrafts.getSnapshot().text).toBe('keep this draft');expect(request.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
 await type('https://export.arxiv.org/pdf/1706.03762.pdf');await enter();
 expect(onImport).toHaveBeenCalledWith('https://arxiv.org/pdf/1706.03762');expect(chatDrafts.getSnapshot().text).toBe('');
});
it('blocks synchronous double Enter and binds the submitted message to the displayed session/workspace',async()=>{
 await mount();await type('one message');let finish!:(value:any)=>void;
 request.mockImplementation(async(_url:string,init?:RequestInit)=>init?.method==='POST'?new Promise(resolve=>{finish=resolve}):response([]));
 await act(async()=>{const field=host.querySelector('textarea')!;for(let i=0;i<2;i++)field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))});
 const posts=request.mock.calls.filter(([,init])=>init?.method==='POST');expect(posts).toHaveLength(1);
 expect(JSON.parse(posts[0][1].body)).toMatchObject({text:'one message',expectedSessionId:'codex:old',expectedWorkspace:'/notes'});
 await act(async()=>finish(response({ok:true})));
});
it('preserves both a failed message and newer typing across Chat remounts without combining messages',async()=>{
 await mount();await type('original request');let finish!:(value:any)=>void;
 request.mockImplementation(async(_url:string,init?:RequestInit)=>init?.method==='POST'?new Promise(resolve=>{finish=resolve}):response([]));
 await enter();await type('new question');
 await act(async()=>root.render(<div/>));await mount();
 await act(async()=>finish(response({error:'会话已切换'},false)));
 expect(chatDrafts.getSnapshot().text).toBe('new question');expect(chatDrafts.getSnapshot().unsent).toContain('original request');
 expect(host.querySelector('.unsent-messages')?.textContent).toContain('original request');
 await act(async()=>host.querySelector<HTMLButtonElement>('.unsent-messages button')!.click());
 expect(chatDrafts.getSnapshot().text).toBe('original request');expect(chatDrafts.getSnapshot().unsent).toContain('new question');
});
it('allows one stop during an unacknowledged send and disables repeated stop requests',async()=>{
 await mount();await type('long request');let sendFinish!:(value:any)=>void,stopFinish!:(value:any)=>void;
 request.mockImplementation(async(url:string,init?:RequestInit)=>!init?.method?response([]):new Promise(resolve=>{if(url.endsWith('/stop'))stopFinish=resolve;else sendFinish=resolve}));
 await enter();await act(async()=>live.receive!(state({status:'running',turnId:'turn'})));
 await act(async()=>{const button=[...host.querySelectorAll('button')].find(button=>button.textContent==='停止')!;button.click();button.click()});
 expect(request.mock.calls.filter(([url])=>url.endsWith('/stop'))).toHaveLength(1);
 expect(host.textContent).toContain('停止中');
 await act(async()=>{stopFinish(response({ok:true}));sendFinish(response({ok:true}));live.receive!(state())});
});
it('clears the visible transcript and drafts from the same clear action that resets the backend session',async()=>{
 await mount(state({items:[{id:'m',type:'message',role:'assistant',text:'old answer'}]}));await type('draft to clear');
 request.mockImplementation(async(url:string)=>url.endsWith('/clear')?response({ok:true,state:state({sessionId:'codex:new',nativeSessionId:'new',items:[],revision:2})}):response([]));
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='清空上下文')!.click());
 expect(request).toHaveBeenCalledWith(expect.stringContaining('/clear'),expect.objectContaining({method:'POST'}));
 expect(host.textContent).not.toContain('old answer');expect(chatDrafts.getSnapshot()).toEqual({text:'',unsent:[]});expect(host.textContent).toContain('有什么想一起研究的？');
});
it('places annotation actions above messages and outside the message composer',async()=>{
 await act(async()=>root.render(<Chat onImport={onImport} quote="Selected text"><button>保存高亮</button><button>保存评论</button></Chat>));
 const panel=host.querySelector('.selection-panel')!;
 expect(panel.textContent).toContain('Selected text');expect(panel.textContent).toContain('保存高亮');expect(panel.textContent).toContain('保存评论');
 expect(host.querySelector('.composer')?.textContent).not.toContain('保存高亮');
 expect(panel.nextElementSibling?.className).toBe('session-messages');
});
it('follows streamed output only while the reader is near the bottom and resumes after scrolling back',async()=>{
 await mount();
 const list=host.querySelector<HTMLElement>('.session-messages')!;
 let height=1000;
 Object.defineProperty(list,'scrollHeight',{configurable:true,get:()=>height});
 Object.defineProperty(list,'clientHeight',{configurable:true,get:()=>400});
 const update=async(text:string)=>act(async()=>live.receive!(state({status:'running',items:[{id:'m',type:'message',role:'assistant',text}]})));
 list.scrollTop=550;list.dispatchEvent(new Event('scroll',{bubbles:true}));
 height=1200;await update('first');expect(list.scrollTop).toBe(1200);
 list.scrollTop=250;list.dispatchEvent(new Event('scroll',{bubbles:true}));
 height=1500;await update('second');expect(list.scrollTop).toBe(250);
 list.scrollTop=1040;list.dispatchEvent(new Event('scroll',{bubbles:true}));
 height=1700;await update('third');expect(list.scrollTop).toBe(1700);
});
