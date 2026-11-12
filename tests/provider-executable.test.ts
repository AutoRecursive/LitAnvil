import {expect,it} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {executable} from "../server/agent/provider";
it("resolves provider binaries from the service environment instead of relying on the parent shell",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"lita-bin-"));const file=path.join(directory,"codex");
 try {await fs.writeFile(file,"#!/bin/sh\n");await fs.chmod(file,0o700);expect(await executable("codex",{CODEX_BIN:file,PATH:""})).toBe(file);expect(await executable("codex",{PATH:"/definitely/missing"})).toBeUndefined();}
 finally {await fs.rm(directory,{recursive:true,force:true});}
});
