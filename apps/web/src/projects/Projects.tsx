// The Projects screen (ui.md section 5): every project, and a form to create one.
import { useState } from "react";
import { useStore } from "zustand";
import type { Mode } from "@agencymem/contracts";
import type { AppState, AppStore } from "../store";
import { SliceView } from "../ui";

function NewProject({ s }: { s: AppState }) {
  const [clientName, setClientName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [mode, setMode] = useState<Mode>("live");
  return (
    <form
      className="new-project"
      onSubmit={(e) => {
        e.preventDefault();
        void s
          .createProject({ clientName: clientName.trim(), projectName: projectName.trim(), mode })
          .then((p) => {
            if (p) location.hash = `#/p/${p.id}/files`;
          });
      }}
    >
      <input
        required
        placeholder="Client name"
        value={clientName}
        onChange={(e) => setClientName(e.target.value)}
      />
      <input
        required
        placeholder="Project name"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
      />
      <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
        <option value="live">live</option>
        <option value="demo">demo</option>
      </select>
      <button type="submit" className="primary">
        New project
      </button>
    </form>
  );
}

export function ProjectsView({ s }: { s: AppState }) {
  return (
    <section className="screen">
      <h2>Projects</h2>
      <NewProject s={s} />
      <SliceView
        slice={s.projects}
        onRetry={() => void s.loadProjects()}
        empty={
          <p>
            No projects yet. Create one, or run <code>pnpm sim:run</code> for demo data.
          </p>
        }
      >
        {(projects) => (
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>client</th>
                <th>mode</th>
                <th>stage</th>
                <th>created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`#/p/${p.id}`}>{p.name}</a>
                  </td>
                  <td>{p.clientName}</td>
                  <td>{p.mode}</td>
                  <td>{p.stage}</td>
                  <td className="muted">{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SliceView>
    </section>
  );
}

export function Projects({ store }: { store: AppStore }) {
  return <ProjectsView s={useStore(store)} />;
}
