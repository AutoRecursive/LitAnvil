import {createInterface} from 'node:readline';
let threadId='persisted-thread';let items=[];let active;
const write=message=>process.stdout.write(JSON.stringify(message)+'\n');
const notify=(method,params)=>write({method,params:{threadId,...params}});
createInterface({input:process.stdin}).on('line',line=>{const {id,method,params}=JSON.parse(line);if(id===undefined)return;
 if(method==='turn/start'&&process.env.LITANVIL_DELAY_TURN_START_MS){setTimeout(()=>{active='delayed-turn';notify('turn/started',{turn:{id:active}});write({id,result:{turn:{id:active,status:'inProgress'}}})},Number(process.env.LITANVIL_DELAY_TURN_START_MS));return}
 if(method==='thread/resume'&&process.env.LITANVIL_FAIL_RESUME){write({id,error:{message:'Temporary resume failure'}});return}
 let result={};
 if(method==='thread/start'){threadId='new-'+Date.now();items=[];result={thread:{id:threadId,turns:[]}}}
 if(method==='thread/resume'){threadId=params.threadId;result={thread:{id:threadId,turns:[{id:'old',status:'completed',items:[{id:'saved',type:'agentMessage',text:'restored'}]}]}}}
 if(method==='turn/start'){active='turn';notify('turn/started',{turn:{id:active}});const item={id:'user-'+Date.now(),type:'userMessage',content:params.input};items.push(item);notify('item/started',{item});result={turn:{id:active,status:'inProgress'}}}
 if(method==='turn/interrupt'){notify('turn/completed',{turn:{id:active,status:'interrupted'}});active=null}
 write({id,result});
});
