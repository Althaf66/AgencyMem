// Task 2.6, Done when: the planted contradictions in fixture set A appear as questions. Set A runs
// through the real Intake and Discovery loops over the real gateway and FalkorDB, with recorded
// replies; route 8's questions are then scored against planted.json (fixtures.md section 6).
// With recorded replies this proves the path from the model's JSON to scored questions; Discovery's
// real recall needs a real model (`pnpm eval:discovery`).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Planted, type ProjectInfo, type QuestionView } from "@agencymem/contracts";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { score } from "../discovery-eval/score";
import { startHarness, ui, type Harness } from "./harness";

const HERE = dirname(fileURLToPath(import.meta.url));
const planted = Planted.parse(
  JSON.parse(readFileSync(join(HERE, "../../apps/simulator/fixtures/A/planted.json"), "utf8")),
);

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe("Done when: planted contradictions in fixture set A appear as questions", () => {
  it("raises every planted contradiction with its two source lines, and the band is low", async () => {
    const project = await h.project("A");
    await h.run(intake, "intake-A.json", project.id, 3);
    await h.run(discovery, "discovery-A.json", project.id, 1);

    const res = await fetch(`${h.base}/api/projects/${project.id}/questions`, { headers: ui });
    const { questions } = (await res.json()) as { questions: QuestionView[] };
    const info = await fetch(`${h.base}/api/projects/${project.id}`, { headers: ui });
    const { clarity } = ((await info.json()) as { project: ProjectInfo }).project;
    expect(clarity?.band).toBe("low");

    const result = score({
      set: "A",
      projectId: project.id,
      questions,
      planted,
      density: clarity!.density,
    });
    expect(result.contradictions).toMatchObject({
      planted: 6,
      questions: 6,
      recall: 1,
      precision: 1,
      missed: [],
    });
    expect(result.unclear.missed).toEqual([]);
    expect(result.open.missed).toEqual([]);
    expect(result.pass).toBe(true);

    // Each contradiction shows its two sources from two different files.
    for (const question of questions.filter((x) => x.kind === "contradiction")) {
      expect(new Set(question.sources.map((s) => s.documentName)).size).toBe(2);
    }
  });
});
