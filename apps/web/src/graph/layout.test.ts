// The graph panel's pure parts (ui.md graph panel): the path highlighter, Flow columns, Orbit hops,
// node size and the delivery filter.
import { describe, expect, it } from "vitest";
import type { GraphView } from "@agencymem/contracts";
import {
  flowColumn,
  highlight,
  hops,
  linkKey,
  merge,
  nodeSize,
  asOf,
  provenance,
  visible,
  writeTimes,
} from "./layout";

const node = (id: string, label: string) => ({
  id,
  label,
  title: id,
  group: "Delivery",
  state: null,
});
const link = (source: string, type: string, target: string) => ({
  source,
  target,
  type,
  label: null,
});
// A card's why path, plus a second card and a work item that are not on it.
const path: GraphView = {
  nodes: [node("T", "Task"), node("R", "Requirement"), node("F", "Fact"), node("E", "Episode")],
  links: [
    link("T", "IMPLEMENTS", "R"),
    link("R", "DERIVED_FROM", "F"),
    link("F", "SOURCED_FROM", "E"),
  ],
};
const all: GraphView = merge(
  {
    nodes: [node("T2", "Task"), node("W", "WorkItem"), node("D", "Document")],
    links: [link("T2", "IMPLEMENTS", "R"), link("E", "PART_OF", "D")],
  },
  path,
);

describe("graph layout", () => {
  it("highlights exactly the path from the card to the client's words", () => {
    const lit = highlight(path);
    expect([...lit.nodes].sort()).toEqual(["E", "F", "R", "T"]);
    expect(lit.links.has(linkKey(link("R", "DERIVED_FROM", "F")))).toBe(true);
    expect(lit.links.has(linkKey(link("T2", "IMPLEMENTS", "R")))).toBe(false);
    expect(highlight(null).nodes.size).toBe(0);
  });

  it("merges views once per node and link", () => {
    expect(all.nodes.map((n) => n.id).sort()).toEqual(["D", "E", "F", "R", "T", "T2", "W"]);
    expect(merge(all, path).links).toHaveLength(all.links.length);
  });

  it("puts Flow columns in trace order, from Document to CodeChange", () => {
    const order = [
      "Document",
      "Episode",
      "Fact",
      "Question",
      "Requirement",
      "Endpoint",
      "Task",
      "CodeChange",
    ];
    const cols = order.map(flowColumn);
    expect(cols).toEqual([...cols].sort((a, b) => a - b));
    expect(flowColumn("Contradiction")).toBe(flowColumn("Question"));
  });

  it("counts Orbit hops from the focus either way along the links", () => {
    const h = hops(all, "R");
    expect(h.get("R")).toBe(0);
    expect(h.get("T")).toBe(1);
    expect(h.get("T2")).toBe(1);
    expect(h.get("E")).toBe(2);
    expect(h.get("D")).toBe(3);
    expect(h.has("W")).toBe(false);
  });

  it("sizes a node by degree within 4 to 16 px", () => {
    expect(nodeSize(0)).toBe(4);
    expect(nodeSize(1)).toBe(6);
    expect(nodeSize(10_000)).toBe(16);
  });

  it("hides delivery details unless asked, but never a node on the path", () => {
    const hidden = visible(all, { delivery: false, keep: new Set() });
    expect(hidden.nodes.some((n) => n.id === "W")).toBe(false);
    expect(visible(all, { delivery: true, keep: new Set() }).nodes).toHaveLength(7);
    expect(visible(all, { delivery: false, keep: new Set(["W"]) }).nodes).toHaveLength(7);
  });
});

describe("provenance", () => {
  it("walks a code change back to the document its card came from", () => {
    const view: GraphView = {
      nodes: [
        node("D", "Document"),
        node("E", "Episode"),
        node("F", "Fact"),
        node("R", "Requirement"),
        node("T", "Task"),
        node("C", "CodeChange"),
        node("K", "AcceptanceCriterion"),
      ],
      links: [
        link("E", "PART_OF", "D"),
        link("F", "SOURCED_FROM", "E"),
        link("R", "DERIVED_FROM", "F"),
        link("T", "HAS_CRITERION", "K"), // not upstream
        link("T", "IMPLEMENTS", "R"),
        link("C", "FOR_TASK", "T"),
      ],
    };
    expect(provenance(view, "C").map((n) => n.id)).toEqual(["D", "E", "F", "R", "T", "C"]);
    expect(provenance(view, "D").map((n) => n.id)).toEqual(["D"]);
    expect(provenance(view, "missing")).toEqual([]);
  });

  it("stops on a cycle", () => {
    const view: GraphView = {
      nodes: [node("A", "Fact"), node("B", "Fact")],
      links: [link("A", "DERIVED_FROM", "B"), link("B", "DERIVED_FROM", "A")],
    };
    expect(provenance(view, "A").map((n) => n.id)).toEqual(["B", "A"]);
  });
});

describe("time slider", () => {
  it("shows the graph as it stood at a time, keeping lit nodes and untimed ones", () => {
    const at = (id: string, createdAt?: number) => ({ ...node(id, "Fact"), createdAt });
    const view: GraphView = {
      nodes: [at("A", 1), at("B", 2), at("C", 3), at("D")],
      links: [link("B", "DERIVED_FROM", "A"), link("C", "DERIVED_FROM", "B")],
    };
    expect(writeTimes(view)).toEqual([1, 2, 3]);
    const two = asOf(view, 2, new Set());
    expect(two.nodes.map((n) => n.id)).toEqual(["A", "B", "D"]);
    expect(two.links).toHaveLength(1);
    expect(asOf(view, 1, new Set(["C"])).nodes.map((n) => n.id)).toEqual(["A", "C", "D"]);
    expect(asOf(view, null, new Set())).toBe(view);
  });
});
