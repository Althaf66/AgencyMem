// Cancels the project's open and claimed WorkItems of the given kinds (stage-machine.md T30: a card
// left Done during e2e or launch). Clears the lease and raises the version; `claimed` says whose
// lease ended, so the gateway can send lease.changed.
MATCH (w:WorkItem {projectId: $projectId})
WHERE w.kind IN $kinds AND w.status IN ['open', 'claimed']
WITH w, w.status = 'claimed' AS claimed
SET w.status = 'cancelled',
    w.leaseOwner = null, w.leaseUntil = null,
    w.version = w.version + 1
RETURN w, claimed
