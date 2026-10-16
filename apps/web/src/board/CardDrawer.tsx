// The card drawer (ui.md section 5, Board): the card's fields and criteria to edit (route 13, H1
// and H3), the moves a person may make (H2, H4, H5, H6) with the rule of a refused one written out,
// and what the card is linked to: requirement, dependencies, commits, note and run log.
import { useState } from "react";
import { Lane, type CardView } from "@agencymem/contracts";
import type { AppState } from "../store";
import { useBusy } from "../ui";

type Move = { label: string; patch: Parameters<AppState["patchTask"]>[1]; refused: string | null };

/** The human moves of stage-machine.md section 6 that apply to this card's column. */
function moves(card: CardView): Move[] {
  const out: Move[] = [];
  if (card.column === "Backlog" || card.column === "Rework") {
    const missing = card.criteria.filter((k) => k.testCaseCount === 0).map((k) => k.key);
    const fixWaits = card.kind === "fix" && card.gate?.status !== "approved";
    out.push({
      label: "Move to Ready",
      patch: { column: "Ready" },
      refused: missing.length
        ? `H2: every criterion needs a TestCase first (${missing.join(", ")}).`
        : fixWaits
          ? "H2: a fix card needs its G6 approved first."
          : null,
    });
  }
  if (card.column === "Ready") {
    out.push({ label: "Park in Backlog", patch: { column: "Backlog" }, refused: null });
  }
  if (card.column === "Done")
    out.push({ label: "Reopen", patch: { column: "Rework" }, refused: null });
  if (card.blocked) out.push({ label: "Unblock", patch: { unblock: true }, refused: null });
  return out;
}

export function CardDrawer(props: { s: AppState; card: CardView; close: () => void }) {
  const { s, card } = props;
  const [busy, run] = useBusy(card.version);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [lane, setLane] = useState<Lane>(card.lane);
  const [order, setOrder] = useState(card.order);
  const [criteria, setCriteria] = useState(
    card.criteria.map((k) => ({ key: k.key, text: k.text, testIds: k.testIds.join(", ") })),
  );
  const changed = {
    ...(title !== card.title ? { title } : {}),
    ...(description !== card.description ? { description } : {}),
    ...(lane !== card.lane ? { lane } : {}),
    ...(order !== card.order ? { order } : {}),
  };
  const number = card.key.slice("CARD-".length);
  // One past the highest number, so a gap (AC-01-1, AC-01-3) never repeats a key.
  const last = Math.max(0, ...criteria.map((k) => Number(k.key.split("-").at(-1))));
  const nextKey = `AC-${number}-${last + 1}`;
  const incomplete = criteria.some((k) => !k.text.trim() || !k.testIds.trim());
  const log = s.runLog[card.id] ?? [];

  return (
    <aside className="drawer" aria-label={`${card.key} ${card.title}`}>
      <header className="drawer-head">
        <span className="mono">{card.key}</span>
        <strong>{card.title}</strong>
        <button type="button" onClick={props.close}>
          Close
        </button>
      </header>

      <form
        className="card-edit"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => s.patchTask(card, changed));
        }}
      >
        <label>
          Title
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Description
          <textarea
            value={description}
            maxLength={1200}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Lane
          <select value={lane} onChange={(e) => setLane(e.target.value as Lane)}>
            {Lane.options.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          Order
          <input type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} />
        </label>
        <button type="submit" disabled={busy || Object.keys(changed).length === 0}>
          Save
        </button>
      </form>

      <section>
        <h3>Acceptance criteria</h3>
        {card.column === "Done" && <p className="muted">H3: a Done card's criteria are fixed.</p>}
        <ol className="criteria">
          {criteria.map((k, i) => (
            <li key={k.key}>
              <span className="mono">{k.key}</span>
              {` · ${card.criteria.find((c) => c.key === k.key)?.testCaseCount ?? 0} test cases`}
              <textarea
                value={k.text}
                aria-label={`${k.key} text`}
                maxLength={300}
                disabled={card.column === "Done"}
                onChange={(e) =>
                  setCriteria(
                    criteria.map((c, j) => (j === i ? { ...c, text: e.target.value } : c)),
                  )
                }
              />
              <input
                value={k.testIds}
                aria-label={`${k.key} data-testids`}
                disabled={card.column === "Done"}
                onChange={(e) =>
                  setCriteria(
                    criteria.map((c, j) => (j === i ? { ...c, testIds: e.target.value } : c)),
                  )
                }
              />
            </li>
          ))}
        </ol>
        {card.column !== "Done" && (
          <div className="row">
            <button
              type="button"
              disabled={criteria.length >= 3}
              onClick={() => setCriteria([...criteria, { key: nextKey, text: "", testIds: "" }])}
            >
              Add criterion
            </button>
            <button
              type="button"
              disabled={busy || incomplete}
              onClick={() =>
                void run(() =>
                  s.patchTask(card, {
                    criteria: criteria.map((k) => ({
                      key: k.key,
                      text: k.text.trim(),
                      testIds: k.testIds
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })),
                  }),
                )
              }
            >
              Save criteria
            </button>
            {criteria.length >= 3 && <span className="muted">A card has at most 3 criteria.</span>}
            {incomplete && (
              <span className="muted">
                Each criterion needs its text and at least one data-testid.
              </span>
            )}
          </div>
        )}
      </section>

      <section className="moves">
        <h3>Moves</h3>
        {moves(card).map((m) => (
          <div key={m.label} className="row">
            <button
              type="button"
              className="primary"
              disabled={busy || m.refused !== null}
              onClick={() => void run(() => s.patchTask(card, m.patch))}
            >
              {m.label}
            </button>
            {m.refused && <span className="blocked">{m.refused}</span>}
          </div>
        ))}
      </section>

      <section>
        <h3>Links</h3>
        <p>{`Requirement ${card.requirementKey}`}</p>
        {card.dependsOn.length > 0 && <p>{`Depends on ${card.dependsOn.join(", ")}`}</p>}
        {card.note && <p className="muted">{card.note}</p>}
        <ul>
          {card.commits.map((c) => (
            <li key={c.sha}>
              <span className="mono">{c.sha.slice(0, 7)}</span> {c.message}
            </li>
          ))}
        </ul>
      </section>

      {log.length > 0 && (
        <section>
          <h3>Run log</h3>
          <ol className="run-log">
            {log.map((step, i) => (
              <li key={i}>{`${step.agent}: ${step.text}`}</li>
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}
