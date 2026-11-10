import React, { useEffect, useRef, useState } from "react";
import {Markdown} from "./Markdown";
const API = "http://localhost:8787/api";
type Snapshot = {
  threadId: string | null;
  status: string;
  items: any[];
  error: string | null;
};
export function Chat({
  documentId,
  quote,
  onImport,
  children,
}: {
  documentId?: string;
  quote?: string;
  onImport: (url: string) => void;
  children?: React.ReactNode;
}) {
  const [state, setState] = useState<Snapshot>({
    threadId: null,
    status: "connecting",
    items: [],
    error: null,
  });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stream = new EventSource(API + "/session/events");
    stream.onmessage = (e) => setState(JSON.parse(e.data));
    stream.onerror = () => setState((s) => ({ ...s, status: "connecting" }));
    return () => stream.close();
  }, []);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [state]);
  async function action(name: string, body: any = {}) {
    setError("");
    setPending(true);
    try {
      const r = await fetch(API + "/session/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  async function send() {
    const text = draft.trim();
    if (!text) return;
    try {
      const u = new URL(text);
      if (
        /^(www\.)?arxiv\.org$/.test(u.hostname) &&
        /^\/(abs|pdf)\//.test(u.pathname)
      ) {
        onImport(text);
        setDraft("");
        return;
      }
    } catch {}
    setDraft("");
    const sent = await action("message", { text, documentId, quote });
    if (!sent) setDraft((previous) => previous || text);
  }
  const busy = state.status === "running";
  return (
    <section className="chat-session">
      <div className="session-toolbar">
        <b>Codex</b>
        <span className="session-state">
          {busy
            ? "生成中"
            : state.status === "connecting"
              ? "连接中"
              : state.status === "error"
                ? "连接异常"
                : "已连接"}
        </span>
        <button
          disabled={pending || !state.threadId}
          onClick={() => action("clear")}
        >
          清空上下文
        </button>
      </div>
      <div className="session-messages" ref={list}>
        {state.items.length === 0 && (
          <div className="session-empty">有什么想一起研究的？</div>
        )}
        {state.items.map((item) => (
          <SessionItem key={item.id} item={item} />
        ))}
        {busy && <div className="session-progress">Codex 正在处理…</div>}
      </div>
      {(error || state.error) && (
        <div className="session-error" role="alert">
          {error || state.error}
        </div>
      )}
      <div className="composer">
        {quote && <blockquote className="chat-quote">{quote}</blockquote>}
        {children}
        <textarea
          aria-label="消息"
          placeholder={
            documentId ? "询问这篇论文…" : "问点什么，或粘贴 arXiv 链接"
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!busy && !pending) void send();
            }
          }}
        />
        <div className="session-send">
          {busy ? (
            <button onClick={() => action("stop")}>停止</button>
          ) : (
            <button
              aria-label="发送消息"
              disabled={pending || !draft.trim() || !state.threadId}
              onClick={send}
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function SessionItem({ item }: { item: any }) {
  if (item.type === "userMessage")
    return (
      <div className="session-user">
        {item.content
          ?.filter(
            (c: any) =>
              c.type === "text" && !c.text.startsWith("Reference document"),
          )
          .map((c: any) => c.text)
          .join("\n")}
      </div>
    );
  if (item.type === "agentMessage")
    return (
      <div className="session-answer">
        <Markdown>{item.text || ""}</Markdown>
      </div>
    );
  if (item.type === "reasoning") {
    const summary = item.summary?.join("\n");
    return summary ? (
      <details className="session-tool summary">
        <summary>过程摘要</summary>
        <Markdown>{summary}</Markdown>
      </details>
    ) : null;
  }
  return (
    <details
      className={`session-tool ${item.status === "failed" ? "failed" : ""}`}
    >
      <summary>
        {item.type === "commandExecution"
          ? "命令"
          : item.type === "mcpToolCall"
            ? `${item.server} · ${item.tool}`
            : item.type === "fileChange"
              ? "文件变更"
              : item.type === "webSearch"
                ? "搜索"
                : item.type}
        <span>
          {item.status === "inProgress"
            ? "运行中"
            : item.status === "failed"
              ? "失败"
              : "完成"}
        </span>
      </summary>
      <pre>
        {item.command ||
          JSON.stringify(item.arguments || item.changes || {}, null, 2)}
      </pre>
      {item.aggregatedOutput && <pre>{item.aggregatedOutput}</pre>}
      {item.error && <pre>{item.error.message}</pre>}
      {item.result && <pre>{JSON.stringify(item.result, null, 2)}</pre>}
    </details>
  );
}
