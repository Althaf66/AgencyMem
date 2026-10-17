// The graph panel (ui.md graph panel): the layouts Network, Flow and Orbit (Clusters is cut, the
// first in the cut order), the views All, Why, Impact and Backtrace, the delivery-details toggle,
// the header with the focus, node count and query time, the lit path in words, and the node drawer.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { graphHash, type GraphViewName } from "../shell/router";
import type { AppState, AppStore, GraphData } from "../store";
import { SliceView } from "../ui";
import type { Layout, Pulse } from "./Canvas";
import { asOf, highlight, visible, writeTimes } from "./layout";
import { NodeDrawer } from "./NodeDrawer";

const Canvas = lazy(() => import("./Canvas"));

const LAYOUTS: Layout[] = ["Network", "Flow", "Orbit"];
const DEFAULT_LAYOUT: Record<GraphViewName, Layout> = {
  all: "Network",
  why: "Orbit",
  impact: "Flow",
  backtrace: "Flow",
  read: "Orbit",
};
const VIEWS: { view: GraphViewName; name: string; labels: string[] | null }[] = [
  { view: "all", name: "All", labels: null },
  { view: "why", name: "Why", labels: null },
  { view: "impact", name: "Impact", labels: ["Fact"] },
  { view: "backtrace", name: "Backtrace", labels: ["Defect"] },
  // What a work item or card read from the graph (its RECALLED edges).
  { view: "read", name: "Read", labels: ["WorkItem", "Task"] },
];

/** What the panel reads from the store: it re-renders on these, not on every event or toast. */
export type PanelState = Pick<AppState, "graph" | "projectId" | "node" | "loadGraph" | "feed">;

/** How far back a node.written event still pulses its node (ms). */
const PULSE_WINDOW = 3000;

/** The nodes recent events named: written (node.written) or read by an agent (context.read). */
function pulses(feed: AppState["feed"]): Map<string, Pulse> {
  const since = Date.now() - PULSE_WINDOW;
  const out = new Map<string, Pulse>();
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches)
    return out;
  for (const e of feed) {
    if (e.at < since) continue;
    if (e.type === "node.written") {
      for (const id of [e.data.id, ...(e.data.ids ?? [])]) out.set(id, { at: e.at, read: false });
    } else if (e.type === "context.read") {
      for (const id of e.data.ids) out.set(id, { at: e.at, read: true });
    }
  }
  return out;
}

export function GraphStage(props: {
  s: PanelState;
  data: GraphData;
  view: GraphViewName;
  focus: string | null;
  height?: number;
}) {
  const { s, data, view, focus } = props;
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT[view]);
  const [delivery, setDelivery] = useState(false);
  const [selected, setSelected] = useState<string | null>(focus);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setLayout(DEFAULT_LAYOUT[view]);
    setSelected(focus);
  }, [view, focus]);

  const project = s.projectId ?? "";
  const go = (v: GraphViewName, f: string | null) => {
    location.hash = graphHash(project, v, f);
  };
  // Stable inputs: a new graph object restarts the canvas simulation.
  const lit = useMemo(() => highlight(data.path), [data.path]);
  const keep = useMemo(() => new Set([...lit.nodes, ...(focus ? [focus] : [])]), [lit, focus]);
  // The time slider: a step per distinct write time; null is now. Play walks the real write
  // times forward, so the graph grows in the order the agents wrote it.
  const times = useMemo(() => writeTimes(data.graph), [data.graph]);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const stride = Math.max(1, Math.ceil(times.length / 200)); // about 12 s for any project
    const t = setInterval(() => {
      setStep((at) => {
        const next = (at ?? -1) + stride;
        if (next < times.length - 1) return next;
        setPlaying(false);
        return null;
      });
    }, 60);
    return () => clearInterval(t);
  }, [playing, times.length]);
  const until = step === null ? null : (times[step] ?? null);
  const shown = useMemo(
    () => asOf(visible(data.graph, { delivery, keep }), until, keep),
    [data.graph, delivery, keep, until],
  );
  const focusNode = data.graph.nodes.find((n) => n.id === focus);

  return (
    <>
      <div className="graph-toolbar row">
        <span role="group" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button
              type="button"
              key={l}
              aria-pressed={layout === l}
              disabled={l === "Orbit" && !focus}
              title={
                l === "Orbit" && !focus ? "Orbit needs a focus node: double-click one." : undefined
              }
              onClick={() => setLayout(l)}
            >
              {l}
            </button>
          ))}
        </span>
        <span role="group" aria-label="View">
          {VIEWS.map((v) => {
            const fits =
              v.view === "all" ||
              (!!focusNode && (!v.labels || v.labels.includes(focusNode.label)));
            return (
              <button
                type="button"
                key={v.view}
                aria-pressed={view === v.view}
                disabled={!fits}
                title={
                  fits
                    ? undefined
                    : `${v.name} needs a ${v.labels?.join(" or ") ?? "focus node"} as the focus.`
                }
                onClick={() => go(v.view, v.view === "all" ? null : focus)}
              >
                {v.name}
              </button>
            );
          })}
        </span>
        <label>
          <input
            type="checkbox"
            checked={delivery}
            onChange={(e) => setDelivery(e.target.checked)}
          />
          Delivery details
        </label>
      </div>
      {times.length > 1 && (
        <div className="time-slider row">
          <button
            type="button"
            className="ghost"
            aria-label={playing ? "Pause" : "Replay the graph growing"}
            onClick={() => {
              if (!playing && step === null) setStep(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause className="icon" /> : <Play className="icon" />}
          </button>
          <input
            type="range"
            min={0}
            max={times.length - 1}
            value={step ?? times.length - 1}
            aria-label="Graph as of"
            onChange={(e) => {
              setPlaying(false);
              const at = Number(e.target.value);
              setStep(at === times.length - 1 ? null : at);
            }}
          />
          <span className="mono muted">
            {until === null
              ? "now"
              : new Date(until).toLocaleString([], { dateStyle: "short", timeStyle: "medium" })}
          </span>
          {step !== null && (
            <button
              type="button"
              className="ghost"
              onClick={() => (setPlaying(false), setStep(null))}
            >
              Now
            </button>
          )}
        </div>
      )}
      <p className="graph-head row">
        {focusNode && <span>{`focus: ${focusNode.title}`}</span>}
        <span className="muted">
          {`${shown.nodes.length} nodes${data.ms === null ? "" : ` · ${data.ms} ms query`}`}
        </span>
      </p>
      {data.path && (
        <ul className="graph-path" aria-label="Nodes on the highlighted path">
          {data.path.nodes.slice(0, 60).map((n) => (
            <li key={n.id}>
              <button type="button" className="link" onClick={() => setSelected(n.id)}>
                <span className="muted">{`${n.label} `}</span>
                {n.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="graph-body">
        {mounted && (
          <Suspense fallback={<div className="graph-stage" aria-busy="true" />}>
            <Canvas
              graph={shown}
              lit={lit}
              layout={layout === "Orbit" && !focus ? "Network" : layout}
              focus={focus}
              reverse={view === "impact"}
              onSelect={setSelected}
              onFocus={(id) => go("why", id)}
              height={props.height}
              pulse={pulses(s.feed)}
            />
          </Suspense>
        )}
        {selected && (
          <NodeDrawer
            key={selected}
            s={s}
            nodeId={selected}
            select={setSelected}
            close={() => setSelected(null)}
          />
        )}
      </div>
    </>
  );
}

export function GraphPanelView(props: {
  s: PanelState;
  view: GraphViewName;
  focus: string | null;
}) {
  const { s, view, focus } = props;
  // Another view's data never shows under this view's buttons: loading, or this view's error.
  const d = s.graph.data;
  const slice = d && (d.view !== view || d.focus !== focus) ? { ...s.graph, data: null } : s.graph;
  return (
    <section className="screen graph">
      <h2>Graph</h2>
      <SliceView
        slice={slice}
        onRetry={() => void s.loadGraph(view, focus)}
        empty="No nodes yet. Upload notes to start."
        isEmpty={(d) => d.graph.nodes.length === 0}
      >
        {(data) => <GraphStage s={s} data={data} view={view} focus={focus} />}
      </SliceView>
    </section>
  );
}

export function GraphPanel(props: {
  store: AppStore;
  projectId: string;
  view: GraphViewName;
  focus: string | null;
}) {
  const s = useStore(
    props.store,
    useShallow((a) => ({
      graph: a.graph,
      projectId: a.projectId,
      node: a.node,
      loadGraph: a.loadGraph,
      feed: a.feed,
    })),
  );
  const { view, focus } = props;
  // App's effect opens the route's project after this effect runs; load once it is the open one,
  // so a link into another project never asks the old one for its node.
  const ready = s.projectId === props.projectId;
  useEffect(() => {
    if (ready) void props.store.getState().loadGraph(view, focus);
  }, [props.store, ready, view, focus]);
  return <GraphPanelView s={s} view={view} focus={focus} />;
}
