import React, { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
const API = "http://localhost:8787/api";
import type { AgentSnapshot, AgentItem, ProviderInfo } from "../shared/agent";
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
  const [state, setState] = useState<AgentSnapshot>({
    protocolVersion: 1,
    provider: "codex",
    sessionId: "connecting",
    workspace: "",
    revision: 0,
    turnId: null,
    nativeSessionId: null,
    status: "connecting",
    items: [],
    error: null,
  });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [draft, setDraftState] = useState(
    () => sessionStorage.getItem("litanvil-agent-draft") || "",
  );
  const draftRef = useRef(draft);
  function setDraft(value: string | ((previous: string) => string)) {
    const next = typeof value === "function" ? value(draftRef.current) : value;
    draftRef.current = next;
    sessionStorage.setItem("litanvil-agent-draft", next);
    setDraftState(next);
  }
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stream = new EventSource(API + "/agent/events");
    stream.onmessage = (e) => setState(JSON.parse(e.data));
    fetch(API + "/agent/providers")
      .then((response) => {
        if (!response.ok) throw new Error("无法读取 Agent 后端");
        return response.json();
      })
      .then(setProviders)
      .catch((error) => setError(String(error)));
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
      const r = await fetch(API + "/agent/" + name, {
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
  const providerLabel = state.provider === "claude" ? "Claude" : "Codex";
  return (
    <section className="chat-session">
      <div className="session-toolbar">
        <select
          className="provider-select"
          aria-label="Agent 后端"
          value={state.provider}
          disabled={busy || pending || state.status === "connecting"}
          onChange={(event) =>
            action("provider", { provider: event.target.value })
          }
        >
          {(providers.length
            ? providers
            : [{ id: state.provider, label: providerLabel, available: true }]
          ).map((provider) => (
            <option
              key={provider.id}
              value={provider.id}
              disabled={!provider.available}
            >
              {provider.label}
              {!provider.available ? "（未安装）" : ""}
            </option>
          ))}
        </select>
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
          disabled={pending || !state.nativeSessionId}
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
        {busy && (
          <div className="session-progress">{providerLabel} 正在处理…</div>
        )}
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
              disabled={pending || !draft.trim() || !state.nativeSessionId}
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

export function SessionItem({ item }: { item: AgentItem }) {
  if (item.type === "message")
    return item.role === "user" ? (
      <div className="session-user">{item.text}</div>
    ) : (
      <div className="session-answer">
        <Markdown>{item.text}</Markdown>
      </div>
    );
  if (item.type === "reasoning")
    return item.text ? (
      <details className="session-tool summary">
        <summary>过程摘要</summary>
        <Markdown>{item.text}</Markdown>
      </details>
    ) : null;
  if (item.type === "notice")
    return (
      <div
        className={
          item.level === "error" ? "session-error" : "session-progress"
        }
      >
        {item.text}
      </div>
    );
  const format = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <details
      className={`session-tool ${item.status === "failed" ? "failed" : ""}`}
    >
      <summary>
        {item.name}
        <span>
          {item.status === "running"
            ? "运行中"
            : item.status === "failed"
              ? "失败"
              : item.status === "interrupted"
                ? "已停止"
                : "完成"}
        </span>
      </summary>
      {item.input !== undefined && <pre>{format(item.input)}</pre>}
      {item.output !== undefined && <pre>{format(item.output)}</pre>}
      {item.error && <pre>{item.error}</pre>}
    </details>
  );
}
