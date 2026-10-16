// Playwright's JSON report as one result per TestCase (agent-prompts.md section 7, test_run step 5).
import { describe, expect, it } from "vitest";
import { resultsFor } from "./run-tests";

const cases = [
  { id: "A", file: "tests/e2e/CARD-01/AC-01-1.spec.ts" },
  { id: "B", file: "tests/e2e/CARD-01/AC-01-2.spec.ts" },
  { id: "C", file: "tests/e2e/CARD-01/AC-01-3.spec.ts" },
];
// Playwright names spec files from its testDir, in nested suites.
const report = {
  suites: [
    {
      suites: [
        {
          specs: [
            {
              file: "CARD-01/AC-01-1.spec.ts",
              ok: true,
              tests: [{ results: [{ duration: 120.4 }] }],
            },
          ],
        },
        {
          specs: [
            {
              file: "CARD-01\\AC-01-2.spec.ts",
              ok: false,
              tests: [
                {
                  results: [
                    { duration: 300, error: { message: "\u001b[31mExpected: 5\u001b[39m" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("resultsFor", () => {
  it("maps each spec to its TestCase by file, strips colours, and fails a file with no result", () => {
    expect(resultsFor(cases, report)).toEqual([
      { testCaseId: "A", passed: true, durationMs: 120 },
      { testCaseId: "B", passed: false, durationMs: 300, error: "Expected: 5" },
      { testCaseId: "C", passed: false, durationMs: 0, error: "No result for this file." },
    ]);
  });
});
