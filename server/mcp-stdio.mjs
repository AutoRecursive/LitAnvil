import {createInterface} from 'node:readline';
const url=`http://127.0.0.1:${process.env.PORT||8787}/mcp`;
createInterface({input:process.stdin}).on('line',async line=>{let request;try{request=JSON.parse(line);if(request.id===undefined)return;const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});process.stdout.write(JSON.stringify(await response.json())+'\n')}catch(e){if(request?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32000,message:String(e)}})+'\n')}});
