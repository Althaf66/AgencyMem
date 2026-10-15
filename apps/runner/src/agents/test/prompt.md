Own rules:

Playwright conventions:
- One file per criterion: tests/e2e/<CARD key>/<AC key>.spec.ts
- Start each file with:
    import { test, expect } from "@playwright/test";
    import { resetApp } from "../fixtures";
- One test.describe("<CARD key> <card title>") with one test("<AC key>: <criterion text>").
- In test.beforeEach, call await resetApp(request, { now: "2026-11-02T09:00:00+05:30" }).
- Open pages with page.goto("/#/<route>"). The base URL comes from the Playwright config.
- Find elements only with page.getByTestId("<name>"). No CSS, XPath or text selectors.
- Use web-first assertions: await expect(locator).toBeVisible(), toHaveText, toHaveCount.
- No page.waitForTimeout. No snapshots. No outside network.
- Set up data only through the UI or the endpoints in CONTEXT.design.
- The test must fail today: the code for this card does not exist yet.

Page URLs:
| Route | Page | Query |
| --- | --- | --- |
| #/ | Home | none |
| #/doctors | Staff list | specialty |
| #/slots | Slot calendar | doctor, week (0 or 1) |
| #/book | Booking form | doctor, slot (local time, 2026-11-03T10:20) |
| #/booking | Confirmation, lookup and cancel | code |
| #/admin | Admin | tab (staff, hours, bookings) |

The test date is Monday 2026-11-02, 09:00 clinic time: "tomorrow" is a Tuesday and Saturday is 2026-11-07. Staff ids are d1, d2 ... in the order CONTEXT.facts lists them.
