// The gateway's REST routes the screens use (contracts.md section 8), each answer checked
// with its contracts schema. In the browser `base` is "" and the Vite dev proxy adds the UI token;
// tests pass the gateway URL and the token in `headers`.
import {
  AnswerResponse,
  ChatResponse,
  CreateProjectResponse,
  DocResponse,
  DocumentsResponse,
  ErrorBody,
  FeaturesResponse,
  GateDecisionResponse,
  GatesResponse,
  GetProjectResponse,
  ListProjectsResponse,
  NodeResponse,
  QuestionsResponse,
  UploadFilesResponse,
  type Doc,
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
    decide: (project: string, gateId: string, body: DecisionInput) =>
      call(GateDecisionResponse, "POST", `/api/gates/${gateId}/decision`, { body, project }),
    doc: (id: string, doc: Doc) => call(DocResponse, "GET", `/api/projects/${id}/docs/${doc}`),
    features: (id: string) => call(FeaturesResponse, "GET", `/api/projects/${id}/features`),
    chat: (project: string, body: { text: string; docSectionId?: string }) =>
      call(ChatResponse, "POST", "/api/chat", { body, project }),
  };
}

export type AnswerInput = { version: number; accept: boolean; text?: string };
export type DecisionInput = { version: number; decision: "approve" | "reject"; reason?: string };
export type Api = ReturnType<typeof createApi>;
