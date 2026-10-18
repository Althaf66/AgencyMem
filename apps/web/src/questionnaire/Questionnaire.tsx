// The questionnaire (ui.md section 5): contradictions first, then open questions, then unclear
// points. Each card shows the question, its five parts, the answer and the answer buttons; only the
// lines from the uploaded files (a contradiction's two side by side) sit in a dropdown.
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useStore } from "zustand";
import type { QuestionKind, QuestionView } from "@agencymem/contracts";
import type { AppState, AppStore } from "../store";
import { Chip, SliceView, time, useBusy } from "../ui";

const GROUPS: { kind: QuestionKind; title: string }[] = [
  { kind: "contradiction", title: "Contradictions" },
  { kind: "open", title: "Open questions" },
  { kind: "unclear", title: "Unclear points" },
];

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
// "kickoff-notes.pdf (fact 01M5…)", "facts 01A… and 01B…" or a bare id: the graph links the facts,
// so the reader needs the file name, not the id.
const IDS = new RegExp(
  String.raw`\(?\b(?:[Ff]acts?:?\s+)?${ULID}(?:\s*(?:,|and|&)\s*(?:[Ff]acts?\s+)?${ULID})*\)?`,
  "g",
);

/** A question part as the person reads it: without the fact ids a model wrote into the text. */
export const withoutIds = (text: string) =>
  text
    .replace(IDS, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

const where = (src: QuestionView["sources"][number]) =>
  [
    src.documentName ?? "answer",
    src.page ? `p${src.page}` : null,
    src.lineStart ? `l${src.lineStart}-${src.lineEnd ?? src.lineStart}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

export function SourcePair({ question }: { question: QuestionView }) {
  const two = question.kind === "contradiction";
  return (
    <div className={`source-pair ${two ? "two" : "one"}`}>
      {question.sources.map((src) => (
        <figure key={`${src.factId}-${src.episodeId}`} className="source">
          <figcaption className="mono">{where(src)}</figcaption>
          <blockquote>{src.text}</blockquote>
        </figure>
      ))}
    </div>
  );
}

function QuestionCard({ q, s }: { q: QuestionView; s: AppState }) {
  const [own, setOwn] = useState(false);
  const [text, setText] = useState("");
  const [busy, run] = useBusy(q.version);
  return (
    <article className={`question ${q.status}`}>
      <header className="question-head">
        <span className="kind">{q.kind}</span>
        <h3>{q.text}</h3>
        <Chip status={q.status} />
      </header>
      <div className="question-body">
        <details className="sources-drop">
          <summary>
            <ChevronRight className="icon chevron" aria-hidden="true" />
            {`Lines from the uploaded files (${q.sources.length})`}
          </summary>
          <SourcePair question={q} />
        </details>
        <dl className="parts">
          <dt>Recommended</dt>
          <dd>{withoutIds(q.recommended)}</dd>
          <dt>Reasoning</dt>
          <dd>{withoutIds(q.reasoning)}</dd>
          <dt>Assumption</dt>
          <dd>
            {withoutIds(q.assumption.text)} <Chip status={q.assumption.status} />
          </dd>
          <dt>Approach</dt>
          <dd>{withoutIds(q.approach)}</dd>
          {q.answer && (
            <>
              <dt>Answer</dt>
              <dd>
                {q.answer.text}{" "}
                <span className="muted">{`${q.answer.actor} · ${time(q.answer.at)}`}</span>
              </dd>
            </>
          )}
        </dl>
        {q.status === "open" && !own && (
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void run(() => s.answer(q, true))}
            >
              Accept recommended
            </button>
            <button type="button" onClick={() => setOwn(true)}>
              Answer differently
            </button>
          </div>
        )}
        {q.status === "open" && own && (
          <form
            className="reason"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => s.answer(q, false, text.trim()));
            }}
          >
            <textarea
              required
              maxLength={2000}
              value={text}
              placeholder="Your answer"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="primary" disabled={!text.trim() || busy}>
              Send
            </button>
            <button type="button" onClick={() => setOwn(false)}>
              Cancel
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

/** Empty: Discovery has not written its questions yet; its run log shows what it is doing. */
function DiscoveryRunning({ s }: { s: AppState }) {
  const steps = Object.values(s.runLog)
    .flat()
    .filter((step) => step.agent === "discovery");
  return (
    <>
      <p>Discovery is still running. Its questions appear here when it is done.</p>
      {steps.length > 0 && (
        <ol className="run-log">
          {steps.map((step, i) => (
            <li key={i}>
              <span className="mono">{step.step}</span> {step.text}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function QuestionnaireView({ s }: { s: AppState }) {
  return (
    <section className="screen">
      <SliceView
        slice={s.questions}
        onRetry={() => void s.load("questions")}
        empty={<DiscoveryRunning s={s} />}
      >
        {(questions) => {
          const count = (kind: QuestionKind) => questions.filter((q) => q.kind === kind).length;
          const answered = questions.filter((q) => q.status === "answered").length;
          const open = questions.length - answered;
          return (
            <>
              <header className="screen-head">
                <h2>Questions</h2>
                <span>{`Contradictions ${count("contradiction")} · Open ${count("open")} · Unclear ${count("unclear")}`}</span>
                <strong>{`Answered ${answered} of ${questions.length}`}</strong>
                {open > 0 && (
                  <a
                    href={`#/p/${s.projectId}/gates`}
                  >{`G1: ${open} ${open === 1 ? "question" : "questions"} still open`}</a>
                )}
              </header>
              {GROUPS.map(({ kind, title }) => {
                const group = questions.filter((q) => q.kind === kind);
                if (group.length === 0) return null;
                return (
                  <section key={kind} className="group">
                    <h3>{title}</h3>
                    {group.map((q) => (
                      <QuestionCard key={q.id} q={q} s={s} />
                    ))}
                  </section>
                );
              })}
            </>
          );
        }}
      </SliceView>
    </section>
  );
}

export function Questionnaire({ store }: { store: AppStore }) {
  return <QuestionnaireView s={useStore(store)} />;
}
