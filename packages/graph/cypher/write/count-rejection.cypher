// Adds 1 to one rejection counter of a Project (contracts.md section 6, "Counting"). A property name
// cannot be a parameter, so each counter has its own CASE. Returns the new value.
MATCH (p:Project {id: $projectId})
SET p.rejectedWrites = p.rejectedWrites + CASE WHEN $counter = 'rejectedWrites' THEN 1 ELSE 0 END,
    p.rejectedClaims = p.rejectedClaims + CASE WHEN $counter = 'rejectedClaims' THEN 1 ELSE 0 END,
    p.rejectedCompletions = p.rejectedCompletions + CASE WHEN $counter = 'rejectedCompletions' THEN 1 ELSE 0 END,
    p.rejectedQueries = p.rejectedQueries + CASE WHEN $counter = 'rejectedQueries' THEN 1 ELSE 0 END
RETURN CASE $counter
  WHEN 'rejectedWrites' THEN p.rejectedWrites
  WHEN 'rejectedClaims' THEN p.rejectedClaims
  WHEN 'rejectedCompletions' THEN p.rejectedCompletions
  ELSE p.rejectedQueries
END AS value
