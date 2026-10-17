// The live code view of a card: its file tree with what the card changed, one file with syntax
// colours and the changed lines marked, and the card's diff of it. While the build runs it reads
// the card's worktree and follows each `Edited <path>` step: the edited file opens and reloads.
import { useEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-markdown";
import { ChevronRight, Eye, FileCode, Folder, Radio } from "lucide-react";
import type { CardFilesResponse, CardView } from "@agencymem/contracts";
import { Patch } from "../pipeline/Evidence";
import type { AppState } from "../store";
import { useRead } from "../ui";

type S = Pick<AppState, "cardFiles" | "cardFile" | "runLog">;
type File = CardFilesResponse["files"][number];
/** A card, or main (`key: "main"`): the finished code, with no change of its own. */
export type CodeSource = Pick<CardView, "key" | "id" | "mergedSha">;
type Dir = { name: string; dirs: Map<string, Dir>; files: (File & { name: string })[] };

/** The line height of the code pane, in px: the changed-line bands are placed by it. */
const LINE = 20;
const LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  sql: "sql",
  css: "css",
  html: "markup",
  md: "markdown",
};

/** The new-file line numbers a unified diff adds. */
export function addedLines(diff: string): Set<number> {
  const out = new Set<number>();
  let line = 0;
  let inHunk = false;
  for (const text of diff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      inHunk = true;
    } else if (inHunk && text.startsWith("+")) out.add(line++);
    else if (inHunk && !text.startsWith("-") && !text.startsWith("\\")) line++;
  }
  return out;
}

/** The path an `Edited <path>` run step names. */
export const editedPath = (text: string) => /^Edited (.+)$/.exec(text)?.[1] ?? null;

function treeOf(files: File[]): Dir {
  const root: Dir = { name: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) dir.dirs.set(part, (next = { name: part, dirs: new Map(), files: [] }));
      dir = next;
    }
    dir.files.push({ ...f, name: parts.at(-1)! });
  }
  return root;
}

const changed = (d: Dir): boolean =>
  d.files.some((f) => f.change) || [...d.dirs.values()].some(changed);

function Tree(props: {
  dir: Dir;
  open: string | null;
  pick: (path: string) => void;
  prefix?: string;
}) {
  const { dir, prefix = "" } = props;
  return (
    <ul className="tree">
      {[...dir.dirs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => (
          <li key={d.name}>
            <details open={changed(d) || !!props.open?.startsWith(`${prefix}${d.name}/`)}>
              <summary>
                <ChevronRight className="icon chevron" aria-hidden="true" />
                <Folder className="icon" aria-hidden="true" />
                {d.name}
              </summary>
              <Tree dir={d} open={props.open} pick={props.pick} prefix={`${prefix}${d.name}/`} />
            </details>
          </li>
        ))}
      {dir.files
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className={`file ${f.path === props.open ? "on" : ""} ${f.change ?? ""}`}
              onClick={() => props.pick(f.path)}
            >
              <FileCode className="icon" aria-hidden="true" />
              {f.name}
              {f.change && <span className="badge">{f.change[0]!.toUpperCase()}</span>}
            </button>
          </li>
        ))}
    </ul>
  );
}

function FilePane(props: { s: S; card: CodeSource; file: File; stamp: number }) {
  const { s, card, file } = props;
  const merged = card.mergedSha ?? undefined;
  const [tab, setTab] = useState<"code" | "diff">("code");
  const box = useRef<HTMLDivElement>(null);
  const { data, error } = useRead(
    () => s.cardFile(card.key, file.path, merged),
    `file:${card.key}:${file.path}:${merged}:${props.stamp}`,
  );
  const lines = useMemo(() => (data ? data.text.split("\n") : []), [data]);
  const hits = useMemo(() => {
    if (!data) return new Set<number>();
    // A new, untracked file has no diff yet: every line is the card's.
    if (file.change === "added" && !data.diff) return new Set(lines.map((_, i) => i + 1));
    return addedLines(data.diff);
  }, [data, file.change, lines]);
  const html = useMemo(() => {
    if (!data) return "";
    const lang = LANGUAGE[file.path.split(".").at(-1) ?? ""];
    const grammar = lang ? Prism.languages[lang] : undefined;
    // Prism escapes the text it is given; a file with no grammar is escaped by Prism too.
    return grammar
      ? Prism.highlight(data.text, grammar, lang!)
      : Prism.util.encode(data.text).toString();
  }, [data, file.path]);
  // Bring the first changed line into view, as an editor jumps to an edit.
  const first = Math.min(...hits);
  useEffect(() => {
    if (box.current && Number.isFinite(first)) box.current.scrollTop = (first - 4) * LINE;
  }, [first, data]);

  return (
    <div className="file-pane">
      <header className="file-head">
        <span className="mono">{file.path}</span>
        {file.change && <span className={`chip change-${file.change}`}>{file.change}</span>}
        <span className="grow" />
        <span role="group" className="tabs-sm" aria-label="View">
          <button type="button" aria-pressed={tab === "code"} onClick={() => setTab("code")}>
            Code
          </button>
          <button type="button" aria-pressed={tab === "diff"} onClick={() => setTab("diff")}>
            Changes
          </button>
        </span>
      </header>
      {error && <p className="muted pad">{error}</p>}
      {!data && !error && <div className="skeleton" />}
      {data && tab === "code" && (
        <div className="code" ref={box} style={{ ["--line" as string]: `${LINE}px` }}>
          <div className="gutter" aria-hidden="true">
            {lines.map((_, i) => (
              <span key={i} className={hits.has(i + 1) ? "hit" : ""}>
                {i + 1}
              </span>
            ))}
          </div>
          <div className="code-body">
            {[...hits].map((n) => (
              <i key={n} className="band" style={{ top: (n - 1) * LINE }} />
            ))}
            <pre>
              <code dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          </div>
        </div>
      )}
      {data && tab === "diff" && (
        <div className="diff">
          {data.diff ? (
            <Patch lines={data.diff.split("\n")} />
          ) : (
            <p className="muted pad">
              {file.change === "added"
                ? "A new file: every line is new."
                : "The card did not change this file."}
            </p>
          )}
        </div>
      )}
      {data?.truncated && <p className="muted pad">The file is longer than shown.</p>}
    </div>
  );
}

const SOURCE = {
  worktree: "Live from the build worktree",
  merge: "As merged into main",
  main: "Main (the card has no worktree or merge yet)",
  none: "No code yet",
};

export function CodeView({ s, card }: { s: S; card: CodeSource }) {
  const merged = card.mergedSha ?? undefined;
  const edits = (s.runLog[card.id] ?? []).filter((st) => st.step === "edit");
  const lastEdit = edits.at(-1);
  const stamp = lastEdit?.seq ?? 0; // every new edit reloads the tree and the open file
  const { data, error } = useRead(
    () => s.cardFiles(card.key, merged),
    `files:${card.key}:${merged}:${stamp}`,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const files = data?.files ?? [];
  const live = follow && lastEdit ? editedPath(lastEdit.text) : null;
  const path =
    (live && files.some((f) => f.path === live) ? live : null) ??
    picked ??
    files.find((f) => f.change)?.path ??
    // ponytail: with no change to show (main), open the first source file, not a dotfile.
    files.find((f) => /\/[^/.][^/]*\.(tsx?|jsx?)$/.test(f.path))?.path ??
    files[0]?.path ??
    null;
  const file = files.find((f) => f.path === path);
  const tree = useMemo(() => treeOf(files), [files]);
  const changes = files.filter((f) => f.change).length;

  if (error) return <p className="muted">{error}</p>;
  if (!data) return <div className="skeleton" />;
  if (data.source === "none" || files.length === 0) {
    return (
      <p className="muted">No code yet. The view fills as soon as the build run writes a file.</p>
    );
  }
  return (
    <div className="ide">
      <header className="ide-bar">
        {data.source === "worktree" ? (
          <span className="chip accent live-chip">
            <Radio className="icon" aria-hidden="true" />
            {SOURCE.worktree}
          </span>
        ) : (
          <span className="chip">
            {card.key === "main" ? "Main · everything merged so far" : SOURCE[data.source]}
          </span>
        )}
        <span className="muted">
          {card.key === "main"
            ? `${files.length} files`
            : `${files.length} files · ${changes} changed by ${card.key}`}
        </span>
        {lastEdit && (
          <span className="muted grow">{`last edit: ${editedPath(lastEdit.text) ?? lastEdit.text}`}</span>
        )}
        {card.key !== "main" && (
          <label className="follow">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            <Eye className="icon" aria-hidden="true" />
            Follow edits
          </label>
        )}
      </header>
      <div className="ide-body">
        <nav className="ide-tree" aria-label="Files">
          <Tree
            dir={tree}
            open={path}
            pick={(p) => {
              setPicked(p);
              setFollow(false);
            }}
          />
        </nav>
        {file && <FilePane s={s} card={card} file={file} stamp={stamp} />}
      </div>
    </div>
  );
}
