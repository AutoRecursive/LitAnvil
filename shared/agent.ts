/** Versioned provider-neutral contract. Native protocol types never cross this boundary. */
export type ProviderId = "codex" | "claude";
export type AgentStatus = "connecting" | "idle" | "running" | "error";
export type ItemStatus = "running" | "completed" | "failed" | "interrupted";
export type AgentItem =
  | {
      id: string;
      type: "message";
      role: "user" | "assistant";
      text: string;
      status?: ItemStatus;
      parentId?: string;
    }
  | {
      id: string;
      type: "reasoning";
      text: string;
      visibility: "summary";
      parentId?: string;
    }
  | {
      id: string;
      type: "tool";
      name: string;
      input?: unknown;
      output?: unknown;
      error?: string;
      status: ItemStatus;
      parentId?: string;
    }
  | { id: string; type: "notice"; text: string; level: "info" | "error" };
export type AdapterState = {
  nativeSessionId: string | null;
  status: AgentStatus;
  items: AgentItem[];
  error: string | null;
  turnId: string | null;
};
export type AgentSnapshot = AdapterState & {
  protocolVersion: 1;
  provider: ProviderId;
  sessionId: string;
  workspace: string;
  revision: number;
};
export type AgentJournalEvent = {
  protocolVersion: 1;
  provider: ProviderId;
  sessionId: string;
  revision: number;
  timestamp: string;
  state: Omit<AdapterState, "items">;
  upserts: AgentItem[];
  reset: boolean;
};
export type ProviderInfo = {
  id: ProviderId;
  label: string;
  available: boolean;
  capabilities: {
    streaming: boolean;
    resume: boolean;
    tools: boolean;
    interrupt: boolean;
  };
};
