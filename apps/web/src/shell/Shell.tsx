// The shell (ui.md section 2): the side nav with icons, the top bar with the project, the stage rail
// and the actor name; the status bar with the WebSocket state and the last seq; toasts.
import { useState, type ReactNode } from "react";
import {
  Activity,
  FileText,
  FileUp,
  House,
  MessageCircleQuestion,
  Network,
  ShieldCheck,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
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
          <li
            key={name}
            className={i < now ? "done" : i === now ? "current" : ""}
            title={name.replace("_", " ")}
          >
            <span className="name">{name.replace("_", " ")}</span>
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
      as human
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

const Brand = () => (
  <a href="#/" className="brand">
    <span className="logo" aria-hidden="true" />
    AgencyMem
  </a>
);

export function Shell(props: { store: AppStore; route: Route; children: ReactNode }) {
  const s = useStore(props.store);
  const { route } = props;
  const projectId = route.screen === "projects" ? null : route.projectId;
  const nav = (screen: string, label: string, Icon: LucideIcon, path = screen) => (
    <a href={`#/p/${projectId}/${path}`} className={route.screen === screen ? "active" : ""}>
      <Icon className="icon" aria-hidden="true" />
      {label}
    </a>
  );
  return (
    <div className={projectId ? "shell" : "shell bare"}>
      <header className="topbar">
        {!projectId && <Brand />}
        {projectId && (
          <span className="project">
            <span className="muted">{s.project.data?.clientName ?? ""}</span>
            <strong>{s.project.data?.name ?? "…"}</strong>
          </span>
        )}
        {projectId && <StageStepper s={s} />}
        {projectId && <ChangeRequestButton s={s} />}
        <ActorField />
      </header>
      {projectId && (
        <nav className="sidenav">
          <Brand />
          <span className="eyebrow">Overview</span>
          {nav("home", "Home", House)}
          {nav("graph", "Graph", Network)}
          <span className="eyebrow">Discover</span>
          {nav("files", "Files", FileUp)}
          {nav("questions", "Questions", MessageCircleQuestion)}
          {nav("docs", "Docs", FileText, "docs/prd")}
          {nav("gates", "Gates", ShieldCheck)}
          <span className="eyebrow">Deliver</span>
          {nav("board", "Board", SquareKanban)}
          {nav("health", "Health", Activity)}
          <div className="side-foot">
            <span className={`conn ${s.connection}`}>{s.connection}</span>
          </div>
        </nav>
      )}
      <main>{props.children}</main>
      <footer className="statusbar">{`connection: ${s.connection} · seq ${s.lastSeq}`}</footer>
      <Toasts s={s} />
    </div>
  );
}
