// The gateway's event bus: one event per write, numbered by a per-project seq, and a replay buffer
// of the last REPLAY_BUFFER events per project (technical design "Reconnect", contracts.md
// section 10). Each event is checked against the contracts Envelope schema before it goes out.
import { Envelope, type EventData, type EventType } from "@agencymem/contracts";

export const REPLAY_BUFFER = 1000;

export type Listener = (event: Envelope) => void;
/** The events after a client's seq, or "reset": the client must reload its snapshots. */
export type Replay = Envelope[] | "reset";

export type Events = {
  emit<T extends EventType>(projectId: string, type: T, data: EventData<T>): Envelope;
  on(listener: Listener): () => void;
  /** The seq of the project's last event: the seq a snapshot read now reflects (C12). */
  current(projectId: string): number;
  replay(projectId: string, since: number): Replay;
  /** Every event the replay buffer still holds for the project, oldest first. */
  recent(projectId: string): Envelope[];
};

/**
 * ponytail: seq and buffer live in memory. So that a restart cannot hand a client events that
 * are not the ones it missed, each project's seq starts at the time (ms) this process first uses
 * it and rises by one per event: every seq a client kept from an earlier run is then older than
 * this run's buffer, and the client gets a reset. This holds while a project averages under one
 * event per millisecond since the earlier run began; past that, keep the seq in FalkorDB.
 */
export function createEvents(opts: { now?: () => number } = {}): Events {
  const now = opts.now ?? Date.now;
  const seqs = new Map<string, number>();
  const buffers = new Map<string, Envelope[]>();
  const listeners = new Set<Listener>();

  const current = (projectId: string): number => {
    let seq = seqs.get(projectId);
    if (seq === undefined) {
      seq = now();
      seqs.set(projectId, seq);
    }
    return seq;
  };

  return {
    current,
    emit(projectId, type, data) {
      const seq = current(projectId) + 1;
      // Parse first: an event that breaks the contract throws here instead of reaching a screen.
      const event = Envelope.parse({ projectId, seq, type, at: Date.now(), data });
      seqs.set(projectId, seq);
      const buffer = buffers.get(projectId) ?? [];
      buffer.push(event);
      if (buffer.length > REPLAY_BUFFER) buffer.shift(); // ponytail: O(n) on 1,000 items
      buffers.set(projectId, buffer);
      for (const listener of listeners) listener(event);
      return event;
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replay(projectId, since) {
      const last = current(projectId);
      if (since > last) return "reset"; // ahead of the gateway: an earlier run
      const buffer = buffers.get(projectId) ?? [];
      const oldest = buffer[0]?.seq ?? last + 1;
      if (since < oldest - 1) return "reset"; // events between `since` and the buffer are gone
      return buffer.filter((event) => event.seq > since);
    },
    recent(projectId) {
      return [...(buffers.get(projectId) ?? [])];
    },
  };
}
