// The graph stage (ui.md graph panel): one react-force-graph-2d canvas, always dark. A layout is a
// set of d3 forces; switching it swaps the forces, reheats for 1.5 seconds, then freezes. The path
// highlighter lights the path a view returned and fades the rest to 15%. Hover shows a node's
// label, title and provenance and lights its neighbours; the legend hides a group; a node a fresh
// node.written event names pulses. Browser only: GraphPanel
// loads this module after mount, so server-side tests never import the canvas library.
import { forceRadial, forceX, forceY } from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import type { GraphView } from "@agencymem/contracts";
import {
  FLOW_COLUMNS,
  FLOW_NAMES,
  GROUP_COLOR,
  STAGE,
  fixedSize,
  flowColumn,
  hops,
  linkKey,
  nodeSize,
  provenance,
  shapeOf,
} from "./layout";

export type Layout = "Network" | "Flow" | "Orbit";

type Base = GraphView["nodes"][number] & {
  deg: number;
  col: number;
  flowX: number;
  flowY: number;
  hop: number | undefined;
};
type N = NodeObject<Base>;
type L = LinkObject<Base, GraphView["links"][number] & { key: string }>;

const COL_W = 140;
const ROW_H = 26;
const RING = 140;

const rgba = (hex: string, a: number) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};
function colorOf(n: Base): string {
  if (n.label === "Defect" || n.state === "failing") return STAGE.danger;
  if (n.state === "ended") return STAGE.muted;
  return GROUP_COLOR[n.group] ?? STAGE.muted;
}
const radiusOf = (n: Base) => (fixedSize(n.label) ?? nodeSize(n.deg)) * 0.6;
const endOf = (end: L["source"]) => (typeof end === "object" ? (end as N) : null);

/** How long a written node pulses (ms). The ring only moves while the engine draws frames, which
 * the event's graph reload starts. */
const PULSE_MS = 3000;

/** The hover card: a DOM element built with textContent, so no node text is read as HTML. */
function tooltip(n: Base, graph: GraphView): HTMLElement {
  const el = (tag: string, cls: string, text = "") => {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };
  const box = el("div", "tip");
  const label = el("div", "tip-label", n.label);
  label.style.color = colorOf(n);
  box.append(label, el("div", "tip-title", n.title));
  const chain = provenance(graph, n.id);
  if (chain.length > 1) {
    const path = el("div", "tip-path");
    for (const c of chain) path.append(el("span", "", `${c.label} ${c.title.slice(0, 28)}`));
    box.append(path);
  }
  box.append(el("div", "tip-meta", `${n.id}${n.state ? ` · ${n.state}` : ""} · ${n.deg} links`));
  return box;
}

function drawShape(ctx: CanvasRenderingContext2D, n: N, r: number, color: string) {
  const x = n.x ?? 0;
  const y = n.y ?? 0;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (n.state === "ended") {
    ctx.setLineDash([2, 2]); // an ended fact is grey and dashed
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  switch (shapeOf(n.label)) {
    case "ring":
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      return;
    case "diamond":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      break;
    case "square":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      break;
    case "triangle":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      break;
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
  ctx.closePath();
  ctx.fill();
  if (n.label === "Task") {
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, 2 * Math.PI);
    ctx.stroke();
  }
  if (n.state === "rework") {
    ctx.strokeStyle = rgba(STAGE.warn, 0.8); // the amber halo of a Rework card
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

export default function Canvas(props: {
  graph: GraphView;
  lit: { nodes: Set<string>; links: Set<string> };
  layout: Layout;
  focus: string | null;
  /** Impact runs against the edges (from the fact to what derives from it): particles follow it. */
  reverse: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  height?: number;
  /** Node id to the time a node.written event named it. */
  pulse?: Map<string, number>;
}) {
  const { lit, layout, focus, reverse, pulse } = props;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const groups = useMemo(
    () => [...new Set(props.graph.nodes.map((n) => n.group))].sort(),
    [props.graph],
  );
  // The legend hides whole groups; what stays keeps its place.
  const graph = useMemo(() => {
    if (hidden.size === 0) return props.graph;
    const nodes = props.graph.nodes.filter((n) => !hidden.has(n.group));
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      links: props.graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)),
    };
  }, [props.graph, hidden]);
  const ref = useRef<ForceGraphMethods<Base, L> | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<string | null>(null);
  const prev = useRef(new Map<string, N>());
  const linkStrength = useRef<unknown>(null);
  const lastClick = useRef({ id: "", at: 0 });
  const labels = useRef<[number, number, number, number][]>([]);
  // The layout the forces were last set for: only a layout switch reheats and re-fits the camera.
  const shaped = useRef<Layout | null>(null);
  const fit = useRef(true);
  const hasPath = lit.nodes.size > 0;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A reload keeps every node where it was (x/y carried by id); a new node enters at its place.
  const data = useMemo(() => {
    const deg = new Map<string, number>();
    for (const l of graph.links) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
    }
    const ring = focus ? hops(graph, focus) : new Map<string, number>();
    const columns = new Map<number, typeof graph.nodes>();
    for (const n of graph.nodes) {
      const c = flowColumn(n.label);
      columns.set(c, [...(columns.get(c) ?? []), n]);
    }
    const row = new Map<string, number>();
    for (const list of columns.values()) {
      const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title));
      sorted.forEach((n, i) => row.set(n.id, (i - (sorted.length - 1) / 2) * ROW_H));
    }
    const nodes: N[] = graph.nodes.map((n) => {
      const old = prev.current.get(n.id);
      const col = flowColumn(n.label);
      return {
        ...n,
        deg: deg.get(n.id) ?? 0,
        col,
        flowX: (col - FLOW_COLUMNS / 2) * COL_W,
        flowY: row.get(n.id) ?? 0,
        hop: ring.get(n.id),
        x: old?.x,
        y: old?.y,
        vx: old?.vx,
        vy: old?.vy,
      };
    });
    prev.current = new Map(nodes.map((n) => [n.id, n]));
    const links: L[] = graph.links.map((l) => ({
      ...l,
      key: linkKey(l),
      ...(reverse ? { source: l.target, target: l.source } : {}),
    }));
    return { nodes, links };
  }, [graph, focus, reverse]);

  const ring1 = data.nodes.filter((n) => n.hop === 1).length;
  // The hovered node and its neighbours stay bright; the rest fade (when no path is lit).
  const near = useMemo(() => {
    if (!hover) return null;
    const out = new Set([hover]);
    for (const l of graph.links) {
      if (l.source === hover) out.add(l.target);
      if (l.target === hover) out.add(l.source);
    }
    return out;
  }, [graph, hover]);

  useEffect(() => {
    const fg = ref.current;
    if (!fg) return;
    const link = fg.d3Force("link");
    linkStrength.current ??= link?.strength?.();
    fg.d3Force("x", null);
    fg.d3Force("y", null);
    fg.d3Force("radial", null);
    for (const n of data.nodes) {
      n.fx = undefined;
      n.fy = undefined;
    }
    if (layout === "Flow") {
      fg.d3Force("x", forceX<N>((n) => n.flowX).strength(1) as never);
      fg.d3Force("y", forceY<N>((n) => n.flowY).strength(0.6) as never);
      link?.strength?.(0);
    } else if (layout === "Orbit") {
      fg.d3Force("radial", forceRadial<N>((n) => RING * (n.hop ?? 4)).strength(1) as never);
      const center = data.nodes.find((n) => n.id === focus);
      if (center) {
        center.fx = 0;
        center.fy = 0;
      }
      link?.strength?.(0.02);
    } else {
      link?.strength?.(linkStrength.current);
    }
    // New data restarts the engine by itself, from the positions carried over.
    if (shaped.current !== layout) {
      shaped.current = layout;
      fit.current = true;
      fg.d3ReheatSimulation();
    }
  }, [layout, data, focus]);

  const showLabel = (n: N) =>
    n.id === focus ||
    n.id === hover ||
    (hasPath && lit.nodes.has(n.id)) ||
    (layout === "Orbit" && n.hop === 1 && ring1 <= 24);
  const linkLit = (l: L) => lit.links.has(l.key);
  const ringLink = (l: L) =>
    layout === "Orbit" && (endOf(l.source)?.id === focus || endOf(l.target)?.id === focus);

  return (
    <div ref={box} className="graph-stage">
      <ForceGraph2D<Base, L>
        ref={ref}
        width={width}
        height={props.height ?? 600}
        backgroundColor={STAGE.bg}
        graphData={data}
        cooldownTime={1500}
        onEngineStop={() => {
          if (!fit.current) return;
          fit.current = false;
          ref.current?.zoomToFit(400, 40);
        }}
        onRenderFramePre={() => {
          labels.current = [];
        }}
        nodeCanvasObject={(n, ctx, scale) => {
          const r = radiusOf(n);
          const on = lit.nodes.has(n.id);
          const color = colorOf(n);
          ctx.globalAlpha = hasPath && !on ? 0.15 : !hasPath && near && !near.has(n.id) ? 0.2 : 1;
          const at = pulse?.get(n.id);
          const age = at === undefined ? PULSE_MS : Date.now() - at;
          if (age < PULSE_MS) {
            // A real write just named this node: an expanding ring that fades out.
            const t = age / PULSE_MS;
            ctx.strokeStyle = rgba(STAGE.accent, 1 - t);
            ctx.lineWidth = 2 / scale;
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, r + 4 + t * 18, 0, 2 * Math.PI);
            ctx.stroke();
          }
          if (on) {
            ctx.shadowColor = color; // the glow of the highlighted path
            ctx.shadowBlur = 16;
          }
          drawShape(ctx, n, r, color);
          ctx.shadowBlur = 0;
          if (showLabel(n)) {
            const size = 12 / scale;
            ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
            const text = n.title.length > 40 ? `${n.title.slice(0, 39)}…` : n.title;
            const w = ctx.measureText(text).width;
            const x = (n.x ?? 0) - w / 2;
            const y = (n.y ?? 0) + r + size * 1.2;
            const clash = labels.current.some(
              ([bx, by, bw, bh]) => x < bx + bw && bx < x + w && y - size < by + bh && by < y,
            );
            if (!clash) {
              labels.current.push([x, y - size, w, size]);
              ctx.fillStyle = STAGE.label;
              ctx.fillText(text, x, y);
            }
          }
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, radiusOf(n) + 3, 0, 2 * Math.PI);
          ctx.fill();
        }}
        onRenderFramePost={(ctx, scale) => {
          if (layout !== "Flow") return;
          const size = 12 / scale;
          ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.fillStyle = STAGE.label;
          for (let c = 0; c <= FLOW_COLUMNS; c++) {
            const col = data.nodes.filter((n) => n.col === c);
            if (col.length === 0) continue;
            const top = Math.min(...col.map((n) => n.y ?? 0)) - 30;
            const text = `${FLOW_NAMES[c]} · ${col.length}`;
            ctx.fillText(
              text,
              (c - FLOW_COLUMNS / 2) * COL_W - ctx.measureText(text).width / 2,
              top,
            );
          }
        }}
        linkColor={(l) => {
          const from = endOf(l.source);
          const touches =
            !!near && near.has(endOf(l.source)?.id ?? "") && near.has(endOf(l.target)?.id ?? "");
          const a = linkLit(l) || (touches && !hasPath) ? 0.9 : hasPath || near ? 0.04 : 0.12;
          return rgba(from ? colorOf(from) : STAGE.label, a);
        }}
        linkWidth={(l) => (linkLit(l) ? 2 : 1)}
        linkDirectionalParticles={(l) => (linkLit(l) ? 3 : 0)}
        linkDirectionalParticleWidth={3}
        linkDirectionalParticleColor={() => STAGE.accent}
        linkCanvasObjectMode={() => "after"}
        linkCanvasObject={(l, ctx, scale) => {
          if (!linkLit(l) && !(ringLink(l) && ring1 <= 24)) return;
          const a = endOf(l.source);
          const b = endOf(l.target);
          if (!a || !b) return;
          const size = 10 / scale;
          const text = `${l.type.toLowerCase().replaceAll("_", " ")}${l.label ? ` · ${l.label}` : ""}`;
          ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.fillStyle = STAGE.muted;
          const w = ctx.measureText(text).width;
          ctx.fillText(text, ((a.x ?? 0) + (b.x ?? 0)) / 2 - w / 2, ((a.y ?? 0) + (b.y ?? 0)) / 2);
        }}
        // float-tooltip takes an HTMLElement too; the typings list only string and React elements.
        nodeLabel={(n) => tooltip(n, props.graph) as unknown as string}
        onNodeHover={(n) => setHover(n?.id ?? null)}
        onNodeClick={(n) => {
          // ponytail: force-graph has no double-click event; two clicks within 300 ms count as one.
          const now = Date.now();
          const twice = lastClick.current.id === n.id && now - lastClick.current.at < 300;
          lastClick.current = { id: n.id, at: now };
          if (twice) props.onFocus(n.id);
          else props.onSelect(n.id);
        }}
      />
      <div className="legend" role="group" aria-label="Groups">
        {groups.map((g) => (
          <button
            type="button"
            key={g}
            aria-pressed={!hidden.has(g)}
            onClick={() => {
              const next = new Set(hidden);
              if (!next.delete(g)) next.add(g);
              setHidden(next);
            }}
          >
            <span className="swatch" style={{ background: GROUP_COLOR[g] ?? STAGE.muted }} />
            {g}
          </button>
        ))}
      </div>
    </div>
  );
}
