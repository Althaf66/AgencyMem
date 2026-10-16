// `pnpm sim:run` runs SIM_PROJECTS demo projects in a row (sets A, B, C, at most 3), each to closed.
// `pnpm sim:run --set A --live-demo` starts one project (projectIndex 3) and stops before G5, with
// no change requests (stage-machine.md section 9). Hidden numbers go to sim-state/, never the graph.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { FixtureSet, loadConfig } from "@agencymem/contracts";
import { createChat, createModelClient } from "@agencymem/llm";
import { drawSim } from "./actual-hours";
import { runProject } from "./persona";

const ROOT = join(import.meta.dirname, "../../..");
const FIXTURES = join(ROOT, "apps/simulator/fixtures");
const STATE = join(ROOT, "sim-state");
const SETS = FixtureSet.options;
const LIVE_DEMO_INDEX = 3; // fixtures.md section 5

async function main() {
  const { values } = parseArgs({
    options: { set: { type: "string" }, "live-demo": { type: "boolean" } },
  });
  const cfg = loadConfig(process.env, "simulator");
  const liveDemo = values["live-demo"] ?? false;
  const only = values.set === undefined ? undefined : FixtureSet.parse(values.set);
  const runs = liveDemo
    ? [{ set: only ?? "A", projectIndex: LIVE_DEMO_INDEX }]
    : (only ? [only] : SETS.slice(0, Math.min(cfg.SIM_PROJECTS!, 3))).map((set) => ({
        set,
        projectIndex: SETS.indexOf(set),
      }));

  const llm = createModelClient({ chat: createChat(cfg) });
  const gw = { url: cfg.GATEWAY_URL!, token: cfg.AM_UI_TOKEN! };
  await mkdir(STATE, { recursive: true });

  for (const { set, projectIndex } of runs) {
    const sim = drawSim(cfg.SIM_SEED!, projectIndex);
    const state = {
      set,
      projectIndex,
      seed: cfg.SIM_SEED!,
      ...sim,
      crsSent: 0,
      actuals: null as unknown,
    };
    const id = await runProject({
      gw,
      llm,
      fixtures: FIXTURES,
      set,
      sim,
      liveDemo,
      save: (projectId, patch) => {
        Object.assign(state, patch);
        return writeFile(join(STATE, `${projectId}.json`), JSON.stringify(state, null, 2));
      },
    });
    console.log(`[${set}] done: ${id}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
