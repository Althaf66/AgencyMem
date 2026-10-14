// The current product and design versions of a project (contracts.md section 4): the highest
// productVersion among current Features and the highest designVersion among DocSections, or 0.
OPTIONAL MATCH (f:Feature {projectId: $projectId})
WHERE f.validTo IS NULL
WITH max(f.productVersion) AS productVersion
OPTIONAL MATCH (s:DocSection {projectId: $projectId})
RETURN coalesce(productVersion, 0) AS productVersion, coalesce(max(s.designVersion), 0) AS designVersion
