import { expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClaudeAdapter } from "../server/agent/providers/claude";
function idle(adapter: ClaudeAdapter) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Turn did not finish")),
      2000,
    );
    adapter.on("snapshot", (state) => {
      if (state.status === "idle" && state.items.length) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}
it("uses native SDK resume, project settings, shared MCP, and restores native transcript", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-claude-"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(root, "empty-config"));
  const calls: any[] = [];
  const history = new Map<string, any[]>();
  const dependencies: any = {
    getSessionMessages: async (id: string) => history.get(id) || [],
    query: ({ prompt, options }: any) => {
      calls.push(options);
      return (async function* () {
        const input = (await prompt[Symbol.asyncIterator]().next()).value;
        const id = options.resume || options.sessionId;
        yield { type: "system", subtype: "init", session_id: id };
        yield { type: "user", uuid: input.uuid, message: input.message };
        yield {
          type: "stream_event",
          uuid: "event",
          event: { type: "message_start", message: { id: "answer" } },
        };
        yield {
          type: "stream_event",
          uuid: "event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
        };
        yield {
          type: "stream_event",
          uuid: "event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "answer" },
          },
        };
        const assistant = {
          type: "assistant",
          uuid: "native-answer",
          message: {
            id: "answer",
            content: [{ type: "text", text: "answer" }],
          },
        };
        yield assistant;
        history.set(id, [
          { type: "user", uuid: input.uuid, message: input.message },
          assistant,
        ]);
        yield { type: "result", is_error: false };
      })();
    },
  };
  const options = {
    root,
    workspace: root,
    storageDir: path.join(root, "claude"),
  };
  let adapter = new ClaudeAdapter(options, dependencies);
  try {
    await adapter.connect();
    const first = adapter.state.nativeSessionId;
    let done = idle(adapter);
    await adapter.send("hello", { title: "reference" });
    await done;
    expect(
      adapter.state.items.filter(
        (item) => item.type === "message" && item.role === "user",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(adapter.state.items)).not.toContain("reference");
    expect(calls[0]).toMatchObject({
      sessionId: first,
      settingSources: ["project"],
      strictMcpConfig: true,
      permissionMode: "dontAsk",
    });
    expect(calls[0].mcpServers.litanvil).toMatchObject({
      type: "http",
      url: "http://127.0.0.1:8787/mcp",
    });
    done = idle(adapter);
    await adapter.send("follow up");
    await done;
    expect(calls[1].resume).toBe(first);
    adapter.close();
    adapter = new ClaudeAdapter(options, dependencies);
    await adapter.connect();
    expect(adapter.state.nativeSessionId).toBe(first);
    expect(
      adapter.state.items.some(
        (item) => item.type === "message" && item.text === "answer",
      ),
    ).toBe(true);
    await adapter.clear();
    expect(adapter.state.nativeSessionId).not.toBe(first);
    expect(adapter.state.items).toEqual([]);
  } finally {
    adapter.close();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("aborts an in-progress SDK turn and marks partial output interrupted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lit-claude-stop-"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(root, "empty-config"));
  const dependencies: any = {
    getSessionMessages: async () => [],
    query: ({ options }: any) =>
      (async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: options.sessionId,
        };
        await new Promise((_, reject) => {
          if (options.abortController.signal.aborted)
            reject(new Error("aborted"));
          else
            options.abortController.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
        });
      })(),
  };
  const adapter = new ClaudeAdapter(
    { root, workspace: root, storageDir: path.join(root, "claude") },
    dependencies,
  );
  try {
    await adapter.send("hello");
    await adapter.stop();
    expect(adapter.state.status).toBe("idle");
    expect(adapter.state.error).toBeNull();
    expect(adapter.state.turnId).toBeNull();
  } finally {
    adapter.close();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  }
});
