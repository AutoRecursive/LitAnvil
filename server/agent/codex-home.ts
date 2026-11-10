import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const within = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
};
async function exists(file: string) { return fs.access(file).then(() => true, () => false); }
async function projectRoot(workspace: string) {
  for (let directory = workspace;; directory = path.dirname(directory)) {
    if (await exists(path.join(directory, ".git"))) return directory;
    if (directory === path.dirname(directory)) return workspace;
  }
}
async function externalSkills(root: string, allowed: string, seen = new Set<string>()): Promise<string[]> {
  let real: string;
  try { real = await fs.realpath(root); } catch { return []; }
  if (seen.has(real) || within(allowed, real)) return [];
  seen.add(real);
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) return path.basename(root) === "SKILL.md" ? [root] : [];
  const entries = await fs.readdir(root, {withFileTypes:true});
  const result: string[] = [];
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.name === "SKILL.md" && entry.isFile()) result.push(file);
    else if (entry.isDirectory() || entry.isSymbolicLink()) result.push(...await externalSkills(file, allowed, seen));
  }
  return result;
}

/** Separate configuration/discovery from shared account credentials and the original rollout file. */
export async function prepareCodexHome(workspace: string, storage: string, environment: NodeJS.ProcessEnv = process.env) {
  const accountHome = path.resolve(environment.LITANVIL_CODEX_ACCOUNT_HOME || environment.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const home = path.join(storage, "native-home");
  const allowed = await fs.realpath(await projectRoot(path.resolve(workspace)));
  await fs.mkdir(home, {recursive:true, mode:0o700});
  const disabled = await externalSkills(path.join(environment.LITANVIL_USER_HOME || os.homedir(), ".agents", "skills"), allowed);
  const config = [
    'cli_auth_credentials_store = "file"',
    '[skills]',
    `config = [${disabled.map(file => `{path=${JSON.stringify(file)},enabled=false}`).join(",")}]`,
    '[skills.bundled]', 'enabled = false',
    '[plugins._default]', 'enabled = false',
    '[features]', 'apps = false',
    '[apps._default]', 'enabled = false',
    `[projects.${JSON.stringify(allowed)}]`, 'trust_level = "trusted"',
    "",
  ].join("\n");
  const temporary = path.join(home, "config.toml.tmp");
  await fs.writeFile(temporary, config, {mode:0o600});
  await fs.rename(temporary, path.join(home,"config.toml"));
  const source = path.join(accountHome,"auth.json"), link = path.join(home,"auth.json");
  if (await exists(source)) {
    const previous = await fs.lstat(link).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!previous) await fs.symlink(source,link);
    else if (!previous.isSymbolicLink() || await fs.realpath(link) !== await fs.realpath(source))
      throw new Error("项目 Codex 登录文件与共享账户不一致，请检查 native-home/auth.json");
  }
  return {home, accountHome, environment:{...environment,CODEX_HOME:home}};
}

/** Import only the selected native thread, without copying or linking the user's entire history. */
export async function findLegacyRollout(accountHome: string, threadId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(threadId)) return undefined;
  async function search(directory: string): Promise<string | undefined> {
    const entries = await fs.readdir(directory,{withFileTypes:true}).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return [];
    });
    for (const entry of entries) {
      const file=path.join(directory,entry.name);
      if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) return file;
      if (entry.isDirectory()) { const found=await search(file); if (found) return found; }
    }
  }
  return await search(path.join(accountHome,"sessions")) || await search(path.join(accountHome,"archived_sessions"));
}


export async function linkLegacyRollout(home: string, accountHome: string, threadId: string, preferred?: string) {
  if (preferred && await exists(preferred) && within(await fs.realpath(home),await fs.realpath(preferred))) return;
  const source = preferred && within(accountHome,preferred) && path.basename(preferred).endsWith(`${threadId}.jsonl`) && await exists(preferred)
    ? preferred : await findLegacyRollout(accountHome,threadId);
  if (!source) return;
  const relative = path.relative(accountHome,source);
  const target = path.join(home,relative);
  if (!within(home,target) || path.resolve(home) === path.resolve(accountHome)) throw new Error("无效的项目会话目录");
  await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
  const previous = await fs.lstat(target).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (previous) {
    if (!previous.isSymbolicLink()) return;
    if (await fs.readlink(target) === source) return;
    await fs.unlink(target);
  }
  await fs.symlink(source,target);
}
