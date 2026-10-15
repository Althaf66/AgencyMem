// The cards a ChangeRequest flagged that are in Rework: the cards a replan item updates.
MATCH (t:Task {projectId: $projectId, column: 'Rework'})-[:FLAGGED_BY]->(:ChangeRequest {id: $crId})
RETURN t.id AS id
ORDER BY t.order, t.key
