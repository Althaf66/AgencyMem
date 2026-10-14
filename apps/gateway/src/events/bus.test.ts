import { describe, expect, it } from "vitest";
import { REPLAY_BUFFER, createEvents } from "./bus";

const A = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const B = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const BASE = 1_000_000;
const metric = (value: number) => ({ metric: "rejectedWrites", value });

describe("event bus", () => {
  it("numbers each project's events by one, from the process's start time", () => {
    const events = createEvents({ now: () => BASE });
    expect(events.current(A)).toBe(BASE); // nothing sent yet
    expect(events.emit(A, "metrics.updated", metric(1)).seq).toBe(BASE + 1);
    expect(events.emit(A, "metrics.updated", metric(2)).seq).toBe(BASE + 2);
    expect(events.emit(B, "metrics.updated", metric(1)).seq).toBe(BASE + 1); // its own count
    expect(events.current(A)).toBe(BASE + 2);
  });

  it("refuses an event that breaks the contract, and keeps its seq", () => {
    const events = createEvents({ now: () => BASE });
    expect(() => events.emit(A, "metrics.updated", { metric: "x" } as never)).toThrow();
    expect(events.current(A)).toBe(BASE);
  });

  it("replays the events after `since`", () => {
    const events = createEvents({ now: () => BASE });
    for (let i = 1; i <= 5; i++) events.emit(A, "metrics.updated", metric(i));
    const replay = events.replay(A, BASE + 3);
    expect(replay).not.toBe("reset");
    expect((replay as { seq: number }[]).map((e) => e.seq)).toEqual([BASE + 4, BASE + 5]);
    expect(events.replay(A, BASE + 5)).toEqual([]);
  });

  it(`keeps the last ${REPLAY_BUFFER} events and resets a client that is further behind`, () => {
    const events = createEvents({ now: () => BASE });
    for (let i = 1; i <= REPLAY_BUFFER + 1; i++) events.emit(A, "metrics.updated", metric(i));
    // The buffer now starts at BASE + 2: BASE + 1 was dropped.
    expect(events.replay(A, BASE)).toBe("reset");
    expect(events.replay(A, BASE + 1)).toHaveLength(REPLAY_BUFFER);
  });

  it("resets a client whose seq is ahead of the gateway (a restart)", () => {
    const events = createEvents({ now: () => BASE });
    events.emit(A, "metrics.updated", metric(1));
    expect(events.replay(A, BASE + 50)).toBe("reset");
  });

  it("resets a client from an earlier run: its seq is older than this run's start", () => {
    const events = createEvents({ now: () => BASE });
    expect(events.replay(A, BASE - 10)).toBe("reset"); // nothing sent in this run yet
    expect(events.replay(A, BASE)).toEqual([]);
  });
});
