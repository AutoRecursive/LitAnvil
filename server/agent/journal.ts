import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentJournalEvent, AgentSnapshot, ProviderId } from "../../shared/agent.js";

/** Only an unterminated final record can be discarded after an interrupted write. */
export async function readJournal(directory: string, provider: ProviderId, repair = false) {
  const file = path.join(directory, "events.ndjson");
  let source: string;
  try { source = await fs.readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: AgentJournalEvent[] = [];
  const lines = source.split("\n");
  let incomplete = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    let event: AgentJournalEvent;
    try { event = JSON.parse(line); }
    catch {
      if (index === lines.length - 1 && !source.endsWith("\n")) { incomplete = true; break; }
      throw new Error(`Agent 事件日志第 ${index + 1} 行损坏，原文件已保留`);
    }
    if (!event || event.protocolVersion !== 1 || event.provider !== provider ||
        !Number.isSafeInteger(event.revision) || event.revision <= (events.at(-1)?.revision ?? 0) ||
        typeof event.sessionId !== "string" || typeof event.reset !== "boolean" ||
        !event.state || !["connecting", "idle", "running", "error"].includes(event.state.status) ||
        !Array.isArray(event.upserts) || event.upserts.some(item => !item || typeof item.id !== "string"))
      throw new Error(`Agent 事件日志第 ${index + 1} 行格式错误，原文件已保留`);
    events.push(event);
  }
  if (repair && source && (incomplete || !source.endsWith("\n"))) {
    if (incomplete) {
      // Preserve the original bytes for diagnosis; never silently remove a complete corrupt record.
      const backup = file + `.incomplete-${randomUUID()}`;
      await fs.copyFile(file, backup, fs.constants.COPYFILE_EXCL);
      console.warn("[Agent runtime] recovered interrupted journal write", {file, backup, records: events.length});
    }
    const complete = incomplete ? source.slice(0, source.lastIndexOf("\n") + 1) : source + "\n";
    const temporary = file + ".repair.tmp";
    await fs.writeFile(temporary, complete, {mode: 0o600});
    await fs.rename(temporary, file);
  }
  return events;
}

export async function recoverSnapshot(directory: string, provider: ProviderId, workspace: string) {
  const events = await readJournal(directory, provider, true);
  const file = path.join(directory, "snapshot.json");
  let cached: AgentSnapshot | undefined;
  try {
    cached = JSON.parse(await fs.readFile(file, "utf8"));
    if (!cached || cached.protocolVersion !== 1 || cached.provider !== provider || cached.workspace !== workspace ||
        !Number.isSafeInteger(cached.revision) || !Array.isArray(cached.items))
      throw new SyntaxError("Invalid Agent snapshot");
  } catch (error) {
    cached = undefined;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (!(error instanceof SyntaxError) || !events.length) throw error;
      const backup = file + `.corrupt-${randomUUID()}`;
      await fs.rename(file, backup);
      console.warn("[Agent runtime] rebuilding snapshot from journal", {file, backup});
    }
  }
  if (!events.length || (cached && cached.revision >= events.at(-1)!.revision)) return cached;
  const items = new Map<string, AgentSnapshot["items"][number]>();
  let previousSession: string | undefined;
  for (const event of events) {
    if (event.reset || event.sessionId !== previousSession) items.clear();
    for (const item of event.upserts) items.set(item.id, item);
    previousSession = event.sessionId;
  }
  const last = events.at(-1)!;
  return {...last.state, protocolVersion: 1, provider, workspace, sessionId: last.sessionId,
    revision: last.revision, items: [...items.values()]} as AgentSnapshot;
}
