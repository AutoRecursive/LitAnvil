import { arxivLink } from "../shared/import-url.js";
export function canonicalUrl(raw:string){
 const u=new URL(raw.trim());u.hash='';
 if(/^(www\.|export\.)?arxiv\.org$/i.test(u.hostname)){
 const canonical=arxivLink(raw);if(!canonical)throw new Error('无效的 arXiv 链接');return canonical;
 }
 return u.toString();
}
