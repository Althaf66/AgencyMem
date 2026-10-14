// The Run records of one work item or card, oldest first.
MATCH (r:Run {itemId: $itemId})
RETURN r.step AS step, r.agent AS agent, r.model AS model, r.endpoint AS endpoint,
       r.tokensIn AS tokensIn, r.tokensOut AS tokensOut, r.ms AS ms, r.cost AS cost,
       r.createdAt AS createdAt
ORDER BY r.createdAt, r.step
