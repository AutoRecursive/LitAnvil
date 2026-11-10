import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexSession} from '../server/session';
it('shares one connection, interrupts turns, clears context, resumes after restart',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-session-'));let starts=0;const transport=()=>{starts++;return spawn(process.execPath,[path.resolve('tests/fixtures/app-server.mjs')],{stdio:'pipe'})};
 const session=new CodexSession(root,async()=>root,path.join(root,'data'),transport);session.log=()=>{};
 let restored:CodexSession|undefined;
 try{await Promise.all([session.connect(),session.connect()]);expect(starts).toBe(1);await session.send('hello');expect(session.state.status).toBe('running');expect(session.state.items.some(x=>x.type==='userMessage')).toBe(true);await session.stop();expect(session.state.status).toBe('idle');const previous=session.state.threadId;await session.clear();expect(session.state.items).toEqual([]);expect(session.state.threadId).not.toBe(previous);const persisted=session.state.threadId;session.close();restored=new CodexSession(root,async()=>root,path.join(root,'data'),transport);restored.log=()=>{};await restored.connect();expect(restored.state.threadId).toBe(persisted);expect(restored.state.items[0].text).toBe('restored')}
 finally{session.close();restored?.close();await fs.rm(root,{recursive:true,force:true})}
});

it('retries repeated transport crashes and resumes without requiring another message',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-reconnect-'));let starts=0;
 const transport=()=>{starts++;return starts<3?spawn(process.execPath,['-e','process.exit(1)'],{stdio:'pipe'}):spawn(process.execPath,[path.resolve('tests/fixtures/app-server.mjs')],{stdio:'pipe'})};
 const session=new CodexSession(root,async()=>root,path.join(root,'data'),transport);session.log=()=>{};
 try{
   const recovered=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Recovery did not complete')),12000);session.on('snapshot',state=>{if(starts===3&&state.threadId&&state.status==='idle'){clearTimeout(timeout);resolve()}})});
   await expect(session.connect()).rejects.toThrow();await recovered;
   expect(starts).toBe(3);expect(session.state.status).toBe('idle');expect(session.state.error).toBeNull();
 }finally{session.close();await fs.rm(root,{recursive:true,force:true})}
},15000);

it('interrupts a turn even when stop is pressed before turn/start replies',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-stop-'));
 const transport=()=>spawn(process.execPath,[path.resolve('tests/fixtures/app-server.mjs')],{stdio:'pipe',env:{...process.env,LITANVIL_DELAY_TURN_START_MS:'100'}});
 const session=new CodexSession(root,async()=>root,path.join(root,'data'),transport);session.log=()=>{};
 try{await session.connect();const running=new Promise<void>(resolve=>session.once('snapshot',()=>resolve()));const sending=session.send('hello');await running;await Promise.all([sending,session.stop()]);expect(session.state.status).toBe('idle');expect(session.state.turnId).toBeNull()}
 finally{session.close();await fs.rm(root,{recursive:true,force:true})}
});

it('preserves the persisted thread when resume fails instead of silently starting an empty conversation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lit-resume-'));const storage=path.join(root,'data');await fs.mkdir(storage);await fs.writeFile(path.join(storage,'session.json'),JSON.stringify({threadId:'keep-this-thread'}));
 const transport=()=>spawn(process.execPath,[path.resolve('tests/fixtures/app-server.mjs')],{stdio:'pipe',env:{...process.env,LITANVIL_FAIL_RESUME:'1'}});
 const session=new CodexSession(root,async()=>root,storage,transport);session.log=()=>{};
 try{await expect(session.connect()).rejects.toThrow('Temporary resume failure');expect(JSON.parse(await fs.readFile(path.join(storage,'session.json'),'utf8')).threadId).toBe('keep-this-thread');expect(session.state.items).toEqual([])}
 finally{session.close();await fs.rm(root,{recursive:true,force:true})}
});
