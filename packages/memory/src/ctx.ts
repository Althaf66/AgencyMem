import type { FalkorDB } from "@agencymem/graph";

/** Where a memory function writes: the client graph the router picked, and the project. */
export type Ctx = { db: FalkorDB; graph: string; projectId: string };
