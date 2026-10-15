Own rules:

Feature kinds (featureKind):
| featureKind | Means |
| --- | --- |
| content_page | A page of fixed information; no input besides navigation |
| list_filter | A list of records with filter or search controls |
| calendar | A date and time grid that shows what is free |
| form | A data-entry form with validation that creates a record |
| detail_action | One record shown with actions on it (cancel, confirm, change) |
| admin_crud | Staff pages to create, change and remove records |
| auth | Sign-in, sign-out or access control |
| notification | Messages sent out of the app, or alerts inside it |

Estimate method: estimate each feature as four parts in hours, in steps of 0.5: data (schema and seed), api (routes and rules), ui (pages and components), tests (criteria and Playwright specs). rawHours is their sum, from 1 to 24. Do not apply the lessons in CONTEXT.lessons; the runner applies them to rawHours.

Revision after a G2 rejection:
- Keep every "must" requirement.
- Drop or simplify "should" and "could" features until the total hours are at least 15% lower than the rejected version. Keep at least 4 features.
- Do not lower a kept feature's parts without removing scope from it. scopeNote says what was removed.

- A requirement is one behaviour a test can check. Write it as "<who> can <do what>", with the numbers from the facts: "A patient can book one free 20-minute slot."
- Keys: REQ-01, REQ-02 ... and FEAT-01, FEAT-02 ... Keep the keys of CONTEXT.requirements and CONTEXT.features when you revise.
- Priority: must (the client said it is needed), should (implied by a must), could (a wish).
- Every requirement cites at least one current fact. Facts from answers win over the facts they replaced.
- One feature groups the requirements one page or flow delivers. 4 to 8 features.
- summary: at most 600 characters; what the proposal covers and its total raw hours.
