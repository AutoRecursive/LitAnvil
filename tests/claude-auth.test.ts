import { expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeAuthentication } from "../server/agent/claude-auth";
it("reuses only account authentication and model defaults while project customizations stay isolated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-auth-"));
  const home = path.join(root, "account");
  const project = path.join(root, "project");
  try {
    await fs.mkdir(home);
    await fs.mkdir(path.join(project, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(home, "settings.json"),
      JSON.stringify({
        model: "account-model",
        env: {
          ANTHROPIC_AUTH_TOKEN: "account-token",
          ANTHROPIC_BASE_URL: "https://example.test",
          NODE_OPTIONS: "unwanted-code",
        },
        hooks: { dangerous: true },
        skills: ["global-skill"],
      }),
    );
    await fs.writeFile(
      path.join(project, ".claude", "settings.json"),
      JSON.stringify({
        model: "project-model",
        env: { ANTHROPIC_AUTH_TOKEN: "project-token" },
      }),
    );
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "process-token");
    const auth = await claudeAuthentication(project, home);
    expect(auth).toEqual({
      model: "project-model",
      env: {
        ANTHROPIC_AUTH_TOKEN: "process-token",
        ANTHROPIC_BASE_URL: "https://example.test",
      },
    });
    expect(JSON.stringify(auth)).not.toContain("global-skill");
    expect(JSON.stringify(auth)).not.toContain("NODE_OPTIONS");
  } finally {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  }
});
