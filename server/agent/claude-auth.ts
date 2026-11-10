import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
/** Authentication is account-scoped; customization remains project-scoped. Never persist or log this object. */
export async function claudeAuthentication(
  workspace: string,
  home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
) {
  const read = async (file: string) => {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Claude 配置文件无法读取");
    }
  };
  const user = await read(path.join(home, "settings.json"));
  const project = await read(path.join(workspace, ".claude", "settings.json"));
  const env: Record<string, string> = {};
  for (const key of [
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ]) {
    const value = process.env[key] ?? project.env?.[key] ?? user.env?.[key];
    if (typeof value === "string") env[key] = value;
  }
  const model = project.model || user.model;
  return { env, ...(typeof model === "string" ? { model } : {}) };
}
