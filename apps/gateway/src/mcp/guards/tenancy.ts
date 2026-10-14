import { reject, type GuardResult } from "./run";

/**
 * Rejects a missing or unknown project, and any node that belongs to another project. A node that
 * does not exist at all is NOT_FOUND, which the tool reports; it is not a guard rejection.
 */
export function tenancy(input: {
  projectId: string | undefined;
  known: boolean;
  nodes?: { id: string; projectId: string | null }[];
}): GuardResult | null {
  if (!input.projectId) {
    return reject("tenancy", "PROJECT_MISSING", "The request names no project.");
  }
  if (!input.known) {
    return reject("tenancy", "PROJECT_UNKNOWN", `Project ${input.projectId} does not exist.`);
  }
  const foreign = input.nodes?.find((node) => node.projectId !== input.projectId);
  if (foreign) {
    return reject("tenancy", "FOREIGN_NODE", `Node ${foreign.id} belongs to another project.`, {
      nodeId: foreign.id,
    });
  }
  return null;
}
