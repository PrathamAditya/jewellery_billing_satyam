# 080: Database adapter (D1-compatible over a local SQLite file)

Status: Built (Wave 4) on branch `spec-080-db-adapter`, PR into `wave-4`. Owner approval pending. The build follows the plan in `docs/wave4-plan.md` (step 1). It changes no screen and no cloud behaviour.
Depends on: 001 (database foundation and migrations), 000 (test setup), `docs/wave4-plan.md`
Open questions used with defaults: Q120 and Q121 (listed in `docs/open-questions.md`, section U).

## 1. Goal
The API runs on Cloudflare D1 today (`c.env.DB`). The downloadable desktop version (Wave 4) must run the same API on a local SQLite file on the owner's PC. This spec adds a D1-compatible adapter over a local SQLite file, and proves the existing API test suite behaves the same on it. The cloud version keeps running on D1, unchanged.

## 2. Rules

**Surface**
- A1. The adapter (`apps/api/src/db/sqlite.ts`) covers exactly the D1 calls the API uses: `prepare`, `bind`, `first`, `all`, `run` and `batch`. Nothing else (no `exec`, `dump`, `withSession`, `raw`, `first(column)`). The list comes from a search of `apps/api/src` (478 matching lines): `first` with and without a type argument, `all`, `run` (5 call sites; the result is not read), `batch` (46 call sites), `bind` (217), `results`. `RETURNING` appears in `apps/api/src/db/numbering.ts` and is read through `first()`.
- A2. Result shapes follow D1. `first()` returns the row or `null` (never `undefined`). `all()` and `run()` return `{ success, results, meta: { changes, last_row_id } }`. `batch()` returns one such result per statement, in order. Rows are plain objects.
- A3. `bind()` returns a new statement and leaves the old one unchanged, so one statement can be used in a `batch` and again with `bind()`.

**Transactions**
- A4. `batch()` runs its statements in one transaction (`BEGIN IMMEDIATE` ... `COMMIT`). Any error rolls back every statement of the batch and is thrown. An empty batch is refused (`No SQL statements detected.`), as D1 refuses it.
- A5. The adapter runs nothing else between the statements of a batch. Execution inside the adapter is synchronous, so the batch is one unbroken block.

**Errors**
- A6. An SQLite error keeps its message and gets D1's wrapper: `D1_ERROR: <message>: <CODE> (extended: <CODE>)`. The code matches on this text: `exceeds_due` and `exceeds_payment` (from `RAISE(ABORT, ...)` triggers), `UNIQUE constraint failed` and `guardCode` in `apps/api/src/payments/routes.ts` and `apps/api/src/oldgold/routes.ts`. Checked on both backends with identical text for UNIQUE, CHECK, FOREIGN KEY, trigger abort and missing table. One difference: a syntax error has no `at offset N` suffix, because `node:sqlite` does not report the offset.
- A7. Errors reject the promise. They are not thrown synchronously, as in D1. The one exception is `bind()`, which refuses a bad value at once, as D1 does.
- A8. Value rules, as D1: `null` binds as NULL; `true` and `false` bind as 1 and 0; `undefined` and `bigint` are refused (`D1_TYPE_ERROR`); a wrong number of bound values is refused (`Wrong number of parameter bindings for SQL query.`).

**Connection**
- A9. Foreign keys are ON. The adapter runs `PRAGMA foreign_keys = ON` when it opens the file and checks that it took effect. D1 has foreign keys on by default, so the API expects them.
- A10. A SQL text with no bound values runs every statement in it (a migration chunk can hold several). Whether a statement returns rows is decided from the SQL text (`SELECT`, `WITH`, `VALUES`, `PRAGMA`, or DML with `RETURNING`), not from `columns()`, because SQLite reports a column for some DDL (`ALTER TABLE ... CHECK`). A statement with bound values must be a single SQL statement, which is how the API writes them.
- A11. The SQLite file is one connection per adapter instance. Compiled statements are cached by SQL text.
- A12. Node's `ExperimentalWarning` for `node:sqlite` is printed, not hidden.

**Test backend**
- A13. `test/helpers.ts` selects the backend with `DB_BACKEND`: `sqlite` (the default in this spec) or `d1` (Miniflare, as before). `createTestDb()` and `openEmptyDb()` keep their signatures and return `{ db, dispose }`, so the 19 existing test files are unchanged.
- A14. `applyMigration()` splits the file the same way on both backends (`--> statement-breakpoint`, then `trim` and drop empty parts). Miniflare is loaded only on the `d1` path.

**Unchanged**
- A15. The cloud path is unchanged: `c.env.DB` in `apps/api/src/index.ts` and the routes, `wrangler.jsonc`, the migrations, and the Worker bundle (which does not import `sqlite.ts`). No migration is added. No screen changes, so the browser suite is not part of this spec's verification.

## 3. Data and API
- **Data:** no change. The same migrations 0000 to 0021 run on both backends.
- **API:** no change. No route, status code or response changes.
- **Module:** `apps/api/src/db/sqlite.ts` exports `SqliteDatabase` (constructor takes a file path or `:memory:`; `prepare`, `batch`, `close`) and `SqliteStatement` (`bind`, `first`, `all`, `run`). The adapter is typed to the D1 type the code uses by one cast, in `test/helpers.ts`. The parity tests are the check that the surface matches.

## 4. Screens
None. Phone and PC screens are unchanged.

## 5. Edge cases
- A bad value (`undefined`, `bigint`) fails at `bind()`, before any SQL runs.
- A `RAISE(ABORT)` inside a batch rolls back the earlier statements of the batch (the same as a UNIQUE failure).
- A `?` inside a string literal or a comment would be counted as a bound value. The API SQL has none. A future change that needs one must bind it differently.
- A multi-statement SQL text with bound values is not supported (only the first statement runs). The API never writes one.
- A `SELECT` that is a multi-statement text is not supported (only the first statement's rows are returned).

## 6. Test cases
`apps/api/test/dbAdapter.test.ts` (20 tests). It runs on whichever backend `DB_BACKEND` selects, so run it on both:
- `batch` rolls back earlier statements when a later one fails (UNIQUE), and commits all of them when all succeed, with results in order.
- An empty batch is refused with `No SQL statements detected`.
- `RAISE(ABORT, 'exceeds_due')` surfaces a message containing `exceeds_due`, and inside a batch it rolls the batch back.
- A UNIQUE violation message contains `UNIQUE constraint failed`. A foreign key violation fails, and `PRAGMA foreign_keys` reports 1.
- A syntax error rejects the promise and is not thrown synchronously.
- `RETURNING` works through `first()` and `all()`. `first()` returns null with no rows. `all()` returns `{ success, results }` with plain objects, and `[]` with no match.
- `run()` reports `meta.changes` (2 rows updated) and `meta.last_row_id` on an insert.
- A statement is reused in a batch and with `bind()`, and `bind()` leaves the original unchanged.
- Booleans bind as 1 and 0; null binds as null; `undefined` and `bigint` are refused at `bind()`; a wrong number of bound values is refused.
- `run()` executes every statement of a multi-statement text. A DDL statement with `CHECK` (`ALTER ... CHECK`) does not stop the statements after it.
- The append-only trigger of the real schema refuses a delete of a customer, with its message.

Full suite: the existing 661 tests, unchanged, pass on both backends.

## 7. Out of scope
- Running under Electron's bundled Node (spec 083 checks it; see Q120).
- A fallback to `better-sqlite3` (only if Q120 fails).
- Local server entry (081), migration runner and backup (082), desktop shell (083), installers (084).
- Journal mode, WAL and busy timeouts for a desktop file (decided with 081).
- A CI job for the `d1` backend (see Q121). CI itself is not changed here.
- Browser suite: not run for this spec (no screen or deploy change).

## 8. Defaults used (owner may change later)
- Q120 (Electron): use `node:sqlite`. If it does not load in Electron's bundled Node, spec 083 switches the adapter to `better-sqlite3`, behind the same class.
- Q121 (test backends): `npm test` runs on SQLite (`DB_BACKEND=sqlite`). The D1 suite runs with `DB_BACKEND=d1` and is not yet a CI step.

## 9. Acceptance checklist
- [x] A1 to A8 implemented in `apps/api/src/db/sqlite.ts`. The parity tests (`apps/api/test/dbAdapter.test.ts`, 20 tests) pass on both backends.
- [x] A9 to A12 implemented. Foreign keys verified on open. Multi-statement migration chunks run in full on the SQLite backend.
- [x] A13 and A14 implemented in `apps/api/test/helpers.ts`. `createTestDb()` and `openEmptyDb()` keep their signatures. No existing test file changed.
- [x] A15: no migration, route, screen or Worker change (`git diff` touches only the helper, the adapter, the new test file and this spec).
- [x] `npm run typecheck` clean.
- [x] `DB_BACKEND=sqlite npx vitest run`: 37 files, 681 tests passed.
- [x] `DB_BACKEND=d1 npx vitest run`: 37 files, 681 tests passed.
- [x] `npm run build` passes.
- [ ] Owner approves this spec and the defaults for Q120 and Q121.
- [ ] Q120 checked inside Electron's bundled Node (spec 083).
- [ ] A CI step runs the suite with `DB_BACKEND=d1` (Q121), before the cloud deploy relies on the D1 path being tested.

Status line: built on branch `spec-080-db-adapter` (Wave 4, PR into `wave-4`), owner approval pending.
