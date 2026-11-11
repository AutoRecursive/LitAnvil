import { expect, it } from "vitest";
import { ClaudeProjection } from "../server/agent/providers/claude";
import { codexItems } from "../server/agent/providers/codex";
it("maps Codex native messages, tools and public summaries without leaking reference context or private reasoning", () => {
  const items = codexItems([
    {
      id: "user",
      type: "userMessage",
      content: [
        { type: "text", text: "question" },
        { type: "text", text: "Reference document private context" },
      ],
    },
    {
      id: "reasoning",
      type: "reasoning",
      summary: ["public summary"],
      content: ["private reasoning"],
    },
    {
      id: "tool",
      type: "mcpToolCall",
      server: "litanvil",
      tool: "control_reader",
      status: "failed",
      arguments: { page: 3 },
      error: { message: "not loaded" },
    },
  ]);
  expect(items[0]).toMatchObject({ type: "message", text: "question" });
  expect(items[2]).toMatchObject({
    type: "tool",
    status: "failed",
    error: "not loaded",
  });
  expect(JSON.stringify(items)).not.toContain("private");
});
it("streams Claude text and tool arguments then reconciles completed messages without duplication", () => {
  const projection = new ClaudeProjection();
  const stream = (event: any) =>
    projection.receive({ type: "stream_event", uuid: "event", event });
  stream({ type: "message_start", message: { id: "answer" } });
  stream({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  stream({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Hello" },
  });
  expect(projection.items[0]).toMatchObject({
    text: "Hello",
    status: "running",
  });
  projection.receive({
    type: "assistant",
    uuid: "uuid",
    message: { id: "answer", content: [{ type: "text", text: "Hello world" }] },
  });
  expect(projection.items).toHaveLength(1);
  expect(projection.items[0]).toMatchObject({
    text: "Hello world",
    status: "completed",
  });
  stream({
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "tool", name: "Read", input: {} },
  });
  stream({
    type: "content_block_delta",
    index: 1,
    delta: {
      type: "input_json_delta",
      partial_json: '{"file_path":"notes.md"}',
    },
  });
  projection.receive({
    type: "user",
    uuid: "tool-result",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "tool", content: "file content" },
      ],
    },
  });
  expect(projection.items[1]).toMatchObject({
    type: "tool",
    input: { file_path: "notes.md" },
    status: "completed",
    output: "file content",
  });
  projection.receive({
    type: "assistant",
    uuid: "thinking",
    message: {
      id: "hidden",
      content: [
        { type: "thinking", thinking: "private chain", signature: "secret" },
      ],
    },
  });
  expect(JSON.stringify(projection.items)).not.toContain("private chain");
});
