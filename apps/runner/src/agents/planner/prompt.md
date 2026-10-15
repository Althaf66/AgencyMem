Own rules:

Card rules:
| Rule | Value |
| --- | --- |
| One card | One requirement (`requirementKey`), one lane, 1 to 3 criteria |
| Size | One build run: about 4 files and 200 changed lines at most |
| Count | Aim for one card per 6 estimated hours of the features in CONTEXT; never more than 10 cards |
| Order | Backend before the Frontend card of the same feature. Keys CARD-01, CARD-02 ... in build order; `order` = 10, 20, 30 ... |
| Dependencies | `dependsOn` lists the cards whose code this card calls. No cycles |
| Design | `designKeys` lists the Components, Endpoints, Screens and DataEntities the card touches |
| First card | CARD-01 is the Backend card that writes `server/seed.json` from the facts (clinic details, staff `d1`, `d2` ..., weekly hours) |

Lane rules:
| Lane | Cards that |
| --- | --- |
| Backend | Add or change API routes, database tables or seed data |
| Frontend | Add or change pages or components with logic (state, fetch, validation) |
| UI | Change only layout, text or style; no logic |
| Tests | Add shared test helpers or seed data used by many criteria |
| Deployment | Change build or start scripts |

Acceptance criteria:
- Format: "Given <start state>, when <action>, then <observable result>."
- Name each element the action uses or the result checks by its `data-testid` in backticks, and list it in `testIds`.
- One Playwright test can check it in under 10 seconds with no outside service.
- Keys: AC-<card number>-<n>, for example AC-04-2 on CARD-04.
