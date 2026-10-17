// A card's story, start to end: the requirement and criteria it builds, what the build run read
// from the graph, its live steps and model calls, each commit with its diff, its test runs, the
// merge and the launch gate.
import type { ReactNode } from "react";
import { useStore } from "zustand";
import {
  ArrowLeft,
  Brain,
  ClipboardCheck,
  FlaskConical,
  GitCommitHorizontal,
  GitMerge,
  Hammer,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import type { CardView } from "@agencymem/contracts";
import { ContextRead, DiffView, ModelCalls, StepLog, TestRuns } from "../pipeline/Evidence";
import { graphHash } from "../shell/router";
import type { AppState, AppStore } from "../store";
import { Chip, Disclosure, SliceView, time } from "../ui";

function Step(props: { icon: LucideIcon; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className={`phase ${props.done ? "done" : "later"}`}>
      <span className="phase-dot" aria-hidden="true">
        <props.icon className="icon" />
      </span>
      <div className="phase-body">
        <header className="phase-head">
          <h3>{props.title}</h3>
        </header>
        {props.children}
      </div>
    </li>
  );
}

function Story({ s, card }: { s: AppState; card: CardView }) {
  const project = s.projectId ?? "";
  const g5 = s.gates.data?.find((g) => g.key === "G5");
  const commits = [...card.commits].sort((a, b) => a.committedAt - b.committedAt);
  return (
    <>
      <header className="screen-head">
        <a href={`#/p/${project}/pipeline`} className="button ghost">
          <ArrowLeft className="icon" aria-hidden="true" />
          Pipeline
        </a>
        <span className="mono">{card.key}</span>
        <h2>{card.title}</h2>
        <span className="chip">{card.lane}</span>
        <span className="chip">{card.column}</span>
        {card.testStatus !== "none" && <Chip status={card.testStatus} />}
        <a href={graphHash(project, "why", card.id)}>Why this card exists</a>
      </header>
      <p className="muted">{card.description}</p>
      <ol className="timeline">
        <Step icon={ClipboardCheck} title={`Builds ${card.requirementKey}`} done>
          <ul className="node-list">
            {card.criteria.map((k) => (
              <li key={k.key}>
                <span className="mono">{k.key}</span> {k.text}{" "}
                <span className="muted">{`· ${k.testCaseCount} test cases · ${k.testIds.join(", ")}`}</span>
              </li>
            ))}
          </ul>
          {card.dependsOn.length > 0 && (
            <p className="muted">{`Depends on ${card.dependsOn.join(", ")}`}</p>
          )}
        </Step>
        <Step icon={Brain} title="Context the build run read from the graph" done>
          <ContextRead s={s} itemId={card.id} wrote={false} />
        </Step>
        <Step icon={Hammer} title="Build run" done={commits.length > 0}>
          <ModelCalls s={s} itemId={card.id} />
          <StepLog steps={s.runLog[card.id] ?? []} />
          {card.note && <p className="muted">{card.note}</p>}
        </Step>
        <Step
          icon={GitCommitHorizontal}
          title={`Commits · ${commits.length}`}
          done={commits.length > 0}
        >
          {commits.length === 0 && <p className="muted">No commits yet.</p>}
          {commits.map((c) => (
            <Disclosure
              key={c.sha}
              className="item-row"
              summary={
                <>
                  <GitCommitHorizontal className="icon" aria-hidden="true" />
                  <span className="mono">{c.sha.slice(0, 7)}</span>
                  <span className="grow">{c.message}</span>
                  {!c.linked && <span className="chip warn">not linked</span>}
                  <span className="muted">{time(c.committedAt)}</span>
                </>
              }
            >
              {() => <DiffView s={s} sha={c.sha} />}
            </Disclosure>
          ))}
        </Step>
        <Step icon={FlaskConical} title="Tests" done={card.testStatus === "passing"}>
          <TestRuns s={s} taskId={card.id} />
        </Step>
        <Step icon={GitMerge} title="Merge" done={!!card.mergedSha}>
          {card.mergedSha ? (
            <p>
              Merged into main at <span className="mono">{card.mergedSha.slice(0, 7)}</span>
            </p>
          ) : (
            <p className="muted">Not merged yet.</p>
          )}
        </Step>
        <Step icon={Rocket} title="Launch" done={g5?.status === "approved"}>
          <p className="muted">
            {g5
              ? `G5 ${g5.status}${g5.decidedBy ? ` by ${g5.decidedBy}` : ""}`
              : "G5 not open yet."}
          </p>
        </Step>
      </ol>
    </>
  );
}

export function CardStoryView({ s, cardKey }: { s: AppState; cardKey: string }) {
  return (
    <section className="screen card-story">
      <SliceView
        slice={s.board}
        onRetry={() => void s.load("board")}
        empty={`No card ${cardKey} in this project.`}
        isEmpty={(b) => !b.cards.some((c) => c.key === cardKey)}
      >
        {(b) => <Story s={s} card={b.cards.find((c) => c.key === cardKey)!} />}
      </SliceView>
    </section>
  );
}

export function CardStory({ store, cardKey }: { store: AppStore; cardKey: string }) {
  return <CardStoryView s={useStore(store)} cardKey={cardKey} />;
}
