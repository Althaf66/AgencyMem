Own rules:

Definitions:
| Kind | Definition | Must link to |
| --- | --- | --- |
| contradiction | Two or more current facts, from different episodes, that cannot all be true for the same subject: the same attribute with values that exclude each other, or two rules that cannot both hold ("open Monday to Saturday" and "closed on weekends") | 2 or more facts from 2 or more episodes |
| open question | A decision a feature needs that no fact states. Only raise it when a feature in the notes depends on it | 1 or more facts (the facts about the feature that needs the decision) |
| unclear point | A fact whose value cannot be tested: vague size or speed ("a few", "fast"), taste ("simple and modern"), or no limit ("as many as needed") | 1 or more facts (the vague one) |

Not a contradiction: the same meaning in other words; a general fact and a more specific one that fits inside it ("open weekdays" and "open Monday 9 to 5"); a value and a later answer that replaced it.

The five parts of a question:
| Part | Field | Rule |
| --- | --- | --- |
| Question | text | One sentence, ends with "?", at most 200 characters, names the subject |
| Recommended answer | recommended | Concrete and testable, with numbers where they apply. For a contradiction, pick the value with the most support and say which source. On equal support, prefer the client summary (the most formal source), then the kickoff notes, then the chat, and say it was a tie |
| Reasoning | reasoning | Why this answer: name the sources by file name. The fact ids go in factIds only, never in the text |
| Assumption | assumption | What the team will build if nobody answers. Usually the recommended answer, stated as a fact |
| Suggested approach | approach | How the feature works under that answer, in one or two sentences |

Topic checklist for open questions: check each topic against the features the notes describe: users and roles; main tasks; business rules and limits; changes and cancellation; data shown and kept; notifications; admin tasks; empty and error states.

- One question per issue. Do not split one contradiction into two questions.
- At most 20 questions. Contradictions first, then open questions, then unclear points.
- Every factId must be a current fact in CONTEXT.
- Do not raise a question about something no feature needs.
- A contradiction has a contradictionSummary: one sentence naming both values and their sources.
