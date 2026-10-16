import { describe, expect, it } from "vitest";
import { actualHours, drawSim } from "./actual-hours";

const features = [
  { id: "f1", featureKind: "content_page" as const, rawHours: 10 },
  { id: "f2", featureKind: "calendar" as const, rawHours: 24 },
];

describe("drawSim", () => {
  it("gives the same traits and the same actual hours for the same seed", () => {
    const a = drawSim(100, 0);
    const b = drawSim(100, 0);
    expect(b).toEqual(a);
    expect(actualHours(features, b)).toEqual(actualHours(features, a));
  });

  it("gives other traits for another seed or project index", () => {
    expect(drawSim(101, 0).traits).not.toEqual(drawSim(100, 0).traits);
    expect(drawSim(100, 1).traits).not.toEqual(drawSim(100, 0).traits);
  });

  it("matches the seed 100 table of fixtures.md section 5", () => {
    const rows = [0, 1, 2].map((i) => drawSim(100, i));
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    expect(rows.map((r) => Object.values(r.traits).map(r3))).toEqual([
      [0.204, 0.315, 0.532],
      [0.136, 0.765, 0.541],
      [0.688, 0.544, 0.756],
    ]);
    expect(rows.map((r) => Math.round(r.M * 100) / 100)).toEqual([1.84, 2.06, 1.83]);
    expect(rows.map((r) => r.changeRequests)).toEqual([1, 2, 2]);
  });

  it("computes actual = round1(raw x M x (1 + eps[kind]))", () => {
    const sim = drawSim(100, 0);
    const [f1] = actualHours(features, sim);
    expect(f1).toEqual({
      featureId: "f1",
      actualHours: Math.round(10 * sim.M * (1 + sim.eps.content_page) * 10) / 10,
    });
    expect(Math.abs(sim.eps.content_page)).toBeLessThanOrEqual(0.1);
  });
});
