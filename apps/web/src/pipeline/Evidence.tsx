// The evidence an item leaves, each part read from the gateway when it opens: what it read from the
// graph (RECALLED links), what it wrote (outputIds), its model calls (Run nodes), its live steps,
// a commit's diff, and a card's test runs.
import { Brain, Cpu, FileCode, FlaskConical, Network, PenLine } from "lucide-react";
import { graphHash } from "../shell/router";
import type { AppState, RunStep } from "../store";
import { time, useRead } from "../ui";

type S = Pick<AppState, "projectId" | "node" | "itemRuns" | "commitDiff" | "testRuns" | "graph">;

const focus = (s: S, id: string) => graphHash(s.projectId ?? "", "why", id);

/** Labels with their counts, most first. */
function countBy(labels: string[]): [string, number][] {
  const out = new Map<string, number>();
  for (const l of labels) out.set(l, (out.get(l) ?? 0) + 1);
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

/** What the item read from the graph and what it wrote back (route 6 on the item). */
export function ContextRead(props: { s: S; itemId: string; wrote?: boolean }) {
  const { s, itemId, wrote = true } = props;
  const { data, error } = useRead(() => s.node(itemId), `node:${itemId}`);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <div className="skeleton" />;
  const read = data.links.filter((l) => l.type === "RECALLED" && l.direction === "out");
  const outputIds = Array.isArray(data.node.outputIds) ? (data.node.outputIds as string[]) : [];
  const known = new Map(s.graph.data?.graph.nodes.map((n) => [n.id, n]) ?? []);
  const summary = typeof data.node.summary === "string" ? data.node.summary : null;
  return (
    <div className="evidence-grid">
      <section>
        <h4>
          <Brain className="icon" aria-hidden="true" />
          {`Read from the graph · ${read.length} nodes`}
          {read.length > 0 && (
            <a className="chip accent" href={graphHash(s.projectId ?? "", "read", itemId)}>
              <Network className="icon" aria-hidden="true" />
              Show on graph
            </a>
          )}
        </h4>
        {read.length === 0 ? (
          <p className="muted">
            No recorded read. Items that ran before reads were recorded show none.
          </p>
        ) : (
          <>
            <p className="row">
              {countBy(read.map((l) => l.otherLabel)).map(([label, n]) => (
                <span key={label} className="chip info">{`${n} ${label}`}</span>
              ))}
            </p>
            <ul className="node-list">
              {read.slice(0, 40).map((l) => (
                <li key={l.otherId}>
                  <span className="muted">{l.otherLabel}</span>{" "}
                  <a href={focus(s, l.otherId)}>{l.otherTitle}</a>
                </li>
              ))}
              {read.length > 40 && <li className="muted">{`and ${read.length - 40} more`}</li>}
            </ul>
          </>
        )}
      </section>
      {wrote && (
        <section>
          <h4>
            <PenLine className="icon" aria-hidden="true" />
            {`Wrote · ${outputIds.length} nodes`}
          </h4>
          {summary && <p>{summary}</p>}
          <ul className="node-list">
            {outputIds.slice(0, 40).map((id) => {
              const n = known.get(id);
              return (
                <li key={id}>
                  {n && <span className="muted">{n.label}</span>}{" "}
                  <a href={focus(s, id)}>{n?.title ?? id}</a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The item's model calls: one Run node each. */
export function ModelCalls({ s, itemId }: { s: S; itemId: string }) {
  const { data, error } = useRead(() => s.itemRuns(itemId), `runs:${itemId}`);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <div className="skeleton" />;
  if (data.runs.length === 0) return <p className="muted">No model calls recorded.</p>;
  const total = data.runs.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0);
  return (
    <section>
      <h4>
        <Cpu className="icon" aria-hidden="true" />
        {`Model calls · ${data.runs.length} · ${total.toLocaleString()} tokens`}
      </h4>
      <table className="compact">
        <thead>
          <tr>
            <th>Step</th>
            <th>Model</th>
            <th>Endpoint</th>
            <th className="num">In</th>
            <th className="num">Out</th>
            <th className="num">ms</th>
            <th>At</th>
          </tr>
        </thead>
        <tbody>
          {data.runs.map((r, i) => (
            <tr key={i}>
              <td className="mono">{r.step}</td>
              <td className="mono">{r.model}</td>
              <td>{r.endpoint ?? ""}</td>
              <td className="num">{r.tokensIn.toLocaleString()}</td>
              <td className="num">{r.tokensOut.toLocaleString()}</td>
              <td className="num">{r.ms.toLocaleString()}</td>
              <td className="muted">{time(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Live steps from run.step events (kept while the gateway runs). */
export function StepLog({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return null;
  return (
    <section>
      <h4>Live steps</h4>
      <ol className="run-log">
        {steps.map((step) => (
          <li key={step.seq}>
            <span className="step-name">{step.step}</span> {step.text}
            <span className="muted">
              {[
                ` · ${time(step.at)}`,
                step.model,
                step.tokens ? `${step.tokens} tok` : null,
                step.ms ? `${step.ms} ms` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A patch line's class. The file header (diff, index, ---, +++) is everything before the first
 * hunk; inside a hunk a line starting "---" is a removed line, not a header. */
export function lineClass(line: string, inHunk: boolean): string {
  if (line.startsWith("@@")) return "hunk";
  if (!inHunk) return "meta";
  return line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
}

/** A patch's lines, coloured: header, hunk, added, removed. */
export function Patch({ lines }: { lines: string[] }) {
  const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
  return (
    <pre>
      {lines.map((line, i) => (
        <span key={i} className={lineClass(line, firstHunk !== -1 && i > firstHunk)}>
          {`${line}\n`}
        </span>
      ))}
    </pre>
  );
}

/** One commit's patch, file by file, read from the project's repo. */
export function DiffView({ s, sha }: { s: S; sha: string }) {
  const { data, error } = useRead(() => s.commitDiff(sha), `diff:${sha}`);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <div className="skeleton" />;
  return (
    <div className="diff">
      {data.files.map((f) => {
        const lines = f.patch.split("\n");
        const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
        const body = firstHunk === -1 ? [] : lines.slice(firstHunk);
        const added = body.filter((l) => l.startsWith("+")).length;
        const removed = body.filter((l) => l.startsWith("-")).length;
        return (
          <details key={f.path} className="diff-file" open={data.files.length <= 3}>
            <summary>
              <FileCode className="icon" aria-hidden="true" />
              <span className="mono">{f.path}</span>
              <span className="add-n">{`+${added}`}</span>
              <span className="del-n">{`-${removed}`}</span>
            </summary>
            <Patch lines={lines} />
          </details>
        );
      })}
      {data.truncated && <p className="muted">The diff is longer than shown.</p>}
    </div>
  );
}

/** A card's test runs, newest first. */
export function TestRuns({ s, taskId }: { s: S; taskId: string }) {
  const { data, error } = useRead(() => s.testRuns(taskId), `tests:${taskId}`);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <div className="skeleton" />;
  if (data.runs.length === 0) return <p className="muted">No test runs yet.</p>;
  return (
    <ul className="test-runs">
      {data.runs.map((r) => (
        <li key={`${r.id}-${r.testCase}`} className={r.passed ? "pass" : "fail"}>
          <FlaskConical className="icon" aria-hidden="true" />
          <span>
            <strong>{r.passed ? "passed" : "failed"}</strong> {r.testCase}
            <span className="feed-meta">
              {`${r.file} · ${r.scope} · ${r.durationMs} ms · ${r.sha.slice(0, 7)} · ${time(r.ranAt)}`}
            </span>
            {r.error && <code className="error-text">{r.error}</code>}
          </span>
        </li>
      ))}
    </ul>
  );
}
