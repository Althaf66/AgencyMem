// The web client's one store (ui.md section 4): a slice per snapshot route, filled from REST and
// kept current by WebSocket events. A slice reloads its snapshot when an event newer than it names
// a label it shows; nothing on screen changes without a gateway event or a snapshot.
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  DocumentInfo,
  Envelope,
  GateView,
  Mode,
  ProjectInfo,
  QuestionView,
  Rejection,
  ServerMessage,
} from "@agencymem/contracts";
import type { Api, Result } from "./api";

export type Slice<T> = {
  data: T | null;
  seq: number;
  status: "idle" | "loading" | "ready" | "error";
  error: Rejection | null;
};
export type SliceName = "project" | "documents" | "questions" | "gates";
export type RunStep = { itemId: string; agent: string; step: string; text: string; at: number };
export type Toast = { id: number; text: string };

export type AppState = {
  projectId: string | null;
  projects: Slice<ProjectInfo[]>;
  project: Slice<ProjectInfo>;
  documents: Slice<DocumentInfo[]>;
  questions: Slice<QuestionView[]>;
  gates: Slice<GateView[]>;
  /** The last 50 run steps per work item. */
  runLog: Record<string, RunStep[]>;
  toasts: Toast[];
  connection: "connecting" | "live" | "closed";
  lastSeq: number;

  loadProjects(): Promise<void>;
  createProject(input: {
    clientName: string;
    projectName: string;
    mode: Mode;
  }): Promise<ProjectInfo | null>;
  /** Opens a project: loads every slice. */
  open(projectId: string): Promise<void>;
  load(slice: SliceName): Promise<void>;
  receive(message: ServerMessage): void;
  setConnection(connection: AppState["connection"]): void;
  upload(files: File[]): Promise<boolean>;
  /** A node of the open project with its links (route 6). */
  node(nodeId: string): ReturnType<Api["node"]>;
  answer(question: QuestionView, accept: boolean, text?: string): Promise<boolean>;
  decide(gate: GateView, decision: "approve" | "reject", reason?: string): Promise<boolean>;
  toast(text: string): void;
  dismiss(id: number): void;
};
export type AppStore = StoreApi<AppState>;

const empty = <T>(): Slice<T> => ({ data: null, seq: 0, status: "idle", error: null });
export const SLICES: SliceName[] = ["project", "documents", "questions", "gates"];
const TOAST_MS = 6000;
const RUN_LOG = 50;

/** The slices an event makes stale. There is no stage event, so item and gate events re-read the
 * project (its stage). */
function staleSlices(event: Envelope): SliceName[] {
  if (event.type === "gate.changed") return ["gates", "project"];
  if (event.type !== "node.written") return [];
  switch (event.data.label) {
    case "Document":
      return ["documents"];
    case "Question":
    case "Assumption":
    case "Episode":
    case "Contradiction":
      return ["questions", "gates"];
    case "WorkItem":
    case "Gate":
      return ["project", "gates"];
    default:
      return [];
  }
}

// ponytail: every event starts its own snapshot read; coalesce to one read per slice in flight if
// a burst of events ever makes that slow.
export function createAppStore(api: Api): AppStore {
  let toastId = 0;

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
      runLog: {},
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

      async open(projectId) {
        // Already open (React runs a dev effect twice): its slices are loaded or loading.
        if (get().projectId === projectId) return;
        set({
          projectId,
          project: empty(),
          documents: empty(),
          questions: empty(),
          gates: empty(),
          runLog: {},
          lastSeq: 0,
        });
        await Promise.all(SLICES.map((name) => fetchSlice(name)));
      },

      load: fetchSlice,

      receive(message) {
        if (message.type === "error") return get().toast(message.error.reason);
        if (message.type === "reset") {
          if (message.projectId !== get().projectId) return;
          for (const name of SLICES) void fetchSlice(name);
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
        if (!fresh) return;
        if (event.type === "run.step") {
          const { itemId, agent, step, text } = event.data;
          set((s) => ({
            runLog: {
              ...s.runLog,
              [itemId]: [
                ...(s.runLog[itemId] ?? []),
                { itemId, agent, step, text, at: event.at },
              ].slice(-RUN_LOG),
            },
          }));
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
  }
}
