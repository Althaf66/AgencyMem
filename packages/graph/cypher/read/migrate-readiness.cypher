// One-time migration (`pnpm migrate:scope-cut`, client graph): the ReadinessReports that still
// carry the removed open_defects check.
MATCH (r:ReadinessReport)
WHERE r.checks CONTAINS 'open_defects'
RETURN r.id AS id, r.version AS version, r.checks AS checks
