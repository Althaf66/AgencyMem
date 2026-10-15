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
  const nav = (screen: string, label: string) => (
    <a href={`#/p/${projectId}/${screen}`} className={route.screen === screen ? "active" : ""}>
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
        <ActorField />
      </header>
      {projectId && (
        <nav className="sidenav">
          {nav("files", "Files")}
          {nav("questions", "Questions")}
          {nav("gates", "Gates")}
        </nav>
      )}
      <main>{props.children}</main>
      <footer className="statusbar">{`connection: ${s.connection} · seq ${s.lastSeq}`}</footer>
      <Toasts s={s} />
    </div>
  );
}
