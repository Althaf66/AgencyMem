// The Memory screen: everything the client said, across sessions, in time order (files, the
// questions Discovery asked, the answers, change requests), and beside it what the project knew
// after the selected turn: the facts valid then, and the ones a change request had ended.
import { useState } from "react";
import { FileText, MessageCircleQuestion, RefreshCw, Reply, type LucideIcon } from "lucide-react";
import { useStore } from "zustand";
import type { MemoryResponse, MemoryTurn } from "@agencymem/contracts";
import type { AppStore } from "../store";
import { useRead } from "../ui";

const KIND: Record<MemoryTurn["kind"], { icon: LucideIcon; label: string }> = {
  document: { icon: FileText, label: "File" },
  question: { icon: MessageCircleQuestion, label: "Question" },
  answer: { icon: Reply, label: "Answer" },
  change_request: { icon: RefreshCw, label: "Change request" },
};

const when = (at: number) =>
  new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

function Turn(props: {
  turn: MemoryTurn;
  selected: boolean;
  question?: string;
  onPick: () => void;
}) {
  const { turn } = props;
  const { icon: Icon, label } = KIND[turn.kind];
  return (
    <li className={`phase ${props.selected ? "now" : "done"}`}>
      <span className="phase-dot">
        <Icon className="icon" aria-hidden="true" />
      </span>
      <button
        type="button"
        className="phase-body memory-turn"
        aria-pressed={props.selected}
        onClick={props.onPick}
      >
        <span className="feed-meta">{`${label} · ${when(turn.at)}`}</span>
        {props.question && <span className="muted">{`Re: ${props.question}`}</span>}
        <span className="feed-text">{turn.text}</span>
        {(turn.facts > 0 || turn.ended > 0) && (
          <span className="feed-meta">
            {[
              turn.facts > 0 && `${turn.facts} facts from this`,
              turn.ended > 0 && `${turn.ended} facts ended`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </button>
    </li>
  );
}

function Known({ data, until }: { data: Omit<MemoryResponse, "seq">; until: number }) {
  const known = data.facts.filter((f) => f.validFrom < until);
  const current = known.filter((f) => f.validTo === null || f.validTo > until);
  const ended = known.filter((f) => f.validTo !== null && f.validTo <= until);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{`What we knew then · ${current.length} facts`}</h3>
      </div>
      {known.length === 0 && <p className="muted">No facts yet at this point.</p>}
      <ul className="node-list">
        {current.map((f) => (
          <li key={f.id}>{f.statement}</li>
        ))}
        {ended.map((f) => (
          <li key={f.id} className="muted">
            <s>{f.statement}</s>
            {` · ended ${when(f.validTo ?? 0)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Memory({ store }: { store: AppStore }) {
  const s = useStore(store);
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const projectId = s.projectId ?? "";
  // ponytail: read when the screen opens and on Refresh, not live; make it a slice if it must be.
  const { data, error } = useRead(() => s.memory(), `memory:${projectId}:${reload}`);
  const turns = data?.turns ?? [];
  const found = turns.findIndex((t) => t.id === picked);
  const selected = found === -1 ? turns.length - 1 : found; // the latest turn by default
  // A turn's state is what held until the next turn (agents work between turns), now for the last.
  const until = turns[selected + 1]?.at ?? Date.now();
  const questions = new Map(turns.filter((t) => t.kind === "question").map((t) => [t.id, t.text]));
  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Memory</h2>
        <span className="muted">
          Every turn the client had with the project, kept in the graph.
        </span>
        <button type="button" className="ghost" onClick={() => setReload((n) => n + 1)}>
          <RefreshCw className="icon" aria-hidden="true" />
          Refresh
        </button>
      </header>
      {error && (
        <div className="state error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {!data && !error && (
        <div className="state loading" aria-busy="true">
          <div className="skeleton" />
          <div className="skeleton short" />
        </div>
      )}
      {data && turns.length === 0 && (
        <div className="state empty">
          Nothing yet. Upload the client's notes on the Files screen.
        </div>
      )}
      {data && turns.length > 0 && (
        <div className="memory-grid">
          <ol className="timeline">
            {turns.map((t, i) => (
              <Turn
                key={t.id}
                turn={t}
                selected={i === selected}
                question={t.refId ? questions.get(t.refId) : undefined}
                onPick={() => setPicked(t.id)}
              />
            ))}
          </ol>
          <Known data={data} until={until} />
        </div>
      )}
    </section>
  );
}
