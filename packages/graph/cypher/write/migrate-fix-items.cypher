// One-time migration (`pnpm migrate:scope-cut`, client graph), step 1: the criteria of every fix
// card and the work items about one, before the cards themselves go in step 2.
MATCH (t:Task {kind: 'fix'})
OPTIONAL MATCH (t)-[:HAS_CRITERION]->(k:AcceptanceCriterion)
OPTIONAL MATCH (w:WorkItem {subjectId: t.id})
WITH collect(DISTINCT k) + collect(DISTINCT w) AS gone
UNWIND gone AS n
DETACH DELETE n
RETURN count(n) AS removed
