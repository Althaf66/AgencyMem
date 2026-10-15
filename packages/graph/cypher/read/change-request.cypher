// One ChangeRequest with the episode it comes FROM (recall_context for a change_request item).
MATCH (cr:ChangeRequest {id: $crId, projectId: $projectId})-[:FROM]->(e:Episode)
RETURN cr.id AS id, cr.text AS text, e.id AS episodeId, cr.status AS status
