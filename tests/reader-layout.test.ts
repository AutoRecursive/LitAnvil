import{expect,it}from'vitest';
import{paneDefaults,paneBounds,validateLayoutPatch,paneLayoutSchema}from'../shared/reader-layout';
it('validates atomic layout patches with shared UI/MCP bounds and rejects unknown or malformed changes',()=>{
 expect(validateLayoutPatch({leftWidth:320,readerShare:50})).toEqual({leftWidth:320,readerShare:50});
 for(const invalid of [null,[],{}, {leftWidth:NaN},{leftWidth:180,rightWidth:900},{constructor:1},{typo:300}]) expect(()=>validateLayoutPatch(invalid)).toThrow();
 for(const [name,[min,max]] of Object.entries(paneBounds)){
  expect(validateLayoutPatch({[name]:min})).toEqual({[name]:min});expect(validateLayoutPatch({[name]:max})).toEqual({[name]:max});
  expect(()=>validateLayoutPatch({[name]:min-1})).toThrow();expect(()=>validateLayoutPatch({[name]:max+1})).toThrow();
 }
 expect(Object.keys(paneLayoutSchema.properties)).toEqual(Object.keys(paneDefaults));
});
