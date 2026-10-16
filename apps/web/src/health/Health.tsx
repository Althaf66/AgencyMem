// The health panel (ui.md, Health panel): the estimate error per closed project in run order, this
// project's numbers, and the blocked items with Retry. Every number comes from routes 24 and 25;
// the browser computes none of them.
import { useStore } from "zustand";
import type { AgencyMetrics } from "@agencymem/contracts";
import type { AppState, AppStore, Metrics } from "../store";
import { SliceView } from "../ui";

const W = 360;
const H = 160;
const PAD = 32;
const pct = (n: number) => `${Math.round(n * 100)}%`;

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
          <Blocked s={s} />
        </div>
        <div>
          <h3>This project</h3>
          <SliceView
            slice={s.metrics}
            onRetry={() => void s.load("metrics")}
            empty="No numbers yet."
          >
            {(m) => <Numbers m={m} />}
          </SliceView>
        </div>
      </div>
    </section>
  );
}

export function Health({ store }: { store: AppStore }) {
  return <HealthView s={useStore(store)} />;
}
