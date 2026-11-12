import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const exec=promisify(execFile);
const cli=path.resolve('bin/lita.mjs');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function available(port:number) {
 const server=createServer();
 try {await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});return true;}
 catch{return false;}
 finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
it('installs a help entry point and rejects unknown commands',async()=>{
 const help=await exec(process.execPath,[cli,'--help'],{cwd:os.tmpdir()});
 expect(help.stdout).toContain('lita start');expect(help.stdout).toContain('lita open');
 await expect(exec(process.execPath,[cli,'unknown'])).rejects.toMatchObject({code:1,stderr:expect.stringContaining('未知命令')});
});
it('owns background services, reuses starts, preserves occupied ports and shuts down sibling processes on failure',async(context)=>{
 if(!await available(5173)||!await available(8787)){context.skip();return;}
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lit-cli-'));
 const env={...process.env,LITANVIL_DATA_DIR:directory,LITANVIL_QMD:'off'};
 const call=(...args:string[])=>exec(process.execPath,[cli,...args],{cwd:os.tmpdir(),env,timeout:50000});
 const state=async()=>JSON.parse(await fs.readFile(path.join(directory,'cli/state.json'),'utf8'));
 const blocker=createServer();
 try{
  await new Promise<void>(resolve=>blocker.listen(5173,'127.0.0.1',resolve));
  await expect(call('start')).rejects.toMatchObject({stderr:expect.stringContaining('5173')});
  expect(blocker.listening).toBe(true);expect(await available(8787)).toBe(true);
  await new Promise<void>(resolve=>blocker.close(()=>resolve()));
  await call('start');const first=await state();expect(first.status).toBe('running');
  expect((await call('status')).stdout).toContain('running');
  await call('start');expect((await state()).pid).toBe(first.pid);
  expect((await fetch('http://127.0.0.1:8787/api/documents')).ok).toBe(true);
  expect((await fetch('http://127.0.0.1:5173')).ok).toBe(true);
  process.kill(first.webPid,'SIGTERM');
  const deadline=Date.now()+15000;while((await state()).status!=='failed'&&Date.now()<deadline)await pause(100);
  expect((await state()).status).toBe('failed');expect(await available(8787)).toBe(true);
  await call('start');expect((await state()).pid).not.toBe(first.pid);
  await call('restart');expect((await state()).status).toBe('running');
  await call('stop');expect((await state()).status).toBe('stopped');
  expect(await available(8787)).toBe(true);expect(await available(5173)).toBe(true);
  expect((await call('stop')).stdout).toContain('已关闭');
  expect((await call('status')).stdout).toContain('未运行');
 }finally{
  await call('stop').catch(()=>{});blocker.close();
  await fs.rm(directory,{recursive:true,force:true});
 }
},60000);
