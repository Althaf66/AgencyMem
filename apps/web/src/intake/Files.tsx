// The Files screen (ui.md section 5): drop or choose files for intake, the documents with their
// status, and a row's episodes with page and line range.
import { useState, type DragEvent } from "react";
import { useStore } from "zustand";
import { UPLOAD_RULES, type DocumentInfo } from "@agencymem/contracts";
import type { AppState, AppStore } from "../store";
import { Chip, SliceView } from "../ui";

function DropZone({ s }: { s: AppState }) {
  const [busy, setBusy] = useState(false);
  if (s.project.data && s.project.data.stage !== "intake") {
    return (
      <div className="drop closed">
        Uploads closed: Discovery has started. Use a change request for new information.
      </div>
    );
  }
  const send = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    if (files.length > UPLOAD_RULES.maxFiles) {
      return s.toast(`Up to ${UPLOAD_RULES.maxFiles} files at a time.`);
    }
    setBusy(true);
    await s.upload(files);
    setBusy(false);
  };
  return (
    <label
      className="drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        void send([...e.dataTransfer.files]);
      }}
    >
      {busy ? "Uploading…" : "Drop PDF, DOCX, TXT or MD files here (up to 10)"}
      <input
        type="file"
        multiple
        accept={UPLOAD_RULES.extensions.join(",")}
        disabled={busy}
        className="visually-hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ""; // choosing the same file again uploads it again
          void send(files);
        }}
      />
      <span className="button" aria-hidden="true">
        Choose
      </span>
    </label>
  );
}

function DocumentRow({ doc, s }: { doc: DocumentInfo; s: AppState }) {
  const [episodes, setEpisodes] = useState<string[] | null>(null);
  const toggle = async () => {
    if (episodes) return setEpisodes(null);
    const result = await s.node(doc.id);
    if (!result.ok) return s.toast(result.error.reason);
    setEpisodes(
      result.data.links
        .filter((l) => l.otherLabel === "Episode" && l.direction === "in")
        .map((l) => l.otherTitle),
    );
  };
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="link"
            aria-expanded={episodes !== null}
            onClick={() => void toggle()}
          >
            {doc.name}
          </button>
        </td>
        <td>
          <Chip status={doc.status} />
        </td>
        <td className="num">{doc.episodeCount}</td>
        <td className="num">{doc.wordCount}</td>
        <td className="muted">{doc.error ?? ""}</td>
      </tr>
      {episodes && (
        <tr className="episodes">
          <td colSpan={5}>
            {episodes.length ? (
              <ul>
                {episodes.map((title, i) => (
                  <li key={i} className="mono">
                    {title}
                  </li>
                ))}
              </ul>
            ) : (
              "No episodes."
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function FilesView({ s }: { s: AppState }) {
  return (
    <section className="screen">
      <h2>Files</h2>
      <DropZone s={s} />
      <SliceView
        slice={s.documents}
        onRetry={() => void s.load("documents")}
        empty="No files yet. Drop the meeting notes above to start intake."
      >
        {(documents) => (
          <table>
            <thead>
              <tr>
                <th>file</th>
                <th>status</th>
                <th className="num">episodes</th>
                <th className="num">words</th>
                <th>error</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} s={s} />
              ))}
            </tbody>
          </table>
        )}
      </SliceView>
    </section>
  );
}

export function Files({ store }: { store: AppStore }) {
  return <FilesView s={useStore(store)} />;
}
