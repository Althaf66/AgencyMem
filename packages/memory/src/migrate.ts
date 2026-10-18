// One-time migration for the removal of G5 and the maintenance phase (`pnpm migrate:scope-cut`):
// what the old flow left in the graphs, so the new contracts parse them. Safe to run again.
import { ReadinessCheck } from "@agencymem/contracts";
import { REGISTRY_GRAPH, readQuery, type FalkorDB } from "@agencymem/graph";
import { writeQuery } from "@agencymem/graph/write";
import { writeVersioned } from "./versioned";

export async function migrateScopeCut(
  db: FalkorDB,
): Promise<{ projects: number; removed: number; reports: number }> {
  const moved = await writeQuery(db, REGISTRY_GRAPH, "write/migrate-stage", {});
  const clients = await readQuery<{ clientId: string }>(db, REGISTRY_GRAPH, "read/projects", {});
  let removed = 0;
  let reports = 0;
  for (const graph of new Set(clients.map((c) => `client_${c.clientId}`))) {
    for (const step of ["write/migrate-fix-items", "write/migrate-scope-cut"]) {
      const [row] = await writeQuery<{ removed: number }>(db, graph, step, {});
      removed += row?.removed ?? 0;
    }
    const old = await readQuery<{ id: string; version: number; checks: string }>(
      db,
      graph,
      "read/migrate-readiness",
      {},
    );
    for (const r of old) {
      const checks = ReadinessCheck.array().parse(
        (JSON.parse(r.checks) as { name: string }[]).filter((c) => c.name !== "open_defects"),
      );
      // projectId is unused by a versioned write, which finds the node by id.
      await writeVersioned(
        { db, graph, projectId: "" },
        {
          id: r.id,
          version: r.version,
          props: { checks: JSON.stringify(checks), passed: checks.every((c) => c.passed) },
        },
      );
      reports++;
    }
  }
  return { projects: moved.length, removed, reports };
}
