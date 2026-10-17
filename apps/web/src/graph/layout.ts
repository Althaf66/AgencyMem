// The graph stage's rules (ui.md graph panel) as plain functions: one path highlighter for every
// view, the Flow columns, the Orbit hops, node size, shape and colour, and the delivery filter.
import type { GraphView } from "@agencymem/contracts";

type Link = GraphView["links"][number];

export const linkKey = (l: Pick<Link, "source" | "type" | "target">) =>
  `${l.source}|${l.type}|${l.target}`;

/** The one path highlighter: the nodes and links a why, impact or backtrace view returned. */
export function highlight(path: GraphView | null): { nodes: Set<string>; links: Set<string> } {
  return {
    nodes: new Set(path?.nodes.map((n) => n.id)),
    links: new Set(path?.links.map(linkKey)),
  };
}

/** Two views as one, each node and link once (the later view's copy wins). */
export function merge(a: GraphView, b: GraphView): GraphView {
  const nodes = new Map([...a.nodes, ...b.nodes].map((n) => [n.id, n]));
  const links = new Map([...a.links, ...b.links].map((l) => [linkKey(l), l]));
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

/** Hidden until the "Delivery details" toggle is on. */
const DELIVERY_DETAILS = ["Gate", "WorkItem", "Run", "Deployment", "ReadinessReport"];

/** The nodes to draw, and the links between them. `keep` (the focus and the path) always shows. */
export function visible(
  view: GraphView,
  opts: { delivery: boolean; keep: Set<string> },
): GraphView {
  const nodes = view.nodes.filter(
    (n) => opts.delivery || opts.keep.has(n.id) || !DELIVERY_DETAILS.includes(n.label),
  );
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, links: view.links.filter((l) => ids.has(l.source) && ids.has(l.target)) };
}

/** Flow: one column per label group, from the client's words to the code. */
const FLOW = [
  ["Document"],
  ["Episode"],
  ["Entity", "Fact"],
  ["Contradiction", "Question", "Assumption"],
  ["Requirement", "Feature", "Estimate", "ChangeRequest"],
  ["Decision", "Component", "Screen", "DataEntity", "Endpoint", "Risk", "DocSection"],
  ["Task"],
  ["AcceptanceCriterion", "TestCase", "TestRun"],
  ["CodeChange"],
  ["Defect"],
];
export const FLOW_COLUMNS = FLOW.length;
/** Column labels, upper case as the stage draws them; the last one holds labels outside the trace. */
export const FLOW_NAMES = [
  "DOCUMENTS",
  "EPISODES",
  "FACTS",
  "QUESTIONS",
  "REQUIREMENTS",
  "DESIGN",
  "TASKS",
  "TESTS",
  "CODE",
  "DEFECTS",
  "OTHER",
];
/** A label's Flow column; labels outside the trace (gates, work items) go after the last one. */
export function flowColumn(label: string): number {
  const i = FLOW.findIndex((col) => col.includes(label));
  return i === -1 ? FLOW.length : i;
}

/** Orbit: hops from the focus, following links either way. Unreached nodes are absent. */
export function hops(view: GraphView, focus: string): Map<string, number> {
  const next = new Map<string, string[]>();
  for (const l of view.links) {
    next.set(l.source, [...(next.get(l.source) ?? []), l.target]);
    next.set(l.target, [...(next.get(l.target) ?? []), l.source]);
  }
  const out = new Map([[focus, 0]]);
  const queue = [focus];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const o of next.get(id) ?? []) {
      if (out.has(o)) continue;
      out.set(o, out.get(id)! + 1);
      queue.push(o);
    }
  }
  return out;
}

/** `4 + 2 × log2(1 + degree)` px, clamped to 4 to 16. */
export const nodeSize = (degree: number) =>
  Math.min(16, Math.max(4, 4 + 2 * Math.log2(1 + degree)));

/** Group colours, dark values (ui.md section 3): the graph stage is always dark. */
export const GROUP_COLOR: Record<string, string> = {
  Sources: "#94a3b8",
  Knowledge: "#22d3ee",
  Product: "#a78bfa",
  Design: "#fb923c",
  Delivery: "#4ade80",
};
export const STAGE = {
  bg: "#05060a",
  read: "#22d3ee",
  label: "#e8e9ec",
  muted: "#6b6f76",
  accent: "#8b85ff",
  warn: "#f0a948",
  danger: "#ff7a6b",
};

export type Shape = "ring" | "dot" | "diamond" | "circle" | "square" | "task" | "triangle";
const SHAPES: [Shape, string[]][] = [
  ["ring", ["Document", "Episode"]],
  ["dot", ["Entity", "Fact"]],
  ["diamond", ["Contradiction", "Question", "Assumption", "Defect"]],
  ["square", ["Decision", "Component", "Screen", "DataEntity", "Endpoint", "Risk", "DocSection"]],
  ["square", ["AcceptanceCriterion", "TestCase", "TestRun"]],
  ["task", ["Task"]],
  ["triangle", ["CodeChange"]],
];
/** Shape adds the label, so a node reads without colour. */
export const shapeOf = (label: string): Shape =>
  SHAPES.find(([, labels]) => labels.includes(label))?.[0] ?? "circle";

/** Fixed sizes (ui.md table); the other labels size by degree. */
export function fixedSize(label: string): number | null {
  if (label === "Document") return 12;
  if (
    [
      "Episode",
      "Entity",
      "Fact",
      "AcceptanceCriterion",
      "TestCase",
      "TestRun",
      "CodeChange",
    ].includes(label)
  )
    return 4;
  if (shapeOf(label) === "diamond" || shapeOf(label) === "square") return 7;
  return null;
}

/** The links that point from a node to what it came from, most telling first. */
const UPSTREAM = [
  "IMPLEMENTS",
  "FOR_TASK",
  "CAUSED_BY",
  "FIXES",
  "RUNS",
  "VERIFIES",
  "OF",
  "FOR",
  "HAS_REQUIREMENT",
  "RENDERS",
  "DERIVED_FROM",
  "RAISED_ON",
  "BETWEEN",
  "ANSWERS",
  "FROM",
  "REPORTED_IN",
  "SOURCED_FROM",
  "PART_OF",
];

/** A node's provenance among the drawn nodes: its chain back to the source, the source first and
 * the node last. ponytail: follows one upstream link per hop (the first in UPSTREAM order); the Why
 * view shows the full path. */
export function provenance(view: GraphView, nodeId: string, max = 7): GraphView["nodes"] {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const chain: GraphView["nodes"] = [];
  for (let id: string | undefined = nodeId; id && chain.length < max;) {
    const node = byId.get(id);
    if (!node || chain.includes(node)) break;
    chain.unshift(node);
    const from = view.links.filter((l) => l.source === id && UPSTREAM.includes(l.type));
    from.sort((a, b) => UPSTREAM.indexOf(a.type) - UPSTREAM.indexOf(b.type));
    id = from[0]?.target;
  }
  return chain;
}

/** The distinct times nodes were written, oldest first: the time slider's steps. */
export const writeTimes = (view: GraphView): number[] =>
  [...new Set(view.nodes.flatMap((n) => (n.createdAt === undefined ? [] : [n.createdAt])))].sort(
    (a, b) => a - b,
  );

/** The graph as it stood at `until`: nodes written by then (and `keep`), and links among them.
 * A node with no write time always shows. */
export function asOf(view: GraphView, until: number | null, keep: Set<string>): GraphView {
  if (until === null) return view;
  const nodes = view.nodes.filter(
    (n) => n.createdAt === undefined || n.createdAt <= until || keep.has(n.id),
  );
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, links: view.links.filter((l) => ids.has(l.source) && ids.has(l.target)) };
}
