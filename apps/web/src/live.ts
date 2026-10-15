// The live event stream (contracts.md section 10): subscribes to the open project from the oldest
// snapshot seq the store holds, hands every message to the store, and reconnects after a drop.
import { ServerMessage } from "@agencymem/contracts";
import { SLICES, type AppState, type AppStore } from "./store";

const RETRY_MS = 2000;

/** The /ws URL of the page's own origin; the Vite dev proxy adds the token. */
export function pageSocketUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

/** Connects `store` to `url`. Returns a function that closes the socket for good. */
export function connectLive(store: AppStore, url: string): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const subscribe = () => {
    const s = store.getState();
    if (!socket || socket.readyState !== WebSocket.OPEN || !loaded(s)) return;
    const since = Math.min(s.project.seq, s.documents.seq, s.questions.seq, s.gates.seq);
    socket.send(JSON.stringify({ type: "subscribe", projectId: s.projectId, since }));
  };

  const open = () => {
    store.getState().setConnection("connecting");
    socket = new WebSocket(url);
    socket.onopen = () => {
      store.getState().setConnection("live");
      subscribe();
    };
    socket.onmessage = (e) => {
      const message = ServerMessage.safeParse(JSON.parse(String(e.data)));
      if (message.success) store.getState().receive(message.data);
    };
    socket.onclose = () => {
      store.getState().setConnection("closed");
      if (!stopped) retry = setTimeout(open, RETRY_MS);
    };
  };

  // A newly opened project subscribes on the same socket once all its snapshots are in, so
  // `since` is a real seq; 0 would be older than the gateway's buffer and cause a reset.
  const loaded = (s: AppState) => !!s.projectId && SLICES.every((name) => s[name].data !== null);
  const unwatch = store.subscribe((s, prev) => {
    if (loaded(s) && (!loaded(prev) || s.projectId !== prev.projectId)) subscribe();
  });
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    unwatch();
    socket?.close();
  };
}
