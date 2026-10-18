// One-time migration (`pnpm migrate:scope-cut`, registry graph): G5 and maintenance were removed,
// so a project left in maintenance goes back to launch, where the close now runs (T28).
MATCH (p:Project {stage: 'maintenance'})
SET p.stage = 'launch'
RETURN p.id AS id
