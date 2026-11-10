export function canonicalUrl(raw:string){
 const u=new URL(raw.trim());u.hash='';
 if(/^(www\.|export\.)?arxiv\.org$/i.test(u.hostname)){
 const match=u.pathname.match(/^\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z.-]+\/\d{7}(?:v\d+)?)(?:\.pdf)?\/?$/i);
 if(!match)throw new Error('无效的 arXiv 链接');return `https://arxiv.org/pdf/${match[1]}`;
 }
 return u.toString();
}
