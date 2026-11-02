# 082: Local migration runner (apply, record, back up before an upgrade)

Status: Built (Wave 4) on branch `spec-082-migration-runner`, PR into `wave-4`. Owner approval pending. The build follows `docs/wave4-plan.md` (step 3).
Depends on: 080 (database adapter), 081 (local server and the temporary `local:migrate`), 001 (migration files), 000 (test setup)
Open questions used with defaults: Q175 to Q179 (listed in `docs/open-questions.md`, section U).

## 1. Goal
The desktop app's database is upgraded safely when the server starts. The migration files run in order, each in its own transaction, and the runner records what ran. Before any upgrade, the database is copied next to itself. If an upgrade fails, the server does not start, and the message says why and where the copy is. This replaces the temporary `local:migrate` step of spec 081. The cloud version keeps `wrangler d1 migrations` and does not change.

## 2. Rules

**Recording**
- M1. The runner keeps `schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`, one row per applied file. `checksum` is the SHA-256 (hex) of the file's text.
- M2. Pending files run in filename order. Each file runs in one transaction together with its record row (the adapter's `batch`). A failing file is rolled back, is not recorded, and stops the run. Files applied earlier in the same run are kept.
- M3. A new file whose name sorts before an applied file is refused, because the history would stop being in order. Nothing changes.

**History is never rewritten**
- M4. A recorded file whose checksum differs from the file on disk is refused: the message says the file has changed since it was applied, and that applied migrations are never rewritten.
- M5. A recorded name whose file is missing from the folder is refused. Applied migrations are never removed or renamed.
- M6. A refusal happens before any backup or change.

**Backup**
- M7. Before any change to a database that already has applied migrations, the runner copies it with `VACUUM INTO` to a file next to the database, named `billing.sqlite.backup-<UTC time>-from-<version>.sqlite`. `<version>` is the number of the last applied migration (for example `0018`). `VACUUM INTO` writes one consistent file that includes pages still held in the WAL file (Q125). A plain file copy would miss them.
- M8. A new database (no applied migrations) gets no backup. An up-to-date database gets no backup (a second run changes nothing).
- M9. If the backup cannot be made, nothing is changed and the run stops with the reason.
- M10. Retention: after each backup, backups of the same kind (same database file name and the same name pattern) are counted by their timestamp. The 5 newest are kept and older ones are deleted. The live database and every other file in the folder are never deleted.

**Recognising a database from spec 081**
- M11. Spec 081 recorded applied files in `d1_migrations` and created no `schema_migrations`. The runner recognises such a database and does not run its migrations again:
  1. It replays the migration files on an empty in-memory database, one file at a time. After each file it compares the schema with the live one. The schema is every table, index, trigger and view (type, name, table and SQL text, spaces collapsed). `d1_migrations` and `schema_migrations` are left out of the comparison.
  2. The number of files whose state matches is the number applied, N. An empty database matches N = 0.
  3. If `d1_migrations` exists, its names must be exactly the first N file names, otherwise the runner refuses.
  4. Then `schema_migrations` is created, and the first N files are recorded with their current checksums. The old text of those files cannot be checked; the schema match is the evidence. `d1_migrations` is left in place.
- M12. The runner refuses, and changes nothing, when:
  - no state matches (the schema was changed by hand, or comes from another version);
  - more than one state matches. This happens when a file changes no table, column, index or trigger (it only changes rows), so the schema cannot tell whether it ran. The runner does not guess; the owner has to decide.
- M13. The first run on a database recognised this way makes a backup (it has applied migrations) and records the files, even when none is pending.

**Server and scripts**
- M14. The server checks for the web build first (081 L5), then runs the runner, and only then listens. If the runner refuses or fails, the server does not start. The message gives the reason, the file that failed (if any) and the backup path (if one was made). `npm run local` prints the message and exits with an error.
- M15. `npm run local:migrate` runs the runner and prints what it did: applied, already applied, recognised from 081, the backup made, and older backups deleted. The script name is kept so existing notes still work.
- M16. `npm run local:owner` runs the runner before it sets the password. This replaces the 081 refusal ("run local:migrate first"), so the owner command works on a new folder too.
- M17. A new or empty data folder is created and migrated when the server starts. This replaces the 081 rule that refused an empty folder (the runner is safe on a fresh folder, and there is nothing to back up).

**Concurrency**
- M18. The server and `local:owner` can both run the runner. Each file runs in one transaction with `BEGIN IMMEDIATE`, and the 5 second busy timeout (081 L12) lets the second process wait. The runner holds no lock between files, so two runs can both decide that a file is pending; the second one then fails on the existing table or record and rolls back. That is safe, but it is not a proper lock, and it is not designed further here.

## 3. Data and API
- **Data:** one new table, `schema_migrations`, created by the runner. No migration file, schema or row changes. `d1_migrations` (spec 081) is left in place and read only when recognising the database.
- **Code:** `apps/api/src/local/migrations.ts` (`runMigrations`, `listMigrationFiles`, `pruneBackups`, `describeMigrations`, `MigrationError`). `apps/api/src/local/migrate.ts` (the 081 temporary step) is removed. `server.ts`, `run.ts` and `cli.ts` call the runner.
- **Scripts:** `local:migrate` and `local:owner` keep their names. `apps/api/package.json` is unchanged.
- **API:** no change. No route, status code or response changes.

## 4. Screens
None. The screens are unchanged. The owner sees the upgrade messages in the terminal only; the first-run wizard (085) will show them later.

## 5. Edge cases
- A failing file in the middle of a run: the files before it in the same run stay (each has its own transaction). The backup is from before the run, so the owner can go back to it.
- A backup that cannot be made stops the run before any migration runs (M9).
- A migration file edited after it was applied: refused at the next start, with the file name (M4). The old text is not kept, so the fix is to put the file back.
- A migration that changes only rows, in a database made by 081, may be impossible to recognise (M12). The runner then refuses and asks.
- Backups hold committed data from the WAL file, because `VACUUM INTO` reads through SQLite.
- Restoring a backup is not part of this spec. It is spec 086, which keeps a copy of the current data before a restore.
- A process that is killed in the middle of a backup may leave a partial file with the backup name. The runner does not delete it on its own. The next prune counts it like any other backup.

## 6. Test cases
`apps/api/test/localMigrations.test.ts` (12 tests, real SQLite files in a temporary folder, and a temporary copy of the migration folder where a test needs an older set):
- Fresh file: all 22 migrations applied in order, each recorded with the SHA-256 of its file. No backup. A second run applies nothing and makes no backup.
- File migrated to 0010: the runner applies 0011 to the last, and makes a backup first (`...-from-0010.sqlite`). The backup holds 11 records and the seeded customer as it was (`C-0001`). The live database converts the seeded rows as the migrations say (`C0001`, `INV-0007`, `INV-0008`), so the seeded rows survive.
- File made by the 081 temporary step with all 22 files: recognised, nothing is run again (an old-format row `C-0009` is left alone; running 0011 again would change it), a backup is made, and a second run changes nothing.
- File made by the 081 temporary step with files up to 0010: 0000 to 0010 are recognised and 0011 to 0021 are applied.
- A schema that matches no state (a hand-made table): refused, nothing changed, no `schema_migrations` table.
- Two states match (a migration that changes only rows): refused, nothing changed.
- A migration file changed after it was applied: refused with the file name and "never rewritten". No backup.
- A new file that sorts before an applied one: refused.
- A migration that fails halfway (create table, then insert into a missing table): the file is rolled back (its table does not exist), not recorded, the file before it in the same run is kept, and the message names the file and the backup. Then `startLocalServer` on the same folder rejects with the same message: the server does not start.
- Retention: seven older backups of the same kind, one file that looks like a backup but is not, and a stray file. After one upgrade: 5 backups of this kind are kept (the new one and the four newest old ones), 3 are deleted, and the other two files and the live database are untouched.

Changed 081 test: `apps/api/test/localServer.test.ts` now imports the runner. Its test "refuses an empty data folder" (081 L5) is replaced by "creates and migrates an empty data folder, then serves" (M17).

Full suite: `npx vitest run` (SQLite) 39 files, 707 tests passed. `DB_BACKEND=d1 npx vitest run --maxWorkers=2` 39 files, 707 tests passed.

Browser suite: `BASE_URL=http://127.0.0.1:8820 node e2e/run-all.mjs` after the real upgrade (section 9): 289 PASS, exit 0.

## 7. Out of scope
- Restoring a backup, copying backups to another folder or drive, and the owner's choice of folder (086, 085).
- Rolling back a migration. Migrations are only applied forwards.
- The cloud version. `wrangler d1 migrations` and the Worker are unchanged.
- Electron (083) and installers (084).
- A process lock across the whole run (M18).
- Journal mode (081 Q125 is unchanged).

## 8. Defaults used (owner may change later)
- Q175 (backup when recognising an old database): the runner makes a backup whenever it writes to a database that already has applied migrations, including the first run that only records the files (M13).
- Q176 (backup name and keeping): `billing.sqlite.backup-<UTC time>-from-<version>.sqlite` in the data folder; the 5 newest of that kind are kept (M7, M10).
- Q177 (unclear states): refuse and ask, never guess (M12).
- Q178 (owner command): `local:owner` runs the runner before setting the password (M16).
- Q179 (empty folder): the server creates and migrates an empty folder at start-up, replacing the 081 refusal (M17).

## 9. Acceptance checklist
- [x] M1 to M18 implemented in `apps/api/src/local/migrations.ts`, with `server.ts`, `run.ts` and `cli.ts` updated. `migrate.ts` (081) removed.
- [x] Tests M1 to M17 in `apps/api/test/localMigrations.test.ts` (12 tests), and the 081 server test updated (section 6).
- [x] `npm run typecheck` clean.
- [x] `npx vitest run` (SQLite): 39 files, 707 tests passed.
- [x] `DB_BACKEND=d1 npx vitest run --maxWorkers=2`: 39 files, 707 tests passed.
- [x] `npm run build` passes.
- [x] Real upgrade: a folder whose database was made by the runner from the files up to `0018_discounts_stones.sql` (19 records) and given the owner login. `npm run local -w @jewellery/api` with `JB_DATA_DIR` on port 8820 made `billing.sqlite.backup-<time>-from-0018.sqlite` (19 records), applied 0019, 0020 and 0021, and served. A setup step saved the 2026-02-03 silver fixture through `PUT /api/rates/...` (Q127), outside the test files.
- [x] Browser suite `BASE_URL=http://127.0.0.1:8820 node e2e/run-all.mjs` on that upgraded database: 289 PASS, exit 0.
- [x] `npm run local:migrate` on the upgraded folder: nothing applied, no backup.
- [ ] Owner approves this spec and the defaults for Q175 to Q179.
- [ ] Not checked: a failing migration through the command line output (the message is tested through the function and through `startLocalServer`); a database made by the real 081 `local:migrate` (the 081 step is removed, so its state is rebuilt in the test by the same steps); a power cut during a backup; Windows paths.
- [ ] Spec 083 checks the runner under Electron's bundled Node (Q120).

Status line: built on branch `spec-082-migration-runner` (Wave 4, PR into `wave-4`), owner approval pending.
