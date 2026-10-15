// The current product and design versions of a project (contracts.md section 4): the highest
// productVersion among current Features and the highest designVersion among DocSections and design
// nodes, or 0. Design nodes count too, because a revision may write nodes only (task 3.4).
// ponytail: the unlabelled match scans the client graph; one OPTIONAL MATCH per label if it grows.
OPTIONAL MATCH (f:Feature {projectId: $projectId})
WHERE f.validTo IS NULL
WITH max(f.productVersion) AS productVersion
OPTIONAL MATCH (s {projectId: $projectId})
WHERE s:DocSection OR s:Decision OR s:Component OR s:Screen OR s:DataEntity OR s:Endpoint
  OR s:Risk
RETURN coalesce(productVersion, 0) AS productVersion, coalesce(max(s.designVersion), 0) AS designVersion
