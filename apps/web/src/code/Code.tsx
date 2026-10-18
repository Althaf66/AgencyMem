// The Code screen: all the code the agents wrote. On the left, where the code is: main (the
// finished code, everything merged) and each card, building (its live worktree), partial (commits
// not merged) or merged; on the right, the chosen source in the live code view.
import { useStore } from "zustand";
import { GitMerge, Radio } from "lucide-react";
import type { CardView } from "@agencymem/contracts";
import { CodeView, type CodeSource } from "../card/CodeView";
import { codeHash } from "../shell/router";
import type { AppState, AppStore } from "../store";
import { SliceView } from "../ui";

export type CodeState = "building" | "partial" | "merged" | "none";

/** How far a card's code is: written now in its worktree, committed, merged, or not started. */
export function codeState(card: CardView): CodeState {
  if (card.column === "In progress" && card.leaseHolder) return "building";
  if (card.mergedSha) return "merged";
  if (card.commits.length > 0) return "partial";
  return "none";
}

const ORDER: CodeState[] = ["building", "partial", "merged", "none"];
const MAIN: CodeSource = { key: "main", id: "main", mergedSha: null };
const commits = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

function sub(card: CardView, state: CodeState) {
  if (state === "building") return `${card.title} · ${card.leaseHolder} is writing it now`;
  if (state === "partial") return `${card.title} · ${commits(card.commits.length)}, not merged`;
  if (state === "merged") return `${card.title} · ${commits(card.commits.length)}`;
  return card.title;
}

function Sources(props: { project: string; cards: CardView[]; open: string }) {
  const rows = props.cards
    .map((card) => ({ card, state: codeState(card) }))
    .sort(
      (a, b) =>
        ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.card.key.localeCompare(b.card.key),
    );
  const merged = rows.filter((r) => r.state === "merged").length;
  const row = (key: string) => ({
    href: codeHash(props.project, key),
    className: `src ${props.open === key ? "on" : ""}`,
    "aria-current": props.open === key ? ("page" as const) : undefined,
  });
  return (
    <nav className="sources" aria-label="Where the code is">
      <span className="eyebrow">Completed</span>
      <a {...row("main")}>
        <span className="src-head">
          <GitMerge className="icon" aria-hidden="true" />
          <span className="src-key">main</span>
          <span className="chip ok">complete</span>
        </span>
        <span className="src-sub">{`Everything merged so far · ${merged} card${merged === 1 ? "" : "s"}`}</span>
      </a>
      <span className="eyebrow src-group">Cards</span>
      {rows.map(({ card, state }) =>
        state === "none" ? (
          <span key={card.key} className="src empty">
            <span className="src-head">
              <span className="src-key">{card.key}</span>
              <span className="chip">no code yet</span>
            </span>
            <span className="src-sub">{card.title}</span>
          </span>
        ) : (
          <a key={card.key} {...row(card.key)}>
            <span className="src-head">
              <span className="src-key">{card.key}</span>
              {state === "building" && (
                <span className="chip accent live-chip">
                  <Radio className="icon" aria-hidden="true" />
                  building
                </span>
              )}
            </span>
            <span className="src-sub">{sub(card, state)}</span>
          </a>
        ),
      )}
    </nav>
  );
}

export function CodeScreenView({ s, cardKey }: { s: AppState; cardKey: string | null }) {
  const project = s.projectId ?? "";
  return (
    <section className="screen code-screen">
      <header className="screen-head">
        <h2>Code</h2>
        <span className="muted">
          What the agents wrote: the finished code on main, and each card&apos;s code while it is
          being built.
        </span>
      </header>
      <SliceView
        slice={s.board}
        onRetry={() => void s.load("board")}
        empty="No code yet. Code appears here once the first card's build run writes a file."
        isEmpty={(b) => b.cards.length === 0}
      >
        {(b) => {
          // With no card named, open the card being built now, else main.
          const key = cardKey ?? b.cards.find((c) => codeState(c) === "building")?.key ?? "main";
          const card = b.cards.find((c) => c.key === key && codeState(c) !== "none");
          return (
            <div className="code-grid">
              <Sources project={project} cards={b.cards} open={card ? key : "main"} />
              <CodeView key={card?.key ?? "main"} s={s} card={card ?? MAIN} />
            </div>
          );
        }}
      </SliceView>
    </section>
  );
}

export function Code({ store, cardKey }: { store: AppStore; cardKey: string | null }) {
  return <CodeScreenView s={useStore(store)} cardKey={cardKey} />;
}
