// The pipeline: every stage from the client's notes to launch, with each work item an agent did in
// it. An item opens into its evidence: what it read from the graph, what it wrote, its model calls
// and its live steps. The build stage lists the cards, each linking to its story.
import { useEffect } from "react";
import { useStore } from "zustand";
import {
  Bot,
  ClipboardList,
  FileUp,
  FlaskConical,
  Hammer,
  Lightbulb,
  Monitor,
  PencilRuler,
  Rocket,
  Search,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import type { GateKey, ItemView, Stage, WorkItemKind } from "@agencymem/contracts";
import { cardHash } from "../shell/router";
import type { AppState, AppStore } from "../store";
import { Chip, Disclosure, SliceView, time } from "../ui";
import { ContextRead, ModelCalls, StepLog } from "./Evidence";

type Phase = {
  name: string;
  icon: LucideIcon;
  kinds: WorkItemKind[];
  /** The project stages the phase covers, for done / now / later. */
  stages: Stage[];
  gate?: GateKey;
  cards?: true;
  launch?: true;
};

export const PHASES: Phase[] = [
  { name: "Intake", icon: FileUp, kinds: ["intake", "intake_answer"], stages: ["intake"] },
  { name: "Discovery", icon: Search, kinds: ["discovery"], stages: ["discovery"], gate: "G1" },
  {
    name: "Proposal",
    icon: Lightbulb,
    kinds: ["proposal", "change_request"],
    stages: ["proposal"],
    gate: "G2",
  },
  {
    name: "Design",
    icon: PencilRuler,
    kinds: ["architect", "architect_revise"],
    stages: ["design"],
    gate: "G3",
  },
  { name: "Planning", icon: ClipboardList, kinds: ["planner", "replan"], stages: ["planning"] },
  {
    name: "Build",
    icon: Hammer,
    kinds: ["write_tests", "merge"],
    stages: ["build"],
    cards: true,
  },
  { name: "Test", icon: FlaskConical, kinds: ["test_run", "e2e"], stages: ["e2e"] },
  { name: "Launch", icon: Rocket, kinds: ["launch"], stages: ["launch"], launch: true },
  {
    name: "Case study",
    icon: BookOpen,
    kinds: ["curator"],
    stages: ["case_study", "closed"],
  },
];

const ORDER: Stage[] = [
  "intake",
  "discovery",
  "proposal",
  "design",
  "planning",
  "build",
  "e2e",
  "launch",
  "case_study",
  "closed",
];

/** done, now or later, from the project's stage. */
export function phaseState(phase: Phase, stage: Stage | undefined): "done" | "now" | "later" {
  if (!stage) return "later";
  const at = ORDER.indexOf(stage);
  const first = Math.min(...phase.stages.map((st) => ORDER.indexOf(st)));
  const last = Math.max(...phase.stages.map((st) => ORDER.indexOf(st)));
  return at > last ? "done" : at >= first ? "now" : "later";
}

function ItemRow({ s, item }: { s: AppState; item: ItemView }) {
  return (
    <Disclosure
      className="item-row"
      summary={
        <>
          <Bot className="icon" aria-hidden="true" />
          <span className="mono">{item.kind}</span>
          <span>{item.agent}</span>
          <Chip status={item.status} />
          {item.attempts > 1 && <span className="chip warn">{`attempt ${item.attempts}`}</span>}
          <span className="muted grow">{item.lastStep ?? ""}</span>
          {item.doneAt && <span className="muted">{time(item.doneAt)}</span>}
        </>
      }
    >
      {() => (
        <div className="item-body">
          <ContextRead s={s} itemId={item.id} />
          <ModelCalls s={s} itemId={item.id} />
          <StepLog steps={s.runLog[item.id] ?? []} />
        </div>
      )}
    </Disclosure>
  );
}

function Cards({ s }: { s: AppState }) {
  const cards = s.board.data?.cards ?? [];
  if (cards.length === 0) return null;
  return (
    <ul className="card-list">
      {cards.map((c) => (
        <li key={c.id}>
          <a href={cardHash(s.projectId ?? "", c.key)} className={`card lane-${c.lane}`}>
            <span className="mono">{c.key}</span>
            <span className="card-title">{c.title}</span>
            <span className="chips">
              <span className="chip">{c.column}</span>
              {c.testStatus !== "none" && <Chip status={c.testStatus} />}
              {c.commits.length > 0 && (
                <span className="chip">{`${c.commits.length} commits`}</span>
              )}
              {c.mergedSha && <span className="chip ok">merged</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Launch({ s }: { s: AppState }) {
  const report = s.readiness.data;
  if (!report)
    return <p className="muted">The Launch agent has not written a readiness report yet.</p>;
  return (
    <ul className="checks">
      {report.checks.map((c) => (
        <li key={c.name} className={c.passed ? "pass" : "fail"}>
          {`${c.passed ? "✓" : "✗"} ${c.name.replace("_", " ")}: ${c.detail}`}
        </li>
      ))}
    </ul>
  );
}

const PreviewLink = ({ s }: { s: AppState }) => (
  <a className="button" href={`#/p/${s.projectId}/preview`}>
    <Monitor className="icon" aria-hidden="true" />
    Open the built app
  </a>
);

export function PipelineView({ s }: { s: AppState }) {
  const stage = s.project.data?.stage;
  return (
    <section className="screen pipeline">
      <header className="screen-head">
        <h2>Pipeline</h2>
        <span className="muted">
          Every agent step from the client&apos;s notes to launch. Open an item to see what it read
          from the graph, what it wrote and what it cost.
        </span>
      </header>
      <SliceView
        slice={s.items}
        onRetry={() => void s.load("items")}
        empty="No work yet. Upload the client's notes in Files to start."
        isEmpty={() => false}
      >
        {(all) => (
          <ol className="timeline">
            {PHASES.map((phase) => {
              const items = all.filter((i) => phase.kinds.includes(i.kind));
              const state = phaseState(phase, stage);
              const gate = phase.gate && s.gates.data?.find((g) => g.key === phase.gate);
              return (
                <li key={phase.name} className={`phase ${state}`}>
                  <span className="phase-dot" aria-hidden="true">
                    <phase.icon className="icon" />
                  </span>
                  <div className="phase-body">
                    <header className="phase-head">
                      <h3>{phase.name}</h3>
                      <span className="chip">{state}</span>
                      {gate && (
                        <span
                          className={`diamond ${gate.status}`}
                        >{`${gate.key} ${gate.status}`}</span>
                      )}
                      <span className="muted">{`${items.length} item${items.length === 1 ? "" : "s"}`}</span>
                    </header>
                    {items.map((item) => (
                      <ItemRow key={item.id} s={s} item={item} />
                    ))}
                    {phase.cards && <Cards s={s} />}
                    {phase.launch && <Launch s={s} />}
                    {(phase.launch || phase.cards) && <PreviewLink s={s} />}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </SliceView>
    </section>
  );
}

export function Pipeline({ store, projectId }: { store: AppStore; projectId: string }) {
  const s = useStore(store);
  // The graph names the nodes an item wrote; load it once the route's project is open.
  const ready = s.projectId === projectId;
  useEffect(() => {
    if (ready && !store.getState().graph.data) void store.getState().loadGraph("all", null);
  }, [store, ready]);
  return <PipelineView s={s} />;
}
