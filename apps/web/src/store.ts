// The web client's one store (ui.md section 4): a slice per snapshot route, filled from REST and
// kept current by WebSocket events. A slice reloads its snapshot when an event newer than it names
// a label it shows; nothing on screen changes without a gateway event or a snapshot.
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  AgencyMetrics,
  BoardResponse,
  CardView,
  Doc,
  DocResponse,
  DocumentInfo,
  Envelope,
  FeatureView,
  GateView,
  GraphView,
  ItemView,
  Mode,
  ProgressMetricResponse,
  ProgressView,
  ProjectMetrics,
  PreviewView,
  ProjectInfo,
  QuestionView,
  ReadinessResponse,
  Rejection,
  ServerMessage,
} from "@agencymem/contracts";
import type { Api, Result, TaskPatch } from "./api";
import { merge } from "./graph/layout";
import type { GraphViewName } from "./shell/router";

export type Slice<T> = {
  data: T | null;
  seq: number;
  status: "idle" | "loading" | "ready" | "error";
  error: Rejection | null;
};
export type SliceName =
  | "project"
  | "documents"
  | "questions"
  | "gates"
  | "readiness"
  | "docs"
  | "features"
  | "board"
  | "items"
  | "progress"
  | "metrics"
  | "agencyMetrics";
/** Route 27: the newest readiness report, or null. */
export type Readiness = ReadinessResponse["report"];
export type Board = Omit<BoardResponse, "seq">;
export type Progress = Omit<ProgressView, "seq">;
export type Metrics = Omit<ProjectMetrics, "seq">;
export type MetricNode = ProgressMetricResponse["nodes"][number];
/** The three documents of route 20, without their seq. */
export type Docs = Record<Doc, Omit<DocResponse, "seq">>;
/** The graph panel: the drawn nodes (route 16, merged with the path) and the path a view lit. */
export type GraphData = {
  view: GraphViewName;
  focus: string | null;
  graph: GraphView;
  path: GraphView | null;
  /** The query time of the last view; null for All. */
  ms: number | null;
};
export type RunStep = {
  seq: number;
  itemId: string;
  agent: string;
  step: string;
  text: string;
  model: string | null;
  tokens: number;
  ms: number;
  at: number;
};
export type Toast = { id: number; text: string };

export type AppState = {
  projectId: string | null;
  projects: Slice<ProjectInfo[]>;
  project: Slice<ProjectInfo>;
  documents: Slice<DocumentInfo[]>;
  questions: Slice<QuestionView[]>;
  gates: Slice<GateView[]>;
  /** Route 27 is not a snapshot: its seq stays 0, so every event that names it reloads it.
   * ponytail: two overlapping loads can land out of order (no seq to compare); the next
   * gate.changed or ReadinessReport event fixes it. */
  readiness: Slice<Readiness>;
  docs: Slice<Docs>;
  features: Slice<FeatureView[]>;
  board: Slice<Board>;
  /** Every work item, done ones included (the Pipeline screen). */
  items: Slice<ItemView[]>;
  progress: Slice<Progress>;
  metrics: Slice<Metrics>;
  /** Route 25 is not a snapshot (no seq), like readiness. */
  agencyMetrics: Slice<AgencyMetrics>;
  /** Not a snapshot route: its seq is the last event seq when it loaded. */
  graph: Slice<GraphData>;
  /** The last 50 run steps per work item. */
  runLog: Record<string, RunStep[]>;
  /** The last FEED events of the open project, oldest first: the Home activity feed. */
  feed: Envelope[];
  /** The built app's live preview, as the last preview.changed event or answer told it. */
  preview: PreviewView;
  toasts: Toast[];
  connection: "connecting" | "live" | "closed";
  lastSeq: number;

  loadProjects(): Promise<void>;
  createProject(input: {
    clientName: string;
    projectName: string;
    mode: Mode;
  }): Promise<ProjectInfo | null>;
  /** Deletes a project and everything it wrote; false after a rejection (a toast). */
  deleteProject(projectId: string): Promise<boolean>;
  /** Opens a project: loads every slice. */
  open(projectId: string): Promise<void>;
  load(slice: SliceName): Promise<void>;
  receive(message: ServerMessage): void;
  setConnection(connection: AppState["connection"]): void;
  upload(files: File[]): Promise<boolean>;
  /** A node of the open project with its links (route 6). */
  node(nodeId: string): ReturnType<Api["node"]>;
  /** Evidence reads of the open project: one commit's diff, an item's model calls, a card's tests. */
  commitDiff(sha: string): ReturnType<Api["commitDiff"]>;
  itemRuns(itemId: string): ReturnType<Api["itemRuns"]>;
  testRuns(taskId: string): ReturnType<Api["testRuns"]>;
  /** A card's code: its files, and one file with the card's diff of it. */
  cardFiles(key: string, merged?: string): ReturnType<Api["cardFiles"]>;
  cardFile(key: string, path: string, merged?: string): ReturnType<Api["cardFile"]>;
  /** Reads (GET), starts (POST) or stops (DELETE) the preview. */
  previewAction(method: "GET" | "POST" | "DELETE"): Promise<void>;
  answer(question: QuestionView, accept: boolean, text?: string): Promise<boolean>;
  decide(gate: GateView, decision: "approve" | "reject", reason?: string): Promise<boolean>;
  /** Route 21: the reply line saying where the text went, or null after a rejection (a toast). */
  chat(text: string, docSectionId?: string): Promise<string | null>;
  /** Route 13 with the version the card shows; false after a rejection (a toast). */
  patchTask(card: CardView, patch: TaskPatch): Promise<boolean>;
  /** Route 31: a blocked item back to open. */
  retry(item: ItemView): Promise<boolean>;
  /** Route 22: the new CR's key, or null after a rejection (a toast). */
  changeRequest(text: string): Promise<string | null>;
  /** Route 15: the nodes behind one number of the progress header. */
  progressList(metric: string): Promise<MetricNode[] | null>;
  /** Routes 16 to 18: the graph, with the path of a why or impact view lit. */
  loadGraph(view: GraphViewName, focus: string | null): Promise<void>;
  toast(text: string): void;
  dismiss(id: number): void;
};
export type AppStore = StoreApi<AppState>;

const empty = <T>(): Slice<T> => ({ data: null, seq: 0, status: "idle", error: null });
/** The snapshot slices: live.ts subscribes from their oldest seq once all hold data. Readiness is
 * loaded with them but is not one: it has no seq, and no report is a real answer (null). */
export const SLICES: SliceName[] = [
  "project",
  "documents",
  "questions",
  "gates",
  "docs",
  "features",
  "board",
  "items",
  "progress",
  "metrics",
];
/** Loaded with the snapshots, but with no seq: every event that names them reloads them. */
const UNSEQ: SliceName[] = ["readiness", "agencyMetrics"];
/** (P, task 5.6) the health slices. A node write reloads only this project's numbers: route 25
 * has no seq and reads every project, so it waits for a gate or metrics event. */
const HEALTH: SliceName[] = ["metrics", "agencyMetrics"];
const DOCS: Doc[] = ["prd", "tdd", "plan"];
// The labels a document section renders: a write to one changes the documents.
const DESIGN = [
  "DocSection",
  "Requirement",
  "Decision",
  "Component",
  "Screen",
  "DataEntity",
  "Endpoint",
  "Risk",
];
const TOAST_MS = 6000;
/** The events the graph panel follows (ui.md graph panel, Data and interactions). */
const GRAPH_EVENTS = ["node.written", "node.ended", "task.moved"];
const PATHS = { why: "why", impact: "impact", read: "recalled" } as const;
const RUN_LOG = 50;
const FEED = 300;
const NO_PREVIEW: PreviewView = { status: "stopped", url: null, log: [] };

/** `a` and `b` as one list, each seq once, in seq order, the newest `cap`. */
function bySeq<T extends { seq: number }>(a: T[], b: T[], cap: number): T[] {
  const all = new Map([...a, ...b].map((x) => [x.seq, x]));
  return [...all.values()].sort((x, y) => x.seq - y.seq).slice(-cap);
}

function stepOf(event: Extract<Envelope, { type: "run.step" }>): RunStep {
  const { itemId, agent, step, text, model, tokens, ms } = event.data;
  // Older events may lack the numbers; they show as none.
  return {
    seq: event.seq,
    itemId,
    agent,
    step,
    text,
    model: model ?? null,
    tokens: tokens ?? 0,
    ms: ms ?? 0,
    at: event.at,
  };
}

/** `runLog` with the run steps among `events` added. */
function withSteps(runLog: Record<string, RunStep[]>, events: Envelope[]) {
  const out = { ...runLog };
  for (const e of events) {
    if (e.type !== "run.step") continue;
    out[e.data.itemId] = bySeq(out[e.data.itemId] ?? [], [stepOf(e)], RUN_LOG);
  }
  return out;
}

/** The slices an event makes stale. There is no stage event, so item and gate events re-read the
 * project (its stage). */
function staleSlices(event: Envelope): SliceName[] {
  if (event.type === "gate.changed")
    return ["gates", "readiness", "project", "progress", ...HEALTH];
  if (event.type === "metrics.updated") return HEALTH;
  if (event.type === "doc.stale") return ["docs"];
  if (event.type === "task.moved" || event.type === "task.edited")
    return ["board", "progress", "metrics"];
  if (event.type === "lease.changed") return ["board", "items"];
  if (event.type !== "node.written") return [];
  if (DESIGN.includes(event.data.label)) return ["docs"];
  switch (event.data.label) {
    case "Feature":
    case "Estimate":
      return ["features", "docs", "metrics"];
    case "Document":
      return ["documents"];
    case "Assumption":
      return ["questions", "gates", "progress"];
    case "Question":
    case "Episode":
    case "Contradiction":
      return ["questions", "gates", "metrics"];
    case "WorkItem":
      return ["project", "gates", "board", "items"];
    case "Gate":
      return ["project", "gates"];
    case "ReadinessReport":
      return ["readiness", "gates"];
    case "Task":
    case "AcceptanceCriterion":
    case "TestCase":
      return ["board", "progress", "metrics"];
    case "ChangeRequest":
    case "TestRun":
      // ponytail: Run writes do not reload the health numbers, so tokens and cost lag until one
      // of these events; reload on run.step if that ever matters.
      return ["metrics"];
    default:
      return [];
  }
}

// ponytail: every event starts its own snapshot read; coalesce to one read per slice in flight if
// a burst of events ever makes that slow.
export function createAppStore(api: Api): AppStore {
  let toastId = 0;
  // The graph view: only the newest load may land; events during a load ask for one more after it.
  let graphLoad = 0;
  let graphPending = 0;
  let graphDirty = false;

  return createStore<AppState>()((set, get) => {
    /** Reads one snapshot; a slower, older answer never replaces a newer one. */
    async function fetchSlice(name: SliceName): Promise<void> {
      const id = get().projectId;
      if (!id) return;
      set((s) => ({ [name]: { ...s[name], status: s[name].data ? "ready" : "loading" } }));
      const result: Result<{ seq: number; data: unknown }> = await snapshot(api, name, id);
      if (get().projectId !== id) return; // another project was opened meanwhile
      set((s) => {
        if (!result.ok) return { [name]: { ...s[name], status: "error", error: result.error } };
        if (result.data.seq < s[name].seq) return {};
        return {
          [name]: { data: result.data.data, seq: result.data.seq, status: "ready", error: null },
        };
      });
    }

    /** Reloads the graph view on screen, or once more after the load in flight. */
    function reloadGraph(): void {
      const data = get().graph.data;
      if (!data) return;
      if (graphPending > 0) graphDirty = true;
      else void get().loadGraph(data.view, data.focus);
    }

    /** The gateway's recent events: the feed and run logs a refreshed page would otherwise lose.
     * Merged by seq, so events the socket delivered meanwhile are not doubled. */
    async function history(): Promise<void> {
      const id = get().projectId;
      if (!id) return;
      const result = await api.events(id);
      if (!result.ok || get().projectId !== id) return; // no history is not an error on screen
      const events = result.data.events;
      set((s) => ({ feed: bySeq(s.feed, events, FEED), runLog: withSteps(s.runLog, events) }));
    }

    /** A rejected write: the reason as a toast; an old version reloads what it showed. */
    function rejected(error: Rejection, reload: SliceName): false {
      if (error.details?.reasonCode === "VERSION_OLD") {
        get().toast("Changed on another screen");
        void fetchSlice(reload);
      } else {
        get().toast(error.reason);
      }
      return false;
    }

    return {
      projectId: null,
      projects: empty(),
      project: empty(),
      documents: empty(),
      questions: empty(),
      gates: empty(),
      readiness: empty(),
      docs: empty(),
      features: empty(),
      board: empty(),
      items: empty(),
      progress: empty(),
      metrics: empty(),
      agencyMetrics: empty(),
      graph: empty(),
      runLog: {},
      feed: [],
      preview: NO_PREVIEW,
      toasts: [],
      connection: "closed",
      lastSeq: 0,

      async loadProjects() {
        set((s) => ({ projects: { ...s.projects, status: "loading" } }));
        const result = await api.listProjects();
        set({
          projects: result.ok
            ? { data: result.data.projects, seq: 0, status: "ready", error: null }
            : { data: null, seq: 0, status: "error", error: result.error },
        });
      },

      async createProject(input) {
        const result = await api.createProject(input);
        if (!result.ok) {
          get().toast(result.error.reason);
          return null;
        }
        await get().loadProjects();
        return result.data.project;
      },

      async deleteProject(projectId) {
        const result = await api.deleteProject(projectId);
        if (!result.ok) {
          get().toast(result.error.reason);
          return false;
        }
        if (get().projectId === projectId) location.hash = "#/";
        await get().loadProjects();
        return true;
      },

      async open(projectId) {
        // Already open (React runs a dev effect twice): its slices are loaded or loading.
        if (get().projectId === projectId) return;
        set({
          projectId,
          project: empty(),
          documents: empty(),
          questions: empty(),
          gates: empty(),
          readiness: empty(),
          docs: empty(),
          features: empty(),
          board: empty(),
          items: empty(),
          progress: empty(),
          metrics: empty(),
          agencyMetrics: empty(),
          graph: empty(),
          runLog: {},
          feed: [],
          preview: NO_PREVIEW,
          lastSeq: 0,
        });
        await Promise.all([...SLICES, ...UNSEQ].map((name) => fetchSlice(name)).concat(history()));
      },

      load: fetchSlice,

      receive(message) {
        if (message.type === "error") return get().toast(message.error.reason);
        if (message.type === "reset") {
          if (message.projectId !== get().projectId) return;
          for (const name of [...SLICES, ...UNSEQ]) void fetchSlice(name);
          return;
        }
        const { event } = message;
        if (event.projectId !== get().projectId) return;
        // A reconnect replays events from the oldest snapshot seq; the ones already handled must
        // not log or toast twice. Slices check their own seq.
        const fresh = event.seq > get().lastSeq;
        set((s) => ({ lastSeq: Math.max(s.lastSeq, event.seq) }));
        for (const name of staleSlices(event)) {
          if (event.seq > get()[name].seq) void fetchSlice(name);
        }
        if (event.seq > get().graph.seq && GRAPH_EVENTS.includes(event.type)) reloadGraph();
        if (!fresh) return;
        if (event.type === "preview.changed") set({ preview: event.data });
        set((s) => ({ feed: bySeq(s.feed, [event], FEED), runLog: withSteps(s.runLog, [event]) }));
        // record_change_request sums up what a CR flagged (ui.md: "CR-1 flagged 3 cards and ...").
        if (
          event.type === "node.written" &&
          event.data.label === "ChangeRequest" &&
          !event.data.summary.endsWith(" open")
        ) {
          get().toast(event.data.summary);
        }
        if (event.type === "write.rejected") {
          // ui.md asks for the item key; the event names only the tool (see the 2.8 doc notes).
          get().toast(`${event.data.tool} · ${event.data.guard}: ${event.data.reason}`);
        }
      },

      setConnection(connection) {
        set({ connection });
      },

      async upload(files) {
        const id = get().projectId;
        if (!id) return false;
        const result = await api.upload(id, files);
        return result.ok || rejected(result.error, "documents");
      },

      node(nodeId) {
        return api.node(get().projectId ?? "", nodeId);
      },
      commitDiff: (sha) => api.commitDiff(get().projectId ?? "", sha),
      itemRuns: (itemId) => api.itemRuns(get().projectId ?? "", itemId),
      testRuns: (taskId) => api.testRuns(get().projectId ?? "", taskId),
      cardFiles: (key, merged) => api.cardFiles(get().projectId ?? "", key, merged),
      cardFile: (key, path, merged) => api.cardFile(get().projectId ?? "", key, path, merged),
      async previewAction(method) {
        const id = get().projectId;
        if (!id) return;
        const result = await api.preview(id, method);
        if (get().projectId !== id) return;
        if (result.ok) set({ preview: result.data.preview });
        else get().toast(result.error.reason);
      },

      async answer(question, accept, text) {
        const id = get().projectId;
        if (!id) return false;
        const body = accept
          ? { version: question.version, accept: true }
          : { version: question.version, accept: false, text };
        const result = await api.answer(id, question.id, body);
        return result.ok || rejected(result.error, "questions");
      },

      async decide(gate, decision, reason) {
        const id = get().projectId;
        if (!id) return false;
        const result = await api.decide(id, gate.id, { version: gate.version, decision, reason });
        return result.ok || rejected(result.error, "gates");
      },

      async chat(text, docSectionId) {
        const id = get().projectId;
        if (!id) return null;
        const result = await api.chat(id, docSectionId ? { text, docSectionId } : { text });
        if (!result.ok) {
          get().toast(result.error.reason);
          return null;
        }
        return result.data.route === "doc_revision"
          ? "Sent to the Architect as a revision"
          : `Recorded as change request ${result.data.crKey ?? ""}`.trim();
      },

      async patchTask(card, patch) {
        const id = get().projectId;
        if (!id) return false;
        const result = await api.patchTask(id, card.id, { version: card.version, ...patch });
        return result.ok || rejected(result.error, "board");
      },

      async retry(item) {
        const id = get().projectId;
        if (!id) return false;
        const result = await api.retry(id, item.id);
        return result.ok || rejected(result.error, "board");
      },

      async changeRequest(text) {
        const id = get().projectId;
        if (!id) return null;
        const result = await api.changeRequest(id, text);
        if (!result.ok) {
          get().toast(result.error.reason);
          return null;
        }
        return result.data.crKey;
      },

      async progressList(metric) {
        const id = get().projectId;
        if (!id) return null;
        const result = await api.progressMetric(id, metric);
        if (!result.ok) {
          get().toast(result.error.reason);
          return null;
        }
        return result.data.nodes;
      },

      async loadGraph(view, focus) {
        const id = get().projectId;
        if (!id) return;
        const seq = get().lastSeq;
        const mine = ++graphLoad;
        graphPending++;
        try {
          set((s) => ({ graph: { ...s.graph, status: s.graph.data ? "ready" : "loading" } }));
          const pathOf = focus && view !== "all" ? PATHS[view] : null;
          const [all, path] = await Promise.all([
            api.graph(id, view === "all" && focus ? { focus } : {}),
            pathOf ? api[pathOf](id, focus!) : null,
          ]);
          // A newer load (another view, or a later event) or another project replaced this one.
          if (mine !== graphLoad || get().projectId !== id) return;
          const fail = (error: Rejection) =>
            set((s) => ({ graph: { ...s.graph, status: "error", error } }));
          if (!all.ok) return fail(all.error);
          if (path && !path.ok) return fail(path.error);
          const lit = path?.data.path ?? null;
          set({
            graph: {
              data: {
                view,
                focus,
                graph: lit ? merge(all.data, lit) : all.data,
                path: lit,
                ms: path?.data.ms ?? null,
              },
              seq,
              status: "ready",
              error: null,
            },
          });
        } finally {
          graphPending--;
          if (graphPending === 0 && graphDirty) {
            graphDirty = false;
            reloadGraph();
          }
        }
      },

      toast(text) {
        const id = ++toastId;
        set((s) => ({ toasts: [...s.toasts, { id, text }] }));
        setTimeout(() => get().dismiss(id), TOAST_MS);
      },

      dismiss(id) {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
    };
  });
}

/** One snapshot route, as `{ seq, data }`. */
async function snapshot(
  api: Api,
  name: SliceName,
  id: string,
): Promise<Result<{ seq: number; data: unknown }>> {
  switch (name) {
    case "project": {
      const r = await api.project(id);
      return r.ok ? { ok: true, data: { seq: r.data.seq, data: r.data.project } } : r;
    }
    case "documents": {
      const r = await api.documents(id);
      return r.ok ? { ok: true, data: { seq: r.data.seq, data: r.data.documents } } : r;
    }
    case "questions": {
      const r = await api.questions(id);
      return r.ok ? { ok: true, data: { seq: r.data.seq, data: r.data.questions } } : r;
    }
    case "gates": {
      const r = await api.gates(id);
      return r.ok ? { ok: true, data: { seq: r.data.seq, data: r.data.gates } } : r;
    }
    case "readiness": {
      const r = await api.readiness(id);
      return r.ok ? { ok: true, data: { seq: 0, data: r.data.report } } : r;
    }
    case "board": {
      const r = await api.board(id);
      if (!r.ok) return r;
      const { seq, ...board } = r.data;
      return { ok: true, data: { seq, data: board } };
    }
    case "items": {
      const r = await api.items(id);
      return r.ok ? { ok: true, data: { seq: r.data.seq, data: r.data.items } } : r;
    }
    case "progress": {
      const r = await api.progress(id);
      if (!r.ok) return r;
      const { seq, ...progress } = r.data;
      return { ok: true, data: { seq, data: progress } };
    }
    case "metrics": {
      const r = await api.metrics(id);
      if (!r.ok) return r;
      const { seq, ...metrics } = r.data;
      return { ok: true, data: { seq, data: metrics } };
    }
    case "agencyMetrics": {
      const r = await api.agencyMetrics();
      return r.ok ? { ok: true, data: { seq: 0, data: r.data } } : r;
    }
    case "features": {
      const r = await api.features(id);
      return r.ok ? { ok: true, data: { seq: r.data.seq, data: r.data.features } } : r;
    }
    case "docs": {
      const all = await Promise.all(DOCS.map((doc) => api.doc(id, doc)));
      const failed = all.find((r) => !r.ok);
      if (failed && !failed.ok) return failed;
      const docs = {} as Docs;
      let seq = Infinity;
      for (const r of all) {
        if (!r.ok) continue;
        const { seq: s, ...doc } = r.data;
        docs[doc.doc] = doc;
        seq = Math.min(seq, s); // the oldest: an event newer than any of the three reloads them
      }
      return { ok: true, data: { seq, data: docs } };
    }
  }
}
