// Home: the project at a glance. The live graph in the centre; the stage rail and what waits next on
// the left; on the right the activity feed, every gateway event as it arrives; the key numbers below.
import { useEffect } from "react";
import { useStore } from "zustand";
import {
  Activity,
  Bot,
  Brain,
  Clock,
  Code,
  Cpu,
  Database,
  FileText,
  PenLine,
  ShieldCheck,
  SquareKanban,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Stage, type Envelope, type GateKey } from "@agencymem/contracts";
import { GraphStage } from "../graph/GraphPanel";
import { graphHash } from "../shell/router";
import type { AppState, AppStore } from "../store";
import { SliceView, time } from "../ui";

const GATE_AFTER: Partial<Record<Stage, GateKey>> = {
  discovery: "G1",
  proposal: "G2",
  design: "G3",
  launch: "G5",
};
const STAGES: readonly Stage[] = Stage.options.filter((name) => name !== "closed");

type Line = { icon: LucideIcon; tone: string; text: string; meta: string; href: string | null };

const STEP_ICON: Record<string, LucideIcon> = {
  recall: Brain,
  think: Cpu,
  edit: PenLine,
  bash: Code,
  tool: Code,
};

/** One feed line per event: an icon, what happened in words, who and when, and where it leads. */
export function feedLine(e: Envelope, projectId: string): Line | null {
  const at = time(e.at);
  const node = (id: string) => graphHash(projectId, "why", id);
  switch (e.type) {
    case "node.written":
      return {
        icon: Database,
        tone: "accent",
        text: `${e.data.label} · ${e.data.summary}`,
        meta: `${at} · written${e.data.ids && e.data.ids.length > 1 ? ` · ${e.data.ids.length} nodes` : ""}`,
        href: node(e.data.id),
      };
    case "node.ended":
      return {
        icon: Clock,
        tone: "warn",
        text: "A fact ended and was replaced",
        meta: at,
        href: node(e.data.replacedBy),
      };
    case "task.moved":
      return {
        icon: SquareKanban,
        tone: e.data.to === "Done" ? "ok" : e.data.to === "Rework" ? "warn" : "info",
        text: `${e.data.key} ${e.data.from ?? "new"} → ${e.data.to}`,
        meta: `${at}${e.data.reason ? ` · ${e.data.reason}` : ""}`,
        href: `#/p/${projectId}/board`,
      };
    case "task.edited":
      return {
        icon: PenLine,
        tone: "info",
        text: `${e.data.actor} edited ${e.data.fields.join(", ")}`,
        meta: at,
        href: `#/p/${projectId}/board`,
      };
    case "lease.changed":
      // A renew is a heartbeat: it says nothing new.
      if (e.data.reason === "renew") return null;
      return {
        icon: Bot,
        tone: "",
        text: `${e.data.owner ?? "Lease"} ${e.data.reason}`,
        meta: at,
        href: null,
      };
    case "gate.changed":
      return {
        icon: ShieldCheck,
        tone:
          e.data.status === "approved" ? "ok" : e.data.status === "rejected" ? "danger" : "warn",
        text: `${e.data.gateKey} ${e.data.status}${e.data.decidedBy ? ` by ${e.data.decidedBy}` : ""}`,
        meta: `${at}${e.data.reason ? ` · ${e.data.reason}` : ""}`,
        href: `#/p/${projectId}/gates`,
      };
    case "doc.stale":
      return {
        icon: FileText,
        tone: "warn",
        text: "A document section went stale after a change request",
        meta: at,
        href: `#/p/${projectId}/docs/prd`,
      };
    case "run.step":
      return {
        icon: STEP_ICON[e.data.step] ?? Bot,
        tone: e.data.step === "recall" ? "info" : "",
        text: `${e.data.agent} · ${e.data.step}: ${e.data.text}`,
        meta: [
          at,
          e.data.model,
          e.data.tokens ? `${e.data.tokens} tok` : null,
          e.data.ms ? `${e.data.ms} ms` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: null,
      };
    case "write.rejected":
      return {
        icon: TriangleAlert,
        tone: "danger",
        text: `${e.data.guard} guard refused ${e.data.tool}: ${e.data.reason}`,
        meta: `${at} · ${e.data.agent}`,
        href: null,
      };
    case "metrics.updated":
      return {
        icon: Activity,
        tone: "",
        text: `${e.data.metric} = ${e.data.value}`,
        meta: at,
        href: null,
      };
    case "context.read":
      return {
        icon: Brain,
        tone: "info",
        text: `${e.data.agent} read ${e.data.ids.length} nodes from the graph`,
        meta: `${at} · ${e.data.tool}`,
        href: `#/p/${projectId}/pipeline`,
      };
  }
}

export function Feed({ s, limit = 120 }: { s: AppState; limit?: number }) {
  const project = s.projectId ?? "";
  const lines = s.feed
    .map((e) => [e.seq, feedLine(e, project)] as const)
    .filter((x): x is readonly [number, Line] => x[1] !== null)
    .reverse()
    .slice(0, limit);
  if (lines.length === 0) {
    return (
      <p className="muted">
        Waiting for the agents. Every write, step and gate shows up here live.
      </p>
    );
  }
  return (
    <ol className="feed" aria-label="Activity">
      {lines.map(([seq, l]) => (
        <li key={seq} className={l.tone ? `tone-${l.tone}` : ""}>
          <l.icon className="icon" aria-hidden="true" />
          <span className="feed-text">
            {l.href ? <a href={l.href}>{l.text}</a> : l.text}
            <span className="feed-meta">{l.meta}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function StageRail({ s }: { s: AppState }) {
  const stage = s.project.data?.stage;
  const now = stage ? STAGES.indexOf(stage) : -1;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Life cycle</h3>
      </div>
      <ol className="stage-list">
        {STAGES.map((name, i) => {
          const gate = GATE_AFTER[name];
          const status = gate ? s.gates.data?.find((g) => g.key === gate)?.status : undefined;
          return (
            <li key={name} className={i < now ? "done" : i === now ? "current" : ""}>
              <span className="dot" aria-hidden="true" />
              {name.replace("_", " ")}
              {gate && (
                <span
                  className={`diamond ${status ?? ""}`}
                >{`${gate} ${status ?? "waiting"}`}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** What waits now, from the snapshots: open questions, a gate a person can decide, or the agents. */
export function nextStep(s: AppState): { title: string; text: string; href: string } {
  const project = s.projectId ?? "";
  const open = s.questions.data?.filter((q) => q.status === "open").length ?? 0;
  const gate = s.gates.data?.find(
    (g) => g.status === "waiting" && g.canDecide && g.blockedBy.length === 0,
  );
  if (gate)
    return {
      title: `Decide ${gate.key}`,
      text: "The gate is ready for your decision.",
      href: `#/p/${project}/gates`,
    };
  if (open > 0 && s.project.data?.stage === "discovery") {
    return {
      title: `${open} open question${open === 1 ? "" : "s"}`,
      text: "Discovery is waiting for your answers.",
      href: `#/p/${project}/questions`,
    };
  }
  const items = s.board.data?.items ?? [];
  const busy = items.filter((i) => i.status === "claimed");
  if (busy.length > 0) {
    return {
      title: `${busy.length} agent${busy.length === 1 ? "" : "s"} at work`,
      text: busy.map((i) => `${i.agent}: ${i.kind}`).join(", "),
      href: `#/p/${project}/board`,
    };
  }
  return {
    title: "Nothing waits for you",
    text: "The agents pick up the next work item on their own.",
    href: `#/p/${project}/board`,
  };
}

function Kpis({ s }: { s: AppState }) {
  const m = s.metrics.data;
  const p = s.progress.data;
  const done = p?.lanes.reduce((n, l) => n + l.done, 0) ?? 0;
  const cards = p?.lanes.reduce((n, l) => n + l.total, 0) ?? 0;
  const kpi = (label: string, value: string, note?: string) => (
    <div className="kpi" key={label}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      {note && <span className="muted">{note}</span>}
    </div>
  );
  return (
    <section className="kpis" aria-label="Key numbers">
      {kpi("Questions", String(m?.questions ?? 0), `${m?.contradictions ?? 0} contradictions`)}
      {kpi("Cards done", `${done}/${cards}`)}
      {kpi(
        "Coverage",
        p ? `${p.coverage.covered}/${p.coverage.total}` : "0/0",
        "requirements with a passing e2e test",
      )}
      {kpi(
        "Change requests",
        String(m?.changeRequests ?? 0),
        `${m?.cardsReopened ?? 0} cards reopened`,
      )}
      {kpi(
        "Guard refusals",
        String(m ? m.rejected.writes + m.rejected.claims + m.rejected.completions : 0),
        "writes the gateway refused",
      )}
      {kpi(
        "Tokens",
        ((m?.tokensIn ?? 0) + (m?.tokensOut ?? 0)).toLocaleString(),
        `${(m?.tokensIn ?? 0).toLocaleString()} in`,
      )}
      {kpi("Model cost", `$${(m?.cost ?? 0).toFixed(2)}`)}
    </section>
  );
}

export function HomeView({ s }: { s: AppState }) {
  const next = nextStep(s);
  return (
    <section className="screen home">
      <div className="home-left">
        <a className="panel next" href={next.href}>
          <span className="eyebrow">Next</span>
          <h3>{next.title}</h3>
          <span className="muted">{next.text}</span>
        </a>
        <StageRail s={s} />
      </div>
      <div className="home-center">
        <SliceView
          slice={
            s.graph.data && (s.graph.data.view !== "all" || s.graph.data.focus)
              ? { ...s.graph, data: null }
              : s.graph
          }
          onRetry={() => void s.loadGraph("all", null)}
          empty="No nodes yet. Upload the client's notes in Files to start."
          isEmpty={(d) => d.graph.nodes.length === 0}
        >
          {(data) => <GraphStage s={s} data={data} view="all" focus={null} height={560} />}
        </SliceView>
      </div>
      <aside className="home-right panel">
        <div className="panel-head">
          <h3>Live activity</h3>
          <span className={`conn ${s.connection}`}>{s.connection}</span>
        </div>
        <Feed s={s} />
      </aside>
      <Kpis s={s} />
    </section>
  );
}

export function Home({ store, projectId }: { store: AppStore; projectId: string }) {
  const s = useStore(store);
  // As the graph panel: load once the route's project is the open one.
  const ready = s.projectId === projectId;
  useEffect(() => {
    if (ready) void store.getState().loadGraph("all", null);
  }, [store, ready]);
  return <HomeView s={s} />;
}
