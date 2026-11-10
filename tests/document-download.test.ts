// @vitest-environment jsdom
import{beforeEach,afterEach,expect,it,vi}from'vitest';
import{downloadAnnotations}from'../src/document-download';
import{exportFilename,dispositionFilename}from'../shared/document-export';
let create:ReturnType<typeof vi.fn>,revoke:ReturnType<typeof vi.fn>;
beforeEach(()=>{vi.useFakeTimers();create=vi.fn(()=> 'blob:fixture');revoke=vi.fn();Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke})});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();delete (URL as any).createObjectURL;delete (URL as any).revokeObjectURL});
it('downloads authoritative response bytes using the server filename and keeps the object URL alive until the browser consumes it',async()=>{
 const request=vi.fn(async()=>({ok:true,headers:new Headers({'content-disposition':"attachment; filename*=UTF-8''Fresh%20title-annotations.json"}),blob:async()=>new Blob(['{"annotations":[{"note":"new server value"}]}'],{type:'application/json'})}));vi.stubGlobal('fetch',request);
 const clicked=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){expect(this.isConnected).toBe(true);expect(this.download).toBe('Fresh title-annotations.json')});
 const result=await downloadAnnotations({id:'a/b',title:'Stale title'},'json');
 expect(request).toHaveBeenCalledWith('http://localhost:8787/api/documents/a%2Fb/export.json',{signal:undefined});expect(clicked).toHaveBeenCalledTimes(1);expect(create).toHaveBeenCalledTimes(1);expect(revoke).not.toHaveBeenCalled();expect(result.requested).toBe(true);expect(result.bytes).toBeGreaterThan(0);
 vi.advanceTimersByTime(1000);expect(revoke).toHaveBeenCalledWith('blob:fixture');expect(document.querySelector('a')).toBeNull();
});
it('does not request a fake download on failure or unsupported format',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({error:'文档不存在'})})));
 await expect(downloadAnnotations({id:'missing',title:'missing'},'json')).rejects.toThrow('文档不存在');expect(create).not.toHaveBeenCalled();
 await expect(downloadAnnotations({id:'a',title:'a'},'pdf' as any)).rejects.toThrow('导出格式');
});
it('safely handles Unicode/apostrophe filenames and bounds UTF-8 filename length',()=>{
 const filename=exportFilename({id:'a',title:"Alice's / 研究 😀"},'markdown');expect(filename).not.toContain('/');expect(filename).toContain("Alice's");
 const long=exportFilename({id:'a',title:'研究😀'.repeat(100)},'json');expect(new TextEncoder().encode(long).length).toBeLessThan(220);expect(()=>encodeURIComponent(long)).not.toThrow();
 expect(dispositionFilename("attachment; filename=\"fallback.json\"; filename*=UTF-8''%E7%A0%94%E7%A9%B6.json")).toBe('研究.json');
 expect(dispositionFilename('attachment; filename="fallback.json"; filename*=UTF-8\'\'%broken')).toBe('fallback.json');
});
