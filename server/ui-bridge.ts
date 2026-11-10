import { randomUUID } from "node:crypto";

type Client = {
  send: (event: unknown) => void;
  state: Record<string, any>;
  active: number;
};
export class ReaderBridge {
  private clients = new Map<string, Client>();
  private pending = new Map<
    string,
    {
      clientId: string;
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private activity = 0;

  register(clientId: string, send: Client["send"]) {
    const client: Client = { send, state: {}, active: ++this.activity };
    this.clients.set(clientId, client);
    return () => {
      if (this.clients.get(clientId) !== client) return;
      this.clients.delete(clientId);
      for (const [id, request] of this.pending) {
        if (request.clientId !== clientId) continue;
        clearTimeout(request.timer);
        this.pending.delete(id);
        request.reject(new Error("操作中的阅读界面已断开，请重试"));
      }
    };
  }
  update(clientId: string, state: Record<string, any>, active = false) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    client.state = state;
    if (active) client.active = ++this.activity;
    return true;
  }
  acknowledge(clientId: string, id: string, result: any) {
    const request = this.pending.get(id);
    if (!request || request.clientId !== clientId) return false;
    clearTimeout(request.timer);
    this.pending.delete(id);
    request.resolve({ ...result, clientId });
    return true;
  }
  snapshots() {
    return [...this.clients].map(([clientId, client]) => ({
      clientId,
      ...client.state,
    }));
  }
  async readStates() {
    const states = await Promise.allSettled(
      this.snapshots().map((tab) =>
        this.command("get_state", { clientId: tab.clientId }),
      ),
    );
    return states.flatMap((state) =>
      state.status === "fulfilled" && state.value.ok
        ? [{ clientId: state.value.clientId, ...state.value.state }]
        : [],
    );
  }
  async command(action: string, args: Record<string, any> = {}) {
    const candidates = [...this.clients].filter(
      ([clientId]) => !args.clientId || clientId === args.clientId,
    );
    candidates.sort(
      ([, a], [, b]) =>
        Number(Boolean(b.state.visible)) - Number(Boolean(a.state.visible)) ||
        b.active - a.active,
    );
    const selected = candidates[0];
    if (!selected) throw new Error("阅读界面未连接");
    const [clientId, client] = selected;
    const id = randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("界面操作超时"));
      }, 12000);
      this.pending.set(id, { clientId, resolve, reject, timer });
      client.send({ ...args, id, action, clientId });
    });
  }
}
export const readerBridge = new ReaderBridge();
export const uiTools = [
  {
    name: "get_reader_state",
    description:
      "Read connected LitAnvil tabs, active document, current page, loaded pages, zoom and panels. clientId identifies a specific tab for control_reader.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "control_reader",
    description:
      "Control one LitAnvil tab (the most recently used visible tab by default). open_document waits until the document is ready. preview_text uses temporary colored overlays and never saves annotations. Its result includes quote/location for the nearest match, usable by manage_annotation to save only when requested. close_document returns to the document library.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "get_state",
            "open_document",
            "close_document",
            "go_to_page",
            "preview_text",
            "clear_preview",
            "set_zoom",
            "toggle_left",
            "toggle_right",
          ],
        },
        clientId: { type: "string" },
        documentId: { type: "string" },
        page: { type: "integer", minimum: 1 },
        text: { type: "string" },
        color: { type: "string", enum: ["cyan", "pink", "blue"] },
        zoom: { type: "number", minimum: 0.75, maximum: 1.8 },
        open: { type: "boolean" },
      },
      required: ["action"],
    },
  },
];
