// The Discovery scoring rules of fixtures.md section 6, on hand-made questions for set A.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Planted, type QuestionView } from "@agencymem/contracts";
import { score } from "./score";

const HERE = dirname(fileURLToPath(import.meta.url));
const planted = Planted.parse(
  JSON.parse(readFileSync(join(HERE, "../../apps/simulator/fixtures/A/planted.json"), "utf8")),
);
const ID = (n: number) => `01JA${String(n).padStart(22, "0")}`;

let next = 0;
/** A question whose sources are episodes holding `lines` (file and text, as QuestionView shows). */
function question(
  kind: QuestionView["kind"],
  lines: { file: string; text: string }[],
  text = "Is this right?",
): QuestionView {
  next += 1;
  return {
    id: ID(next),
    kind,
    text,
    recommended: "r",
    reasoning: "r",
    approach: "a",
    status: "open",
    version: 1,
    assumption: { id: ID(1000 + next), text: "a", status: "open" },
    contradiction:
      kind === "contradiction" ? { id: ID(2000 + next), summary: "s", status: "open" } : null,
    // Episode text is a whole paragraph: the planted line sits inside it.
    sources: lines.map((l, i) => ({
      episodeId: ID(3000 + next * 10 + i),
      factId: ID(4000 + next * 10 + i),
      factStatement: "f",
      documentName: l.file,
      page: 1,
      lineStart: 1,
      lineEnd: 3,
      text: `Before.\n${l.text.toUpperCase()}  \nAfter.`,
    })),
    answer: null,
  };
}

const perfect = (): QuestionView[] => [
  ...planted.contradictions.map((c) => question("contradiction", c.lines)),
  ...planted.unclear.map((u) => question("unclear", [u.line])),
  ...planted.open.map((o) => question("open", [], `${o.keywords.join(" and ")}?`)),
];

const run = (questions: QuestionView[], density = 8.9) =>
  score({ set: "A", projectId: ID(9999), questions, planted, density });

describe("score (fixtures.md section 6)", () => {
  it("matches every planted item one to one and passes", () => {
    const result = run(perfect());
    expect(result.contradictions).toMatchObject({
      planted: 6,
      questions: 6,
      recall: 1,
      precision: 1,
      missed: [],
      falsePositives: [],
    });
    expect(result.unclear.recall).toBe(1);
    expect(result.open.recall).toBe(1);
    expect(result).toMatchObject({ band: "low", expectedBand: "low", pass: true });
  });

  it("counts a missed contradiction and a false positive: 5 of 6 still passes", () => {
    const questions = perfect();
    questions.splice(
      0,
      1,
      question("contradiction", [{ file: "kickoff-notes.pdf", text: "Nothing planted here." }]),
    );
    const result = run(questions);
    expect(result.contradictions).toMatchObject({
      recall: 5 / 6,
      precision: 5 / 6,
      missed: ["C-A1"],
    });
    expect(result.contradictions.falsePositives).toHaveLength(1);
    expect(result.pass).toBe(true);
  });

  it("fails below 80% recall", () => {
    const result = run(perfect().slice(2));
    expect(result.contradictions.recall).toBe(4 / 6);
    expect(result.pass).toBe(false);
  });

  it("needs both lines, each from its own file, for a contradiction", () => {
    const [first] = planted.contradictions;
    const wrongFile = question("contradiction", [
      first!.lines[0],
      { ...first!.lines[1], file: "whatsapp-chat.txt" },
    ]);
    expect(run([wrongFile]).contradictions.missed).toContain("C-A1");
  });

  it("finds the best one-to-one matching, not the first fit", () => {
    const [a, b] = planted.contradictions;
    // Q1 fits C-A1 and C-A2; Q2 fits only C-A1. First fit would give Q1 to C-A1 and miss C-A2.
    const q1 = question("contradiction", [...a!.lines, ...b!.lines]);
    const q2 = question("contradiction", a!.lines);
    const result = run([q1, q2]).contradictions;
    expect(result.matched).toEqual([
      { id: a!.id, questionId: q2.id },
      { id: b!.id, questionId: q1.id },
    ]);
  });

  it("lets one question match one planted item only", () => {
    const [a, b] = planted.contradictions;
    const both = question("contradiction", [...a!.lines, ...b!.lines]);
    expect(run([both]).contradictions.matched).toHaveLength(1);
  });

  it("needs kind open and two keywords for an open question", () => {
    const [o] = planted.open;
    expect(run([question("unclear", [], `${o!.keywords.join(" ")}?`)]).open.missed).toContain(
      o!.id,
    );
    expect(run([question("open", [], `${o!.keywords[0]}?`)]).open.missed).toContain(o!.id);
  });

  it("fails when the band is not the expected one", () => {
    const result = run(perfect(), 4);
    expect(result).toMatchObject({ band: "medium", pass: false });
  });
});
