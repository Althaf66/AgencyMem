// Task 6.5, Done when: the cost of 3 pre-run projects is known. The report prices each agent and
// model group of one project's Runs from the price table, so runs recorded at cost 0 before a
// price was set are priced too.
import { describe, expect, it } from "vitest";
import { costReport } from "./cost-report";

const prices = {
  "deep-model": { inPerMillion: 1, outPerMillion: 5 },
  "vendor/build-model": { inPerMillion: 0.5, outPerMillion: 2 },
};
const rows = [
  {
    agent: "intake",
    model: "deep-model",
    runs: 25,
    tokensIn: 1_000_000,
    tokensOut: 200_000,
    cost: 0,
  },
  {
    agent: "build",
    model: "vendor/build-model",
    runs: 6,
    tokensIn: 20_000_000,
    tokensOut: 100_000,
    cost: 0,
  },
  {
    agent: "test",
    model: "unknown-model",
    runs: 3,
    tokensIn: 50_000,
    tokensOut: 10_000,
    cost: 0.2,
  },
];

describe("costReport", () => {
  it("prices every group from the table and estimates 3 projects", () => {
    const report = costReport({ projectId: "P1", stage: "closed", rows, prices });
    expect(report.groups.map((g) => [g.agent, g.cost])).toEqual([
      ["build", 10.2], // 20 M in at 0.5 + 0.1 M out at 2
      ["intake", 2], // 1 M in at 1 + 0.2 M out at 5
      ["test", 0.2], // no price: the cost the Runs recorded
    ]);
    expect(report.total).toEqual({
      runs: 34,
      tokensIn: 21_050_000,
      tokensOut: 310_000,
      cost: 12.4,
    });
    expect(report.threeProjects).toBe(37.2);
    expect(report.unpriced).toEqual(["unknown-model"]);
    expect(report.complete).toBe(true);
  });

  it("with an empty table, costs only what the Runs recorded and lists every model", () => {
    const unpriced = rows.map((r) => ({ ...r, cost: 0 }));
    const report = costReport({ projectId: "P1", stage: "build", rows: unpriced, prices: {} });
    expect(report.total.cost).toBe(0);
    expect(report.threeProjects).toBe(0);
    expect(report.unpriced.sort()).toEqual(["deep-model", "unknown-model", "vendor/build-model"]);
  });

  it("marks a project that has not closed as incomplete", () => {
    expect(costReport({ projectId: "P1", stage: "build", rows, prices }).complete).toBe(false);
  });
});
