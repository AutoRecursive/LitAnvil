#!/usr/bin/env node
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {root,runtimeDir,stateFile,lockFile,logFile,webUrl,delay,alive,readState,control} from './runtime.mjs';

async function start() {
  const old=await readState();
  const running=await control(old);
  if(running?.status==='running'){console.log(`LitAnvil 已运行：${webUrl}`);return;}
  if(!running) {
    try {
      const lock=JSON.parse(await fs.readFile(lockFile,'utf8'));
      if(alive(lock.pid))throw new Error('服务管理进程正在启动或无法响应；请使用 lita status / logs 查看');
      await fs.unlink(lockFile);
    }catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.mkdir(runtimeDir,{recursive:true,mode:0o700});
    await fs.mkdir(path.dirname(logFile),{recursive:true});
    const log=await fs.open(logFile,'a',0o600);
    try {
      const child=spawn(process.execPath,[path.join(root,'bin/service.mjs')],{cwd:root,env:process.env,detached:true,stdio:['ignore',log.fd,log.fd]});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
      child.unref();
    } finally {await log.close();}
  }
  console.log('正在启动 LitAnvil…');
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    await delay(200);
    const state=await readState();
    if(state?.startedAt===old?.startedAt&&!running)continue;
    if(state?.status==='failed')throw new Error(`${state.error}；日志：${logFile}`);
    const current=await control(state);
    if(current?.status==='running'){console.log(`LitAnvil 已启动：${webUrl}`);return;}
    if(state&&!alive(state.pid))throw new Error(`服务启动中断；日志：${logFile}`);
  }
  throw new Error(`启动尚未完成，请运行 lita status；日志：${logFile}`);
}
async function stop() {
  const state=await readState();
  if(!state||!alive(state.pid)||state.status==='stopped'||state.status==='failed'){console.log('LitAnvil 已关闭');return;}
  if(!await control(state,'stop'))throw new Error('管理进程无法响应，未向未知进程发送关闭信号；请查看 lita logs');
  const end=Date.now()+16000;
  while(Date.now()<end){
    await delay(100);const current=await readState();
    if(current?.token!==state.token||current.status==='stopped'||current.status==='failed'||!alive(state.pid)){console.log('LitAnvil 已关闭');return;}
  }
  throw new Error(`服务仍在关闭中；日志：${logFile}`);
}
async function openWeb() {
  await start();
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open';
  const args=process.platform==='win32'?['/c','start','',webUrl]:[webUrl];
  await new Promise((resolve,reject)=>{const p=spawn(command,args,{stdio:'ignore'});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error(`无法自动打开浏览器，请访问 ${webUrl}`)))});
  console.log(`已打开浏览器：${webUrl}`);
}
try {
  switch(process.argv[2]||'help') {
    case 'start': await start();if(process.argv.includes('--open'))await openWeb();break;
    case 'stop': await stop();break;
    case 'restart': await stop();await start();break;
    case 'open': case 'web': await openWeb();break;
    case 'status': {const s=await control(await readState());console.log(s?`LitAnvil ${s.status} · ${webUrl} · PID ${s.pid}`:'LitAnvil 未运行');break;}
    case 'logs': {const log=await fs.readFile(logFile,'utf8').catch(error=>{if(error.code==='ENOENT')return '暂无日志';throw error});console.log(log.split('\n').slice(-100).join('\n'));break;}
    case 'help': case '--help': case '-h': console.log(`LitAnvil CLI\n\n  lita start [--open]  后台启动 API 和 Web\n  lita stop            关闭 CLI 管理的服务\n  lita restart         重启服务\n  lita status          查看运行状态\n  lita open            启动服务并打开浏览器\n  lita logs            查看最近日志\n\n项目：${root}`);break;
    default: throw new Error('未知命令，请运行 lita --help');
  }
}catch(error){console.error(error.message);process.exitCode=1;}
