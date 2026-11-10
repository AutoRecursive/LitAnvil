import { chatDrafts, useChatDraft } from "./chat-draft";
import { arxivLink } from "../shared/import-url";
import { subscribeLive } from "./live";
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
  const {text:draft,unsent} = useChatDraft();
  const setDraft = chatDrafts.setText;
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const requestLock = useRef<string | null>(null);
  const stopLock = useRef(false);
  const [stopping, setStopping] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const unsubscribe = subscribeLive("agent", setState, { onError: () => setState(s => ({ ...s, status: "connecting" })) });
    fetch(API + "/agent/providers")
      .then((response) => {
        if (!response.ok) throw new Error("无法读取 Agent 后端");
        return response.json();
      })
      .then(setProviders)
      .catch((error) => setError(String(error)));
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [state]);
  async function action(name: string, body: any = {}) {
    if (name === "stop" ? stopLock.current : requestLock.current) return false;
    if (name === "stop") { stopLock.current = true; setStopping(true); }
    else { requestLock.current = name; setPending(name); }
    setError("");
    try {
      const r = await fetch(API + "/agent/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedSessionId:state.sessionId, expectedWorkspace:state.workspace }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      if (name === "stop") { stopLock.current = false; setStopping(false); }
      else { requestLock.current = null; setPending(null); }
    }
  }
  const busy = state.status === "running";
  const importLink = arxivLink(draft);
  const connected = state.status !== "connecting" && Boolean(state.nativeSessionId);
  const canSend = Boolean(draft.trim()) && !pending && !stopping && !busy && (Boolean(importLink) || connected);
  async function send() {
    if (requestLock.current || stopLock.current || !canSend) return;
    const text = chatDrafts.getSnapshot().text.trim();
    if (!text) return;
    const link = arxivLink(text);
    if (link) { onImport(link); setDraft(""); return; }
    setDraft("");
    const sent = await action("message", { text, documentId, quote });
    if (!sent) chatDrafts.failed(text);
  }
  const providerLabel = state.provider === "claude" ? "Claude" : "Codex";
  return (
    <section className="chat-session">
      <div className="session-toolbar">
        <select
          className="provider-select"
          aria-label="Agent 后端"
          value={state.provider}
          disabled={busy || Boolean(pending) || stopping || state.status === "connecting"}
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
          disabled={Boolean(pending) || stopping || !connected}
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
      {unsent.length > 0 && <details className="session-tool failed unsent-messages">
        <summary>未发送的消息 · {unsent.length}</summary>
        {unsent.map((text,index)=><div key={index}><pre>{text}</pre><button onClick={()=>chatDrafts.restore(index)}>恢复到输入框</button></div>)}
      </details>}
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
              if (canSend) void send();
            }
          }}
        />
        <div className="session-send">
          {busy ? (
            <button disabled={stopping || Boolean(pending && pending !== "message")} onClick={() => action("stop")}>{stopping ? "停止中…" : "停止"}</button>
          ) : (
            <button
              aria-label="发送消息"
              disabled={!canSend}
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
