// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {PaperNotes} from '../src/paper-notes';

afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();vi.useRealTimers()});
const response=(note:unknown)=>({ok:true,json:async()=>note});
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve()};

it('refreshes a clean notebook after an external change but preserves a conflicting draft',async()=>{
 let remote={markdown:'initial',revision:1};
 vi.stubGlobal('fetch',vi.fn(async()=>response(remote)));
 const store=new PaperNotes('paper');await store.load();
 remote={markdown:'agent wrote this',revision:2};store.refresh();await settle();
 expect(store.getSnapshot()).toMatchObject({markdown:'agent wrote this',revision:2,dirty:false});
 store.setText('my draft');remote={markdown:'another agent change',revision:3};store.refresh();await settle();
 expect(store.getSnapshot()).toMatchObject({markdown:'my draft',revision:2,dirty:true,conflict:true});
});

it('rechecks changes arriving while a refresh is already in flight',async()=>{
 let resolveFirst!:(value:unknown)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve}))
  .mockResolvedValue(response({markdown:'latest',revision:2}));
 vi.stubGlobal('fetch',fetcher);
 const store=new PaperNotes('paper');const first=store.load();store.refresh();
 resolveFirst(response({markdown:'old',revision:1}));await first;await settle();
 expect(store.getSnapshot()).toMatchObject({markdown:'latest',revision:2});
 expect(fetcher).toHaveBeenCalledTimes(2);
});
