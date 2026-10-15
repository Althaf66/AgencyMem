// Opens one WorkItem, unless an open or claimed item of the same kind and subject already exists
// (stage-machine.md section 1, rule 2). No row back: one exists. MERGE on id keeps ids unique.
OPTIONAL MATCH (e:WorkItem {projectId: $projectId, kind: $kind})
WHERE e.status IN ['open', 'claimed']
  AND ((e.subjectId IS NULL AND $subjectId IS NULL) OR e.subjectId = $subjectId)
WITH count(e) AS existing
WHERE existing = 0
MERGE (w:WorkItem {id: $id})
ON CREATE SET w.projectId = $projectId, w.kind = $kind, w.status = 'open',
  w.subjectId = $subjectId, w.note = $note, w.outputIds = [], w.attempts = 0,
  w.createdBy = $createdBy, w.createdAt = $now, w.version = 1
RETURN w
