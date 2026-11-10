import {API} from './api';
import {exportFilename,exportFormats,dispositionFilename,type ExportFormat} from '../shared/document-export';
export async function downloadAnnotations(paper: {id:string;title:string},format: ExportFormat) {
  if (!Object.hasOwn(exportFormats,format)) throw new Error('导出格式仅支持 json 或 markdown');
  const url=`${API}/documents/${encodeURIComponent(paper.id)}/export.${exportFormats[format].extension}`;
  const response=await fetch(url);
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'导出失败，请重试')}
  const blob=await response.blob();const filename=dispositionFilename(response.headers.get("Content-Disposition")) || exportFilename(paper,format);
  const objectUrl=URL.createObjectURL(blob);const anchor=document.createElement('a');
  anchor.href=objectUrl;anchor.download=filename;anchor.hidden=true;
  window.document.body.append(anchor);
  try{anchor.click()}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000)}
  return {filename,mimeType:blob.type,bytes:blob.size,url,requested:true};
}
