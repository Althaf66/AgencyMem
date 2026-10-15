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
