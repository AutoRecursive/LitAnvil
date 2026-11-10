import { API } from "./api";
type Channel = "agent" | "reader" | "library";
type Listener = { channel: Channel; receive: (data: any) => void; onOpen?: () => void; onError?: () => void };
const listeners = new Set<Listener>();
const cache = new Map<Channel, unknown>();
export const liveClientId = crypto.randomUUID();
let stream: EventSource | undefined;
let connected = false;

/** One stream per tab prevents HTTP/1 connection starvation across concurrent readers. */
export function subscribeLive(channel: Channel, receive: Listener["receive"], lifecycle: Pick<Listener, "onOpen" | "onError"> = {}) {
  const listener = { channel, receive, ...lifecycle };
  listeners.add(listener);
  if (cache.has(channel)) receive(cache.get(channel));
  if (connected) listener.onOpen?.();
  if (!stream) {
    stream = new EventSource(`${API}/live/events?clientId=${liveClientId}`);
    stream.onopen = () => { connected = true; for (const subscriber of listeners) subscriber.onOpen?.(); };
    stream.onerror = () => { connected = false; for (const subscriber of listeners) subscriber.onError?.(); };
    stream.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (!["agent", "reader", "library"].includes(message.type)) return;
        // Reader commands are delivered once, never replayed to a new subscriber.
        if (message.type !== "reader") cache.set(message.type, message.data);
        for (const subscriber of listeners) if (subscriber.channel === message.type) subscriber.receive(message.data);
      } catch (error) { console.error("[Live] invalid event", error); }
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stream?.close(); stream = undefined; connected = false; cache.clear(); }
  };
}
