// Completes a merge WorkItem whose live lease the caller holds, with its result (contracts.md
// section 7, complete_item). $mergedSha: the item is done and the card gets the sha. Else a conflict
// (C6): the item is cancelled with no attempt added (the card's next Done opens a new one), and a
// Done card goes back to Ready with $conflictNote, attempts unchanged. Both clear the item's lease,
// raise both versions and record one Run per entry. No row back: the caller holds no live lease.
MATCH (w:WorkItem {id: $itemId, projectId: $projectId, kind: 'merge'})
WHERE w.status = 'claimed' AND w.leaseOwner = $workerId AND w.leaseUntil >= $now
MATCH (t:Task {projectId: $projectId, id: w.subjectId})
WITH w, t, t.column AS fromColumn, $mergedSha IS NOT NULL AS merged
SET w.status = CASE WHEN merged THEN 'done' ELSE 'cancelled' END,
    w.doneAt = CASE WHEN merged THEN $now ELSE w.doneAt END,
    w.note = coalesce(w.note, $note),
    w.summary = CASE WHEN merged THEN $summary ELSE w.summary END,
    w.leaseOwner = null, w.leaseUntil = null,
    w.version = w.version + 1,
    // A card that left Done during the merge (Rework) gets no sha: its dependents must wait for
    // its next merge item, which finds the branch merged and reports main's head.
    t.mergedSha = CASE WHEN merged AND t.column <> 'Done' THEN t.mergedSha ELSE $mergedSha END,
    t.column = CASE WHEN NOT merged AND t.column = 'Done' THEN 'Ready' ELSE t.column END,
    t.note = CASE WHEN merged THEN t.note ELSE $conflictNote END,
    t.version = t.version + 1
FOREACH (run IN $runs |
  MERGE (r:Run {id: run.id})
  ON CREATE SET r += run)
RETURN w, t.key AS key, fromColumn, t.column AS toColumn, t.version AS taskVersion
