// One-time migration (`pnpm migrate:scope-cut`, client graph), step 2: every node of the removed
// maintenance phase (Defects, Deployments, G5 and G6, maintenance items, bug reports, fix cards).
MATCH (n)
WHERE n:Defect OR n:Deployment OR (n:Gate AND n.key IN ['G5', 'G6'])
  OR (n:WorkItem AND n.kind = 'maintenance') OR (n:Episode AND n.kind = 'bug_report')
  OR (n:Task AND n.kind = 'fix')
DETACH DELETE n
RETURN count(n) AS removed
