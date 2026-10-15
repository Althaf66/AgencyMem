// What the stage machine reads from a client graph (stage-machine.md section 1): the project's
// Gates, the open or claimed intake and intake_answer items (T3, T6, T7), the processed Documents
// (T3), and the processed Documents and answer Episodes that never got their item (startup repair
// of T2 and T5).
OPTIONAL MATCH (g:Gate {projectId: $projectId})
WITH collect(CASE WHEN g IS NULL THEN null ELSE {key: g.key, status: g.status} END) AS gates
OPTIONAL MATCH (i:WorkItem {projectId: $projectId, kind: 'intake'})
WHERE i.status IN ['open', 'claimed']
WITH gates, count(i) AS openIntake
OPTIONAL MATCH (ia:WorkItem {projectId: $projectId, kind: 'intake_answer'})
WHERE ia.status IN ['open', 'claimed']
WITH gates, openIntake, count(ia) AS openIntakeAnswer
OPTIONAL MATCH (e:Episode {projectId: $projectId, kind: 'answer'})
OPTIONAL MATCH (we:WorkItem {projectId: $projectId, kind: 'intake_answer', subjectId: e.id})
WITH gates, openIntake, openIntakeAnswer, e, count(we) AS answerItems
WITH gates, openIntake, openIntakeAnswer,
  collect(CASE WHEN e IS NOT NULL AND answerItems = 0
    THEN {episodeId: e.id, createdBy: e.createdBy} END) AS unopenedAnswers
OPTIONAL MATCH (d:Document {projectId: $projectId, status: 'processed'})
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'intake', subjectId: d.id})
WITH gates, openIntake, openIntakeAnswer, unopenedAnswers, d, count(w) AS items
RETURN gates, openIntake, openIntakeAnswer, unopenedAnswers, count(d) AS processedDocuments,
  collect(CASE WHEN d IS NOT NULL AND items = 0
    THEN {documentId: d.id, createdBy: d.createdBy} END) AS unopened
