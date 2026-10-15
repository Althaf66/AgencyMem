// The Phase 2 screens rendered from store states (ui.md section 1, rule 6: loading, empty, error),
// plus the parts the spec names: two source boxes for a contradiction, blockedBy as text, and the
// closed drop zone after intake.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeatureView, GateView, ProjectInfo, QuestionView } from "@agencymem/contracts";
import type { Api } from "./api";
import { DocsView } from "./docs/Docs";
import { GatesView } from "./gates/Gates";
import { FilesView } from "./intake/Files";
import { ProjectsView } from "./projects/Projects";
import { QuestionnaireView, SourcePair } from "./questionnaire/Questionnaire";
import { StageStepper } from "./shell/Shell";
import { createAppStore, type AppState, type Docs, type Slice } from "./store";

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
