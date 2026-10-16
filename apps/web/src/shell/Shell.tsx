// The shell (ui.md section 2): top bar with the project, the stage stepper and the actor name; the
// side nav; the status bar with the WebSocket state and the last seq; toasts.
import { useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Stage, type GateKey, type GateStatus } from "@agencymem/contracts";
import type { AppState, AppStore } from "../store";
import { getActor, setActor } from "./actor";
import type { Route } from "./router";

/** The gate between a stage and the next one. */
const GATE_AFTER: Partial<Record<Stage, GateKey>> = {
  discovery: "G1",
  proposal: "G2",
  design: "G3",
  launch: "G5",
};

/** The ten stages of the life cycle; `closed` only marks the end (stage-machine.md section 2). */
const STAGES: readonly Stage[] = Stage.options.filter((name) => name !== "closed");

export function StageStepper({ s }: { s: AppState }) {
  const stage = s.project.data?.stage;
  const now = stage ? STAGES.indexOf(stage) : -1;
  const status = (key: GateKey): GateStatus | undefined =>
    s.gates.data?.find((g) => g.key === key)?.status;
  return (
    <ol className="stepper" aria-label="Stage">
      {STAGES.map((name, i) => {
        const gate = GATE_AFTER[name];
        return (
          <li key={name} className={i < now ? "done" : i === now ? "current" : ""}>
            {name.replace("_", " ")}
            {gate && (
              <span className={`diamond ${status(gate) ?? ""}`}>
                {gate}
                <span className="visually-hidden">{` ${status(gate) ?? "waiting"}`}</span>
                {status(gate) === "approved" ? " ✓" : ""}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ActorField() {
  const [name, setName] = useState(getActor());
  return (
    <label className="actor">
      as human:
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setActor(name)}
        size={8}
      />
    </label>
  );
}

/** stage-machine.md section 7: change requests from G2 approval until the project closes. */
const CR_STAGES: readonly Stage[] = ["design", "planning", "build", "e2e", "launch", "maintenance"];

/** The top bar's "Change request" button and its dialog (route 22). */
export function ChangeRequestButton({ s }: { s: AppState }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const stage = s.project.data?.stage;
  const allowed = stage !== undefined && CR_STAGES.includes(stage);
  if (!open) {
    return (
      <button
        type="button"
        disabled={!allowed}
        title={
          allowed
            ? undefined
            : stage === "case_study" || stage === "closed"
              ? "The project is closed; it takes no change requests."
              : "Change requests start once the proposal is approved (G2)."
        }
        onClick={() => setOpen(true)}
      >
        Change request
      </button>
    );
  }
  return (
    <form
      className="cr-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void s.changeRequest(text.trim()).then((key) => {
          setBusy(false);
          if (!key) return;
          s.toast(`Recorded as change request ${key}`);
          setText("");
          setOpen(false);
        });
      }}
    >
      <textarea
        required
        maxLength={2000}
        value={text}
        placeholder="What should change?"
        aria-label="Change request text"
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="primary" disabled={!text.trim() || busy}>
        Send
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function Toasts({ s }: { s: AppState }) {
  return (
    <div className="toasts" role="status">
      {s.toasts.map((t) => (
        <button type="button" key={t.id} className="toast" onClick={() => s.dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

export function Shell(props: { store: AppStore; route: Route; children: ReactNode }) {
  const s = useStore(props.store);
  const { route } = props;
  const projectId = route.screen === "projects" ? null : route.projectId;
  const nav = (screen: string, label: string, path = screen) => (
    <a href={`#/p/${projectId}/${path}`} className={route.screen === screen ? "active" : ""}>
      {label}
    </a>
  );
  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand">
          AgencyMem
        </a>
        {projectId && <span className="project">{s.project.data?.name ?? "…"}</span>}
        {projectId && <StageStepper s={s} />}
        {projectId && <ChangeRequestButton s={s} />}
        <ActorField />
      </header>
      {projectId && (
        <nav className="sidenav">
          {nav("board", "Board")}
          {nav("files", "Files")}
          {nav("questions", "Questions")}
          {nav("docs", "Docs", "docs/prd")}
          {nav("gates", "Gates")}
        </nav>
      )}
      <main>{props.children}</main>
      <footer className="statusbar">{`connection: ${s.connection} · seq ${s.lastSeq}`}</footer>
      <Toasts s={s} />
    </div>
  );
}
