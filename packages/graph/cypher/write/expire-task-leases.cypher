// Frees the cards of a project whose build lease ended (contracts.md section 10): an In progress or
// Testing card goes back to Ready with one more attempt, so the board shows the recovery after a
// runner stops. The gateway's lease sweeper calls it.
MATCH (t:Task {projectId: $projectId})
WHERE t.column IN ['In progress', 'Testing'] AND t.leaseUntil < $now
WITH t, t.column AS fromColumn
SET t.column = 'Ready', t.attempts = t.attempts + 1,
    t.leaseOwner = null, t.leaseUntil = null,
    t.version = t.version + 1
RETURN t.id AS id, t.key AS key, fromColumn, t.version AS version
