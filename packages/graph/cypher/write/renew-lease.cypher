// Renews a lease that the caller holds and that has not ended, on a WorkItem or a Task (a card).
// Returns the lease as it stands, so the lease guard can say LEASE_ENDED or LEASE_OTHER_WORKER.
// A renewal does not raise the version: a heartbeat must not make the worker's next write stale.
MATCH (n {id: $id, projectId: $projectId})
WHERE n:WorkItem OR n:Task
WITH n, coalesce(n.leaseOwner = $workerId AND n.leaseUntil >= $now, false) AS ok
SET n.leaseUntil = CASE WHEN ok THEN $now + $leaseMs ELSE n.leaseUntil END
RETURN ok, n.leaseOwner AS owner, n.leaseUntil AS until
