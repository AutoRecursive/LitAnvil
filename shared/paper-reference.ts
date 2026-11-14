export type PaperReference = {
  version: 1;
  documentId: string;
  page: number;
  rects: {page:number;x:number;y:number;w:number;h:number}[];
  textRanges: {page:number;node:number;start:number;end:number}[];
};
const prefix='#lita-ref=';
export function parsePaperReference(href: string): PaperReference | undefined {
  if(!href.startsWith(prefix)||href.length>150000)return;
  try{
    const v=JSON.parse(decodeURIComponent(href.slice(prefix.length)));
    const page=(n:unknown)=>Number.isInteger(n)&&Number(n)>0&&Number(n)<=100000;
    if(v.version!==1||typeof v.documentId!=='string'||!/^[\w-]{1,128}$/.test(v.documentId)||!page(v.page))return;
    if(!Array.isArray(v.rects)||v.rects.length>2000||!Array.isArray(v.textRanges)||v.textRanges.length>2000)return;
    if(v.rects.some((r:any)=>!r||!page(r.page)||['x','y','w','h'].some(k=>typeof r[k]!=='number'||!Number.isFinite(r[k])||r[k]<0||r[k]>1)))return;
    if(v.textRanges.some((r:any)=>!r||!page(r.page)||![r.node,r.start,r.end].every(n=>Number.isSafeInteger(n)&&n>=0)||r.end<=r.start))return;
    return v;
  }catch{return;}
}
export function selectionReference(documentId:string,location:string):PaperReference|undefined{
  try{
    const anchor=JSON.parse(location);
    const ref={version:1,documentId,page:anchor.textRanges?.[0]?.page||anchor.rects?.[0]?.page,rects:anchor.rects||[],textRanges:anchor.textRanges||[]};
    return parsePaperReference(prefix+encodeURIComponent(JSON.stringify(ref)));
  }catch{return;}
}
export function referenceMarkdown(reference:PaperReference,quote:string){
  const excerpt=quote.replace(/\s+/g,' ').trim();
  const label=(excerpt.length>100?excerpt.slice(0,100)+'…':excerpt).replace(/[\\[\]`*_~$<>]/g,'\\$&');
  return `[${label||'PDF 选区'} · p.${reference.page}](${prefix+encodeURIComponent(JSON.stringify(reference))})`;
}
