// The health panel (ui.md, Health panel): the estimate error per closed project in run order, this
// project's numbers, the model calls priced per model and per agent, the work items by status with
// Retry on the blocked ones, the gates and the live link. Every number comes from routes 24 and 25
// and the snapshots; the browser only adds up the gateway's per-model rows by agent.
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { WorkItemStatus, type AgencyMetrics } from "@agencymem/contracts";
import type { AppState, AppStore, Metrics } from "../store";
import { Chip, SliceView } from "../ui";

const W = 360;
const H = 160;
const PAD = 32;
const pct = (n: number) => `${Math.round(n * 100)}%`;
/** Dollars: four places under a cent, so a cheap model's calls do not read $0.00. */
const usd = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
const k = (n: number) => n.toLocaleString();

/** Hand-drawn SVG (P, no chart package): one point per closed project, with its lessons as the tooltip. */
function ErrorChart({ agency }: { agency: AgencyMetrics }) {
  const points = agency.projects.filter((p) => p.closedAt !== null && p.estimateError !== null);
  if (!points.length)
    return <p className="muted">The curve appears after the first project closes.</p>;
  const top = Math.max(0.5, ...points.map((p) => p.estimateError!));
  const x = (i: number) => PAD + ((W - 2 * PAD) * (i + 0.5)) / points.length;
  const y = (e: number) => H - PAD - ((H - 2 * PAD) * e) / top;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Estimate error per project">
      <text x={4} y={y(top) + 4}>
        {pct(top)}
      </text>
      <text x={4} y={y(0) + 4}>
        0%
      </text>
      <polyline
        fill="none"
        stroke="currentColor"
        points={points.map((p, i) => `${x(i)},${y(p.estimateError!)}`).join(" ")}
      />
      {points.map((p, i) => (
        <g key={p.projectId}>
          <circle cx={x(i)} cy={y(p.estimateError!)} r={4}>
            <title>
              {`${p.name}: ${pct(p.estimateError!)} · lessons: ${
                p.lessons.map((l) => `${l.featureKind} (${l.clarityBand})`).join(", ") || "none"
              }`}
            </title>
          </circle>
          <text x={x(i)} y={H - 16} textAnchor="middle">
            {p.name}
          </text>
          <text x={x(i)} y={H - 4} textAnchor="middle">
            {p.clarityBand ?? ""}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Numbers({ m }: { m: Metrics }) {
  const r = m.rejected;
  return (
    <ul className="health-numbers">
      <li>{`Estimate error ${m.estimateError === null ? "none yet" : pct(m.estimateError)}`}</li>
      <li>{`Questions ${m.questions} · Contradictions ${m.contradictions}`}</li>
      <li>{`Cards reopened per CR ${m.cardsReopenedPerCR === null ? "none" : m.cardsReopenedPerCR.toFixed(1)}`}</li>
      <li>{`Rejected: claims ${r.claims} · writes ${r.writes} · completions ${r.completions} · queries ${r.queries}`}</li>
      <li>{`Coverage ${m.coverage.covered}/${m.coverage.total} · Backtrace ${m.backtraceMs === null ? "none" : `${m.backtraceMs} ms`}`}</li>
      <li>{`Tokens ${Math.round((m.tokensIn + m.tokensOut) / 1000)}k · Cost $${m.cost.toFixed(2)}`}</li>
    </ul>
  );
}

const noPrice = <span className="muted">no price</span>;

/** One row per agent and model, with the meter's price per million tokens, and the total. */
function ModelCost({ m }: { m: Metrics }) {
  if (!m.models.length) return <p className="muted">No model calls yet.</p>;
  return (
    <>
      <table className="compact">
        <thead>
          <tr>
            <th>Model</th>
            <th>Agent</th>
            <th>Runs</th>
            <th>Tokens in</th>
            <th>Tokens out</th>
            <th>$ / M in</th>
            <th>$ / M out</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {m.models.map((r) => (
            <tr key={`${r.agent}-${r.model}`}>
              <td className="mono">{r.model}</td>
              <td>{r.agent}</td>
              <td>{r.runs}</td>
              <td>{k(r.tokensIn)}</td>
              <td>{k(r.tokensOut)}</td>
              <td>{r.price ? usd(r.price.inPerMillion) : noPrice}</td>
              <td>{r.price ? usd(r.price.outPerMillion) : noPrice}</td>
              <td>{usd(r.cost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={3}>Total</th>
            <th>{k(m.tokensIn)}</th>
            <th>{k(m.tokensOut)}</th>
            <th colSpan={2} />
            <th>{usd(m.cost)}</th>
          </tr>
        </tfoot>
      </table>
      <p className="muted">
        List prices from packages/contracts/src/prices.ts. A model with no price counts the cost its
        run recorded.
      </p>
    </>
  );
}

function AgentCost({ m }: { m: Metrics }) {
  const agents = new Map<string, { runs: number; tokens: number; cost: number }>();
  for (const r of m.models) {
    const a = agents.get(r.agent) ?? { runs: 0, tokens: 0, cost: 0 };
    agents.set(r.agent, {
      runs: a.runs + r.runs,
      tokens: a.tokens + r.tokensIn + r.tokensOut,
      cost: a.cost + r.cost,
    });
  }
  if (!agents.size) return <p className="muted">No model calls yet.</p>;
  return (
    <table className="compact">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Runs</th>
          <th>Tokens</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {[...agents].map(([agent, a]) => (
          <tr key={agent}>
            <td>{agent}</td>
            <td>{a.runs}</td>
            <td>{k(a.tokens)}</td>
            <td>{usd(a.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkItems({ s }: { s: AppState }) {
  const items = s.board.data?.items ?? [];
  return (
    <ul className="health-numbers">
      {WorkItemStatus.options.map((status) => (
        <li key={status}>
          <Chip status={status} /> {items.filter((i) => i.status === status).length}
        </li>
      ))}
    </ul>
  );
}

function GatesAndLink({ s }: { s: AppState }) {
  return (
    <ul className="health-numbers">
      {(s.gates.data ?? []).map((g) => (
        <li key={g.key}>
          <span className="mono">{g.key}</span> <Chip status={g.status} />
        </li>
      ))}
      <li>
        {"Live link "}
        <span className={`conn ${s.connection}`}>{s.connection}</span>
        {` · last event seq ${s.lastSeq}`}
      </li>
    </ul>
  );
}

function Blocked({ s }: { s: AppState }) {
  const items = (s.board.data?.items ?? []).filter((i) => i.status === "blocked");
  if (!items.length) return <p>Blocked items: none</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          {`${item.agent}: ${item.kind} blocked${item.lastStep ? ` (${item.lastStep})` : ""}`}{" "}
          <button type="button" onClick={() => void s.retry(item)}>
            Retry
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HealthView({ s }: { s: AppState }) {
  const metrics = (body: (m: Metrics) => ReactNode) => (
    <SliceView slice={s.metrics} onRetry={() => void s.load("metrics")} empty="No numbers yet.">
      {body}
    </SliceView>
  );
  return (
    <section className="screen health">
      <h2>Health</h2>
      <div className="health-grid">
        <div>
          <h3>Estimate error per project</h3>
          <SliceView
            slice={s.agencyMetrics}
            onRetry={() => void s.load("agencyMetrics")}
            empty="The curve appears after the first project closes."
          >
            {(agency) => <ErrorChart agency={agency} />}
          </SliceView>
        </div>
        <div>
          <h3>This project</h3>
          {metrics((m) => (
            <Numbers m={m} />
          ))}
        </div>
        <div className="wide">
          <h3>Model cost</h3>
          {metrics((m) => (
            <ModelCost m={m} />
          ))}
        </div>
        <div>
          <h3>Cost by agent</h3>
          {metrics((m) => (
            <AgentCost m={m} />
          ))}
        </div>
        <div>
          <h3>Work items</h3>
          <WorkItems s={s} />
          <Blocked s={s} />
        </div>
        <div>
          <h3>Gates and live link</h3>
          <GatesAndLink s={s} />
        </div>
      </div>
    </section>
  );
}

export function Health({ store }: { store: AppStore }) {
  return <HealthView s={useStore(store)} />;
}
