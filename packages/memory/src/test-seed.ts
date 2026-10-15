// Test seed only (task 3.3): the design nodes, sections and cards a change-request test needs,
// until write_design (3.4) and write_cards (3.6) exist. Two queries; a test seed needs no atomicity.
import type { Actor, Column, Doc } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

export async function seedBoardForTest(
  ctx: Ctx,
  input: {
    endpoints: { key: string; requirementKey: string }[];
    sections: { doc: Doc; order: number; requirementKey: string }[];
    tasks: {
      key: string;
      requirementKey: string;
      uses: string | null;
      column: Column;
      leaseOwner: string | null;
      leaseUntil: number | null;
    }[];
    createdBy: Actor;
    now: number;
  },
): Promise<{ tasks: { key: string; id: string }[] }> {
  const common = { projectId: ctx.projectId, createdBy: input.createdBy, now: input.now };
  await writeQuery(ctx.db, ctx.graph, "write/test-seed-design", {
    ...common,
    endpoints: input.endpoints.map((e) => ({ ...e, id: ulid() })),
    sections: input.sections.map((s) => ({ ...s, id: ulid() })),
  });
  const tasks = await writeQuery<{ id: string; key: string }>(
    ctx.db,
    ctx.graph,
    "write/test-seed-tasks",
    { ...common, tasks: input.tasks.map((t, i) => ({ ...t, id: ulid(), order: (i + 1) * 10 })) },
  );
  return { tasks };
}
