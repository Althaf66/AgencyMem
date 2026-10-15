// What the stage machine reads from a client graph (stage-machine.md section 1): the project's
// Gates, the open or claimed intake and intake_answer items (T3, T6, T7), the processed Documents
// (T3), and the processed Documents and answer Episodes that never got their item (startup repair
// of T2 and T5). For G2 (T8 to T10): the open or claimed proposal items and the newest one. For
// C1 and C2: each ChangeRequest with its change_request item, its flags and its follow-up items.
// For T12: the human_edit Episodes that never got their architect_revise item. For G3 (T13): the
// newest architect_revise with no subject, which only a G3 rejection opens.
OPTIONAL MATCH (cr:ChangeRequest {projectId: $projectId})
OPTIONAL MATCH (ci:WorkItem {projectId: $projectId, kind: 'change_request', subjectId: cr.id})
WITH cr, count(ci) AS items, sum(CASE WHEN ci.status = 'done' THEN 1 ELSE 0 END) AS done
OPTIONAL MATCH (ft:Task)-[:FLAGGED_BY]->(cr)
WITH cr, items, done, count(ft) AS tasks
OPTIONAL MATCH (fs:DocSection)-[:FLAGGED_BY]->(cr)
WITH cr, items, done, tasks, count(fs) AS sections
OPTIONAL MATCH (fw:WorkItem {projectId: $projectId, subjectId: cr.id})
WHERE fw.kind IN ['architect_revise', 'replan']
WITH cr, items, done, tasks, sections,
  sum(CASE WHEN fw.kind = 'architect_revise' THEN 1 ELSE 0 END) AS revise,
  sum(CASE WHEN fw.kind = 'replan' THEN 1 ELSE 0 END) AS replan
WITH collect(CASE WHEN cr IS NULL THEN null ELSE {id: cr.id, text: cr.text, status: cr.status,
  createdBy: cr.createdBy, hasItem: items > 0, itemDone: done > 0, tasks: tasks,
  sections: sections, revise: revise > 0, replan: replan > 0} END) AS changeRequests
OPTIONAL MATCH (he:Episode {projectId: $projectId, kind: 'human_edit'})
OPTIONAL MATCH (hw:WorkItem {projectId: $projectId, kind: 'architect_revise', subjectId: he.id})
WITH changeRequests, he, count(hw) AS editItems
WITH changeRequests, collect(CASE WHEN he IS NOT NULL AND editItems = 0
  THEN {episodeId: he.id, text: he.text, createdBy: he.createdBy} END) AS unopenedEdits
OPTIONAL MATCH (g:Gate {projectId: $projectId})
WITH changeRequests, unopenedEdits,
  collect(CASE WHEN g IS NULL THEN null ELSE {key: g.key, status: g.status, reason: g.reason,
    decidedAt: g.decidedAt, decidedBy: g.decidedBy} END) AS gates
OPTIONAL MATCH (pr:WorkItem {projectId: $projectId, kind: 'proposal'})
WITH changeRequests, unopenedEdits, gates, max(pr.createdAt) AS lastAt,
  sum(CASE WHEN pr.status IN ['open', 'claimed'] THEN 1 ELSE 0 END) AS openProposal
OPTIONAL MATCH (lp:WorkItem {projectId: $projectId, kind: 'proposal', createdAt: lastAt})
WITH changeRequests, unopenedEdits, gates, openProposal,
  collect(CASE WHEN lp IS NULL THEN null ELSE {createdAt: lp.createdAt, doneAt: lp.doneAt} END)[0]
    AS lastProposal
OPTIONAL MATCH (ar:WorkItem {projectId: $projectId, kind: 'architect_revise'})
WHERE ar.subjectId IS NULL
WITH changeRequests, unopenedEdits, gates, openProposal, lastProposal, max(ar.createdAt) AS revAt
OPTIONAL MATCH (lr:WorkItem {projectId: $projectId, kind: 'architect_revise', createdAt: revAt})
WHERE lr.subjectId IS NULL
WITH changeRequests, unopenedEdits, gates, openProposal, lastProposal,
  collect(CASE WHEN lr IS NULL THEN null ELSE {createdAt: lr.createdAt, doneAt: lr.doneAt} END)[0]
    AS lastRevision
OPTIONAL MATCH (i:WorkItem {projectId: $projectId, kind: 'intake'})
WHERE i.status IN ['open', 'claimed']
WITH changeRequests, unopenedEdits, gates, openProposal, lastProposal, lastRevision,
  count(i) AS openIntake
OPTIONAL MATCH (ia:WorkItem {projectId: $projectId, kind: 'intake_answer'})
WHERE ia.status IN ['open', 'claimed']
WITH changeRequests, unopenedEdits, gates, openProposal, lastProposal, lastRevision, openIntake,
  count(ia) AS openIntakeAnswer
OPTIONAL MATCH (e:Episode {projectId: $projectId, kind: 'answer'})
OPTIONAL MATCH (we:WorkItem {projectId: $projectId, kind: 'intake_answer', subjectId: e.id})
WITH changeRequests, unopenedEdits, gates, openProposal, lastProposal, lastRevision, openIntake,
  openIntakeAnswer, e,
  count(we) AS answerItems
WITH changeRequests, unopenedEdits, gates, openProposal, lastProposal, lastRevision, openIntake, openIntakeAnswer,
  collect(CASE WHEN e IS NOT NULL AND answerItems = 0
    THEN {episodeId: e.id, createdBy: e.createdBy} END) AS unopenedAnswers
OPTIONAL MATCH (d:Document {projectId: $projectId, status: 'processed'})
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'intake', subjectId: d.id})
WITH changeRequests, unopenedEdits, gates, openProposal, lastProposal, lastRevision, openIntake, openIntakeAnswer,
  unopenedAnswers, d, count(w) AS items
RETURN changeRequests, unopenedEdits, gates, openProposal, lastProposal, lastRevision, openIntake, openIntakeAnswer,
  unopenedAnswers, count(d) AS processedDocuments,
  collect(CASE WHEN d IS NOT NULL AND items = 0
    THEN {documentId: d.id, createdBy: d.createdBy} END) AS unopened
