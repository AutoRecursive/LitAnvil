import fs from 'node:fs/promises';
import {writeFileSync, openSync, closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {root, runtimeDir, stateFile, lockFile, webUrl, delay} from './runtime.mjs';

await fs.mkdir(runtimeDir, {recursive:true,mode:0o700});
const state = {root, pid:process.pid, token:randomUUID(), status:'starting', url:webUrl, startedAt:new Date().toISOString()};
try {
  const fd = openSync(lockFile, 'wx', 0o600);
  writeFileSync(fd, JSON.stringify({pid:process.pid})); closeSync(fd);
} catch (error) {
  if (error.code === 'EEXIST') process.exit(0);
  throw error;
}
const save = async () => {
  await fs.writeFile(stateFile+'.tmp',JSON.stringify(state,null,2),{mode:0o600});
  await fs.rename(stateFile+'.tmp',stateFile);
};
const children = new Set();
let ending;
let failure;
const childExit = new WeakMap();
function launch(args) {
  const child = spawn(process.execPath,args,{cwd:root,env:{...process.env,PORT:'8787'},stdio:'inherit'});
  children.add(child);
  childExit.set(child,new Promise(resolve => child.once('exit',resolve)));
  child.on('error',error=>{failure=error;void shutdown(1)});
  child.once('exit',(code,signal)=>{
    children.delete(child);
    if (!ending && state.status==='running') {
      failure=new Error(`子进程意外退出 (${code ?? signal})`);
      void shutdown(1);
    }
  });
  return child;
}
const server = createServer((req,res)=>{
  if (req.headers.authorization!==`Bearer ${state.token}`) {res.writeHead(403).end();return;}
  res.setHeader('content-type','application/json');
  if (req.method==='POST' && req.url==='/stop') {res.end(JSON.stringify(state));void shutdown(0);}
  else if (req.method==='GET' && req.url==='/status') res.end(JSON.stringify(state));
  else res.writeHead(404).end();
});
async function shutdown(code) {
  if (ending) return ending;
  ending=(async()=>{
    if (failure) console.error('[CLI]',failure);
    state.status='stopping';
    const owned=[...children];
    for (const child of owned) child.kill('SIGTERM');
    const force=setTimeout(()=>{for(const child of owned) if(child.exitCode===null&&child.signalCode===null) child.kill('SIGKILL')},12000);
    await Promise.all(owned.map(child=>childExit.get(child)));
    clearTimeout(force);
    state.status=failure?'failed':'stopped';
    if(failure) state.error=failure.message;
    await save();
    await fs.unlink(lockFile).catch(()=>{});
    server.close();server.closeAllConnections();
    console.log(`[CLI] ${state.status}`);
    process.exit(code);
  })().catch(error=>{console.error(error);process.exit(1)});
  return ending;
}
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>void shutdown(0));
async function freePort(port) {
  const s=netServer();
  await new Promise((resolve,reject)=>{s.once('error',()=>reject(new Error(`端口 ${port} 已被其他服务占用，请先关闭该服务`)));s.listen(port,'127.0.0.1',resolve)});
  await new Promise(resolve=>s.close(resolve));
}
async function ready(url,child) {
  const end=Date.now()+30000;
  while(Date.now()<end&&!ending) {
    if(child.exitCode!==null||child.signalCode!==null) throw new Error(`服务启动失败：${url}`);
    try {if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
    await delay(200);
  }
  throw new Error(`服务启动超时：${url}`);
}
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  state.controlPort=server.address().port;await save();
  await freePort(8787);await freePort(5173);
  console.log('[CLI] building web assets');
  const build=launch([path.join(root,'node_modules/typescript/bin/tsc'),'-b']);
  await childExit.get(build);
  if(ending)await ending;
  if(build.exitCode!==0)throw new Error('TypeScript 构建失败');
  const bundle=launch([path.join(root,'node_modules/vite/bin/vite.js'),'build']);
  await childExit.get(bundle);
  if(ending)await ending;
  if(bundle.exitCode!==0)throw new Error('Web 构建失败');
  const api=launch(['--import','tsx','server/index.ts']);state.apiPid=api.pid;
  await ready('http://127.0.0.1:8787/api/documents',api);
  const web=launch([path.join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','5173','--strictPort']);state.webPid=web.pid;
  await ready(webUrl,web);
  if(ending)await ending;
  if(!children.has(api)||!children.has(web))throw new Error('服务在启动过程中退出');
  state.status='running';await save();console.log(`[CLI] ready ${webUrl}`);
}catch(error){failure=error;await shutdown(1)}
