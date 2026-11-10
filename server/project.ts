import fs from 'node:fs/promises';
import path from 'node:path';
export class ProjectWorkspace {
 constructor(public dataDir:string,public defaultDir:string){}
 async directory(){try{return JSON.parse(await fs.readFile(path.join(this.dataDir,'project.json'),'utf8')).directory as string}catch{return this.defaultDir}}
 async configure(directory:string){if(!path.isAbsolute(directory))throw new Error('请输入绝对目录路径');const resolved=await fs.realpath(directory);if(!(await fs.stat(resolved)).isDirectory())throw new Error('该路径不是目录');await fs.access(resolved,fs.constants.R_OK|fs.constants.W_OK);await fs.mkdir(this.dataDir,{recursive:true});await fs.writeFile(path.join(this.dataDir,'project.json'),JSON.stringify({directory:resolved},null,2));return resolved}
 async sync(documents:any[],annotations:any[]){const root=await this.directory();await fs.mkdir(root,{recursive:true});for(const doc of documents){const folder=path.join(root,'papers',doc.id);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'paper.md'),`# ${doc.title}\n\nSource: ${doc.source}\n\n${doc.content}`);const notes=annotations.filter(a=>a.documentId===doc.id);await fs.writeFile(path.join(folder,'annotations.json'),JSON.stringify({documentId:doc.id,title:doc.title,annotations:notes},null,2));await fs.writeFile(path.join(folder,'notes.md'),`# ${doc.title}\n\n`+notes.map(a=>`> ${a.quote.replaceAll('\n','\n> ')}\n\n${a.note||''}`).join('\n\n'))}}
}
