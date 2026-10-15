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

The data-testid rule:
- Form: <page>-<element> or <page>-<element>-<qualifier>, kebab-case, lower case.
- Items in a list add their id: doctors-item-d2. Dates are yyyy-mm-dd and times HHmm in clinic time: slots-slot-2026-11-03-1020. An error for a field is <page>-error-<field>: book-error-phone.
- A name never changes after a card uses it. A card that needs a new element adds a new name.

Reserved names (use these first; A, B and C mark set-specific fields):
| Page | Names |
| --- | --- |
| Shell | app-clinic-name, nav-home, nav-doctors, nav-slots, nav-book, nav-booking, nav-admin |
| Home | home-page, home-name, home-address, home-phone, home-hours |
| Staff list | doctors-page, doctors-filter-specialty, doctors-list, doctors-item-<id>, doctors-empty |
| Slots | slots-page, slots-doctor-select, slots-day-<date>, slots-slot-<date>-<HHmm>, slots-next-week, slots-prev-week, slots-empty |
| Booking form | book-page, book-slot-summary, book-name, book-phone, book-reason (A), book-injury-area (B), book-child-name (C), book-child-age (C), book-submit, book-error-<field> |
| Booking | booking-page, booking-code, booking-doctor, booking-date, booking-time, booking-status, booking-lookup-code, booking-lookup-submit, booking-cancel, booking-cancel-confirm, booking-error |
| Admin | admin-page, admin-tab-staff, admin-tab-hours, admin-tab-bookings, admin-doctor-add, admin-doctor-name, admin-doctor-specialty, admin-doctor-save, admin-doctor-item-<id>, admin-hours-<mon..sun>-open, admin-hours-<mon..sun>-close, admin-hours-save, admin-bookings-day, admin-bookings-list, admin-bookings-item-<code> |
