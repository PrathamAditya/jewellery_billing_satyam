# Tech stack (proposal, awaiting approval)

Goal: reliable money and stock logic, one shared database, installable on PC and Android, cheap to host.

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript everywhere | One language for UI, API and calculation code, with shared types. |
| Repo layout | npm workspaces monorepo (pnpm via corepack is broken on the dev machine's Node 22.22.1) | `apps/web`, `apps/api`, `packages/calc`, `packages/shared`. |
| Frontend | React + Vite, PWA (vite-plugin-pwa) | Installable on Windows and Android, service worker for offline shell. |
| UI | Tailwind CSS, plus a separate `print.css` per printable document | Responsive dashboard, and exact print layouts kept apart from screen styles. |
| Server state | TanStack Query | Caching, refetch, and optimistic updates. Android stays fresh through refetch on focus and polling. |
| API | Hono on Cloudflare Workers | Small, typed, and well suited to Workers. |
| Database | Cloudflare D1 (SQLite) with Drizzle ORM and SQL migrations | One database for every device. Migrations are versioned in git. |
| Validation | Zod, shared by client and server | Same rules on both sides. |
| Offline | Dexie (IndexedDB) outbox, client-generated UUIDv7 ids, idempotency keys | Safe retries and no duplicate invoices or payments. Designed in its own spec (phase 4). |
| Auth | Owner login, httpOnly session cookie, hashed password via WebCrypto | Method confirmed in the auth spec (O7). |
| Backups | D1 Time Travel, plus a nightly cron Worker exporting to R2, plus a manual export button | Point-in-time recovery and an off-database copy. |
| Printing | HTML + CSS `@page` (A4 landscape, A5 landscape) | Matches D10. Margins are calibrated on the real Brother printer. |
| Tests | Vitest for calculations and API, Playwright for end-to-end flows | Money logic gets the heaviest tests. |
| CI | GitHub Actions: typecheck, lint, test | Runs on every push. |
| Deploy | Wrangler. One Worker serves the API and the built web app. | Same pattern as the other Cloudflare projects. |

## Data rules (apply to every spec)

- **Money** is stored as integer paise. Never floats.
- **Weight** is stored as integer milligrams. Displayed as grams with 3 decimals.
- **Rates** are stored as integer paise per gram.
- **Rounding** lives in one function in `packages/calc` (below 50 paise rounds down, 50 paise or more rounds up). Nothing else rounds money.
- **Calculation code** is pure functions with no I/O, covered by table-driven tests that include worked examples from the owner.
- **No hard deletes.** Records are voided, with a reason and a timestamp.
- **Edits create a new revision.** The original stays readable. Saved invoices keep the rates, GST rates and calculations they were saved with.
- **IDs:** every record gets a UUIDv7 from the client, plus a human-readable number allocated by the server.
- **Reprint never writes** a transaction.
- **Every table** has `created_at`, `created_by`, `updated_at`, `updated_by`.

## Alternatives considered

- Supabase or a VPS with Postgres: stronger SQL, but more to operate or another vendor. D1 is enough for one showroom.
- Generated PDFs for printing: deferred. Browser print covers v1.
- Local shop server for offline: more reliable offline, but heavy to set up and maintain.
