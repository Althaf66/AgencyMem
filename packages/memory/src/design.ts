// Design nodes and document sections (write_design). One Cypher query per call.
import { text, type Actor, type DesignLabel, type Doc } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

export type DesignNodeWrite = {
  label: DesignLabel;
  key: string;
  name: string;
  body: string;
  method?: string;
  path?: string;
  requirementKeys: string[];
};
export type DocSectionWrite = {
  doc: Doc;
  order: number;
  title: string;
  body: string;
  renders: string[];
};

/**
 * Writes design version `baseVersion + 1`: design nodes MERGE on key, sections on (doc, order) with
 * stale cleared; what is left out stays. Id lists follow the input order. Null when `baseVersion`
 * is not the current design version, or a requirement or render key the write names is gone;
 * nothing changes then.
 */
export async function writeDesign(
  ctx: Ctx,
  input: {
    baseVersion: number;
    nodes: DesignNodeWrite[];
    sections: DocSectionWrite[];
    createdBy: Actor;
    now: number;
  },
): Promise<{
  designVersion: number;
  nodeIds: string[];
  sectionIds: string[];
  /** The versions of the written nodes and sections, in the same order. */
  nodeVersions: number[];
  sectionVersions: number[];
} | null> {
  const designVersion = input.baseVersion + 1;
  const rows = await writeQuery<{
    nodes: [string, string, number][];
    sections: [string, number, string, number][];
  }>(ctx.db, ctx.graph, "write/write-design", {
    projectId: ctx.projectId,
    baseVersion: input.baseVersion,
    designVersion,
    nodes: input.nodes.map((n) => ({
      ...n,
      id: ulid(),
      name: text(80).parse(n.name), // checked before it is written
      body: text(1500).parse(n.body),
      method: n.method ?? null,
      path: n.path ?? null,
      requirementKeys: [...new Set(n.requirementKeys)],
    })),
    sections: input.sections.map((s) => ({
      ...s,
      id: ulid(),
      title: text(80).parse(s.title),
      body: text(1500).parse(s.body),
      renders: [...new Set(s.renders)],
    })),
    createdBy: input.createdBy,
    now: input.now,
  });
  const row = rows[0];
  if (!row) return null;
  const nodes = new Map(row.nodes.map(([key, id, version]) => [key, { id, version }]));
  const sections = new Map(
    row.sections.map(([doc, order, id, version]) => [`${doc} ${order}`, { id, version }]),
  );
  const section = (s: DocSectionWrite) => sections.get(`${s.doc} ${s.order}`)!;
  return {
    designVersion,
    nodeIds: input.nodes.map((n) => nodes.get(n.key)!.id),
    sectionIds: input.sections.map((s) => section(s).id),
    nodeVersions: input.nodes.map((n) => nodes.get(n.key)!.version),
    sectionVersions: input.sections.map((s) => section(s).version),
  };
}
