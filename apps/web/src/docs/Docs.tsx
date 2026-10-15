// The Documents screen (ui.md section 5, Documents): the Final PRD, the Technical Design and the
// Implementation Plan rendered from their sections, each opening with its Summary; gate G3 to
// approve them (US-06); and chat that sends a change to the Architect or records a change request.
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useState } from "react";
import { useStore } from "zustand";
import type { Doc, FeatureView } from "@agencymem/contracts";
import { GateRow } from "../gates/Gates";
import type { AppState, AppStore, Docs as DocsData } from "../store";
import { Chip, SliceView } from "../ui";

const TABS: [Doc, string][] = [
  ["prd", "Final PRD"],
  ["tdd", "Technical Design"],
  ["plan", "Implementation Plan"],
];

type Section = DocsData[Doc]["sections"][number];
type Target = { id: string; title: string };

/** Agent-written Markdown, cleaned before it reaches the page. */
function Markdown({ text }: { text: string }) {
  // Without a DOM (server render, tests) DOMPurify cannot clean, so show plain text instead.
  if (!DOMPurify.isSupported) return <p className="md">{text}</p>;
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }));
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function DocSectionView(props: {
  section: Section;
  features: Map<string, FeatureView>;
  onChat: (target: Target) => void;
}) {
  const { section } = props;
  return (
    <section className="doc-section">
      <h3>
        {section.title}
        {section.stale && <Chip status="stale" />}
      </h3>
      <Markdown text={section.body} />
      {section.renders.length > 0 && (
        <ul className="renders">
          {section.renders.map((node) => {
            const estimate = props.features.get(node.id)?.estimate;
            return (
              <li key={node.id}>
                <span className="mono">{node.key}</span> {node.text}
                {estimate && (
                  <span className="muted">{` ${estimate.hours} h · ${estimate.basis}`}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={() => props.onChat(section)}>
        Ask about this section
      </button>
    </section>
  );
}

function ChatDrawer(props: { s: AppState; target: Target | null; clear: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // ponytail: this page session's messages only; no route reads chat episodes back yet.
  const [sent, setSent] = useState<{ text: string; reply: string }[]>([]);
  const send = async () => {
    setBusy(true);
    const reply = await props.s.chat(text.trim(), props.target?.id);
    setBusy(false);
    if (!reply) return;
    setSent((list) => [...list, { text: text.trim(), reply }]);
    setText("");
    props.clear();
  };
  return (
    <aside className="chat">
      <h3>Chat</h3>
      <ul>
        {sent.map((m, i) => (
          <li key={i}>
            <p>{`you: ${m.text}`}</p>
            <p className="muted">{`-> ${m.reply}`}</p>
          </li>
        ))}
      </ul>
      {props.target && (
        <p className="muted">
          {`About: ${props.target.title} `}
          <button type="button" onClick={props.clear}>
            ×
          </button>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          required
          maxLength={2000}
          value={text}
          placeholder="Ask for a change"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="primary" disabled={!text.trim() || busy}>
          Send
        </button>
      </form>
    </aside>
  );
}

export function DocsView({ s, doc }: { s: AppState; doc: Doc }) {
  const [target, setTarget] = useState<Target | null>(null);
  const g3 = s.gates.data?.find((g) => g.key === "G3");
  const features = new Map((s.features.data ?? []).map((f) => [f.id, f]));
  return (
    <section className="screen docs">
      <h2>Documents</h2>
      <nav className="tabs">
        {TABS.map(([key, name]) => (
          <a key={key} href={`#/p/${s.projectId}/docs/${key}`} className={key === doc ? "active" : ""}>
            {name}
          </a>
        ))}
      </nav>
      {g3 && (
        <ul className="gates">
          <GateRow gate={g3} s={s} />
        </ul>
      )}
      <div className="docs-body">
        <SliceView
          slice={s.docs}
          onRetry={() => void s.load("docs")}
          empty="The documents appear after the proposal is approved."
          isEmpty={(d) => TABS.every(([key]) => d[key].sections.length === 0)}
        >
          {(docs) => (
            <article>
              {docs[doc].sections.map((section) => (
                <DocSectionView
                  key={section.id}
                  section={section}
                  features={features}
                  onChat={({ id, title }) => setTarget({ id, title })}
                />
              ))}
            </article>
          )}
        </SliceView>
        <ChatDrawer s={s} target={target} clear={() => setTarget(null)} />
      </div>
    </section>
  );
}

export function Docs({ store, doc }: { store: AppStore; doc: Doc }) {
  return <DocsView s={useStore(store)} doc={doc} />;
}
