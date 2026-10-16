// The Phase 2 screens rendered from store states (ui.md section 1, rule 6: loading, empty, error),
// plus the parts the spec names: two source boxes for a contradiction, blockedBy as text, and the
// closed drop zone after intake.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CardView,
  GraphView,
  FeatureView,
  GateView,
  ItemView,
  ProjectInfo,
  QuestionView,
} from "@agencymem/contracts";
import type { Api } from "./api";
import { BoardView } from "./board/Board";
import { CardDrawer } from "./board/CardDrawer";
import { DocsView } from "./docs/Docs";
import { GatesView } from "./gates/Gates";
import { GraphPanelView } from "./graph/GraphPanel";
import { FilesView } from "./intake/Files";
import { ProjectsView } from "./projects/Projects";
import { QuestionnaireView, SourcePair } from "./questionnaire/Questionnaire";
import { ChangeRequestButton, StageStepper } from "./shell/Shell";
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
                itemId: "I1",
                agent: "discovery",
                step: "think",
                text: "Reading 3 documents",
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
      screen: "board",
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
