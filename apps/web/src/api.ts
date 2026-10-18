// The gateway's REST routes the screens use (contracts.md section 8), each answer checked
// with its contracts schema. In the browser `base` is "" and the Vite dev proxy adds the UI token;
// tests pass the gateway URL and the token in `headers`.
import {
  AgencyMetrics,
  AnswerResponse,
  BoardResponse,
  CardFileResponse,
  CardFilesResponse,
  ChangeRequestResponse,
  ChatResponse,
  CommitDiffResponse,
  CreateProjectResponse,
  DeleteProjectResponse,
  DocResponse,
  DocumentsResponse,
  ErrorBody,
  EventsResponse,
  FeaturesResponse,
  GateDecisionResponse,
  GatesResponse,
  GetProjectResponse,
  GraphView,
  ItemRunsResponse,
  ItemsResponse,
  ListProjectsResponse,
  MemoryResponse,
  NodeResponse,
  PatchTaskResponse,
  PathResponse,
  PreviewResponse,
  ProgressMetricResponse,
  ProgressView,
  ProjectMetrics,
  QuestionsResponse,
  ReadinessResponse,
  RetryItemResponse,
  TestRunsResponse,
  UploadFilesResponse,
  type Doc,
  type Lane,
  type Mode,
  type Rejection,
} from "@agencymem/contracts";

export type Result<T> = { ok: true; data: T } | { ok: false; error: Rejection };

type Schema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
};

export type ApiOptions = {
  base: string;
  headers?: Record<string, string>;
  /** X-AM-Actor for writes, for example `human:lead`. */
  actor: () => string;
};

export function createApi(opts: ApiOptions) {
  async function call<T>(
    schema: Schema<T>,
    method: string,
    path: string,
    init: { body?: unknown; form?: FormData; project?: string } = {},
  ): Promise<Result<T>> {
    const headers: Record<string, string> = { ...opts.headers };
    if (method !== "GET") headers["X-AM-Actor"] = opts.actor();
    if (init.project) headers["X-AM-Project"] = init.project;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(`${opts.base}${path}`, {
        method,
        headers,
        body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      });
    } catch {
      return { ok: false, error: { code: "INTERNAL", reason: "The gateway cannot be reached." } };
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const body = ErrorBody.safeParse(json);
      return {
        ok: false,
        error: body.success
          ? body.data.error
          : { code: "INTERNAL", reason: `The gateway answered ${res.status}.` },
      };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "INTERNAL", reason: `The answer of ${method} ${path} breaks its contract.` },
      };
    }
    return { ok: true, data: parsed.data };
  }

  return {
    listProjects: () => call(ListProjectsResponse, "GET", "/api/projects"),
    createProject: (body: { clientName: string; projectName: string; mode: Mode }) =>
      call(CreateProjectResponse, "POST", "/api/projects", { body }),
    deleteProject: (id: string) => call(DeleteProjectResponse, "DELETE", `/api/projects/${id}`),
    project: (id: string) => call(GetProjectResponse, "GET", `/api/projects/${id}`),
    documents: (id: string) => call(DocumentsResponse, "GET", `/api/projects/${id}/documents`),
    upload: (id: string, files: File[]) => {
      const form = new FormData();
      for (const file of files) form.append("files", file, file.name);
      return call(UploadFilesResponse, "POST", `/api/projects/${id}/files`, { form });
    },
    node: (id: string, nodeId: string) =>
      call(NodeResponse, "GET", `/api/projects/${id}/nodes/${nodeId}`),
    questions: (id: string) => call(QuestionsResponse, "GET", `/api/projects/${id}/questions`),
    answer: (project: string, questionId: string, body: AnswerInput) =>
      call(AnswerResponse, "POST", `/api/questions/${questionId}/answer`, { body, project }),
    gates: (id: string) => call(GatesResponse, "GET", `/api/projects/${id}/gates`),
    readiness: (id: string) => call(ReadinessResponse, "GET", `/api/projects/${id}/readiness`),
    decide: (project: string, gateId: string, body: DecisionInput) =>
      call(GateDecisionResponse, "POST", `/api/gates/${gateId}/decision`, { body, project }),
    doc: (id: string, doc: Doc) => call(DocResponse, "GET", `/api/projects/${id}/docs/${doc}`),
    features: (id: string) => call(FeaturesResponse, "GET", `/api/projects/${id}/features`),
    memory: (id: string) => call(MemoryResponse, "GET", `/api/projects/${id}/memory`),
    chat: (project: string, body: { text: string; docSectionId?: string }) =>
      call(ChatResponse, "POST", "/api/chat", { body, project }),
    board: (id: string) => call(BoardResponse, "GET", `/api/projects/${id}/board`),
    progress: (id: string) => call(ProgressView, "GET", `/api/projects/${id}/progress`),
    metrics: (id: string) => call(ProjectMetrics, "GET", `/api/projects/${id}/metrics`),
    agencyMetrics: () => call(AgencyMetrics, "GET", "/api/agency/metrics"),
    progressMetric: (id: string, metric: string) =>
      call(ProgressMetricResponse, "GET", `/api/projects/${id}/progress/${metric}`),
    patchTask: (project: string, taskId: string, body: TaskPatch & { version: number }) =>
      call(PatchTaskResponse, "PATCH", `/api/tasks/${taskId}`, { body, project }),
    retry: (project: string, itemId: string) =>
      call(RetryItemResponse, "POST", `/api/items/${itemId}/retry`, { body: {}, project }),
    graph: (id: string, query: { focus?: string; depth?: number; limit?: number } = {}) => {
      const qs = new URLSearchParams(
        Object.entries(query).map(([k, v]) => [k, String(v)] as [string, string]),
      ).toString();
      return call(GraphView, "GET", `/api/projects/${id}/graph${qs ? `?${qs}` : ""}`);
    },
    why: (id: string, nodeId: string) =>
      call(PathResponse, "GET", `/api/projects/${id}/why/${nodeId}`),
    impact: (id: string, nodeId: string) =>
      call(PathResponse, "GET", `/api/projects/${id}/impact/${nodeId}`),
    recalled: (id: string, nodeId: string) =>
      call(PathResponse, "GET", `/api/projects/${id}/recalled/${nodeId}`),
    events: (id: string) => call(EventsResponse, "GET", `/api/projects/${id}/events`),
    commitDiff: (id: string, sha: string) =>
      call(CommitDiffResponse, "GET", `/api/projects/${id}/commits/${sha}/diff`),
    preview: (id: string, method: "GET" | "POST" | "DELETE") =>
      call(
        PreviewResponse,
        method,
        `/api/projects/${id}/preview`,
        method === "GET" ? {} : { body: {} },
      ),
    cardFiles: (id: string, key: string, merged?: string) =>
      call(
        CardFilesResponse,
        "GET",
        `/api/projects/${id}/cards/${key}/files${merged ? `?merged=${merged}` : ""}`,
      ),
    cardFile: (id: string, key: string, path: string, merged?: string) =>
      call(
        CardFileResponse,
        "GET",
        `/api/projects/${id}/cards/${key}/file?${new URLSearchParams({ path, ...(merged ? { merged } : {}) }).toString()}`,
      ),
    items: (id: string) => call(ItemsResponse, "GET", `/api/projects/${id}/items`),
    itemRuns: (id: string, itemId: string) =>
      call(ItemRunsResponse, "GET", `/api/projects/${id}/items/${itemId}/runs`),
    testRuns: (id: string, taskId: string) =>
      call(TestRunsResponse, "GET", `/api/projects/${id}/tasks/${taskId}/test-runs`),
    changeRequest: (id: string, text: string) =>
      call(ChangeRequestResponse, "POST", `/api/projects/${id}/change-requests`, {
        body: { text },
      }),
  };
}

/** What a person may change on a card (route 13, stage-machine.md section 6). */
export type TaskPatch = {
  title?: string;
  description?: string;
  lane?: Lane;
  order?: number;
  column?: "Backlog" | "Ready" | "Rework";
  criteria?: { key: string; text: string; testIds: string[] }[];
  unblock?: true;
};
export type AnswerInput = { version: number; accept: boolean; text?: string };
export type DecisionInput = {
  version: number;
  decision: "approve" | "reject";
  reason?: string;
};
export type Api = ReturnType<typeof createApi>;
