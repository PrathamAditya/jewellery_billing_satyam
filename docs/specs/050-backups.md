# 050: Backups and restore

Status: Approved (Wave 1, owner approved in advance 2026-11-01), not built
Depends on: 004, and all earlier specs (it backs up every table)
Open questions used with defaults: Q81 (local PC copy), O14

## 1. Goal
Every day an automatic backup of the whole database goes to cloud storage, several versions are kept, the owner can download a backup at any time, and a full restore is possible. A copy also reaches the showroom PC.

## 2. Rules
- R1. **Format:** a backup is one gzip-compressed JSON file `backup-YYYY-MM-DDTHH-MM-SSZ.json.gz` with `{ formatVersion, createdAt, schemaVersion (last migration name), tables: { name: [rows...] } }` containing every table of the database (all business tables, audit log, revisions, number series, settings, users including password hashes, sessions are excluded). Table list comes from `sqlite_master`, so new tables are included automatically. Large tables are read in pages of 5,000 rows.
- R2. **Daily automatic backup to the cloud:** a Worker `scheduled` handler runs at 18:30 UTC (midnight India time) and writes the file to the R2 bucket bound as `BACKUPS`. It records the result in `backup_log` (`id`, `at`, `kind` auto or manual, `file`, `size`, `rows`, `status`, `error`). A failed backup is visible in the Backups screen and the Home banner "Last backup failed".
- R3. **Versions kept:** the last 30 daily backups, plus the first backup of each of the last 12 months. Older ones are deleted by the same scheduled run after a successful backup, never before.
- R4. **Manual backup and download:** `POST /api/backups` (needs `backups.manage`) makes a backup now. `GET /api/backups` lists backups and the log. `GET /api/backups/:file` downloads one (needs `backups.view`). Every action writes an audit row.
- R5. **Local PC copy (default for Q81, option b):** while the app is open on the showroom PC, once a day it asks the server for the newest backup and saves it to a folder the owner picked once (File System Access API, remembering the choice), or downloads it normally if the browser has no folder access. The Backups screen shows "Last copy saved to this PC: date" and a "Save a copy now" button. A small helper program for fully automatic PC copies is a later option (Q81 a).
- R6. **Restore (command line, this wave):** `npm run backup:restore -- --file <path> --local|--remote` (script in `apps/api/scripts/`). It refuses to run without a `--yes-restore` flag, first writes a safety backup of the current data to a file, checks `formatVersion` and that `schemaVersion` equals the database's latest migration, then empties and reloads all tables in batches (foreign order does not matter, there are no foreign keys), and finally prints row counts per table that must equal the backup's. Sessions are cleared so everyone logs in again. A restore into an empty local database from a fresh backup must give identical rows (tested).
- R7. **Restore from the screen** is not part of Wave 1: the Backups screen shows the exact command and the steps. (The owner runs commands on his PC.)
- R8. **Integrity:** each backup's JSON includes a SHA-256 of the rows per table, checked by the restore script and by an automatic "verify backup" action (`POST /api/backups/:file/verify`) that reads the file and compares counts and hashes.
- R9. No customer data in logs: backup contents never appear in logs, errors or audit rows (only counts and sizes).
- R10. The backup includes password hashes, so downloads need `backups.view` (owner only by default) and the file is described as sensitive on the screen.

## 3. Data
Table `backup_log`. `wrangler.jsonc` gets `r2_buckets` `[{ "binding": "BACKUPS", "bucket_name": "jewellery-billing-backups" }]` and `triggers.crons ["30 18 * * *"]`. The one-time commands the owner must run are documented in `docs/HANDOFF.md` and in the Backups screen: `npx wrangler r2 bucket create jewellery-billing-backups` and then deploy. Local development and tests use Miniflare's R2. `Bindings` type gains `BACKUPS: R2Bucket`. The app must still work (and say "Backups are not set up") if the binding is missing.

## 4. Screens
**Backups** (top bar, `backups.view`): last backup status and time, a table of versions (date, size, rows, Download, Verify), "Backup now" (`backups.manage`), the local PC copy panel (choose folder, last copy, Save a copy now), and the restore instructions box.

## 5. Edge cases
- Two backups at the same second get different file names (a counter suffix).
- A scheduled run while a manual backup is running: both succeed.
- R2 missing or full: logged as failed, never throws into other requests.
- A backup of an empty database restores to an empty database.
- Restore of a backup from an older schema is refused with the reason.

## 6. Test cases
- Backup contains every table: seed rows through the API (customer, rate, invoice, payment, order, old gold receipt, settings, users), make a backup, read it back, assert row counts per table equal the database's and that `sessions` is excluded. A test creates a new table in the test database and asserts it appears without code changes.
- Round trip: restore the file into a second empty in-memory database with the restore code path (the script's core function is exported and tested), and assert every table is identical (row by row, JSON equality) and the totals (outstanding, advances, invoice payables) are equal.
- Retention: given a fake clock with 45 daily backups over 14 months, the cleanup keeps exactly the last 30 and the first of each of the last 12 months and deletes nothing when the new backup failed.
- Scheduled handler writes the object and a `backup_log` row, a failing R2 writes a `failed` row.
- Verify detects a corrupted file (changed row) and a truncated file.
- Permissions: staff gets 403 on backup routes, owner only for manual and download.
- No row content in logs or audit (assert on audit detail).
- Local copy logic (web): pure function deciding "a copy is due" from the last-copy date and the newest backup date, table-tested.
- Browser (`e2e/backups.mjs`): Backup now, see it listed, verify it, download works (file starts with the gzip magic bytes), restore instructions visible, phone view without Backup now.

## 7. Out of scope
Restore from the screen, an installable helper for PC backups, encrypted backups, off-cloud second destination, point-in-time recovery (D1 Time Travel exists in Cloudflare as an extra safety net, mention it in the instructions), restoring a single table.

## 8. Defaults used
Q81: option (b), folder copy while the app is open plus manual download. O14 stays open until the owner chooses the helper program.

## 9. Acceptance checklist
- [ ] R1 to R10 implemented and tested, round trip proven
- [ ] `wrangler.jsonc` updated, owner steps documented
- [ ] Browser test passes, earlier tests green
