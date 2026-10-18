// The Memory screen: everything said to the project, across sessions, in time order (files, the
// questions Discovery asked, the answers, change requests, and the team's own questions with
// Discovery's replies), and beside it what the project knew after the selected turn: the facts
// valid then, and the ones a change request had ended. "Ask the project" sends a question.
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  FileText,
  MessageCircleQuestion,
  MessageSquare,
  RefreshCw,
  Reply,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "zustand";
import type { MemoryResponse, MemoryTurn } from "@agencymem/contracts";
import type { AppStore } from "../store";
import { useRead } from "../ui";

const KIND: Record<MemoryTurn["kind"], { icon: LucideIcon; label: string }> = {
  document: { icon: FileText, label: "File" },
  question: { icon: MessageCircleQuestion, label: "Question" },
  answer: { icon: Reply, label: "Answer" },
  change_request: { icon: RefreshCw, label: "Change request" },
  ask: { icon: MessageSquare, label: "Asked" },
  reply: { icon: Bot, label: "Discovery replied" },
};
const POLL_MS = 3000;
const POLLS = 40; // two minutes: a failed ask stays unanswered, so polling must end

type Data = Omit<MemoryResponse, "seq">;

const when = (at: number) =>
  new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

function Turn(props: {
  turn: MemoryTurn;
  selected: boolean;
  re?: string;
  waiting: boolean;
  cites: string[];
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
        {props.re && <span className="muted">{`Re: ${props.re}`}</span>}
        <span className="feed-text">{turn.text}</span>
        {props.waiting && <span className="muted">Waiting for Discovery to answer…</span>}
        {props.cites.length > 0 && (
          <ul className="node-list">
            {props.cites.map((statement, i) => (
              <li key={i} className="muted">{`Source: ${statement}`}</li>
            ))}
          </ul>
        )}
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

function Known({ data, until, cited }: { data: Data; until: number; cited: Set<string> }) {
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
          <li key={f.id}>
            {cited.has(f.id) && <span className="chip ok">cited</span>} {f.statement}
          </li>
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

function AskBox({ onAsk }: { onAsk: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="panel memory-ask"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        if (await onAsk(text.trim())) setText("");
        setBusy(false);
      }}
    >
      <label htmlFor="memory-ask">Ask the project</label>
      <div className="row">
        <input
          id="memory-ask"
          className="grow"
          value={text}
          maxLength={1000}
          placeholder="What did the client say about opening hours?"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="primary" disabled={busy || !text.trim()}>
          {busy ? "Asking…" : "Ask"}
        </button>
      </div>
      <span className="muted">Discovery answers from the project's facts, with its sources.</span>
    </form>
  );
}

export function Memory({ store }: { store: AppStore }) {
  const s = useStore(store);
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const projectId = s.projectId ?? "";
  // ponytail: read on open, on Refresh and while an ask waits for its reply; not a live slice.
  const read = useRead(() => s.memory(), `memory:${projectId}:${reload}`);
  const last = useRef<Data | null>(null);
  if (read.data) last.current = read.data;
  const data = read.data ?? last.current; // keep the old turns on screen while a reload runs
  const turns = data?.turns ?? [];
  const replied = new Set(turns.filter((t) => t.kind === "reply").map((t) => t.refId));
  const waiting = turns.some((t) => t.kind === "ask" && !replied.has(t.id));

  const polls = useRef(0);
  useEffect(() => {
    if (!waiting || !read.data || polls.current >= POLLS) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      setReload((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, read.data]);

  const found = turns.findIndex((t) => t.id === picked);
  const selected = found === -1 ? turns.length - 1 : found; // the latest turn by default
  // A turn's state is what held until the next turn (agents work between turns), now for the last.
  const until = turns[selected + 1]?.at ?? Date.now();
  const refs = new Map(
    turns.filter((t) => t.kind === "question" || t.kind === "ask").map((t) => [t.id, t.text]),
  );
  const statements = new Map((data?.facts ?? []).map((f) => [f.id, f.statement]));
  const ask = async (text: string) => {
    const ok = await s.ask(text);
    if (ok) {
      polls.current = 0;
      setPicked(null); // follow the new question
      setReload((n) => n + 1);
    }
    return ok;
  };
  return (
    <section className="screen">
      <header className="screen-head">
        <h2>Memory</h2>
        <span className="muted">Every turn with the project, kept in the graph.</span>
        <button type="button" className="ghost" onClick={() => setReload((n) => n + 1)}>
          <RefreshCw className="icon" aria-hidden="true" />
          Refresh
        </button>
      </header>
      <AskBox onAsk={ask} />
      {read.error && (
        <div className="state error" role="alert">
          <p>{read.error}</p>
        </div>
      )}
      {!data && !read.error && (
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
                re={t.refId ? refs.get(t.refId) : undefined}
                waiting={t.kind === "ask" && !replied.has(t.id)}
                cites={t.sourceIds.flatMap((id) => statements.get(id) ?? [])}
                onPick={() => setPicked(t.id)}
              />
            ))}
          </ol>
          <Known data={data} until={until} cited={new Set(turns[selected]?.sourceIds ?? [])} />
        </div>
      )}
    </section>
  );
}
