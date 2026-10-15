import { describe, expect, it } from "vitest";
import type { Recall } from "../../agent";
import { checkFiles, listedTests, writeTestsAgent } from "./write-tests";

const card = {
  id: "01JA00000000000000000000T3",
  key: "CARD-03",
  title: "Doctors and free slots API",
  designKeys: ["EP-03", "CMP-01"],
  criteria: [
    { id: "K1", key: "AC-03-1", text: "Given, when, then.", testIds: ["slots-page"] },
    { id: "K2", key: "AC-03-2", text: "Given, when, then.", testIds: ["slots-empty"] },
  ],
};
const recall = {
  item: { id: "01JA0000000000000000000001", kind: "write_tests", subjectId: card.id },
  project: { id: "01JA0000000000000000000009" },
  context: {
    tasks: [card],
    design: [{ key: "EP-03", label: "Endpoint" }],
    facts: [{ id: "F1", statement: "Dr. Menon works on Tuesday." }],
  },
} as unknown as Recall;
const file = (ac: string, path = `tests/e2e/CARD-03/${ac}.spec.ts`) => ({
  criterionKey: ac,
  path,
  content: "x",
});
const agent = writeTestsAgent({
  workspacesDir: "ws",
  gatewayUrl: "http://127.0.0.1:4000",
  hookToken: "hook-t",
});

describe("Test agent, write_tests (agent-prompts.md section 7)", () => {
  it("has the preamble, the conventions, the page URLs and the reserved names", () => {
    expect(agent.prompt).toMatch(/^You are the Test agent of AgencyMem/);
    expect(agent.prompt).toMatch(/tests\/e2e\/<CARD key>\/<AC key>\.spec\.ts/);
    expect(agent.prompt).toMatch(/#\/slots/);
    expect(agent.prompt).toMatch(/booking-lookup-submit/);
    expect(agent).toMatchObject({ id: "test", kinds: ["write_tests"], handoff: [], tier: "deep" });
    expect(agent.task).toBe("Write one Playwright spec file for each acceptance criterion.");
  });

  it("sends the card, the design nodes it uses and the facts", () => {
    expect(agent.select(recall)).toEqual(recall.context);
  });

  it("asks for a repair on a wrong path, another card's criterion, or a criterion with no file or two", () => {
    expect(checkFiles({ files: [file("AC-03-1"), file("AC-03-2")] }, card)).toEqual([]);
    expect(
      checkFiles(
        {
          files: [
            file("AC-03-1", "tests/e2e/CARD-03/../x.spec.ts"),
            file("AC-03-1"),
            file("AC-04-1"),
          ],
        },
        card,
      ),
    ).toEqual([
      "files.0.path: must be tests/e2e/CARD-03/AC-03-1.spec.ts",
      "files.2.criterionKey: AC-04-1 is not a criterion of CARD-03",
      "files: AC-03-1 has 2 files; write exactly one",
      "files: AC-03-2 has no file",
    ]);
  });

  it("reads the titles per file from the --list JSON, and asks for one test per file", () => {
    const report = (specs: string[][], errors: string[] = []) => ({
      suites: specs.map((titles, i) => ({
        title: `CARD-03\\AC-03-${i + 1}.spec.ts`,
        file: `CARD-03/AC-03-${i + 1}.spec.ts`,
        specs: [],
        suites: [{ title: "CARD-03 x", specs: titles.map((title) => ({ title })), suites: [] }],
      })),
      errors: errors.map((message) => ({ message })),
    });
    const paths = ["tests/e2e/CARD-03/AC-03-1.spec.ts", "tests/e2e/CARD-03/AC-03-2.spec.ts"];
    expect(listedTests(report([["AC-03-1: a"], ["AC-03-2: b"]]), paths)).toEqual({
      errors: [],
      titles: new Map([
        [paths[0], "AC-03-1: a"],
        [paths[1], "AC-03-2: b"],
      ]),
    });
    expect(listedTests(report([["AC-03-1: a", "AC-03-1: again"]]), paths).errors).toEqual([
      "tests/e2e/CARD-03/AC-03-1.spec.ts: lists 2 tests; it must list exactly one",
      "tests/e2e/CARD-03/AC-03-2.spec.ts: lists 0 tests; it must list exactly one",
    ]);
    expect(listedTests(report([], ["SyntaxError: Unexpected token"]), paths).errors[0]).toBe(
      "playwright test --list: SyntaxError: Unexpected token",
    );
  });
});
