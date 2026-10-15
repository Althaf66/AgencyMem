// The gate panel (ui.md section 5, Gates): each gate with its status and who decided it. A button
// that cannot be used shows why (`blockedBy`), never a silent grey button.
import { useState } from "react";
import { useStore } from "zustand";
import type { GateKey, GateView } from "@agencymem/contracts";
import type { AppState, AppStore } from "../store";
import { Chip, SliceView, time, useBusy } from "../ui";

const NAMES: Record<GateKey, string> = {
  G1: "Answers",
  G2: "Proposal",
  G3: "Documents",
  G5: "Deploy",
  G6: "Fix",
};
// stage-machine.md section 5: G1 and G5 cannot be rejected.
const REJECTABLE: GateKey[] = ["G2", "G3", "G6"];

export function GateRow({ gate, s }: { gate: GateView; s: AppState }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, run] = useBusy(gate.version);
  const waiting = gate.status === "waiting";
  // Never a silent grey button (ui.md section 5): say why even when the gateway gave no reason.
  const blockedBy = gate.canDecide
    ? []
    : gate.blockedBy.length
      ? gate.blockedBy
      : ["not decidable yet"];
  return (
    <li className="gate-row">
      <div className="gate-head">
        <span className="mono">{gate.key}</span>
        <strong>{NAMES[gate.key]}</strong>
        <Chip status={gate.status} />
        {gate.decidedBy && (
          <span className="muted">{`by ${gate.decidedBy} · ${time(gate.decidedAt ?? 0)}`}</span>
        )}
        {gate.reason && <span className="muted">{`"${gate.reason}"`}</span>}
      </div>
      {waiting && (
        <div className="gate-actions">
          {blockedBy.length > 0 && (
            <span className="blocked">{`blocked: ${blockedBy.join("; ")}`}</span>
          )}
          <button
            type="button"
            className="primary"
            disabled={!gate.canDecide || busy}
            onClick={() => void run(() => s.decide(gate, "approve"))}
          >
            Approve
          </button>
          {REJECTABLE.includes(gate.key) && (
            <button
              type="button"
              disabled={!gate.canDecide || busy}
              onClick={() => setRejecting(true)}
            >
              Reject
            </button>
          )}
        </div>
      )}
      {waiting && rejecting && (
        <form
          className="reason"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => s.decide(gate, "reject", reason.trim())).then(
              (ok) => ok && setRejecting(false),
            );
          }}
        >
          <textarea
            required
            maxLength={300}
            value={reason}
            placeholder="Why is this rejected?"
            onChange={(e) => setReason(e.target.value)}
          />
          <button type="submit" disabled={!reason.trim() || busy}>
            Send
          </button>
          <button type="button" onClick={() => setRejecting(false)}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

export function GatesView({ s }: { s: AppState }) {
  return (
    <section className="screen">
      <h2>Gates</h2>
      <SliceView slice={s.gates} onRetry={() => void s.load("gates")} empty="No gates yet.">
        {(gates) => (
          <ul className="gates">
            {gates.map((gate) => (
              <GateRow key={gate.id} gate={gate} s={s} />
            ))}
          </ul>
        )}
      </SliceView>
    </section>
  );
}

export function Gates({ store }: { store: AppStore }) {
  return <GatesView s={useStore(store)} />;
}
