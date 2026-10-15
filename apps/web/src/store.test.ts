// The store's event rules (ui.md section 4) against a stub api: which snapshot an event reloads,
// that an event no newer than a slice is ignored, reset, toasts, and an old version.
import { describe, expect, it, vi } from "vitest";
import type { Envelope, QuestionView } from "@agencymem/contracts";
import { createApi, type Api } from "./api";
import { connectLive } from "./live";
import { createAppStore } from "./store";

const P = "01JA0000000000000000000001";

/** An api whose snapshots answer with `seq` and count their calls. */
function stubApi(seq = { value: 5 }) {
  const calls: string[] = [];
  const ok = <T>(name: string, data: T) => {
    calls.push(name);
    return Promise.resolve({ ok: true as const, data: { ...data, seq: seq.value } });
  };
  const api = {
    project: () => ok("project", { project: { id: P, stage: "discovery" } }),
    documents: () => ok("documents", { documents: [] }),
    questions: () => ok("questions", { questions: [] }),
    gates: () => ok("gates", { gates: [] }),
    answer: vi.fn(),
  } as unknown as Api;
  return { api, calls, seq };
}

const event = (seq: number, type: string, data: Record<string, unknown>) =>
  ({
    type: "event",
    event: { projectId: P, seq, type, at: 1, data } as unknown as Envelope,
  }) as const;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("store", () => {
  it("opens a project with every snapshot and its seq", async () => {
    const { api, calls } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    await store.getState().open(P); // opening it again loads nothing more
    expect(calls.sort()).toEqual(["documents", "gates", "project", "questions"]);
    expect(store.getState().questions).toMatchObject({ status: "ready", seq: 5, data: [] });
  });

  it("reloads the slices an event names, and ignores an event no newer than them", async () => {
    const { api, calls, seq } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    calls.length = 0;

    store.getState().receive(event(5, "node.written", { label: "Question" })); // not newer
    await tick();
    expect(calls).toEqual([]);

    seq.value = 7;
    store.getState().receive(event(6, "node.written", { label: "Question" }));
    await tick();
    expect(calls.sort()).toEqual(["gates", "questions"]);
    expect(store.getState().questions.seq).toBe(7);
    expect(store.getState().lastSeq).toBe(6);

    calls.length = 0;
    seq.value = 9;
    store.getState().receive(event(8, "gate.changed", { gateKey: "G1" }));
    store.getState().receive(event(9, "node.written", { label: "Document" }));
    await tick();
    expect(calls.sort()).toEqual(["documents", "gates", "project"]);
  });

  it("ignores another project's events, and reloads everything on reset", async () => {
    const { api, calls, seq } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    calls.length = 0;
    seq.value = 20;
    store.getState().receive({
      type: "event",
      event: {
        projectId: "01JA0000000000000000000002",
        seq: 30,
        type: "node.written",
        at: 1,
        data: { label: "Question" },
      } as unknown as Envelope,
    });
    store.getState().receive({ type: "reset", projectId: P, seq: 20 });
    await tick();
    expect(calls.sort()).toEqual(["documents", "gates", "project", "questions"]);
  });

  it("keeps the run log per item, and shows a write.rejected as a toast", async () => {
    const { api } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    store.getState().receive(
      event(6, "run.step", {
        itemId: "I1",
        agent: "discovery",
        step: "think",
        text: "Thinking",
        model: null,
        tokens: 0,
        ms: 0,
      }),
    );
    store.getState().receive(
      event(7, "write.rejected", {
        tool: "write_fact",
        guard: "source",
        reasonCode: "SOURCE_MISSING",
        reason: "No source.",
        agent: "intake",
      }),
    );
    expect(store.getState().runLog.I1).toEqual([
      { itemId: "I1", agent: "discovery", step: "think", text: "Thinking", at: 1 },
    ]);
    expect(store.getState().toasts.map((t) => t.text)).toEqual(["write_fact · source: No source."]);

    // A reconnect replays events the store already handled: no second log line or toast.
    store
      .getState()
      .receive(
        event(6, "run.step", { itemId: "I1", agent: "discovery", step: "think", text: "Thinking" }),
      );
    store
      .getState()
      .receive(
        event(7, "write.rejected", { tool: "write_fact", guard: "source", reason: "No source." }),
      );
    expect(store.getState().runLog.I1).toHaveLength(1);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it("answers with the version it shows; an old version says so and reloads", async () => {
    const { api, calls } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    calls.length = 0;
    vi.mocked(api.answer).mockResolvedValue({
      ok: false,
      error: {
        code: "GUARD_REJECTED",
        guard: "version",
        reason: "old",
        details: { reasonCode: "VERSION_OLD" },
      },
    });
    const question = { id: "Q1", version: 3 } as QuestionView;
    expect(await store.getState().answer(question, false, "Closed on Saturday.")).toBe(false);
    expect(api.answer).toHaveBeenCalledWith(P, "Q1", {
      version: 3,
      accept: false,
      text: "Closed on Saturday.",
    });
    await tick();
    expect(store.getState().toasts.map((t) => t.text)).toEqual(["Changed on another screen"]);
    expect(calls).toEqual(["questions"]);
  });
});

describe("live", () => {
  it("subscribes once every snapshot is in, from the oldest seq, even when it connects first", async () => {
    const sent: string[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage = null;
      onclose = null;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      send(data: string) {
        sent.push(data);
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    const { api } = stubApi();
    const store = createAppStore(api);
    const stop = connectLive(store, "ws://test/ws"); // main.tsx connects before a project opens
    await tick();
    await store.getState().open(P);
    await tick();
    stop();
    vi.unstubAllGlobals();
    expect(sent.map((m) => JSON.parse(m))).toEqual([{ type: "subscribe", projectId: P, since: 5 }]);
  });
});

describe("api", () => {
  it("turns an answer that breaks its contract into an INTERNAL rejection", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ gates: "nope" }), { status: 200 }),
    );
    const api = createApi({ base: "", actor: () => "human:lead" });
    const result = await api.gates(P);
    vi.unstubAllGlobals();
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });
});
