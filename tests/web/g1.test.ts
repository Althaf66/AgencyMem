// Task 2.8, Done when: a person can answer every question and watch G1 approve. The web client's own
// api, store and live socket run against the real gateway (set A through Intake and Discovery on
// recorded replies). The screens are rendered from the store the WebSocket events keep current.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectInfo } from "@agencymem/contracts";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { createApi } from "../../apps/web/src/api";
import { GatesView } from "../../apps/web/src/gates/Gates";
import { connectLive } from "../../apps/web/src/live";
import { QuestionnaireView } from "../../apps/web/src/questionnaire/Questionnaire";
import { createAppStore, type AppStore } from "../../apps/web/src/store";
import { startHarness, type Harness } from "../agents/harness";

let h: Harness;
let project: ProjectInfo;
let store: AppStore;
let stopLive: () => void;

/** Waits until `check` holds; the store changes only when gateway events arrive. */
async function until(what: string, check: () => boolean, ms = 10_000) {
  for (const start = Date.now(); !check();) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const g1 = () => store.getState().gates.data?.find((g) => g.key === "G1");
const gatesHtml = () => renderToString(createElement(GatesView, { s: store.getState() }));
/** G1's row of the gate panel (gates come in key order). */
const g1Row = () => gatesHtml().split('<li class="gate-row">')[1]!;

beforeAll(async () => {
  h = await startHarness();
  project = await h.project("A");
  await h.run(intake, "intake-A.json", project.id, 3);
  await h.run(discovery, "discovery-A.json", project.id, 1);

  const api = createApi({
    base: h.base,
    headers: { "X-AM-Token": "ui-t" },
    actor: () => "human:lead",
  });
  store = createAppStore(api);
  await store.getState().open(project.id);
  stopLive = connectLive(store, `${h.base.replace("http", "ws")}/ws?token=ui-t`);
  await until("the live socket", () => store.getState().connection === "live");
}, 60_000);
afterAll(async () => {
  stopLive?.();
  await h.stop();
});

describe("Done when: a person can answer every question and watch G1 approve", () => {
  it("shows G1 waiting and blocked while questions are open", () => {
    expect(store.getState().questions.data).toHaveLength(15);
    expect(g1()).toMatchObject({ status: "waiting", canDecide: false });
    const html = g1Row();
    expect(html).toContain("<strong>Answers</strong>");
    expect(html).toContain("15 questions still open");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Approve<\/button>/);
  });

  it("answers every question; the questionnaire shows each answer and both sources", async () => {
    const questions = store.getState().questions.data!;
    for (const [i, question] of questions.entries()) {
      const ok =
        i === 1
          ? await store.getState().answer(question, false, "Closed on Saturday.")
          : await store.getState().answer(question, true);
      expect(ok).toBe(true);
    }
    await until("every answer to arrive by event", () =>
      (store.getState().questions.data ?? []).every((q) => q.status === "answered"),
    );

    const html = renderToString(createElement(QuestionnaireView, { s: store.getState() }));
    expect(html).toContain("Answered 15 of 15");
    expect(html).toContain("Closed on Saturday.");
    expect(html).toContain("human:lead");
    // Contradictions show their two source lines side by side.
    const pairs = html.match(/class="source-pair two"/g) ?? [];
    expect(pairs).toHaveLength(6);
    expect(html).toContain("kickoff-notes.pdf");
    expect(html).toContain("client-summary.docx");
  });

  it("approves G1 and the gate panel shows who approved it", async () => {
    await until("G1 to become decidable", () => g1()?.canDecide === true);
    expect(g1Row()).toMatch(/<button[^>]*>Approve<\/button>/);
    expect(g1Row()).not.toMatch(/<button[^>]*disabled[^>]*>Approve<\/button>/);

    expect(await store.getState().decide(g1()!, "approve")).toBe(true);
    await until("gate.changed to update the gate panel", () => g1()?.status === "approved");
    const html = g1Row();
    expect(html).toContain('<span class="chip ok">approved</span>');
    expect(html).toContain("by human:lead");
    expect(html).not.toContain("Approve</button>");
  });
});
