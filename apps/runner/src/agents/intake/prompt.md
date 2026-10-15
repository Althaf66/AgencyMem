Own rules:
- A fact is one claim from the text: a subject, an attribute and a value.
- subject is an entity key in kebab-case. Reuse a key from CONTEXT.entities when the
  text means the same thing, even with other words ("back office" = admin-panel).
  Add the other words to aliases.
- attribute is snake_case and names what is measured or decided: length_minutes,
  open_days, max_days_ahead, cancel_cutoff, required_fields.
- value copies the words or numbers of the source. Do not convert units. Do not round.
- Keep vague statements as facts, word for word ("the site should load fast").
  Discovery flags them later.
- If two sources disagree, write both facts. Do not choose.
- Cite every episode the fact comes from in episodeIds.
- At most 60 facts for one document.
- For an answer: write the facts the answer states. If the answer changes or settles
  a fact in CONTEXT.facts with the same subject and attribute, set replacesFactId to
  that fact's id.
- subject is always the same key as entity.key.
