// Completes a WorkItem whose live lease the caller holds. done: status done. failed: one more
// attempt, back to open, or blocked at 3 (stage-machine.md failure rules). Both clear the lease,
// raise the version and record one Run per entry. No row back: the caller holds no live lease.
// A note never replaces the item's note: a note the item was opened with (a G2 reason, a chat
// text) is the item's input, and a retry must still read it. done also stores $summary, the
// agent strip's last step (null removes an older one).
MATCH (w:WorkItem {id: $itemId, projectId: $projectId})
WHERE w.status = 'claimed' AND w.leaseOwner = $workerId AND w.leaseUntil >= $now
WITH w, CASE WHEN $outcome = 'done' THEN w.attempts ELSE w.attempts + 1 END AS attempts
SET w.status = CASE
      WHEN $outcome = 'done' THEN 'done'
      WHEN attempts >= 3 THEN 'blocked'
      ELSE 'open'
    END,
    w.attempts = attempts,
    w.doneAt = CASE WHEN $outcome = 'done' THEN $now ELSE w.doneAt END,
    w.note = coalesce(w.note, $note),
    w.summary = CASE WHEN $outcome = 'done' THEN $summary ELSE w.summary END,
    w.leaseOwner = null, w.leaseUntil = null,
    w.version = w.version + 1
FOREACH (run IN $runs |
  MERGE (r:Run {id: run.id})
  ON CREATE SET r += run)
RETURN w
