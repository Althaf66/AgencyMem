Own rules:

Section outline:
| doc | order | Title | Renders |
| --- | --- | --- | --- |
| prd | 0 | Summary | every Feature |
| prd | 1 | Users and goals | every must Requirement |
| prd | 2 | Requirements | every Requirement |
| prd | 3 | Features and estimates | every Feature |
| prd | 4 | Out of scope | the Requirements it limits |
| tdd | 0 | Summary | every Component |
| tdd | 1 | Components | every Component |
| tdd | 2 | Data model | every DataEntity |
| tdd | 3 | API endpoints | every Endpoint |
| tdd | 4 | Screens | every Screen |
| tdd | 5 | Decisions | every Decision |
| tdd | 6 | Risks | every Risk |
| plan | 0 | Summary | every Component |
| plan | 1 | Build order | every Component, in build order |
| plan | 2 | Test approach | every Screen |
| plan | 3 | Risks and cut list | every Risk |

- Keys: DEC-01, CMP-01, SCR-01, ENT-01, EP-01, RSK-01. Keep existing keys when you revise.
- Every design node lists the requirement keys it serves.
- Use the stack in CONTEXT.conventions. Endpoints follow /api/<resource> with JSON bodies.
- A DataEntity body lists its fields with types. A Screen body lists the data-testid names it uses, following the data-testid rule.
- Section bodies are Markdown, at most 1,500 characters, and start with their point.
- For a revision, return only the nodes and sections that change.
