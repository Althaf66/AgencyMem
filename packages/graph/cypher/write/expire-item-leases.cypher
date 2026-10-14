// Frees the claimed WorkItems of a project whose lease ended: back to open with one more attempt,
// or blocked at 3 (stage-machine.md failure rules). The gateway's lease sweeper calls it.
MATCH (w:WorkItem {projectId: $projectId, status: 'claimed'})
WHERE w.leaseUntil < $now
WITH w, w.attempts + 1 AS attempts
SET w.status = CASE WHEN attempts >= 3 THEN 'blocked' ELSE 'open' END,
    w.attempts = attempts,
    w.leaseOwner = null, w.leaseUntil = null,
    w.version = w.version + 1
RETURN w
