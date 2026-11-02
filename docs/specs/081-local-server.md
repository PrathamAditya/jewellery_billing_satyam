# 081: Local server entry (API and web app on 127.0.0.1)

Status: Built (Wave 4) on branch `spec-081-local-server`, PR into `wave-4`. Owner approval pending. The build follows `docs/wave4-plan.md` (step 2). It changes no screen, no route and no cloud behaviour.
Depends on: 080 (database adapter, `apps/api/src/db/sqlite.ts`), 002 (login and session cookie), 001 (migrations), `docs/wave4-plan.md`
Open questions used with defaults: Q122 to Q127 (listed in `docs/open-questions.md`, section U).

## 1. Goal
The downloadable version runs on the owner's PC as one local Node process: the same API the Cloudflare Worker runs (`createApp()`), on the spec 080 SQLite file, and the built web app, served from the same address. The process listens on 127.0.0.1 only, so nothing outside the PC can reach it. Spec 083 (desktop shell) starts and stops this process; spec 090 (network access) is out of scope.

## 2. Rules

**Entry and address**
- L1. The entry is `apps/api/src/local/run.ts` (`npm run local`). It starts one HTTP server that serves the API under `/api` and the built web app (`apps/web/dist`) at every other path.
- L2. The server listens on `127.0.0.1` only. The address is not configurable. A request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` gets 403 (DNS-rebinding guard).
- L3. The port comes from `JB_PORT`. Default `8765` (Q122). A value that is not a whole number from 1 to 65535 stops the start with a message.
- L4. On start the process prints the address to open (`http://127.0.0.1:<port>`) and the data folder. Ctrl+C (SIGINT) and SIGTERM close the HTTP server and the database file, then exit 0.
- L5. (Superseded by 082, M14 and M17: the server now runs the migration runner before it serves, and an empty folder is migrated, not refused.) The server refuses to start when the migration runner fails, and refuses to start when `apps/web/dist/index.html` is missing (run `npm run build`).

**Web app**
- L6. Files are served with a content type from the extension (HTML, JS, CSS, JSON, images, fonts). `index.html` is `no-cache`. Files under `assets/` (content-hashed by Vite) are cached for a year.
- L7. Any GET or HEAD request that is not an API request and matches no file gets `index.html` (the hash-routing safety net). Other methods on non-API paths get 405.
- L8. A path that leaves the web folder gets 400. Nothing outside `apps/web/dist` is readable through the server.

**API**
- L9. Requests to `/api` and `/api/...` go to `createApp()` unchanged, with the database passed as `DB` in the environment (the same binding name the Worker uses). No route, status code or response changes.
- L10. An unknown `/api/...` path returns the JSON 404 `{ "error": "not_found" }` when the request is logged in. Without a login it returns the JSON 401 (the login check runs first, as on Cloudflare). It never returns `index.html`.

**Data**
- L11. The data folder is `JB_DATA_DIR` when set; otherwise `Documents/JewelleryBilling` in the owner's home folder (Q117). The database file is `billing.sqlite` in that folder. The folder is created if missing.
- L12. The database is opened through the spec 080 adapter with foreign keys on (080 A9), `PRAGMA busy_timeout = 5000` and `PRAGMA journal_mode = WAL` (Q125). A second process (`local:migrate`, `local:owner`) waits up to 5 seconds for the server's write instead of failing at once. WAL adds `billing.sqlite-wal` and `billing.sqlite-shm` next to the file; spec 086 (backup) copies the database through SQLite, not by copying the file alone.
- L13. The session cookie rule is unchanged in both modes (decision, see section 8): `__Host-session`, `HttpOnly`, `Secure`, `Path=/`. Chrome stores and sends a `Secure` cookie on `http://127.0.0.1` and on `http://localhost` (checked, section 9). No separate HTTP rule is added. A LAN address would not get the cookie over plain HTTP; that is for spec 090, which needs HTTPS.

**Setup scripts (temporary, see L16)**
- L14. `npm run local:migrate` applies the migration files in `apps/api/migrations` in name order, each file in one transaction, and records each name in table `d1_migrations` (the table name Wrangler uses). A file already recorded is skipped. The data folder is `JB_DATA_DIR` or the default in L11.
- L15. `npm run local:owner` creates or resets the owner (username `owner`) on the local database with the SQL the cloud script uses (`ownerUpsertSql`, spec 002 R3): it ends every session of the owner and writes the audit row. The password comes only from the environment variable `OWNER_PASSWORD` (at least 10 characters). It is never an argument, a file or a printed value. It refuses to run on an unmigrated database.
- L16. Temporary: spec 082 replaces `local:migrate` with the real runner (recording, and a copy of the database before any upgrade). `local:owner` stays and is reused by 085 (first-run setup).

## 3. Data and API
- **Data:** no change. No migration is added. The same migrations 0000 to 0021 run as on Cloudflare.
- **API:** no change. No route, status code or response changes (L9, L10).
- **Files:**
  - `apps/api/src/local/run.ts` (entry, signals, messages), `server.ts` (`startLocalServer`), `static.ts` (web app handler), `database.ts` (data folder and database open), `migrate.ts`, `owner.ts`, `cli.ts` (`migrate` and `owner` commands).
  - `apps/api/package.json`: scripts `local`, `local:migrate`, `local:owner`; dependency `@hono/node-server` (Q126). It is the Node adapter for Hono's `Request` and `Response`. Cloudflare's Worker bundle does not import it.
- **Environment:** `JB_DATA_DIR`, `JB_PORT`, `OWNER_PASSWORD` (only for `local:owner`).

## 4. Screens
None. The screens are the web app already built. Phone and PC screens are unchanged.

## 5. Edge cases
- Port in use: the start fails with the system error (`EADDRINUSE`); nothing else is stopped. The owner picks another `JB_PORT`.
- Data folder not writable: the start fails before listening, with the system error.
- Database file from a newer or older migration set: refused by L5 until `local:migrate` runs. No migration is ever rolled back.
- Two servers on the same data folder: not supported. The second fails when it reads the database lock or refuses at L5. Spec 083 keeps one server per PC.
- Ctrl+C while a request runs: the server waits for open connections to close, then closes the database. Open connections are closed at the same time, so the process exits quickly.
- `Host: localhost:<port>` and `Host: 127.0.0.1:<port>` both work. The Origin check of 002 R10 compares the same host, so both work for changes too.

## 6. Test cases
`apps/api/test/localServer.test.ts` (14 tests). It starts the server on port 0 (a free port) with a temporary data folder and a stand-in web folder, so it needs no build. It uses the SQLite backend (`DB_BACKEND` does not change it; the local server is always SQLite):
- `/api/health` answers 200 with `db: "ok"`.
- `/` serves the web index as `text/html; charset=utf-8`, `no-cache`. `/assets/app.js` serves as JavaScript with the long cache.
- An unknown non-API path (`/customers/unknown/page`) gets `index.html`.
- A POST to a non-API path gets 405 with `Allow: GET, HEAD`.
- A path that leaves the web folder (percent-encoded `../`) gets 400.
- A `Host` header that is not the loopback name gets 403.
- An unknown `/api` path gets the JSON 404 once logged in, and the JSON 401 without a login. Never HTML.
- Login with the owner password gives 200 and a `__Host-session` cookie with `HttpOnly`, `Secure`, `Path=/`; the cookie then opens `/api/auth/me`. A wrong password gives no cookie.
- The server is not reachable on the machine's first non-loopback IPv4 address (`ECONNREFUSED`). Skipped as a no-op if the machine has no such address.
- The server does not start on an empty data folder (message mentions `local:migrate`).

Browser suite against the real server: `BASE_URL=http://127.0.0.1:8810 node e2e/run-all.mjs` (after `npm run build`, `npm run local:migrate`, `npm run local:owner`). Run for this spec (section 9).

Fixture needed on a fresh database (Q127): `e2e/invoices.mjs` expects the silver rate for 2026-02-03 to be 150.123. The rate lookup takes the latest rate on or before the invoice date, and a fresh database has no rate that early. The run therefore first saves that rate with the owner's login: `PUT /api/rates/2026-02-03/silver` with `{"price":"150.123","unit":"gram","reason":"e2e fixture"}`. The browser test itself is unchanged.

## 7. Out of scope
- A settings file for the data folder (the plan's "with a settings file"). The folder is `JB_DATA_DIR` or the default until the setup screen (spec 085) writes a choice (Q117).
- The real migration runner and the database copy before an upgrade (082). `local:migrate` is temporary (L16).
- Electron, the window, starting and stopping the server from the app (083).
- Installers, signing (084), backup and restore (086), updates (087), recovery code (088), packaged-app tests (089).
- HTTPS, phones and other PCs on the network, the login rules for them (090, Q112).
- A Windows service or start-at-login.
- Changing the cloud Worker, `wrangler.jsonc`, the migrations, or the cookie rule of the cloud.

## 8. Defaults used (owner may change later)
- Q122 (port): 8765, from `JB_PORT`. Chosen away from the cloud dev ports (8787, 8799) and the test port range (8810 and above).
- Q123 (scripts): `local:migrate` is temporary until 082; `local:owner` stays.
- Q124 (data folder on Windows): `Documents/JewelleryBilling` in the home folder, which Windows may move under OneDrive. The owner decides at setup (085) whether to keep it.
- Q125 (journal mode): WAL with a 5 second busy timeout. Rollback journal would also work for one server; WAL lets the local scripts read and write while the server runs. The backup (086) must use SQLite's own copy.
- Q126 (dependency): `@hono/node-server` 2.1.5 (peer `hono` ^4, already installed). The alternative is a hand-written converter, which would need its own tests for streaming and headers.
- Q127 (e2e fixture): the browser suite's fresh-database run saves the silver rate for 2026-02-03 first (section 6). The default leaves the browser tests unchanged; a later change should make `invoices.mjs` use a date with its own rate.
- Cookie rule (decision, not a question): `__Host-session` stays `Secure` in local mode. Checked in Chrome on both loopback names (section 9), so no HTTP-only cookie variant exists. A rule "Secure only over HTTPS" was considered and not needed.

## 9. Acceptance checklist
- [x] L1 to L5 implemented in `apps/api/src/local/` (run, server, static, database, migrate, owner, cli).
- [x] L6 to L8 tested (`localServer.test.ts`: content types, cache, fallback, traversal, 405).
- [x] L9 and L10 tested: health, JSON 404 after login, JSON 401 without login.
- [x] L11 and L12 implemented: `JB_DATA_DIR`, WAL and busy timeout in `openLocalDatabase`.
- [x] L13 checked in headless Chrome 156 (Playwright, `/usr/bin/google-chrome`): login on `http://127.0.0.1:8810` and on `http://localhost:8810` sets `__Host-session` (`secure=true`, `httpOnly=true`, `path=/`), and `/api/auth/me` returns 200 with it. Not checked: Firefox, Edge, Safari, a LAN address.
- [x] L14 and L15 implemented: `local:migrate` applied 22 migrations to a fresh folder; `local:owner` set the owner from `OWNER_PASSWORD`.
- [x] `npm run typecheck` clean.
- [x] `npx vitest run` (SQLite): 38 files, 695 tests passed.
- [x] `DB_BACKEND=d1 npx vitest run --maxWorkers=2`: 38 files, 695 tests passed. With the default parallelism, `ledger.test.ts` ("a seeded run of random steps", 30 s test timeout, about 28 s alone) timed out in 2 of 3 full runs and passed in the other. This test is not changed by spec 081 (see PR).
- [x] `npm run build` passes.
- [x] `npm run typecheck` clean after the last change.
- [x] Browser suite `BASE_URL=http://127.0.0.1:8810 node e2e/run-all.mjs` against the local server, on a fresh database with the fixture rate (Q127): all 18 files, 289 PASS, exit 0.
- [ ] Owner approves this spec and the defaults for Q122 to Q127.
- [x] Spec 082 replaces `local:migrate` (L16): the runner is in `apps/api/src/local/migrations.ts`, and `local:migrate` and `local:owner` call it.
- [ ] Spec 083 checks that the server runs under Electron's bundled Node (Q120).

Status line: built on branch `spec-081-local-server` (Wave 4, PR into `wave-4`), owner approval pending.
