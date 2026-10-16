// The board (ui.md section 5, Board and progress header): the progress header, whose every number
// opens its list (route 15); the agent strip, one chip per agent with Retry on a blocked item; and
// the grid of six columns by five lanes. A card opens its drawer.
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { CardView, ItemView } from "@agencymem/contracts";
import type { AppState, AppStore, MetricNode, Progress } from "../store";
import { Chip, SliceView } from "../ui";
import { CardDrawer } from "./CardDrawer";

function ProgressHeader({ s, progress }: { s: AppState; progress: Progress }) {
  const [list, setList] = useState<{ title: string; nodes: MetricNode[] } | null>(null);
  const number = (metric: string, title: string) => (
    <button
      type="button"
      className="link"
      onClick={() =>
        void s.progressList(metric).then((nodes) => nodes && setList({ title, nodes }))
      }
    >
      {title}
    </button>
  );
  return (
    <div className="progress">
      <div className="row">
        <span>{`Stage: ${progress.stage}`}</span>
        {progress.gates.map((g) => (
          <span key={g.key} className="mono">
            {`${g.key} ${g.status === "approved" ? "✓" : "·"}`}
          </span>
        ))}
        <span className="muted">Done per lane:</span>
        {progress.lanes
          .filter((l) => l.total > 0)
          .map((l) => (
            <span key={l.lane}>{number(`lane:${l.lane}`, `${l.lane} ${l.done}/${l.total}`)}</span>
          ))}
      </div>
      <div className="row">
        {number("coverage", `Coverage ${progress.coverage.covered}/${progress.coverage.total}`)}
        {number("openAssumptions", `Open assumptions ${progress.openAssumptions}`)}
        {number("openDefects", `Open defects ${progress.openDefects}`)}
      </div>
      {list && (
        <div className="metric-list">
          <strong>{list.title}</strong>
          <button type="button" onClick={() => setList(null)}>
            Close
          </button>
          <ul>
            {list.nodes.map((n) => (
              <li key={n.id}>
                {n.key && <span className="mono">{`${n.key} `}</span>}
                {n.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One chip per agent (ui.md section 5): what it holds now, else what waits for it, else its last
 * finished step. A blocked item shows red with Retry. */
function AgentStrip({ s, items }: { s: AppState; items: ItemView[] }) {
  const agents = [...new Set(items.map((i) => i.agent))];
  if (agents.length === 0) return null;
  return (
    <ul className="agent-strip" aria-label="Agents">
      {agents.map((agent) => {
        const mine = items.filter((i) => i.agent === agent);
        const blocked = mine.find((i) => i.status === "blocked");
        const held = mine.find((i) => i.status === "claimed");
        const waiting = mine.filter((i) => i.status === "open");
        const done = mine.find((i) => i.status === "done"); // newest first from the gateway
        const text = held
          ? `${agent}: ${held.kind} (${held.leaseOwner ?? "claimed"})`
          : blocked
            ? `${agent}: ${blocked.kind} blocked`
            : waiting.length
              ? `${agent}: ${waiting[0]!.kind} waiting${waiting.length > 1 ? ` +${waiting.length - 1}` : ""}`
              : `${agent} ✓ ${done?.lastStep ?? done?.kind ?? ""}`;
        return (
          <li key={agent} className={`chip ${blocked ? "danger" : ""}`}>
            {text}
            {blocked && (
              <button type="button" onClick={() => void s.retry(blocked)}>
                Retry
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CardFace(props: { card: CardView; now: number; onOpen: () => void }) {
  const { card, now, onOpen } = props;
  const minutes =
    card.leaseUntil === null ? 0 : Math.max(0, Math.floor((card.leaseUntil - now) / 60_000));
  return (
    <button type="button" className={`card lane-${card.lane}`} onClick={onOpen}>
      <span className="mono">{card.key}</span>
      <span className="card-title">{card.title}</span>
      <span className="chips">
        {card.leaseHolder && (
          <span className="chip info">{`${card.leaseHolder} · ${minutes} min left`}</span>
        )}
        {card.testStatus !== "none" && <Chip status={card.testStatus} />}
        {card.commits.length > 0 && (
          <span className="chip">{`${card.commits.length} commit${card.commits.length === 1 ? "" : "s"}`}</span>
        )}
        {card.rework &&
          (card.crKeys.length ? card.crKeys : [null]).map((key) => (
            <span key={key ?? "rework"} className="chip warn">
              {key ? `Rework · ${key}` : "Rework"}
            </span>
          ))}
        {card.blocked && <span className="chip danger">Blocked</span>}
        {card.gate && card.gate.status !== "approved" && (
          <span className="chip warn">{`${card.gate.key} ${card.gate.status}`}</span>
        )}
        {card.mergedSha && <span className="chip ok">merged</span>}
      </span>
    </button>
  );
}

export function BoardView({ s }: { s: AppState }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The one timer of the board (ui.md section 1, rule 1): lease countdowns move each 30 seconds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  const open = s.board.data?.cards.find((c) => c.id === openId) ?? null;
  return (
    <section className="screen board">
      <h2>Board</h2>
      {s.progress.data && <ProgressHeader s={s} progress={s.progress.data} />}
      <SliceView
        slice={s.board}
        onRetry={() => void s.load("board")}
        empty="Cards appear after the documents are approved (G3)."
        isEmpty={(board) => board.cards.length === 0}
      >
        {(board) => (
          <>
            <AgentStrip s={s} items={board.items} />
            <table className="board-grid">
              <thead>
                <tr>
                  <th />
                  {board.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.lanes.map((lane) => (
                  <tr key={lane}>
                    <th scope="row">{lane}</th>
                    {board.columns.map((column) => (
                      <td key={column}>
                        {board.cards
                          .filter((c) => c.lane === lane && c.column === column)
                          .map((c) => (
                            <CardFace
                              key={c.id}
                              card={c}
                              now={now}
                              onOpen={() => setOpenId(c.id)}
                            />
                          ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </SliceView>
      {/* The key resets the drawer's form when another card, or a new version, opens. */}
      {open && (
        <CardDrawer
          key={`${open.id}-${open.version}`}
          s={s}
          card={open}
          close={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

export function Board({ store }: { store: AppStore }) {
  return <BoardView s={useStore(store)} />;
}
