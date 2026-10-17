// The Phase 2 screens rendered from store states (ui.md section 1, rule 6: loading, empty, error),
// plus the parts the spec names: two source boxes for a contradiction, blockedBy as text, and the
// closed drop zone after intake.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  ReadinessCheck,
  CardView,
  GraphView,
  FeatureView,
  GateView,
  ItemView,
  Envelope,
  ProjectInfo,
  QuestionView,
} from "@agencymem/contracts";
import type { Api } from "./api";
import { BoardView } from "./board/Board";
import { CardDrawer } from "./board/CardDrawer";
import { CardStoryView } from "./card/CardStory";
import { addedLines, editedPath } from "./card/CodeView";
import { CodeScreenView, codeState } from "./code/Code";
import { DocsView } from "./docs/Docs";
import { GatesView } from "./gates/Gates";
import { GraphPanelView } from "./graph/GraphPanel";
import { HealthView } from "./health/Health";
import { HomeView, feedLine, nextStep } from "./home/Home";
import { FilesView } from "./intake/Files";
import { lineClass } from "./pipeline/Evidence";
import { PHASES, PipelineView, phaseState } from "./pipeline/Pipeline";
import { PreviewPanel } from "./preview/Preview";
import { ProjectsView } from "./projects/Projects";
import { QuestionnaireView, SourcePair } from "./questionnaire/Questionnaire";
import { ChangeRequestButton, Logo, StageStepper, ThemeToggle } from "./shell/Shell";
import { parseHash } from "./shell/router";
import {
  createAppStore,
  type AppState,
  type Board,
  type Docs,
  type GraphData,
  type Progress,
  type Slice,
} from "./store";

const base = createAppStore({} as Api).getState();
const ready = <T,>(data: T): Slice<T> => ({ data, seq: 1, status: "ready", error: null });
const state = (over: Partial<AppState>): AppState => ({ ...base, projectId: "P", ...over });

const source = (documentName: string, text: string) => ({
  episodeId: "01JA00000000000000000000E1",
  factId: `01JA00000000000000000000F${documentName.length}`,
  factStatement: "s",
  documentName,
  page: 1,
  lineStart: 4,
  lineEnd: 6,
  text,
});
const question = (over: Partial<QuestionView> = {}): QuestionView => ({
  id: "01JA00000000000000000000Q1",
  kind: "contradiction",
  text: "Is a slot 20 or 30 minutes long?",
  recommended: "20 minutes.",
  reasoning: "r",
  approach: "a",
  status: "open",
  version: 1,
  assumption: { id: "01JA00000000000000000000A1", text: "A slot is 20 minutes.", status: "open" },
  contradiction: null,
  sources: [source("kickoff-notes.pdf", "20 minutes"), source("client-summary.docx", "30-minute")],
  answer: null,
  ...over,
});
const gate = (over: Partial<GateView> = {}): GateView => ({
  id: "01JA00000000000000000000G1",
  key: "G1",
  status: "waiting",
  version: 1,
  decidedBy: null,
  decidedAt: null,
  reason: null,
  canDecide: false,
  blockedBy: ["2 questions still open"],
  task: null,
  ...over,
});

describe("screen states", () => {
  it("shows a skeleton while loading, and the reason with Retry on an error", () => {
    expect(renderToString(<GatesView s={state({})} />)).toContain('aria-busy="true"');
    const error = renderToString(
      <QuestionnaireView
        s={state({
          questions: {
            data: null,
            seq: 0,
            status: "error",
            error: { code: "INTERNAL", reason: "The gateway cannot be reached." },
          },
        })}
      />,
    );
    expect(error).toContain("The gateway cannot be reached.");
    expect(error).toContain("Retry");
  });

  it("says what to do when a screen is empty", () => {
    expect(renderToString(<ProjectsView s={state({ projects: ready([]) })} />)).toContain(
      "No projects yet.",
    );
    expect(renderToString(<FilesView s={state({ documents: ready([]) })} />)).toContain(
      "No files yet.",
    );
    const running = renderToString(
      <QuestionnaireView
        s={state({
          questions: ready([]),
          runLog: {
            I1: [
              {
                seq: 1,
                itemId: "I1",
                agent: "discovery",
                step: "think",
                text: "Reading 3 documents",
                model: null,
                tokens: 0,
                ms: 0,
                at: 1,
              },
            ],
          },
        })}
      />,
    );
    expect(running).toContain("Discovery is still running.");
    expect(running).toContain("Reading 3 documents");
  });
});

describe("questionnaire", () => {
  it("shows a contradiction's two sources side by side, and one box for the others", () => {
    const two = renderToString(<SourcePair question={question()} />);
    expect(two).toContain('class="source-pair two"');
    expect(two).toContain("kickoff-notes.pdf · p1 · l4-6");
    expect(two).toContain("client-summary.docx · p1 · l4-6");
    const one = renderToString(
      <SourcePair
        question={question({ kind: "unclear", sources: [source("whatsapp-chat.txt", "fast")] })}
      />,
    );
    expect(one).toContain('class="source-pair one"');
  });

  it("counts the questions, links G1 while some are open, and shows the five parts", () => {
    const html = renderToString(
      <QuestionnaireView
        s={state({
          questions: ready([
            question(),
            question({
              id: "01JA00000000000000000000Q2",
              kind: "open",
              status: "answered",
              answer: {
                episodeId: "01JA00000000000000000000E2",
                text: "Yes.",
                actor: "human:lead",
                at: 1,
              },
            }),
          ]),
        })}
      />,
    );
    expect(html).toContain("Contradictions 1 · Open 1 · Unclear 0");
    expect(html).toContain("Answered 1 of 2");
    expect(html).toContain('href="#/p/P/gates"');
    expect(html).toContain("G1: 1 question still open");
    for (const part of ["Recommended", "Reasoning", "Assumption", "Approach", "Answer"]) {
      expect(html).toContain(`<dt>${part}</dt>`);
    }
    expect(html).toContain("Accept recommended");
    // Each question is a dropdown: the question on its face, the parts inside, closed at first.
    expect(html).toMatch(/<details class="question open"><summary>.*Is a slot 20/s);
    expect(html).not.toContain('<details class="question open" open');
  });
});

describe("gates", () => {
  it("disables Approve with the reason written out, and has no Reject for G1", () => {
    const html = renderToString(<GatesView s={state({ gates: ready([gate()]) })} />);
    expect(html).toContain("blocked: 2 questions still open");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Approve<\/button>/);
    expect(html).not.toContain("Reject");
  });
});

describe("G5 deploy (task 5.2)", () => {
  const check = (name: ReadinessCheck["name"], passed: boolean): ReadinessCheck => ({
    name,
    passed,
    detail: passed ? "none" : `${name} failed`,
    nodeIds: passed ? [] : ["01JA00000000000000000000N1", "01JA00000000000000000000N2"],
  });
  const report = (passed: boolean) => ({
    id: "01JA00000000000000000000R1",
    passed,
    override: false,
    createdAt: 1,
    checks: [
      check("cards_done", passed),
      check("coverage", true),
      check("open_assumptions", true),
      check("open_defects", true),
      check("drift", true),
    ],
  });
  const g5 = gate({ key: "G5", canDecide: true, blockedBy: [] });

  it("shows the five readiness checks with pass or fail, the failing node count, and the environment field", () => {
    const html = renderToString(
      <GatesView s={state({ gates: ready([g5]), readiness: ready(report(false)) })} />,
    );
    for (const name of ["cards_done", "coverage", "open_assumptions", "open_defects", "drift"]) {
      expect(html).toContain(name);
    }
    expect(html.match(/>pass</g)).toHaveLength(4);
    expect(html.match(/>fail</g)).toHaveLength(1);
    expect(html).toContain("cards_done failed · 2 nodes");
    expect(html).toContain('name="environment"');
    expect(html).toContain("Approve anyway");
  });

  it("asks for no override when the report passed", () => {
    const html = renderToString(
      <GatesView s={state({ gates: ready([g5]), readiness: ready(report(true)) })} />,
    );
    expect(html.match(/>pass</g)).toHaveLength(5);
    expect(html).not.toContain("Approve anyway");
    // ui.md: never a silent grey button, also when only the form is incomplete.
    expect(html).toContain("blocked: needs an environment");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Approve<\/button>/);
  });
});

describe("gates without a reason", () => {
  it("never shows a silent grey button", () => {
    const html = renderToString(
      <GatesView s={state({ gates: ready([gate({ key: "G2", blockedBy: [] })]) })} />,
    );
    expect(html).toContain("blocked: not decidable yet");
  });

  it("shows a decided gate's status in words in the stage stepper", () => {
    const html = renderToString(
      <StageStepper
        s={state({
          project: ready({ id: "P", stage: "proposal" } as ProjectInfo),
          gates: ready([gate({ status: "approved" })]),
        })}
      />,
    );
    expect(html).toMatch(/G1(<!-- -->)?<span class="visually-hidden"> approved<\/span>/);
    expect(html).not.toContain(">closed<");
  });
});

describe("files", () => {
  it("lists a document's episodes from a button a keyboard can reach", () => {
    const doc = {
      id: "01JA00000000000000000000D1",
      name: "kickoff-notes.pdf",
      mime: "application/pdf",
      status: "processed",
      episodeCount: 15,
      wordCount: 612,
      error: null,
      uploadedAt: 1,
    } as const;
    const html = renderToString(<FilesView s={state({ documents: ready([doc]) })} />);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>kickoff-notes.pdf<\/button>/);
  });

  it("closes the drop zone once Discovery has started", () => {
    const project = { id: "P", stage: "discovery" } as ProjectInfo;
    const html = renderToString(
      <FilesView s={state({ project: ready(project), documents: ready([]) })} />,
    );
    expect(html).toContain("Uploads closed: Discovery has started.");
    expect(html).not.toContain('type="file"');
  });
});

const section = (
  order: number,
  title: string,
  over: Partial<Docs["prd"]["sections"][number]> = {},
) => ({
  id: `01JA00000000000000000000S${order}`,
  order,
  title,
  body: "Text.",
  stale: false,
  renders: [],
  ...over,
});
const FEAT = "01JA00000000000000000000F3";
const docs = (prd: Docs["prd"]["sections"]): Docs => ({
  prd: { doc: "prd", sections: prd, designVersion: 1 },
  tdd: { doc: "tdd", sections: [], designVersion: 1 },
  plan: { doc: "plan", sections: [], designVersion: 1 },
});
const feature = {
  id: FEAT,
  key: "FEAT-03",
  name: "Slot calendar",
  featureKind: "calendar",
  productVersion: 1,
  requirementKeys: [],
  actualHours: null,
  estimate: {
    hours: 13.5,
    rawHours: 7,
    basis: "raw 7 h × 1.91 (lesson low, n=1) = 13.5 h",
    lessons: [],
  },
} as unknown as FeatureView;

describe("documents", () => {
  it("says the documents come after the proposal while there are none", () => {
    const html = renderToString(<DocsView s={state({ docs: ready(docs([])) })} doc="prd" />);
    expect(html).toContain("The documents appear after the proposal is approved.");
  });

  it("shows the tabs, the summary first, stale sections, feature estimates and G3", () => {
    const html = renderToString(
      <DocsView
        doc="prd"
        s={state({
          docs: ready(
            docs([
              section(0, "Summary", { body: "**Lotus** clinic books online." }),
              section(2, "Requirements", { stale: true }),
              section(3, "Features and estimates", {
                renders: [{ label: "Feature", id: FEAT, key: "FEAT-03", text: "Slot calendar" }],
              }),
            ]),
          ),
          features: ready([feature]),
          gates: ready([gate({ key: "G3", blockedBy: ["Architect still working"] })]),
        })}
      />,
    );
    for (const tab of ["Final PRD", "Technical Design", "Implementation Plan"]) {
      expect(html).toContain(tab);
    }
    expect(html.indexOf("Summary")).toBeLessThan(html.indexOf("Requirements"));
    expect(html).toContain('<span class="chip warn">stale</span>');
    expect(html).toContain("13.5 h · raw 7 h × 1.91 (lesson low, n=1) = 13.5 h");
    expect(html).toContain("blocked: Architect still working");
    // No DOM here, so no DOMPurify: the Markdown shows as text, never as unchecked HTML.
    expect(html).toContain("**Lotus** clinic books online.");
    expect(html).not.toContain("<strong>Lotus");
  });
});

const cardView = (over: Partial<CardView> = {}): CardView => ({
  id: "01JA00000000000000000000T1",
  key: "CARD-01",
  title: "Seed the clinic",
  description: "Writes the seed.",
  lane: "Backend",
  column: "Backlog",
  order: 10,
  kind: "build",
  version: 2,
  attempts: 0,
  blocked: false,
  note: null,
  leaseHolder: null,
  leaseUntil: null,
  testStatus: "none",
  commits: [],
  rework: false,
  crIds: [],
  crKeys: [],
  requirementKey: "REQ-01",
  dependsOn: [],
  criteria: [
    {
      id: "K1",
      key: "AC-01-1",
      text: "Given, when, then.",
      testIds: ["home-page"],
      testCaseCount: 0,
    },
  ],
  gate: null,
  mergedSha: null,
  ...over,
});
const boardOf = (cards: CardView[], items: ItemView[] = []): Board => ({
  columns: ["Backlog", "Ready", "In progress", "Testing", "Done", "Rework"],
  lanes: ["Frontend", "Backend", "UI", "Tests", "Deployment"],
  cards,
  items,
});
const progress: Progress = {
  stage: "build",
  gates: [{ key: "G3", status: "approved" }],
  lanes: [
    { lane: "Frontend", done: 0, total: 1 },
    { lane: "Backend", done: 1, total: 3 },
    { lane: "UI", done: 0, total: 0 },
    { lane: "Tests", done: 0, total: 0 },
    { lane: "Deployment", done: 0, total: 0 },
  ],
  coverage: { covered: 0, total: 2 },
  openAssumptions: 1,
  openDefects: 0,
};

describe("board", () => {
  it("says the cards come after G3 while there are none", () => {
    const html = renderToString(
      <BoardView s={state({ board: ready(boardOf([])), progress: ready(progress) })} />,
    );
    expect(html).toContain("Cards appear after the documents are approved (G3).");
  });

  it("draws six columns by five lanes, and a card face with its chips", () => {
    const leased = cardView({
      column: "In progress",
      leaseHolder: "build-1",
      leaseUntil: Date.now() + 7 * 60_000 + 30_000,
      testStatus: "pending",
      commits: [
        { sha: "a".repeat(40), message: "m", committedAt: 1, linked: true },
        { sha: "b".repeat(40), message: "m", committedAt: 2, linked: true },
      ],
    });
    const reworked = cardView({
      id: "01JA00000000000000000000T2",
      key: "CARD-02",
      lane: "Frontend",
      column: "Rework",
      rework: true,
      crIds: ["C1"],
      crKeys: ["CR-1"],
      blocked: true,
    });
    const html = renderToString(
      <BoardView
        s={state({ board: ready(boardOf([leased, reworked])), progress: ready(progress) })}
      />,
    );
    for (const name of ["Backlog", "Ready", "In progress", "Testing", "Done", "Rework"]) {
      expect(html).toContain(`<th>${name}</th>`);
    }
    for (const lane of ["Frontend", "Backend", "UI", "Tests", "Deployment"]) {
      expect(html).toContain(`<th scope="row">${lane}</th>`);
    }
    expect(html).toContain("lane-Backend");
    expect(html).toContain("build-1 · 7 min left");
    expect(html).toContain('<span class="chip warn">pending</span>');
    expect(html).toContain("2 commits");
    expect(html).toContain("Rework · CR-1");
    expect(html).toContain('<span class="chip danger">Blocked</span>');
  });

  it("makes every progress number a button, and puts Retry on a blocked item", () => {
    const blocked = {
      id: "01JA00000000000000000000W1",
      kind: "replan",
      agent: "planner",
      status: "blocked",
      leaseOwner: null,
      leaseUntil: null,
      attempts: 3,
      lastStep: "model unavailable",
      doneAt: null,
    } as ItemView;
    const html = renderToString(
      <BoardView
        s={state({ board: ready(boardOf([cardView()], [blocked])), progress: ready(progress) })}
      />,
    );
    expect(html).toMatch(/<button[^>]*>Backend 1\/3<\/button>/);
    expect(html).toMatch(/<button[^>]*>Coverage 0\/2<\/button>/);
    expect(html).toMatch(/<button[^>]*>Open assumptions 1<\/button>/);
    expect(html).toContain("planner: replan blocked");
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
  });

  it("offers only the moves the rules allow, and names the rule of a refused one", () => {
    const backlog = renderToString(<CardDrawer s={state({})} card={cardView()} close={() => {}} />);
    expect(backlog).toMatch(/<button[^>]*disabled[^>]*>Move to Ready<\/button>/);
    expect(backlog).toContain("H2: every criterion needs a TestCase first (AC-01-1).");
    expect(backlog).not.toContain("Reopen");
    const done = renderToString(
      <CardDrawer s={state({})} card={cardView({ column: "Done" })} close={() => {}} />,
    );
    expect(done).toMatch(/<button[^>]*>Reopen<\/button>/);
    const ready = renderToString(
      <CardDrawer s={state({})} card={cardView({ column: "Ready" })} close={() => {}} />,
    );
    expect(ready).toMatch(/<button[^>]*>Park in Backlog<\/button>/);
    const blocked = renderToString(
      <CardDrawer s={state({})} card={cardView({ blocked: true, attempts: 2 })} close={() => {}} />,
    );
    expect(blocked).toMatch(/<button[^>]*>Unblock<\/button>/);
    const covered = [{ ...cardView().criteria[0]!, testCaseCount: 1 }];
    const fix = renderToString(
      <CardDrawer
        s={state({})}
        card={cardView({
          kind: "fix",
          criteria: covered,
          gate: { id: "01JA00000000000000000000G6", key: "G6", status: "waiting" },
        })}
        close={() => {}}
      />,
    );
    expect(fix).toContain("H2: a fix card needs its G6 approved first.");
  });
});

describe("routes", () => {
  it("opens a project on its board, and keeps the other screens", () => {
    expect(parseHash("#/p/01JA0000000000000000000001")).toEqual({
      screen: "home",
      projectId: "01JA0000000000000000000001",
    });
    expect(parseHash("#/p/01JA0000000000000000000001/gates")).toMatchObject({ screen: "gates" });
    expect(parseHash("#/p/01JA0000000000000000000001/docs/tdd")).toMatchObject({ doc: "tdd" });
    expect(parseHash("#/")).toEqual({ screen: "projects" });
    expect(
      parseHash("#/p/01JA0000000000000000000001/graph?focus=01JA0000000000000000000T01&view=why"),
    ).toEqual({
      screen: "graph",
      projectId: "01JA0000000000000000000001",
      focus: "01JA0000000000000000000T01",
      view: "why",
    });
    expect(parseHash("#/p/01JA0000000000000000000001/graph")).toMatchObject({
      screen: "graph",
      focus: null,
      view: "all",
    });
  });

  it("enables the Change request button from G2 approval until the project closes", () => {
    const at = (stage: string) =>
      renderToString(
        <ChangeRequestButton s={state({ project: ready({ id: "P", stage } as ProjectInfo) })} />,
      );
    expect(at("proposal")).toMatch(/<button[^>]*disabled[^>]*>Change request<\/button>/);
    expect(at("planning")).not.toMatch(/disabled/);
  });
});

describe("graph panel", () => {
  const n = (id: string, label: string, title: string, group: string) => ({
    id,
    label,
    title,
    group,
    state: null,
  });
  const why: GraphView = {
    nodes: [
      n("01JA00000000000000000000T1", "Task", "CARD-01", "Delivery"),
      n("01JA00000000000000000000R1", "Requirement", "REQ-01", "Product"),
      n("01JA00000000000000000000F1", "Fact", "A slot is 20 minutes.", "Knowledge"),
      n("01JA00000000000000000000E1", "Episode", "p1 · l3-4", "Sources"),
    ],
    links: [
      {
        source: "01JA00000000000000000000T1",
        target: "01JA00000000000000000000R1",
        type: "IMPLEMENTS",
        label: null,
      },
      {
        source: "01JA00000000000000000000R1",
        target: "01JA00000000000000000000F1",
        type: "DERIVED_FROM",
        label: null,
      },
      {
        source: "01JA00000000000000000000F1",
        target: "01JA00000000000000000000E1",
        type: "SOURCED_FROM",
        label: null,
      },
    ],
  };
  const data: GraphData = {
    view: "why",
    focus: "01JA00000000000000000000T1",
    graph: why,
    path: why,
    ms: 3,
  };

  it("shows the build run's steps under the card, each with agent, text, model, tokens and ms", () => {
    const card = cardView();
    const step = (text: string, extra = {}) => ({
      seq: 1,
      itemId: card.id,
      agent: "build",
      step: "tool",
      text,
      model: null,
      tokens: 0,
      ms: 0,
      at: 1,
      ...extra,
    });
    const html = renderToString(
      <CardDrawer
        s={state({
          runLog: {
            [card.id]: [
              step("Called get_task_context"),
              step("Run finished (exit 0, 29 s)", {
                model: "vendor/model-y",
                tokens: 13400,
                ms: 29400,
              }),
            ],
          },
        })}
        card={card}
        close={() => {}}
      />,
    );
    expect(html).toContain("build: Called get_task_context");
    expect(html).toContain(
      "build: Run finished (exit 0, 29 s) · vendor/model-y · 13400 tokens · 29400 ms",
    );
    expect(html.indexOf("Called get_task_context")).toBeLessThan(html.indexOf("Run finished"));
  });

  it("opens a card's path to the client's words from the card drawer", () => {
    const html = renderToString(<CardDrawer s={state({})} card={cardView()} close={() => {}} />);
    expect(html).toContain(`href="#/p/P/graph?focus=${cardView().id}&amp;view=why"`);
    expect(html).toMatch(/<a[^>]*>Why<\/a>/);
  });

  it("shows the focus, the count, the query time and the path in words", () => {
    const html = renderToString(
      <GraphPanelView s={state({ graph: ready(data) })} view="why" focus={data.focus} />,
    );
    for (const b of ["Network", "Flow", "Orbit", "All", "Why", "Impact", "Backtrace"]) {
      expect(html).toMatch(new RegExp(`<button[^>]*>${b}</button>`));
    }
    expect(html).toContain("focus: CARD-01");
    expect(html).toContain("4 nodes · 3 ms query");
    expect(html).toMatch(/CARD-01.*REQ-01.*A slot is 20 minutes\..*p1 · l3-4/s);
  });

  it("says what to do with no nodes, and shows loading and errors", () => {
    const none: GraphData = {
      view: "all",
      focus: null,
      graph: { nodes: [], links: [] },
      path: null,
      ms: null,
    };
    expect(
      renderToString(<GraphPanelView s={state({ graph: ready(none) })} view="all" focus={null} />),
    ).toContain("No nodes yet. Upload notes to start.");
    expect(renderToString(<GraphPanelView s={state({})} view="all" focus={null} />)).toContain(
      'aria-busy="true"',
    );
    // Another view's data never shows under this view: loading, or this view's error.
    expect(
      renderToString(
        <GraphPanelView s={state({ graph: ready(data) })} view="impact" focus={data.focus} />,
      ),
    ).toContain('aria-busy="true"');
    const failed = {
      ...ready(data),
      status: "error" as const,
      error: { code: "NOT_FOUND" as const, reason: "Unknown Defect." },
    };
    const html = renderToString(
      <GraphPanelView s={state({ graph: failed })} view="backtrace" focus={data.focus} />,
    );
    expect(html).toContain("Unknown Defect.");
    expect(html).not.toContain("REQ-01");
  });
});

describe("health panel (task 5.6)", () => {
  const metrics = {
    estimateError: 0.12,
    questions: 15,
    contradictions: 6,
    changeRequests: 2,
    cardsReopened: 6,
    cardsReopenedPerCR: 3,
    rejected: { writes: 2, claims: 4, completions: 1, queries: 1 },
    coverage: { covered: 12, total: 12 },
    tokensIn: 400000,
    tokensOut: 12000,
    cost: 3.1,
    backtraceMs: 3,
  };
  const row = (name: string, order: number, estimateError: number | null) => ({
    projectId: `01JA00000000000000000000P${order}`,
    name,
    order,
    closedAt: estimateError === null ? null : 1,
    clarityBand: "low" as const,
    estimateError,
    questions: 1,
    cardsReopenedPerCR: null,
    lessonsUsed: 1,
    lessons: [
      {
        id: "01JA00000000000000000000L1",
        featureKind: "calendar" as const,
        clarityBand: "low" as const,
      },
    ],
  });

  it("draws the stored numbers and one point per closed project", () => {
    const html = renderToString(
      <HealthView
        s={state({
          metrics: ready(metrics),
          agencyMetrics: ready({
            projects: [row("A", 1, 0.45), row("B", 2, 0.12), row("Live", 3, null)],
            lessons: [],
          }),
          board: ready(boardOf([], [])),
        })}
      />,
    );
    expect(html).toContain("Questions 15 · Contradictions 6");
    expect(html).toContain("Cards reopened per CR 3.0");
    expect(html).toContain("Rejected: claims 4 · writes 2 · completions 1 · queries 1");
    expect(html).toContain("Coverage 12/12 · Backtrace 3 ms");
    expect(html).toContain("Tokens 412k · Cost $3.10");
    expect(html.match(/<circle/g)).toHaveLength(2); // the open project has no point
    expect(html).toContain("calendar (low)"); // a point's tooltip lists its lessons
    expect(html).toContain("Blocked items: none");
  });

  it("has its own route", () => {
    expect(parseHash("#/p/01JA0000000000000000000001/health")).toMatchObject({ screen: "health" });
  });

  it("says when the curve appears while no project has closed", () => {
    const html = renderToString(
      <HealthView
        s={state({
          metrics: ready({ ...metrics, estimateError: null }),
          agencyMetrics: ready({ projects: [row("Live", 1, null)], lessons: [] }),
          board: ready(boardOf([], [])),
        })}
      />,
    );
    expect(html).toContain("The curve appears after the first project closes.");
  });
});

describe("home", () => {
  const ev = (seq: number, type: string, data: Record<string, unknown>) =>
    ({ projectId: "P", seq, type, at: 1, data }) as unknown as Envelope;

  it("draws the feed from gateway events, newest first, and skips lease renewals", () => {
    const html = renderToString(
      <HomeView
        s={state({
          project: ready({ id: "P", stage: "build" } as ProjectInfo),
          feed: [
            ev(1, "node.written", {
              label: "Fact",
              id: "F1",
              version: 1,
              summary: "Slots are 20 min",
            }),
            ev(2, "lease.changed", { itemId: "I", owner: "build-1", until: 2, reason: "renew" }),
            ev(3, "run.step", {
              itemId: "I",
              agent: "planner",
              step: "recall",
              text: "Read 14 facts",
              model: null,
              tokens: 0,
              ms: 0,
            }),
          ],
        })}
      />,
    );
    expect(html).toContain("planner · recall: Read 14 facts");
    expect(html).toContain("Fact · Slots are 20 min");
    expect(html.indexOf("Read 14 facts")).toBeLessThan(html.indexOf("Slots are 20 min"));
    expect(html).not.toContain("renew");
    expect(html).toContain('href="#/p/P/graph?focus=F1&amp;view=why"');
  });

  it("says when nothing has happened yet, and shows the key numbers", () => {
    const html = renderToString(<HomeView s={state({})} />);
    expect(html).toContain("Waiting for the agents");
    expect(html).toContain("Guard refusals");
    expect(html).toContain("Model cost");
  });

  it("points at a gate a person can decide before anything else", () => {
    expect(
      nextStep(state({ gates: ready([gate({ canDecide: true, blockedBy: [] })]) })),
    ).toMatchObject({
      title: "Decide G1",
      href: "#/p/P/gates",
    });
    expect(
      feedLine(
        ev(1, "write.rejected", {
          tool: "write_fact",
          guard: "source",
          reasonCode: "X",
          reason: "No source.",
          agent: "intake",
        }),
        "P",
      )?.text,
    ).toBe("source guard refused write_fact: No source.");
  });
});

describe("pipeline", () => {
  const item = (over: Partial<ItemView>): ItemView => ({
    id: "01JA00000000000000000000W1",
    kind: "intake",
    agent: "intake",
    status: "done",
    leaseOwner: null,
    leaseUntil: null,
    attempts: 0,
    lastStep: "47 facts from kickoff-notes.pdf",
    doneAt: 1,
    ...over,
  });

  it("puts each work item under its phase, closed, so nothing is read until it opens", () => {
    const html = renderToString(
      <PipelineView
        s={state({
          project: ready({ id: "P", stage: "planning" } as ProjectInfo),
          items: ready([
            item({}),
            item({
              id: "01JA00000000000000000000W2",
              kind: "planner",
              agent: "planner",
              status: "claimed",
              lastStep: null,
            }),
          ]),
          board: ready(boardOf([cardView()])),
        })}
      />,
    );
    const intake = html.indexOf("<h3>Intake</h3>");
    const planning = html.indexOf("<h3>Planning</h3>");
    expect(html.indexOf("47 facts from kickoff-notes.pdf")).toBeGreaterThan(intake);
    expect(html.indexOf("47 facts from kickoff-notes.pdf")).toBeLessThan(planning);
    expect(html.indexOf(">planner<")).toBeGreaterThan(planning);
    expect(html).not.toContain("Read from the graph"); // the evidence mounts on open
    expect(html).toContain('href="#/p/P/card/CARD-01"');
  });

  it("marks phases done, now and later from the project's stage", () => {
    const [intake, , , , planning, build] = PHASES;
    expect(phaseState(intake!, "planning")).toBe("done");
    expect(phaseState(planning!, "planning")).toBe("now");
    expect(phaseState(build!, "planning")).toBe("later");
  });
});

describe("card story", () => {
  it("tells the card from requirement to launch, with each commit as a dropdown", () => {
    const html = renderToString(
      <CardStoryView
        cardKey="CARD-01"
        s={state({
          board: ready(
            boardOf([
              cardView({
                commits: [
                  { sha: "a".repeat(40), message: "feat: seed", committedAt: 1, linked: true },
                ],
                mergedSha: "b".repeat(40),
              }),
            ]),
          ),
        })}
      />,
    );
    expect(html).toContain("Builds REQ-01");
    expect(html).toContain("Context the build run read from the graph");
    expect(html).toContain("Commits · 1");
    expect(html).toContain("feat: seed");
    expect(html).toContain("Merged into main at");
    expect(html).toContain("bbbbbbb");
  });

  it("says so when the card is not on the board", () => {
    const html = renderToString(
      <CardStoryView cardKey="CARD-09" s={state({ board: ready(boardOf([cardView()])) })} />,
    );
    expect(html).toContain("No card CARD-09 in this project.");
  });

  it("colours a removed line that starts with --- as removed inside a hunk", () => {
    expect(lineClass("--- a/x.sql", false)).toBe("meta");
    expect(lineClass("@@ -1 +1 @@", false)).toBe("hunk");
    expect(lineClass("--- insert doctors", true)).toBe("del");
    expect(lineClass("+++x", true)).toBe("add");
    expect(lineClass(" same", true)).toBe("");
  });
});

describe("app preview", () => {
  it("offers to run the app when stopped, shows the frame when ready, and the log when it failed", () => {
    expect(renderToString(<PreviewPanel s={state({})} />)).toContain("Run the app");
    const ready = renderToString(
      <PreviewPanel
        s={state({ preview: { status: "ready", url: "http://127.0.0.1:5191", log: [] } })}
      />,
    );
    expect(ready).toContain('<iframe src="http://127.0.0.1:5191"');
    expect(ready).toContain("Stop");
    const failed = renderToString(
      <PreviewPanel
        s={state({ preview: { status: "failed", url: null, log: ["Error: no main"] } })}
      />,
    );
    expect(failed).toContain("Error: no main");
    expect(failed).not.toContain("<iframe");
  });
});

describe("live code view", () => {
  it("maps a diff to the new file's added line numbers", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,4 @@",
      " one",
      "-two",
      "+TWO",
      "+three",
      " four",
      "@@ -10,1 +11,2 @@",
      " ten",
      "+eleven",
    ].join("\n");
    expect([...addedLines(diff)]).toEqual([2, 3, 12]);
  });

  it("reads the file an edit step names", () => {
    expect(editedPath("Edited server/routes/doctors.ts")).toBe("server/routes/doctors.ts");
    expect(editedPath("Ran npm test")).toBeNull();
  });
});

describe("theme", () => {
  it("draws the logo tile and offers the light theme from the dark default", () => {
    expect(renderToString(<Logo />)).toContain('fill="#facc15"');
    const toggle = renderToString(<ThemeToggle />);
    expect(toggle).toContain('aria-label="Switch to light theme"');
  });
});

describe("code screen", () => {
  const sha = "a".repeat(40);
  const commit = { sha, message: "feat: x", committedAt: 1, linked: true };
  const cards = [
    cardView({ key: "CARD-01", commits: [commit], mergedSha: "b".repeat(40) }),
    cardView({ key: "CARD-02", column: "In progress", leaseHolder: "builder", commits: [commit] }),
    cardView({ key: "CARD-03", commits: [commit] }),
    cardView({ key: "CARD-04" }),
  ];

  it("tells building, partial, merged and not started apart", () => {
    expect(cards.map(codeState)).toEqual(["merged", "building", "partial", "none"]);
  });

  it("lists main first, then the card being built, and opens that card", () => {
    const html = renderToString(
      <CodeScreenView cardKey={null} s={state({ board: ready(boardOf(cards)) })} />,
    );
    const at = (text: string) => html.indexOf(text);
    expect(at("main")).toBeLessThan(at("CARD-02"));
    expect(at("CARD-02")).toBeLessThan(at("CARD-03"));
    expect(at("CARD-03")).toBeLessThan(at("CARD-01"));
    expect(html).toContain("builder is writing it now");
    expect(html).toContain("no code yet");
    expect(html).toMatch(/href="#\/p\/P\/code\/CARD-02" class="src on" aria-current="page"/);
    expect(html).not.toContain('href="#/p/P/code/CARD-04"');
  });

  it("deep-links one card's code", () => {
    expect(parseHash("#/p/P/code/CARD-03")).toEqual({
      screen: "code",
      projectId: "P",
      key: "CARD-03",
    });
    expect(parseHash("#/p/P/code")).toEqual({ screen: "code", projectId: "P", key: null });
  });
});
