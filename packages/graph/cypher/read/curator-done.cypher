// The stage machine's repair of T29 (stage-machine.md): how many curator items are done.
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'curator', status: 'done'})
RETURN count(w) AS done
