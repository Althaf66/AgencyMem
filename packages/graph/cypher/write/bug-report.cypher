// Route 28 (stage-machine.md T24): the bug_report Episode with the person's words, which the
// maintenance item reads and the Defect is REPORTED_IN.
CREATE (e:Episode {id: $id, projectId: $projectId, kind: 'bug_report', text: $text,
  createdBy: $createdBy, createdAt: $now, version: 1})
RETURN e
