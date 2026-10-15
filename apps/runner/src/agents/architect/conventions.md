Stack (sample-app.md section 1): Node.js 22.13 or later; Express 5.2.1 serves /api and, in dev, mounts Vite as middleware (one process, one port); one SQLite file through node:sqlite; React 18.3.1 and Vite 8.3.1; a small hash router (#/doctors); @playwright/test 1.63.0, Chromium only; npm.

API rules (section 7):
- Paths: /api/<resource>, plural nouns: /api/doctors, /api/slots, /api/bookings, /api/admin/hours.
- Bodies: JSON, field names camelCase. Times: ISO 8601 with offset, for example 2026-11-03T10:20:00+05:30.
- Ids: staff d1, d2 ... in seed order. Bookings get a 6-character code (letters and digits) as their id.
- Errors: { "error": { "code": "SLOT_TAKEN", "message": "This slot was just taken.", "field": "slot" } }.
- Status: 400 validation, 404 not found, 409 conflict (slot taken, limit reached), 201 created.
- Every business rule (hours, slot length, limits, cutoffs) is checked in the API; the page only shows the error the API sends.
- Every "now" comes from server/clock.ts, never Date.now() directly.

Page URLs: #/ Home; #/doctors staff list (query specialty); #/slots slot calendar (doctor, week 0 or 1); #/book booking form (doctor, slot as local time 2026-11-03T10:20); #/booking confirmation, lookup and cancel (code); #/admin (tab: staff, hours, bookings).

The data-testid rule (section 8): every element an acceptance criterion names has a data-testid, and specs find elements only by it. Form: <page>-<element> or <page>-<element>-<qualifier>, kebab-case, lower case. Items in a list add their id: doctors-item-d2. Dates are yyyy-mm-dd and times HHmm in clinic time: slots-slot-2026-11-03-1020. An error for a field is <page>-error-<field>: book-error-phone. A name never changes after a card uses it.
