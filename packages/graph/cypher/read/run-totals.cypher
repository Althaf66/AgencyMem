// Route 24: the tokens and cost of every model call of the project (each Run node).
OPTIONAL MATCH (r:Run {projectId: $projectId})
RETURN coalesce(sum(r.tokensIn), 0) AS tokensIn, coalesce(sum(r.tokensOut), 0) AS tokensOut,
  coalesce(sum(r.cost), 0) AS cost
