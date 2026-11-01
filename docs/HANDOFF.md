# Handoff: state of the project and how to continue

Written 2026-11-01 when the project passed from Claude Code to Codex. Read `AGENTS.md` first.

## What this is
One showroom, one shared database, PC for billing and printing, Android phones for the dashboard and (later, by role) data entry. Cloudflare Workers + D1, React web app served by the same Worker. Live: https://jewellery-billing-satyam.prathamadityasalhotra.workers.dev (workers.dev, private by obscurity, login required). D1 database `jewellery-billing` (APAC), id `f67c176c-a029-444a-aed0-cd468ec25815`. Repo: private GitHub `PrathamAditya/jewellery_billing_satyam`, branch `main`.

## What is built (all merged to `main`)
| Spec | What | State |
|------|------|-------|
| 000 | Scaffold, CI, deploy | Done, live |
| 001 | Database foundation: ids, audit log, revisions, numbering, no-delete triggers | Done, live |
| 002 | Owner login (PBKDF2, session cookie `__Host-session`, rate limit, change password, `owner:set`) | Done, live |
| 010 | Customers (create, search, edit with history, void/restore, masked Aadhaar, customer picker) | Done, live |
| 011 | Daily rates per kind (24K995, 22K916, silver), typed per kg or gram, stored paise per kg | Merged, live, owner check pending |
| 012 | Invoice calculation engine (`packages/calc`) and the Calculator screen | Merged, owner check pending, **not deployed** |
| 013 | Invoices: save, search, edit with revisions, void, history, list/form/page screens | Merged, **not deployed**: remote migrations `0008_invoices.sql` and `0009_invoices_no_delete.sql` are still to be applied and the Worker deployed by the owner |

Tests at handoff: 300 vitest tests, 4 browser scripts in `e2e/`, all green. Remote D1 has migrations up to `0007`.

Local numbers differ from the plan in places because the plan was updated after the owner's answers: see `docs/decisions.md` D11 (numbers become `INV-0001` style), D17 and D24. **Numbers and user roles still follow the old design in the code**: changing them is part of Wave 1 (spec 003 and 004).

## Known gaps in the built code that Wave 1 must fix
- Invoice numbers are `INV/2025-26/0001` (spec 013). Wave 1 changes the printed format to `INV-0001` and keeps the financial year as a separate stored column (spec 003 "Number formats"). Customer numbers `C-0001` become `C0001` for display.
- Only one login role (`owner`) exists and routes check only that a session exists. Spec 004 adds roles and permissions to every route.
- `pcOnly` (hidden below 768 px) hides actions on phones. From spec 004 on, buttons depend on permissions. Big forms (invoice form, calculator) stay PC layout until spec 040: on a phone they show a "use a PC" note.
- HSN is free text and GST % is typed per line, polish is entered in grams, and HSN 9988 is refused. Spec 012b fixes all three.
- Invoice voiding and editing ignore payments because payments do not exist yet. Spec 015 and 017 add those checks (see their rules).
- The invoice page Print button is a disabled placeholder. Spec 014 builds printing.

## Deployment and secrets (the owner does these, you do not)
```
npm run db:migrate:remote -w @jewellery/api     # applies new migrations to the live database
npm run deploy                                  # builds the web app and deploys the Worker
npm run owner:set -- --remote                   # hidden prompt, live owner password
```
Cloudflare account and wrangler login exist on the owner's PC only. You have no credentials for the live system and must not try to get them. The live owner username is `owner`. Never write passwords, GSTIN, PAN, phone numbers or bank numbers into the repo. Spec 003 gives the owner a Settings screen to type business details into the database.

Spec 050 needs an R2 bucket for backups and a cron trigger. You add the configuration to `wrangler.jsonc` (binding and cron) and document the one-time commands the owner must run (`wrangler r2 bucket create ...`). Local tests use Miniflare's R2.

## Local setup from a fresh clone
```
npm install
npm run db:migrate -w @jewellery/api
OWNER_PASSWORD=throwaway-local-pass-1 npm run owner:set -- --local
npm run typecheck && npm test
npm run build && npm run dev:e2e     # then, in another terminal: npm run e2e
```
Chrome is needed for `npm run e2e` (`CHROME_PATH` to override, default `/usr/bin/google-chrome`). Playwright is `playwright-core`, no browser download.

## Where things are decided
- Locked decisions: `docs/decisions.md`. Owner's words: `docs/owner-answers-2026-11-01.md`, `docs/requirements.md`.
- Printed formats: `docs/reference-formats.md` and the PDFs in `docs/reference/`.
- Questions with defaults: `docs/open-questions.md` (Wave 1 defaults are summarised in `docs/wave1-plan.md`).
- Roadmap and the 1 December 2026 testing start: `docs/roadmap.md`.

## Style of work the owner expects
Small verified steps, everything tested with real worked examples from his documents, plain-language summaries, and nothing declared done until typecheck, unit/API tests, build and the browser tests pass. He tests with the real Brother DCP-T830DW printer (A4, automatic duplex), so print output must be exact.

## When you finish Wave 1
Update this file (state table, deploy list, known gaps), list every default you used in `docs/open-questions.md`, and give the owner the deploy steps in the pull request description (new migrations in order, new Cloudflare resources, new environment settings, how to test on the live site).
