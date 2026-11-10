import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let proc:ChildProcess,dir:string;const base='http://127.0.0.1:18787';
beforeAll(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'litanvil-test-'));proc=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:'18787',LITANVIL_DATA_DIR:dir},stdio:'ignore'});for(let i=0;i<60;i++){try{if((await fetch(base+'/api/documents')).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error('Isolated API failed to start')});
afterAll(async()=>{proc?.kill();await fs.rm(dir,{recursive:true,force:true})});
describe('isolated document API',()=>{
 it('retains every document across concurrent imports',async()=>{const results=await Promise.all(Array.from({length:5},(_,i)=>fetch(base+'/api/import/url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:`data:text/html,<title>Concurrent${i}</title><p>body${i}</p>`})}).then(r=>r.json())));const docs=await(await fetch(base+'/api/documents')).json();for(const d of results)expect(docs.some((x:any)=>x.id===d.id)).toBe(true)});

 it('reuses imported links and persists editable annotations',async()=>{const url='data:text/html,<title>Test%20Paper</title><p>Evidence%20and%20methods.</p>';const post=async(route:string,body:any,method='POST')=>(await fetch(base+route,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();const d=await post('/api/import/url',{url});expect(d.title).toBe('Test Paper');const cached=await post('/api/import/url',{url});expect(cached.id).toBe(d.id);expect(cached.cached).toBe(true);const a=await post('/api/annotations',{documentId:d.id,quote:'Evidence',note:'Check sample'});await post('/api/annotations/'+a.id,{note:'Updated comment'},'PATCH');const md=await(await fetch(base+`/api/documents/${d.id}/export.md`)).text();expect(md).toContain('Updated comment');const removed=await fetch(base+'/api/annotations/'+a.id,{method:'DELETE'});expect(removed.ok).toBe(true);expect(await(await fetch(base+`/api/documents/${d.id}/annotations`)).json()).toEqual([]);expect((await(await fetch(base+'/api/documents')).json()).filter((x:any)=>x.id===d.id)).toHaveLength(1)});
});
