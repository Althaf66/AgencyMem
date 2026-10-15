// What the stage machine reads from a client graph (stage-machine.md section 1): the keys of the
// project's Gates, the open or claimed intake items (T3), the processed Documents (T3), and the
// processed Documents that never got an intake item (startup repair of T2).
// Later transitions add their counts here.
OPTIONAL MATCH (g:Gate {projectId: $projectId})
WITH collect(g.key) AS gates
OPTIONAL MATCH (i:WorkItem {projectId: $projectId, kind: 'intake'})
WHERE i.status IN ['open', 'claimed']
WITH gates, count(i) AS openIntake
OPTIONAL MATCH (d:Document {projectId: $projectId, status: 'processed'})
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'intake', subjectId: d.id})
WITH gates, openIntake, d, count(w) AS items
RETURN gates, openIntake, count(d) AS processedDocuments,
  collect(CASE WHEN d IS NOT NULL AND items = 0
    THEN {documentId: d.id, createdBy: d.createdBy} END) AS unopened
