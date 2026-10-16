// The gate panel (ui.md section 5, Gates): each gate with its status and who decided it. A button
// that cannot be used shows why (`blockedBy`), never a silent grey button.
import { useState } from "react";
import { useStore } from "zustand";
import type { GateKey, GateView } from "@agencymem/contracts";
import type { AppState, AppStore, Readiness } from "../store";
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

/** G5's five readiness checks with pass or fail and how many nodes fail each (ui.md, Gates). */
function Checks({ report }: { report: NonNullable<Readiness> }) {
  return (
    <ul className="checks">
      {report.checks.map((c) => (
        <li key={c.name}>
          <span className="mono">{c.name}</span>{" "}
          <span className={c.passed ? "pass" : "fail"}>{c.passed ? "pass" : "fail"}</span>{" "}
          <span className="muted">
            {`${c.detail}${c.nodeIds.length ? ` · ${c.nodeIds.length} nodes` : ""}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function GateRow({ gate, s }: { gate: GateView; s: AppState }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  // G5 (T23): the environment, and for a failed report "Approve anyway" with a reason.
  const [environment, setEnvironment] = useState("");
  const [override, setOverride] = useState(false);
  const deploy = gate.key === "G5";
  const report = deploy ? s.readiness.data : null;
  const failed = report !== null && !report.passed;
  // What the G5 form still needs, said next to the button like blockedBy.
  const deployBlocks = deploy
    ? [
        ...(environment.trim() ? [] : ["needs an environment"]),
        ...(failed && !(override && reason.trim())
          ? ["a failed report needs Approve anyway and a reason"]
          : []),
      ]
    : [];
  const deployReady = deployBlocks.length === 0;
  const [busy, run] = useBusy(gate.version);
  const waiting = gate.status === "waiting";
  // Never a silent grey button (ui.md section 5): say why even when the gateway gave no reason.
  const blockedBy = gate.canDecide
    ? deployBlocks
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
      {report && <Checks report={report} />}
      {waiting && deploy && (
        <div className="deploy">
          <input
            name="environment"
            required
            maxLength={40}
            value={environment}
            placeholder="Environment, for example demo"
            onChange={(e) => setEnvironment(e.target.value)}
          />
          {failed && (
            <label>
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />{" "}
              Approve anyway
            </label>
          )}
          {failed && override && (
            <textarea
              required
              maxLength={300}
              value={reason}
              placeholder="Why deploy with a failed check?"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </div>
      )}
      {waiting && (
        <div className="gate-actions">
          {blockedBy.length > 0 && (
            <span className="blocked">{`blocked: ${blockedBy.join("; ")}`}</span>
          )}
          <button
            type="button"
            className="primary"
            disabled={!gate.canDecide || busy || !deployReady}
            onClick={() =>
              void run(() =>
                deploy
                  ? s.decide(gate, "approve", failed ? reason.trim() : undefined, {
                      environment: environment.trim(),
                      override: failed,
                    })
                  : s.decide(gate, "approve"),
              )
            }
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
