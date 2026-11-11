export type ExportFormat = "json" | "markdown";
export const exportFormats = {
  json:{extension:"json",mimeType:"application/json; charset=utf-8"},
  markdown:{extension:"md",mimeType:"text/markdown; charset=utf-8"},
} as const;
export function exportFilename(document: {id:string;title:string},format: ExportFormat) {
  const source=document.title.replace(/[\\/:*?"<>|\r\n]/g,"_").trim() || document.id;
  let title="";let bytes=0;
  for (const character of source) { const size=new TextEncoder().encode(character).length;if(bytes+size>180)break;title+=character;bytes+=size; }
  return `${title}-annotations.${exportFormats[format].extension}`;
}

export function dispositionFilename(value:string|null) {
  if (!value) return undefined;
  const encoded=value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) try { return decodeURIComponent(encoded); } catch {}
  return value.match(/filename="([^"\r\n]*)"/i)?.[1];
}
