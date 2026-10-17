// The store's event rules (ui.md section 4) against a stub api: which snapshot an event reloads,
// that an event no newer than a slice is ignored, reset, toasts, and an old version.
import { describe, expect, it, vi } from "vitest";
import type { CardView, Envelope, ItemView, QuestionView } from "@agencymem/contracts";
import { createApi, type Api } from "./api";
import { connectLive } from "./live";
import { createAppStore } from "./store";

const P = "01JA0000000000000000000001";

/** An api whose snapshots answer with `seq` and count their calls. */
function stubApi(seq = { value: 5 }, history: Envelope[] = []) {
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
    readiness: () => ok("readiness", { report: null }),
    metrics: () => ok("metrics", { questions: 0 }),
    agencyMetrics: () => ok("agencyMetrics", { projects: [], lessons: [] }),
    doc: (_id: string, doc: string) => ok("doc", { doc, sections: [], designVersion: 0 }),
    features: () => ok("features", { features: [] }),
    board: () => ok("board", { columns: [], lanes: [], cards: [], items: [] }),
    items: () => ok("items", { items: [] }),
    progress: () => ok("progress", { stage: "build", gates: [], lanes: [] }),
    events: () => Promise.resolve({ ok: true as const, data: { events: history } }),
    patchTask: vi.fn(),
    retry: vi.fn(),
    changeRequest: vi.fn(),
    progressMetric: vi.fn(),
    answer: vi.fn(),
    chat: vi.fn(),
    graph: () => (
      calls.push("graph"),
      Promise.resolve({ ok: true as const, data: view(["A", "T"]) })
    ),
    why: (_id: string, nodeId: string) => (
      calls.push(`why:${nodeId}`),
      Promise.resolve({ ok: true as const, data: { path: view(["T", "E"]), ms: 2 } })
    ),
  } as unknown as Api;
  return { api, calls, seq };
}

const view = (ids: string[]) => ({
  nodes: ids.map((id) => ({ id, label: "Task", title: id, group: "Delivery", state: null })),
  links: [],
});
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
    expect(calls.sort()).toEqual([
      "agencyMetrics",
      "board",
      "doc",
      "doc",
      "doc",
      "documents",
      "features",
      "gates",
      "items",
      "metrics",
      "progress",
      "project",
      "questions",
      "readiness",
    ]);
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
    expect(calls.sort()).toEqual(["gates", "metrics", "questions"]);
    expect(store.getState().questions.seq).toBe(7);
    expect(store.getState().lastSeq).toBe(6);

    calls.length = 0;
    seq.value = 9;
    store.getState().receive(event(8, "gate.changed", { gateKey: "G1" }));
    store.getState().receive(event(9, "node.written", { label: "Document" }));
    await tick();
    expect(calls.sort()).toEqual([
      "agencyMetrics",
      "documents",
      "gates",
      "metrics",
      "progress",
      "project",
      "readiness",
    ]);

    // Route 27 has no seq: a report written by the Launch agent reloads it and the gates.
    calls.length = 0;
    store.getState().receive(event(10, "node.written", { label: "ReadinessReport" }));
    await tick();
    expect(calls.sort()).toEqual(["gates", "readiness"]);
    expect(store.getState().readiness).toMatchObject({ status: "ready", seq: 0, data: null });
  });

  it("reloads both health slices on metrics.updated (task 5.6)", async () => {
    const { api, calls, seq } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    calls.length = 0;
    seq.value = 7;
    store.getState().receive(event(6, "metrics.updated", { metric: "rejectedWrites", value: 3 }));
    await tick();
    expect(calls.sort()).toEqual(["agencyMetrics", "metrics"]);
    expect(store.getState().metrics.seq).toBe(7);
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
    expect(calls.sort()).toEqual([
      "agencyMetrics",
      "board",
      "doc",
      "doc",
      "doc",
      "documents",
      "features",
      "gates",
      "items",
      "metrics",
      "progress",
      "project",
      "questions",
      "readiness",
    ]);
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
      {
        seq: 6,
        itemId: "I1",
        agent: "discovery",
        step: "think",
        text: "Thinking",
        model: null,
        tokens: 0,
        ms: 0,
        at: 1,
      },
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

  it("fills the feed and run logs from the gateway's recent events, each seq once", async () => {
    const step = event(4, "run.step", {
      itemId: "I1",
      agent: "planner",
      step: "recall",
      text: "Read 3 facts",
      model: null,
      tokens: 0,
      ms: 0,
    }).event;
    const { api } = stubApi(undefined, [step]);
    const store = createAppStore(api);
    await store.getState().open(P);
    expect(store.getState().feed.map((e) => e.seq)).toEqual([4]);
    expect(store.getState().runLog.I1?.map((r) => r.text)).toEqual(["Read 3 facts"]);
    store.getState().receive(event(6, "metrics.updated", { metric: "x", value: 1 }));
    expect(store.getState().feed.map((e) => e.seq)).toEqual([4, 6]);
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

describe("board", () => {
  it("reloads the board and progress on card events, and the board on leases and items", async () => {
    const { api, calls, seq } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    expect(store.getState().board.data).toMatchObject({ cards: [], items: [] });
    calls.length = 0;
    seq.value = 7;
    store.getState().receive(event(6, "task.moved", { taskId: "T1", key: "CARD-01" }));
    await tick();
    expect(calls.sort()).toEqual(["board", "metrics", "progress"]);
    calls.length = 0;
    seq.value = 8;
    store.getState().receive(event(8, "lease.changed", { itemId: "T1", reason: "cancel" }));
    await tick();
    expect(calls.sort()).toEqual(["board", "items"]);
  });

  it("edits a card with the version it shows; an old version says so and reloads the board", async () => {
    const { api, calls } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    calls.length = 0;
    vi.mocked(api.patchTask).mockResolvedValue({
      ok: false,
      error: {
        code: "GUARD_REJECTED",
        guard: "version",
        reason: "old",
        details: { reasonCode: "VERSION_OLD" },
      },
    });
    const card = { id: "T1", version: 4 } as CardView;
    expect(await store.getState().patchTask(card, { title: "Book" })).toBe(false);
    expect(api.patchTask).toHaveBeenCalledWith(P, "T1", { version: 4, title: "Book" });
    await tick();
    expect(store.getState().toasts.map((t) => t.text)).toEqual(["Changed on another screen"]);
    expect(calls).toEqual(["board"]);
  });

  it("retries a blocked item, records a change request, and toasts what a CR flagged", async () => {
    const { api } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    vi.mocked(api.retry).mockResolvedValue({ ok: true, data: { item: {} } } as never);
    expect(await store.getState().retry({ id: "W1" } as ItemView)).toBe(true);
    expect(api.retry).toHaveBeenCalledWith(P, "W1");
    vi.mocked(api.changeRequest).mockResolvedValue({
      ok: true,
      data: { crId: "C1", crKey: "CR-1", episodeId: "E1", workItemId: "W2" },
    });
    expect(await store.getState().changeRequest("Slots are 30 minutes.")).toBe("CR-1");
    expect(api.changeRequest).toHaveBeenCalledWith(P, "Slots are 30 minutes.");
    store.getState().receive(
      event(40, "node.written", {
        label: "ChangeRequest",
        summary: "CR-1 flagged 3 cards and 2 sections",
      }),
    );
    expect(store.getState().toasts.map((t) => t.text)).toContain(
      "CR-1 flagged 3 cards and 2 sections",
    );
    // The CR's own creation ("CR-2 open") is not a result to announce.
    store
      .getState()
      .receive(event(41, "node.written", { label: "ChangeRequest", summary: "CR-2 open" }));
    expect(store.getState().toasts.map((t) => t.text)).not.toContain("CR-2 open");
  });
});

describe("documents", () => {
  it("holds the three documents in one slice; doc.stale and design writes reload it", async () => {
    const { api, calls, seq } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    expect(Object.keys(store.getState().docs.data ?? {})).toEqual(["prd", "tdd", "plan"]);
    expect(store.getState().docs.seq).toBe(5);

    calls.length = 0;
    seq.value = 8;
    store.getState().receive(event(6, "doc.stale", { docSectionId: "S1", crId: "C1" }));
    await tick();
    expect(calls).toEqual(["doc", "doc", "doc"]);

    calls.length = 0;
    seq.value = 9;
    store.getState().receive(event(9, "node.written", { label: "DocSection" }));
    await tick();
    expect(calls).toEqual(["doc", "doc", "doc"]);

    calls.length = 0;
    seq.value = 10;
    store.getState().receive(event(10, "node.written", { label: "Estimate" }));
    await tick();
    expect(calls.sort()).toEqual(["doc", "doc", "doc", "features", "metrics"]);
  });

  it("sends a chat with its section and says where it went", async () => {
    const { api } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    vi.mocked(api.chat).mockResolvedValue({
      ok: true,
      data: { episodeId: "E1", route: "doc_revision", workItemId: "W1" },
    });
    expect(await store.getState().chat("Say the clinic name first.", "S1")).toBe(
      "Sent to the Architect as a revision",
    );
    expect(api.chat).toHaveBeenCalledWith(P, {
      text: "Say the clinic name first.",
      docSectionId: "S1",
    });

    vi.mocked(api.chat).mockResolvedValue({
      ok: true,
      data: {
        episodeId: "E2",
        route: "change_request",
        workItemId: "W2",
        crId: "C1",
        crKey: "CR-2",
      },
    });
    expect(await store.getState().chat("Add a waiting list.")).toBe(
      "Recorded as change request CR-2",
    );
    expect(api.chat).toHaveBeenLastCalledWith(P, { text: "Add a waiting list." });

    vi.mocked(api.chat).mockResolvedValue({
      ok: false,
      error: { code: "GUARD_REJECTED", guard: "gate", reason: "Chat is closed." },
    });
    expect(await store.getState().chat("Too late.")).toBeNull();
    expect(store.getState().toasts.map((t) => t.text)).toContain("Chat is closed.");
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

describe("graph", () => {
  it("loads a why view over the whole graph, and reloads it on node events only once loaded", async () => {
    const { api, calls, seq } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    calls.length = 0;
    seq.value = 9;
    store.getState().receive(event(9, "node.written", { label: "Fact", id: "F" }));
    await tick();
    expect(calls).not.toContain("graph"); // nothing loaded yet

    await store.getState().loadGraph("why", "T");
    expect(calls.sort()).toEqual(["graph", "why:T"]);
    const { data, seq: at } = store.getState().graph;
    expect(at).toBe(9);
    expect(data).toMatchObject({ view: "why", focus: "T", ms: 2 });
    expect(data!.graph.nodes.map((n) => n.id).sort()).toEqual(["A", "E", "T"]);
    expect(data!.path!.nodes.map((n) => n.id)).toEqual(["T", "E"]);

    calls.length = 0;
    store.getState().receive(event(10, "node.ended", { factId: "F" }));
    await tick();
    expect(calls.sort()).toEqual(["graph", "why:T"]);
  });
});

describe("graph loads", () => {
  it("lets only the newest load land, and turns an event burst into one more load", async () => {
    const { api, calls } = stubApi();
    const store = createAppStore(api);
    await store.getState().open(P);
    // why/T answers after why/U: the older answer must not replace the newer view.
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const why = api.why;
    (api as { why: Api["why"] }).why = (id, nodeId) =>
      nodeId === "T" ? slow.then(() => why(id, nodeId)) : why(id, nodeId);
    const first = store.getState().loadGraph("why", "T");
    await store.getState().loadGraph("why", "U");
    release();
    await first;
    expect(store.getState().graph.data).toMatchObject({ focus: "U" });

    // Three events while a load runs: one reload after it, not three.
    calls.length = 0;
    const running = store.getState().loadGraph("why", "U");
    for (const seq of [20, 21, 22]) {
      store.getState().receive(event(seq, "node.written", { label: "Task", id: "X" }));
    }
    await running;
    await tick();
    await tick();
    expect(calls.filter((c) => c === "graph")).toHaveLength(2);
  });
});
