// The built app, live: the gateway runs main's `npm run dev` and this screen shows it in a browser
// frame. Start, stop and reload; while it installs or starts, its last log lines show.
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { ExternalLink, Monitor, Play, RotateCw, Square } from "lucide-react";
import type { AppState, AppStore } from "../store";

const TONE = { ready: "ok", failed: "danger", stopped: "", installing: "warn", starting: "warn" };

export function PreviewPanel({ s, height = 640 }: { s: AppState; height?: number }) {
  // The app is another origin: a reload mounts a new frame.
  const [loads, setLoads] = useState(0);
  const { status, url, log } = s.preview;
  const busy = status === "installing" || status === "starting";
  return (
    <section className="browser">
      <header className="browser-bar">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="address mono">{url ?? "not running"}</span>
        <span className={`chip ${TONE[status]}`}>{status}</span>
        {status === "ready" && (
          <>
            <button
              type="button"
              className="ghost"
              title="Reload"
              onClick={() => setLoads((n) => n + 1)}
            >
              <RotateCw className="icon" aria-hidden="true" />
            </button>
            <a
              href={url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="button ghost"
              title="Open in a new tab"
            >
              <ExternalLink className="icon" aria-hidden="true" />
            </a>
          </>
        )}
        {status === "stopped" || status === "failed" ? (
          <button type="button" className="primary" onClick={() => void s.previewAction("POST")}>
            <Play className="icon" aria-hidden="true" />
            Run the app
          </button>
        ) : (
          <button type="button" onClick={() => void s.previewAction("DELETE")}>
            <Square className="icon" aria-hidden="true" />
            Stop
          </button>
        )}
      </header>
      {status === "ready" && url ? (
        <iframe key={loads} src={url} title="The built app" style={{ height }} />
      ) : (
        <div className="browser-empty" style={{ minHeight: Math.min(height, 360) }}>
          <Monitor className="icon big" aria-hidden="true" />
          <p>
            {busy
              ? status === "installing"
                ? "Installing the app's packages (first run only)…"
                : "Starting the app from main…"
              : status === "failed"
                ? "The app did not start. Its last output is below."
                : "Runs the code the agents merged into main, on this machine, and shows it here."}
          </p>
          {log.length > 0 && <pre className="log">{log.slice(-12).join("\n")}</pre>}
        </div>
      )}
    </section>
  );
}

export function PreviewScreen({ store, projectId }: { store: AppStore; projectId: string }) {
  const s = useStore(store);
  const ready = s.projectId === projectId;
  useEffect(() => {
    if (ready) void store.getState().previewAction("GET");
  }, [store, ready]);
  return (
    <section className="screen">
      <header className="screen-head">
        <h2>App preview</h2>
        <span className="muted">The client&apos;s app as the agents built it: main, run live.</span>
      </header>
      <PreviewPanel s={s} height={700} />
    </section>
  );
}
