// The node drawer (ui.md graph panel): one node from route 6 with its label, properties and links,
// and the views that fit its label: Why (any node), Impact (a Fact), Backtrace (a Defect). An ended
// fact names the fact that replaced it.
import { useEffect, useState } from "react";
import { graphHash } from "../shell/router";
import type { AppState } from "../store";
import { time } from "../ui";

/** Route 6's answer. */
type Found = Extract<Awaited<ReturnType<AppState["node"]>>, { ok: true }>["data"];

export function NodeDrawer(props: {
  s: Pick<AppState, "node" | "projectId">;
  nodeId: string;
  select: (id: string) => void;
  close: () => void;
}) {
  const { s, nodeId } = props;
  const { node } = s;
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    setError(null);
    void node(nodeId).then((r) => {
      if (!live) return;
      if (r.ok) setFound(r.data);
      else setError(r.error.reason);
    });
    return () => {
      live = false;
    };
  }, [node, nodeId]);

  const project = s.projectId ?? "";
  const { label, ...fields }: { label: string; [key: string]: unknown } = found?.node ?? {
    label: "",
  };
  const validTo = typeof fields.validTo === "number" ? fields.validTo : null;
  const replacedBy = found?.links.find((l) => l.type === "SUPERSEDES" && l.direction === "in");

  return (
    <aside className="drawer node-drawer" aria-label="Node">
      <header className="drawer-head">
        <strong>{label || "…"}</strong>
        <button type="button" onClick={props.close}>
          Close
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {found && (
        <>
          <nav className="row">
            <a href={graphHash(project, "why", nodeId)}>Why</a>
            {label === "Fact" && <a href={graphHash(project, "impact", nodeId)}>Impact</a>}
            {label === "Defect" && <a href={graphHash(project, "backtrace", nodeId)}>Backtrace</a>}
            {(label === "WorkItem" || label === "Task") && (
              <a href={graphHash(project, "read", nodeId)}>What it read</a>
            )}
          </nav>
          {validTo !== null && (
            <p className="chip warn">
              {`Ended ${time(validTo)}`}
              {replacedBy && (
                <>
                  {", replaced by "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => props.select(replacedBy.otherId)}
                  >
                    {replacedBy.otherTitle}
                  </button>
                </>
              )}
            </p>
          )}
          <dl className="props">
            {Object.entries(fields).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className={k === "id" ? "mono" : ""}>
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </dd>
              </div>
            ))}
          </dl>
          <h3>Links</h3>
          <ul>
            {found.links.map((l) => (
              <li key={`${l.type}-${l.direction}-${l.otherId}`}>
                <span className="muted">{`${l.direction === "out" ? "→" : "←"} ${l.type.toLowerCase().replaceAll("_", " ")} `}</span>
                <button type="button" className="link" onClick={() => props.select(l.otherId)}>
                  {`${l.otherLabel} ${l.otherTitle}`}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
