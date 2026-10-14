// Import rules from AGENTS.md (CI enforces them) and the technical design "Import rules".
// Rules cover workspace code only; third-party npm imports are free.

const PKG = (name) => `packages/${name}`;

// Workspace code each folder may import (besides itself). Technical design: apps table and
// import rules; implementation plan: dependency order.
const ALLOWED = {
  "apps/gateway": ["contracts", "graph", "memory", "ingest"],
  "apps/runner": ["contracts", "llm"],
  "apps/web": ["contracts"],
  "apps/simulator": ["contracts", "llm"],
  "packages/contracts": [],
  "packages/graph": ["contracts"],
  "packages/memory": ["contracts", "graph"],
  "packages/llm": ["contracts"],
  "packages/ingest": ["contracts"],
};

const NAMES = {
  "apps/runner": "runner-only-contracts-llm",
  "apps/web": "web-only-contracts",
  "apps/simulator": "simulator-only-contracts-llm",
  "apps/gateway": "gateway-imports-allowed-packages",
  "packages/contracts": "contracts-imports-no-workspace-code",
  "packages/graph": "graph-imports-contracts-only",
  "packages/memory": "memory-imports-contracts-graph-only",
  "packages/llm": "llm-imports-contracts-only",
  "packages/ingest": "ingest-imports-contracts-only",
};

const importRules = Object.entries(ALLOWED).map(([dir, allowed]) => ({
  name: NAMES[dir],
  severity: "error",
  comment: `${dir} may import workspace code only from itself and: ${allowed.join(", ") || "nothing"}.`,
  from: { path: `^${dir}/` },
  to: {
    path: "^(apps|packages)/",
    pathNot: [`^${dir}/`, ...allowed.map((name) => `^${PKG(name)}/`)],
  },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...importRules,
    {
      // Rule 3. Only packages/memory sends write Cypher, so only it may import the write entry of
      // packages/graph (`@agencymem/graph/write`, packages/graph/src/write.ts).
      name: "write-cypher-only-in-memory",
      severity: "error",
      comment: "Only packages/memory may import the write entry of packages/graph.",
      from: { pathNot: "^packages/(memory|graph)/" },
      to: { path: "^packages/graph/src/write" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)dist/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
