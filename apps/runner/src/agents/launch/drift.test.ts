import { describe, expect, it } from "vitest";
import { driftCheck } from "./agent";

const sha = (n: number) => String(n).repeat(40); // distinct 7-character prefixes
const change = (n: number, linked = true) => ({ id: `CC${n}`, sha: sha(n), linked });

describe("driftCheck (agent-prompts.md section 10, step 2)", () => {
  it("passes when every commit on main has a linked CodeChange", () => {
    expect(driftCheck([sha(1), sha(2)], [change(1), change(2), change(3)])).toEqual({
      name: "drift",
      passed: true,
      detail: "All 2 commits on main are recorded",
      nodeIds: [],
    });
  });

  it("fails on a commit on main with no CodeChange, and names it", () => {
    const check = driftCheck([sha(1), sha(9)], [change(1)]);
    expect(check).toMatchObject({ passed: false, nodeIds: [] });
    expect(check.detail).toContain(sha(9).slice(0, 7));
  });

  it("fails on an unlinked CodeChange, with its id in nodeIds", () => {
    const check = driftCheck([sha(1)], [change(1), change(2, false)]);
    expect(check).toMatchObject({ passed: false, nodeIds: ["CC2"] });
    expect(check.detail).toContain(sha(2).slice(0, 7));
  });

  it("names the first five shas only, within 200 characters", () => {
    const shas = [1, 2, 3, 4, 5, 6, 7].map(sha);
    const check = driftCheck(shas, []);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("7 commits");
    expect(check.detail).toContain(sha(5).slice(0, 7));
    expect(check.detail).not.toContain(sha(6).slice(0, 7));
    expect(check.detail.length).toBeLessThanOrEqual(200);
  });
});
