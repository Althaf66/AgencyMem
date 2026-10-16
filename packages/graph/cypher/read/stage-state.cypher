// What the stage machine reads from a client graph (stage-machine.md section 1): the project's
// Gates, the open or claimed intake and intake_answer items (T3, T6, T7), the processed Documents
// (T3), and the processed Documents and answer Episodes that never got their item (startup repair
// of T2 and T5). For G2 (T8 to T10): the open or claimed proposal items and the newest one. For
// C1 and C2: each ChangeRequest with its change_request item, its flags and its follow-up items;
// for C3, whether its replan item is done and its flagged Rework cards with no write_tests item.
// For T12: the human_edit Episodes that never got their architect_revise item. For G3 (T13): the
// newest architect_revise with no subject, which only a G3 rejection opens. For T15: whether a
// planner item is done, and the build Tasks in Backlog with no write_tests item. For T16: the build
// Tasks past Backlog and Rework. For T20 and T30: the build Tasks, those Done with a mergedSha, and
// the change_request, replan and write_tests items open or claimed. For T21's repair: the newest e2e
// item's status. For T24's repair: the bug_report Episodes with no maintenance item. For T26's:
// the fix cards whose G6 is approved but which got no write_tests item since.
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
  sum(CASE WHEN fw.kind = 'replan' THEN 1 ELSE 0 END) AS replan,
  sum(CASE WHEN fw.kind = 'replan' AND fw.status = 'done' THEN 1 ELSE 0 END) AS replanDone
// FalkorDB gotcha 10: a property filter on rt here can match nothing after the ft traversal and
// its count (it does in a shorter query; this full one was not affected), so the column is tested
// in the CASE.
OPTIONAL MATCH (rt:Task)-[:FLAGGED_BY]->(cr)
OPTIONAL MATCH (rw:WorkItem {projectId: $projectId, kind: 'write_tests', subjectId: rt.id})
WHERE rw.status IN ['open', 'claimed', 'blocked']
WITH cr, items, done, tasks, sections, revise, replan, replanDone, rt, count(rw) AS testItems
WITH cr, items, done, tasks, sections, revise, replan, replanDone,
  collect(CASE WHEN rt IS NOT NULL AND rt.column = 'Rework' AND testItems = 0 THEN rt.id END)
    AS reworkTasks
WITH collect(CASE WHEN cr IS NULL THEN null ELSE {id: cr.id, text: cr.text, status: cr.status,
  createdBy: cr.createdBy, hasItem: items > 0, itemDone: done > 0, tasks: tasks,
  sections: sections, revise: revise > 0, replan: replan > 0, replanDone: replanDone > 0,
  reworkTasks: reworkTasks} END) AS changeRequests
OPTIONAL MATCH (he:Episode {projectId: $projectId, kind: 'human_edit'})
OPTIONAL MATCH (hw:WorkItem {projectId: $projectId, kind: 'architect_revise', subjectId: he.id})
WITH changeRequests, he, count(hw) AS editItems
WITH changeRequests, collect(CASE WHEN he IS NOT NULL AND editItems = 0
  THEN {episodeId: he.id, text: he.text, createdBy: he.createdBy} END) AS unopenedEdits
OPTIONAL MATCH (be:Episode {projectId: $projectId, kind: 'bug_report'})
OPTIONAL MATCH (bw:WorkItem {projectId: $projectId, kind: 'maintenance', subjectId: be.id})
WITH changeRequests, unopenedEdits, be, count(bw) AS bugItems
WITH changeRequests, unopenedEdits, collect(CASE WHEN be IS NOT NULL AND bugItems = 0
  THEN {episodeId: be.id, createdBy: be.createdBy} END) AS unopenedBugs
OPTIONAL MATCH (fg:Gate {projectId: $projectId, key: 'G6', status: 'approved'})-[:GUARDS]->(fx:Task)
WHERE fx.column IN ['Backlog', 'Rework']
OPTIONAL MATCH (fxw:WorkItem {projectId: $projectId, kind: 'write_tests', subjectId: fx.id})
WHERE fxw.createdAt >= fg.decidedAt
WITH changeRequests, unopenedEdits, unopenedBugs, fg, fx, count(fxw) AS fixItems
WITH changeRequests, unopenedEdits, unopenedBugs, collect(CASE WHEN fx IS NOT NULL AND fixItems = 0
  THEN {taskId: fx.id, createdBy: fg.decidedBy} END) AS approvedFixes
OPTIONAL MATCH (g:Gate {projectId: $projectId})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes,
  collect(CASE WHEN g IS NULL THEN null ELSE {key: g.key, status: g.status, reason: g.reason,
    decidedAt: g.decidedAt, decidedBy: g.decidedBy} END) AS gates
OPTIONAL MATCH (pr:WorkItem {projectId: $projectId, kind: 'proposal'})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, max(pr.createdAt) AS lastAt,
  sum(CASE WHEN pr.status IN ['open', 'claimed'] THEN 1 ELSE 0 END) AS openProposal
OPTIONAL MATCH (lp:WorkItem {projectId: $projectId, kind: 'proposal', createdAt: lastAt})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal,
  collect(CASE WHEN lp IS NULL THEN null ELSE {createdAt: lp.createdAt, doneAt: lp.doneAt} END)[0]
    AS lastProposal
OPTIONAL MATCH (ar:WorkItem {projectId: $projectId, kind: 'architect_revise'})
WHERE ar.subjectId IS NULL
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, max(ar.createdAt) AS revAt
OPTIONAL MATCH (lr:WorkItem {projectId: $projectId, kind: 'architect_revise', createdAt: revAt})
WHERE lr.subjectId IS NULL
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal,
  collect(CASE WHEN lr IS NULL THEN null ELSE {createdAt: lr.createdAt, doneAt: lr.doneAt} END)[0]
    AS lastRevision
OPTIONAL MATCH (pw:WorkItem {projectId: $projectId, kind: 'planner', status: 'done'})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision,
  count(pw) > 0 AS plannerDone
OPTIONAL MATCH (t:Task {projectId: $projectId, kind: 'build', column: 'Backlog'})
OPTIONAL MATCH (tw:WorkItem {projectId: $projectId, kind: 'write_tests', subjectId: t.id})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision, plannerDone, t,
  count(tw) AS testItems
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision, plannerDone,
  collect(CASE WHEN t IS NOT NULL AND testItems = 0 THEN {taskId: t.id} END) AS untestedCards
OPTIONAL MATCH (rt:Task {projectId: $projectId, kind: 'build'})
WHERE NOT rt.column IN ['Backlog', 'Rework']
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision, plannerDone,
  untestedCards, count(rt) AS readyCards
OPTIONAL MATCH (bt:Task {projectId: $projectId, kind: 'build'})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision, plannerDone,
  untestedCards, readyCards, count(bt) AS buildTotal,
  sum(CASE WHEN bt.column = 'Done' AND bt.mergedSha IS NOT NULL THEN 1 ELSE 0 END) AS buildMerged
OPTIONAL MATCH (bw:WorkItem {projectId: $projectId})
WHERE bw.kind IN ['change_request', 'replan', 'write_tests'] AND bw.status IN ['open', 'claimed']
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision, plannerDone,
  untestedCards, readyCards, buildTotal, buildMerged, count(bw) AS buildBlockers
OPTIONAL MATCH (ee:WorkItem {projectId: $projectId, kind: 'e2e'})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision, plannerDone,
  untestedCards, readyCards, buildTotal, buildMerged, buildBlockers, max(ee.createdAt) AS e2eAt
OPTIONAL MATCH (le:WorkItem {projectId: $projectId, kind: 'e2e', createdAt: e2eAt})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision, plannerDone,
  untestedCards, readyCards, buildTotal, buildMerged, buildBlockers, collect(le.status)[0] AS lastE2e
OPTIONAL MATCH (i:WorkItem {projectId: $projectId, kind: 'intake'})
WHERE i.status IN ['open', 'claimed']
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision,
  plannerDone, untestedCards, readyCards, buildTotal, buildMerged, buildBlockers, lastE2e,
  count(i) AS openIntake
OPTIONAL MATCH (ia:WorkItem {projectId: $projectId, kind: 'intake_answer'})
WHERE ia.status IN ['open', 'claimed']
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision,
  plannerDone, untestedCards, readyCards, buildTotal, buildMerged, buildBlockers, lastE2e,
  openIntake,
  count(ia) AS openIntakeAnswer
OPTIONAL MATCH (e:Episode {projectId: $projectId, kind: 'answer'})
OPTIONAL MATCH (we:WorkItem {projectId: $projectId, kind: 'intake_answer', subjectId: e.id})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision,
  plannerDone, untestedCards, readyCards, buildTotal, buildMerged, buildBlockers, lastE2e,
  openIntake,
  openIntakeAnswer, e,
  count(we) AS answerItems
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision,
  plannerDone, untestedCards, readyCards, buildTotal, buildMerged, buildBlockers, lastE2e,
  openIntake, openIntakeAnswer,
  collect(CASE WHEN e IS NOT NULL AND answerItems = 0
    THEN {episodeId: e.id, createdBy: e.createdBy} END) AS unopenedAnswers
OPTIONAL MATCH (d:Document {projectId: $projectId, status: 'processed'})
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'intake', subjectId: d.id})
WITH changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision,
  plannerDone, untestedCards, readyCards, buildTotal, buildMerged, buildBlockers, lastE2e,
  openIntake, openIntakeAnswer,
  unopenedAnswers, d, count(w) AS items
RETURN changeRequests, unopenedEdits, unopenedBugs, approvedFixes, gates, openProposal, lastProposal, lastRevision,
  plannerDone, untestedCards, readyCards, buildTotal, buildMerged, buildBlockers, lastE2e,
  openIntake, openIntakeAnswer,
  unopenedAnswers, count(d) AS processedDocuments,
  collect(CASE WHEN d IS NOT NULL AND items = 0
    THEN {documentId: d.id, createdBy: d.createdBy} END) AS unopened
