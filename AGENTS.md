# AGENTS.md: start here

You are continuing a project that another AI agent (Claude Code) built up to Wave 1. This file is the contract. Read it fully, then read `docs/HANDOFF.md` and `docs/wave1-plan.md`, then start building Wave 1.

**Project:** web billing, inventory and business management for ONE gold and silver jewellery showroom (Baba Jewellers, Nadaun, Himachal Pradesh, India). Regular GST scheme, state code 02. It replaces an Excel inventory and an HTML billing system. It is jewellery retail software, not a generic GST app. Owner: Pratham Aditya Salhotra (developer and project owner), client showroom owner: Satyam. Reply to the owner in plain English.

**Your mission:** implement all of **Wave 1** (listed in `docs/wave1-plan.md`) in one continuous run, in the order given there, without waiting for the owner. The owner approved every Wave 1 spec in advance on 2026-11-01, with the defaults written in the specs. Parallel testing against the old system starts about **1 December 2026**, so Wave 1 must end as a stable, testable, printable build.

## Read in this order
1. `docs/HANDOFF.md`: what exists, how to run it, what is deployed, what you must not do.
2. `docs/wave1-plan.md`: the work order, branch strategy and definition of done.
3. `docs/decisions.md`: locked decisions D1 to D28. Do not change a locked decision. If a spec seems to contradict one, the decision wins and you note it in `docs/open-questions.md`.
4. `docs/specs/*.md`: one spec per feature, with numbered rules and test cases. The spec is the requirement. Specs 000 to 013 are built. The Wave 1 specs (012b, 012c, 003, 004, 015, 016, 017, 018, 019, 014, 050) are approved and not built.
5. `docs/reference-formats.md` and `docs/reference/*.pdf`: the owner's existing printed documents. Printing must match them.
6. `docs/requirements.md`, `docs/owner-answers-2026-11-01.md`, `docs/client-invoice-reference.md`: the owner's own words.
7. `docs/tech-stack.md`, `docs/open-questions.md`.

## Commands
```
npm install
npm run typecheck          # all workspaces, must be clean
npm test                   # vitest: unit, API (real workerd D1 through Miniflare), shared, calc
npm run build              # web build, must succeed
npm run db:migrate -w @jewellery/api              # apply migrations to the local D1
npm run db:generate -w @jewellery/api -- --name=x # new migration from apps/api/src/db/schema.ts
OWNER_PASSWORD=throwaway-local-pass-1 npm run owner:set -- --local   # seed the local owner (username owner)
npm run dev:e2e            # wrangler dev on http://localhost:8799 (serves the built web app and the API)
npm run e2e                # Playwright browser tests in e2e/ (needs dev:e2e running and a fresh build)
```
Node 22.22 has no TypeScript stripping: scripts run through `tsx`. Package manager is npm workspaces, not pnpm.

## Code map
- `apps/api`: Hono on Cloudflare Workers. `src/index.ts` builds the app (`createApp({ now })`, the clock is injectable for tests). `src/<module>/routes.ts` per feature, `src/db/schema.ts` Drizzle schema, `migrations/` plain numbered SQL (generate with drizzle-kit, hand-write triggers), `test/*.test.ts` run against a real in-memory D1.
- `apps/web`: React 19 + Vite + Tailwind 4, hash router (`#/path`), no UI library. `src/<module>/` per feature. Shared UI helpers in `src/customers/ui.tsx`.
- `packages/shared`: zod schemas, helpers and response types used by both API and web (customers, rates, invoices, weights, money formatting, ids).
- `packages/calc`: pure calculation code (invoice engine, rounding, numbering). No I/O. Table-driven tests.
- `e2e/`: browser tests. `docs/`: specs and decisions.

## Rules that must never be broken
1. Money is integer paise, weight is integer milligrams, rates are integer paise per kg. No floats anywhere in money or weight logic. Use BigInt for products that can pass 2^53 (`divRoundHalfUp` in `packages/calc`).
2. All rounding goes through `packages/calc/src/round.ts`. Round to the paisa half up. Final invoice and receipt totals round to the rupee: below 50 paise down, 50 or more up, shown as its own signed line.
3. Calculation code is pure and has table-driven tests with worked examples (use the owner's reference documents).
4. No hard deletes. Business tables get a `BEFORE DELETE` trigger that aborts (`noDeleteTriggerSql`). Edits keep the earlier version (`record_revisions` or per-revision rows). Voiding keeps number and row.
5. Saved invoices, receipts and old gold receipts keep the rates, GST rates, customer details and figures they were saved with, and are displayed from stored data, never recalculated.
6. Reprinting never creates a transaction. Printing is read-only (an audit row is allowed).
7. A payment, advance or old-gold amount is never counted twice. A partly used advance leaves only the unused part available. Only the amount actually allocated is deducted.
8. Do not change the invoice first page or the settlement page while building other features. Do not break earlier specs: their tests and the browser tests must stay green.
9. Print layouts: invoice A4 **portrait** (owner confirmed 2026-11-01), settlement on the back page of the same sheet (duplex), payment and old gold receipts A5 landscape on A4 paper. Internal fields and UI controls never print.
10. **Never commit** secrets, real customer data, GSTIN, PAN, phone numbers, bank account numbers, `.env` or `.dev.vars` files. Test data only (the reference PDFs use "SATYAM", "123"). Business details live in the database (spec 003) and are typed in by the owner.
11. Every change to business data writes an audit row (`auditStatement`) in the same atomic D1 batch as the change. Document numbers are allocated in the same batch as the insert so a failed save never uses a number.
12. Every route needs a login. From spec 004 on, every route also checks a named permission.

## Conventions
- Standard columns on every business table: `id` (UUIDv7 text, may be client-generated for safe retry), `created_at`, `created_by`, `updated_at`, `updated_by`. Timestamps are ISO UTC text. Business dates are `YYYY-MM-DD` in India time (`indiaDate`).
- Create endpoints accept an optional client `id` and are idempotent (`classifyReplay`): same id and content returns the first result, same id with different content is 409.
- Optimistic concurrency on edits: edits send `expectedRevision`, a stale one is 409.
- Validation with zod in `packages/shared`, errors as `{ error: "validation", issues: [{ field, message }] }` (`validationBody`). Domain errors are `{ error: "<code>", message }` with a clear sentence a shop owner can read.
- Search endpoints: case-insensitive substring, 3+ digits for mobile numbers, `LIKE ... ESCAPE '\'`, 20 per page with an offset cursor, under 200 ms with thousands of rows (test it).
- Screens: Tailwind, plain components, inline field errors, no sideways page scroll at 390 px, buttons the user may not use are hidden. Dates shown as `1 Nov 2026`, money as `₹1,23,456.00` (`formatMoney`).
- Each spec: update the status line and checklist in the spec file and the row in `docs/specs/README.md`. New decisions or unanswered questions go in `docs/decisions.md` or `docs/open-questions.md`, never only in chat.
- Tests: for every rule in a spec write an API or unit test, for every screen a browser test in `e2e/`. Use the worked examples in the specs as exact expected values.

## Gotchas already paid for (do not rediscover them)
- Test isolation: rates carry forward, so tests that save rates or invoices must use their own dates (see the year-based isolation in `apps/api/test/rates.test.ts`).
- A session expires 30 days after last use. Tests that move the injectable clock past that must log in again.
- `db.batch` is atomic and the right way to keep a number, a row and an audit row together. A unique-constraint error inside a batch rolls the whole batch back: catch `UNIQUE constraint failed` and re-read to decide replay, conflict or stale.
- A generated custom migration starts with a `-- Custom SQL migration file ...` comment line: rewrite the file fully, do not append to it (it merges the comment with your SQL).
- Partial unique indexes work with Drizzle (`uniqueIndex().where(sql...)`).
- Playwright text selectors also match hidden phone-only or PC-only copies: use `>> visible=true`.
- Do not run `pkill -f` patterns that match your own shell command. Stop the dev server with `fuser -k 8799/tcp`.
- The calculator and invoice form share `apps/web/src/invoice/LinesEditor.tsx` and `Breakdown.tsx`.
- `customers.pan` uniqueness is only among non-voided customers. Customer numbers are the `C` series and never reset.

## Working rules for this run
- Work on the branch named in `docs/wave1-plan.md`. One commit per spec (or per clear step), message starts with `Spec NNN:`. Push after every spec. Open one pull request at the end (a draft early is fine). Follow your own tool's attribution convention for commits and the pull request.
- **Do not deploy** and do not apply migrations to the live database. The owner runs `npm run db:migrate:remote -w @jewellery/api` and `npm run deploy`. Never run anything with `--remote`.
- Do not ask the owner questions mid-run. When something is unclear, pick the default written in the spec, record the question in `docs/open-questions.md` (ID, default used, spec affected) and continue.
- If a spec is wrong or impossible, fix the spec file in the same commit and say so in the commit message. If it conflicts with a locked decision, follow the decision.
- Before every commit: `npm run typecheck`, `npm test`, `npm run build`, and for UI work `npm run e2e`. Fix what you break. Never weaken or delete an existing test to make it pass.
- Finish by updating `docs/HANDOFF.md` (state, what is deployed, what the owner must do next) and writing the PR description with a test plan and deploy notes.
