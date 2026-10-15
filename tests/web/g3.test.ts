// Task 3.5, Done when: planning starts only after G3 is approved. The web client's own api, store
// and live socket run against the real gateway (set A to G2 approved on recorded replies). G3 stays
// blocked while the Architect works; a rejection sends the documents back for a revision (T13) and
// leaves the project in design; only the approval opens the planner item and moves to planning
// (T14).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectInfo } from "@agencymem/contracts";
import { architect } from "../../apps/runner/src/agents/architect/agent";
import { discovery } from "../../apps/runner/src/agents/discovery/agent";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { proposal } from "../../apps/runner/src/agents/proposal/agent";
import { createApi } from "../../apps/web/src/api";
import { DocsView } from "../../apps/web/src/docs/Docs";
import { connectLive } from "../../apps/web/src/live";
import { createAppStore, type AppStore } from "../../apps/web/src/store";
import { OWN_A, startHarness, type Harness } from "../agents/harness";

// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");
const REASON = "The plan misses the admin screens.";

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

const g3 = () => store.getState().gates.data?.find((g) => g.key === "G3");
const stage = () => store.getState().project.data?.stage;
/** The project's WorkItems of one kind: status and note. */
const items = (kind: string) =>
  h.rows(
    project.id,
    q(
      "MATCH",
      `(w:WorkItem {kind: '${kind}'})`,
      "RETURN",
      "w.status, w.note",
      "ORDER BY",
      "w.createdAt",
    ),
  );

beforeAll(async () => {
  h = await startHarness();
  project = await h.project("A");
  await h.run(intake, "intake-A.json", project.id, 3);
  await h.run(discovery, "discovery-A.json", project.id, 1);
  await h.answerAndApprove(project.id, OWN_A);
  await h.run(intake, "intake-answer-A.json", project.id, 15);
  await h.run(proposal, "proposal-A.json", project.id, 1);
  await h.decide(project.id, "G2", "approve", `persona:${project.id}`);

  const api = createApi({
    base: h.base,
    headers: { "X-AM-Token": "ui-t" },
    actor: () => "human:lead",
  });
  store = createAppStore(api);
  await store.getState().open(project.id);
  stopLive = connectLive(store, `${h.base.replace("http", "ws")}/ws?token=ui-t`);
  await until("the live socket", () => store.getState().connection === "live");
}, 120_000); // the whole chain from upload to G2
afterAll(async () => {
  stopLive?.();
  await h.stop();
});

describe("Done when: planning starts only after G3 is approved", () => {
  it("keeps G3 blocked while the Architect works, and refuses an approval", async () => {
    expect(stage()).toBe("design");
    expect(g3()).toMatchObject({
      status: "waiting",
      canDecide: false,
      blockedBy: ["Architect still working"],
    });
    expect(await store.getState().decide(g3()!, "approve")).toBe(false);
    expect(store.getState().toasts.map((t) => t.text)).toContain("G3 cannot be decided yet.");
    expect(await items("planner")).toEqual([]);
  });

  it("renders the three documents, each opening with its summary, and G3 becomes decidable", async () => {
    await h.run(architect, "architect-A.json", project.id, 1);
    await until("G3 to become decidable", () => g3()?.canDecide === true);
    await until("the documents", () => (store.getState().docs.data?.plan.sections.length ?? 0) > 0);

    const docs = store.getState().docs.data!;
    for (const doc of ["prd", "tdd", "plan"] as const) {
      expect(docs[doc].sections[0]).toMatchObject({ order: 0, title: "Summary" });
      const html = renderToString(createElement(DocsView, { s: store.getState(), doc }));
      expect(html).toContain("Summary");
      expect(html).toMatch(/<button[^>]*>Approve<\/button>/);
      expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Approve<\/button>/);
    }
  });

  it("sends a rejected G3 back to the Architect with the reason, still in design (T13)", async () => {
    expect(await store.getState().decide(g3()!, "reject", REASON)).toBe(true);
    await until("G3 rejected", () => g3()?.status === "rejected");
    expect(await items("architect_revise")).toEqual([["open", REASON]]);
    expect(await items("planner")).toEqual([]);
    expect(stage()).toBe("design");

    await h.run(architect, "architect-chat-A.json", project.id, 1);
    await until("G3 back to waiting", () => g3()?.status === "waiting" && g3()!.canDecide);
    expect(await items("architect_revise")).toEqual([["done", REASON]]);
    expect(await items("planner")).toEqual([]);
    expect(stage()).toBe("design");
  });

  it("starts planning when G3 is approved (T14), and the gate shows who approved it", async () => {
    expect(await store.getState().decide(g3()!, "approve")).toBe(true);
    await until("G3 approved", () => g3()?.status === "approved");
    await until("the stage stepper to show planning", () => stage() === "planning");
    expect(await items("planner")).toEqual([["open", null]]);

    const html = renderToString(createElement(DocsView, { s: store.getState(), doc: "prd" }));
    expect(html).toContain('<span class="chip ok">approved</span>');
    expect(html).toContain("by human:lead");
    expect(html).not.toContain("Approve</button>");
  });
});
