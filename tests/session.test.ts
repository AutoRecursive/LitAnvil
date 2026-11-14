import {describe,it,expect} from 'vitest';
import {CodexSession} from '../server/session';
describe('Codex session projection',()=>{
 it('keeps streaming items in the same persistent thread until turn completion',()=>{
 const s=new CodexSession('/tmp');s.log=()=>{};s.state.threadId='thread';
 s.receive({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});
 s.receive({method:'item/started',params:{threadId:'thread',item:{id:'answer',type:'agentMessage',text:''}}});
 for(const delta of ['你','好'])s.receive({method:'item/agentMessage/delta',params:{threadId:'thread',itemId:'answer',delta}});
 expect(s.state.items[0].text).toBe('你好');expect(s.state.status).toBe('running');
 s.receive({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});
 expect(s.state.status).toBe('idle');expect(s.state.threadId).toBe('thread');expect(s.state.items).toHaveLength(1);
 });
 it('starts native compaction and follows its turn lifecycle', async()=>{
 const s=new CodexSession('/tmp');s.log=()=>{};s.state.threadId='thread';
 s.connect=async()=>{};
 let call: unknown;
 s.request=async(method,params)=>{call={method,params};return {}};
 await s.compact();
 expect(call).toEqual({method:'thread/compact/start',params:{threadId:'thread'}});
 expect(s.state.status).toBe('running');
 s.receive({method:'turn/started',params:{threadId:'thread',turn:{id:'compact'}}});
 s.receive({method:'turn/completed',params:{threadId:'thread',turn:{id:'compact',status:'completed'}}});
 expect(s.state.status).toBe('idle');
 });
 it('ignores events from a previous context and preserves tool output',()=>{
 const s=new CodexSession('/tmp');s.log=()=>{};s.state.threadId='new';
 s.receive({method:'item/started',params:{threadId:'old',item:{id:'old'}}});expect(s.state.items).toEqual([]);
 s.receive({method:'item/started',params:{threadId:'new',item:{id:'cmd',type:'commandExecution'}}});
 s.receive({method:'item/commandExecution/outputDelta',params:{threadId:'new',itemId:'cmd',delta:'result'}});
 expect(s.state.items[0].aggregatedOutput).toBe('result');
 });
});
