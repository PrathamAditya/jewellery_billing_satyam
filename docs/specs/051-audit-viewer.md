# 051: Audit history viewer

Status: Built (Wave 2) on branch `spec-051-032-audit-cash`, owner review pending. Built with the defaults in section 8; no owner question is open for it.
Depends on: 001 (audit_log, CLAUDE rule 11), 004 (permissions and roles)
Open questions used with defaults: none new (defaults listed in section 8 and in `docs/open-questions.md` section V where they touch the cash work).

## 1. Goal
The owner can read the history of every change in the system: who did what, to which record, when, and the stored detail. The audit log is written by the other specs and is never edited or deleted. This spec only reads it.

## 2. Rules

**Reading**
- A1. The page lists rows from `audit_log`, newest first (by time, then id). Pages of 20, with a "Load older rows" button.
- A2. Each row shows: when (India time, `2 Nov 2026, 14:05`), who (the user's display name; a failed login shows "Not logged in (failed login)"), the action, the record type and the first 8 characters of the record id.
- A3. Filters: date range (From and To, India business dates, both inclusive), who, record type (entity), and action. Filters combine. The "Who", "Record type" and "Action" boxes list only the values that appear in the log. "Clear filters" resets them.
- A4. Row detail: a row with stored JSON detail has a "Detail" button that shows the detail as formatted JSON. Rows without detail show no button.
- A5. Bad input: a date that is not a real date, or a From date after the To date, is refused (400, `invalid_date` or `invalid_range`).

**Who can see it**
- A6. Permission `audit.view`. It is already in the shared permission list (spec 004 reserved it). The default owner role has it. The default manager, shop staff and view-only roles do not. Migration `0022_cash_closing.sql` removes it from the manager and view-only roles stored in the roles table (see section 8), because the roles table is what the server checks.
- A7. A user without `audit.view` gets 403 on both routes, and the Audit link is not shown.

**Read only**
- A8. No route writes to `audit_log`. The routes are `GET /api/audit` and `GET /api/audit/options`. Any other method on `/api/audit` returns 404 or 405.
- A9. The table refuses UPDATE and DELETE (migration 0001 triggers). A test checks both.
- A10. The page has no edit, delete, void or save controls, on PC or phone.

## 3. Data and API
- **Migration: none** for the table. The role data change is part of migration `0022` (see section 8).
- `GET /api/audit?from=&to=&actor=&entity=&action=&cursor=` (permission `audit.view`): `{ items, nextCursor }`. Each item: `id`, `at` (ISO UTC), `actor`, `actorName`, `action`, `entity`, `entityId`, `detail` (parsed JSON or null). `cursor` is an offset: the next page starts at the next 20.
- `GET /api/audit/options` (permission `audit.view`): `{ entities, actions, actors: [{ id, label }] }`, the distinct values in the log.
- Shared types: `packages/shared/src/audit.ts`.
- Permission map: both routes map to `audit.view`.

## 4. Screen
- **Audit history** page at `#/audit`, linked from the top bar for users with `audit.view`.
- Filter row (From, To, Who, Record type, Action), then the table, then "Load older rows".
- Phone: the table scrolls inside its box; the page does not scroll sideways (decision D5 applies: nothing here is editable on any device).

## 5. Edge cases
- A failed login has actor `anonymous` and detail with the IP address and reason. It shows as "Not logged in (failed login)". The detail is visible to the owner only.
- A user whose display name is empty shows their username.
- An actor with no user row (for example `owner-script`, written by the `owner:set` command) shows the raw actor text.
- Dates are India business dates. A row at 18:29 UTC on 1 Nov is on 2 Nov in India time and belongs to 2 Nov's filter.
- A large log: each page reads 21 rows; the options list is capped at 200 entities, 300 actions and 300 actors.

## 6. Test cases
- `apps/api/test/auditViewer.test.ts`:
  - Rows come back newest first; the detail is parsed; a null detail stays null; a failed login shows as not logged in.
  - Paging: 40 rows give pages of 20, 20 and no cursor after the second page; no row appears twice.
  - Date range uses India days (A3, section 5 example); actor, entity and action filters, alone and combined.
  - Options list the entities, actions and actors in the log.
  - Bad date and reversed range are refused (A5).
  - Owner can read; staff gets 403 with `permission: audit.view` (A6, A7). Manager and view-only are checked in the commit that adds migration 0022.
  - No write route exists (A8); UPDATE and DELETE on audit_log fail (A9); rows written by other features (a customer save) appear.
- Browser (`e2e/auditViewer.mjs`): the owner opens the page from the top bar, sees rows, filters by action, filters by a date range with and without rows, opens a row's detail, sees no edit controls, and on a 390 px phone the page does not scroll sideways.

## 7. Out of scope
Exporting the log, reading the log for a single customer on the customer page, retention or archiving, alerts, and recording who viewed the audit page.

## 8. Defaults used (owner may change later)
- A3 default: the filters use India business dates, both ends inclusive.
- A6 default: owner only. Manager and view-only lose the permission. Staff never had it. The roles table is seeded by migration `0012`, which gave manager and view-only `audit.view`; migration `0022_cash_closing.sql` removes it from those two stored roles (a data change, not a schema change, so this spec has no migration of its own). The owner can give it back on the People screen.
- Detail: shown as the stored JSON, not translated into words.

## 9. Acceptance checklist
- [x] A1 to A5 implemented and tested in `apps/api/test/auditViewer.test.ts`
- [x] A6 owner and staff tested; manager and view-only checked once migration 0022 is in place
- [x] A8 and A9 tested (no write route, database refuses edit and delete)
- [x] Browser test `e2e/auditViewer.mjs` added to `e2e/run-all.mjs`
- [ ] Owner review

Status line: built on branch `spec-051-032-audit-cash`, owner review pending.
