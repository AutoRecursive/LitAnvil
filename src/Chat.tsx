import { chatDrafts, useChatDraft } from "./chat-draft";
import { arxivLink } from "../shared/import-url";
import { subscribeLive } from "./live";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { ResizeHandle } from "./ResizeHandle";
import { paneBounds, paneDefaults } from "../shared/reader-layout";
const API = "http://localhost:8787/api";
import type { AgentSnapshot, AgentItem, ProviderInfo } from "../shared/agent";
export function Chat({
  documentId,
  quote,
  onImport,
  children,
  composerHeight = paneDefaults.composerHeight,
  onComposerResize,
}: {
  documentId?: string;
  quote?: string;
  onImport: (url: string) => void;
  children?: React.ReactNode;
  composerHeight?: number;
  onComposerResize?: (height: number) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [composerLimit, setComposerLimit] = useState(paneBounds.composerHeight[1]);
  useEffect(() => {
    const element = panel.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setComposerLimit(Math.max(paneBounds.composerHeight[0], Math.min(paneBounds.composerHeight[1], element.clientHeight - 180)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const inputHeight = Math.min(composerHeight, composerLimit);
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
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const requestLock = useRef<string | null>(null);
  const stopLock = useRef(false);
  const [stopping, setStopping] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const scrollToBottom = () => {
    if (followBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  };
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
  useLayoutEffect(scrollToBottom, [state]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !list.current || !messages.current) return;
    const observer = new ResizeObserver(scrollToBottom);
    observer.observe(list.current);
    observer.observe(messages.current);
    return () => observer.disconnect();
  }, []);
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
      if (name === "clear") {
        if (result?.state) setState(result.state);
        chatDrafts.clear();
      }
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      if (name === "stop") { stopLock.current = false; setStopping(false); }
      else { requestLock.current = null; setPending(null); }
    }
  }
  const commands = [
    ...(state.provider === "codex" ? [{ name: "/compact", description: "压缩当前会话上下文" }] : []),
    { name: "/clear", description: "开始新的会话上下文" },
  ];
  const matches = /^\/[\w-]*$/.test(draft) && !commandDismissed
    ? commands.filter(command => command.name.startsWith(draft.toLowerCase())) : [];
  const selectedCommand = matches[Math.min(commandIndex, matches.length - 1)];
  function chooseCommand(name: string) {
    setDraft(name);
    setCommandDismissed(true);
    input.current?.focus();
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
    setCommandDismissed(false);
    const command = commands.find(item => item.name === text);
    const sent = command
      ? await action(command.name.slice(1))
      : await action("message", { text, documentId, quote });
    if (!sent) chatDrafts.failed(text);
  }
  const providerLabel = state.provider === "claude" ? "Claude" : "Codex";
  return (
    <section className="chat-session" ref={panel}>
      <div className="session-toolbar">
        <label className="provider-control">
        <span className="provider-caption">Agent</span><select
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
        </select></label>
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
      {(quote || children) && <div className="selection-panel">
        {quote && <blockquote className="chat-quote">{quote}</blockquote>}
        {children}
      </div>}
      <div className="session-messages" ref={list} onScroll={event => {
        const element = event.currentTarget;
        followBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 80;
      }}>
        <div ref={messages}>
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
        {onComposerResize && <ResizeHandle
          className="composer-resize"
          orientation="horizontal"
          label="输入区高度"
          value={inputHeight}
          min={paneBounds.composerHeight[0]}
          max={composerLimit}
          defaultValue={Math.min(paneDefaults.composerHeight, composerLimit)}
          direction={-1}
          onChange={onComposerResize}
        />}
        {matches.length > 0 && <div className="slash-menu" role="listbox" aria-label="斜杠命令">
          {matches.map((command, index) => <button type="button" role="option" aria-selected={index === Math.min(commandIndex, matches.length - 1)}
            key={command.name} onMouseDown={event => event.preventDefault()} onClick={() => chooseCommand(command.name)}>
            <strong>{command.name}</strong><span>{command.description}</span>
          </button>)}
        </div>}
        <textarea
          ref={input}
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          style={onComposerResize ? {height:inputHeight} : undefined}
          aria-label="消息"
          placeholder={
            documentId ? "询问这篇论文…" : "问点什么，或粘贴 arXiv 链接"
          }
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setCommandIndex(0); setCommandDismissed(false); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setCommandIndex(index => (index + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
              return;
            }
            if (matches.length && e.key === "Escape") { e.preventDefault(); setCommandDismissed(true); return; }
            if (selectedCommand && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
              e.preventDefault(); chooseCommand(selectedCommand.name); return;
            }
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
