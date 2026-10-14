// The gateway's event bus: one event per write, numbered by a per-project seq (contracts.md
// section 10). Each event is checked against the contracts Envelope schema before it goes out.
// ponytail: in memory; task 1.9 adds the replay buffer and the WebSocket fan-out on top.
import { Envelope, type EventData, type EventType } from "@agencymem/contracts";

export type Listener = (event: Envelope) => void;

export type Events = {
  emit<T extends EventType>(projectId: string, type: T, data: EventData<T>): Envelope;
  on(listener: Listener): () => void;
};

export function createEvents(): Events {
  const seqs = new Map<string, number>();
  const listeners = new Set<Listener>();
  return {
    emit(projectId, type, data) {
      const seq = (seqs.get(projectId) ?? 0) + 1;
      // Parse first: an event that breaks the contract throws here instead of reaching a screen.
      const event = Envelope.parse({ projectId, seq, type, at: Date.now(), data });
      seqs.set(projectId, seq);
      for (const listener of listeners) listener(event);
      return event;
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
