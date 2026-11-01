# 001: Database foundation

Status: Done (built 2026-11-01, owner approved 2026-11-01)
Depends on: 000
Open questions: none

## 1. Goal
A real D1 database is connected, migrations work locally, in CI and on Cloudflare, and the shared rules every later table must follow (ids, timestamps, units, no hard deletes, revisions, audit log, numbering) exist as tested code. No business tables yet: customers, invoices and the rest arrive in their own specs.

## 2. Rules

**Database and migrations**
- R1. One D1 database `jewellery-billing`, bound to the Worker as `DB`. Local dev uses wrangler's local D1.
- R2. Schema is defined with Drizzle. Migrations are plain numbered SQL files in `apps/api/migrations`, forward-only, applied with `npm run db:migrate` (local) and `npm run db:migrate:remote`. Hand-written SQL (triggers) lives in the same folder.
- R3. CI applies all migrations to an empty database and fails if any migration errors.
- R4. `/api/health` also runs `SELECT 1` and returns `db: "ok"`, or `db: "error"` with HTTP 503.

**Conventions (every later spec follows these)**
- R5. **IDs:** text primary keys, UUIDv7 from `newId()` in `packages/shared`. The client may generate the id, which makes a retried create safe: the same id with the same content returns the existing record, the same id with different content returns 409.
- R6. **Timestamps** are ISO-8601 UTC text (`2026-11-01T08:04:07.606Z`). **Business dates** (invoice date, rate date) are `YYYY-MM-DD` text in India time (Asia/Kolkata). "Today" always means the India date.
- R7. **Units:** money is integer paise (`*_paise`), weight is integer milligrams (`*_mg`), rates are integer paise per gram (`*_paise_per_g`). Columns that cannot be negative get a `CHECK (>= 0)`.
- R8. **Standard columns** on every business table: `id`, `created_at`, `created_by`, `updated_at`, `updated_by`. Until login exists (spec 002), the actor is the fixed string `owner`.
- R9. **No hard deletes.** Business tables get a `BEFORE DELETE` trigger that aborts. Voiding uses `voided_at`, `voided_by`, `void_reason`, and a voided record keeps its number and stays visible.
- R10. **Revisions:** one shared table `record_revisions(entity, entity_id, revision_no, snapshot_json, reason, created_at, created_by)`. The main record keeps its id and number. Each edit stores the previous version as an immutable snapshot with the next `revision_no`. `(entity, entity_id, revision_no)` is unique and rows cannot be updated or deleted.
- R11. **Audit log:** append-only table `audit_log(id, at, actor, action, entity, entity_id, detail_json)`. Triggers block UPDATE and DELETE. An audit row is written in the same atomic D1 batch as the change it describes, so neither can exist without the other.
- R12. **Numbering:** table `number_series(series, fy, last_no)` with primary key `(series, fy)`. `allocateNumber(series, businessDate)` increments atomically in one SQL statement and returns a string like `INV/2026-27/0001`. Series: `INV`, `PR`, `OG`. The number is padded to at least 4 digits and grows beyond that (`10000`). The financial year runs 1 April to 31 March. A number is never reused, and a save that fails must not consume a number (allocation happens in the same atomic batch as the insert).

## 3. Data
New tables: `number_series`, `record_revisions`, `audit_log`. No other tables. One migration file for the schema, one for the triggers.

## 4. Screens and printing
None. The only visible change is the health response (`db: "ok"`).

## 5. Edge cases
- Two allocations at the same moment: both succeed with different numbers.
- Date on 31 March vs 1 April: different financial year, and the new year restarts at `0001`.
- An allocation inside a batch that later fails: the counter rolls back with the batch.
- Replaying a create with the same id: handled by the helper from R5, first exercised in spec 010 (customers).

## 6. Test cases
Financial year and format (R12):

| Series | Business date | Allocation # | Result |
|--------|---------------|--------------|--------|
| INV | 2026-03-31 | 1st | `INV/2025-26/0001` |
| INV | 2026-04-01 | 1st | `INV/2026-27/0001` |
| INV | 2026-04-01 | 2nd | `INV/2026-27/0002` |
| PR | 2026-04-01 | 1st | `PR/2026-27/0001` (independent of INV) |
| INV | 2027-03-31 | 1st | `INV/2026-27/0003` |
| INV | 2026-04-01 | 10,000th | `INV/2026-27/10000` |

Other:
- 20 parallel `allocateNumber` calls give 20 unique numbers, 1 to 20, with no gaps.
- `DELETE` on a table with the no-delete trigger fails (R9).
- `UPDATE` and `DELETE` on `audit_log` and `record_revisions` fail (R10, R11).
- Two revisions with the same `(entity, entity_id, revision_no)` fail on insert (R10).
- A batch that allocates a number and then errors leaves `last_no` unchanged (R12).
- `newId()` returns valid UUIDv7 strings that sort in creation order (R5).
- `/api/health` returns `db: "ok"` (R4).

## 7. Out of scope
Login (002), customer or invoice tables, backups (050, D1 Time Travel is on by default meanwhile), idempotent create helper (arrives with its first use in 010), offline sync (041).

## 8. Acceptance checklist
- [x] R1 to R12 implemented and tested
- [x] Migrations applied locally, in CI and on the remote database
- [x] Remote `/api/health` shows `db: "ok"`
- [x] Nothing in spec 000 broke
- [x] Owner approved the result
