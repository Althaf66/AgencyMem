// Route 24 and the cost check (task 6.5): one project's model calls (Run nodes) by agent and model,
// with their tokens and the cost each Run recorded. Both price them again from the table.
// One grouping key, a list: with two keys FalkorDB gives every aggregate the first one's value.
MATCH (r:Run {projectId: $projectId})
WITH [r.agent, r.model] AS key, count(r) AS runs, sum(r.tokensIn) AS tokensIn,
  sum(r.tokensOut) AS tokensOut, sum(r.cost) AS cost
RETURN key[0] AS agent, key[1] AS model, runs, tokensIn, tokensOut, cost
ORDER BY agent, model
