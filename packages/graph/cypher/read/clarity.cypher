// The clarity inputs of a project (contracts.md, Clarity band): whether a discovery item is done,
// the contradiction and unclear questions, and the words of the processed documents.
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'discovery', status: 'done'})
WITH count(w) AS done
OPTIONAL MATCH (q:Question {projectId: $projectId})
WHERE q.kind IN ['contradiction', 'unclear']
WITH done, count(q) AS flagged
OPTIONAL MATCH (d:Document {projectId: $projectId, status: 'processed'})
RETURN done, flagged, sum(d.wordCount) AS words
