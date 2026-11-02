# Wave 1 work plan (for Codex)

Goal: implement all of Wave 1 in one continuous run, so that the owner can start four months of parallel testing on about **1 December 2026**: make a real bill, print it on the Brother DCP-T830DW, take payments and advances, settle with old gold, see each customer's ledger, with staff logins and daily backups. Read `AGENTS.md` and `docs/HANDOFF.md` first.

All specs below are **approved in advance** (decision D12 amendment). Build them exactly as written. Where a spec used a default for an open question, use the default and keep going.

## Branch and commits
- Start from an up-to-date `main`. Create the branch `wave-1` and work only on it.
- One commit per spec, message `Spec NNN: <name>`, plus extra commits if a spec is big. Run the full check (below) before each commit. Push after each spec.
- Open a **draft pull request** after the first push and keep updating its description. Mark it ready at the end.
- Migrations are numbered in the order you build, from `0010` upward. Never edit a migration that is already committed in an earlier commit of `main`. Within this branch you may amend your own unmerged migration only before you push it.

## Order of work
Numbers are spec numbers. This is the build order, which differs from the numbering because printing needs the money modules.

| # | Spec | File | What | Depends on |
|---|------|------|------|------------|
| 1 | 012b | `specs/012b-job-work-polish-hsn.md` | HSN 9988 formula, polish percent, two HSN categories | built code |
| 2 | 003 | `specs/003-settings.md` | Settings, header snapshot, number formats `INV-0001`, `C0001` | 1 |
| 3 | 004 | `specs/004-users-roles.md` | Users, roles, permissions on every route | 2 |
| 4 | 012c | `specs/012c-discounts-stones.md` | Discounts, stones, combined pricing | 1, 3 |
| 5 | 015 | `specs/015-payments.md` | Payments, allocations, receipts model, amount in words | 3 |
| 6 | 016 | `specs/016-orders-advances.md` | Orders, advances, opening advances, cancel, refunds | 5 |
| 7 | 018 | `specs/018-old-gold.md` | Old gold purchase and its four settlements | 5, 6 |
| 8 | 017 | `specs/017-settlement.md` | Settlement tab and API | 5, 6, 7 |
| 9 | 019 | `specs/019-ledger-opening.md` | Ledger, outstanding, opening balances | 5 to 8 |
| 10 | 014 | `specs/014-print.md` | Print invoice and settlement (duplex), A5 receipts | 2, 5 to 9 |
| 11 | Final | this file, "Final pass" | Hardening, full e2e, docs, PR | all |

Why 003 and 004 come early: number formats and permissions touch every module, so doing them first avoids rewriting later modules. Why 014 is late: the settlement page and receipts print stored data that only exists after 015 to 019.

## What each step must leave behind
For every spec: code, migrations, API tests (vitest) for each numbered rule and each worked example in the spec, browser test in `e2e/` (added to `e2e/run-all.mjs`), updated spec status line and checklist, updated `docs/specs/README.md`, and green checks. Update the existing tests and browser scripts that the change affects (number formats in 003, permissions in 004) rather than weakening them.

## Defaults for open questions (use these, do not wait)
| Q | Default used in Wave 1 |
|---|------------------------|
| Q61 | Printed numbers `INV-0001`, `PAY-0001`, `OGP-0001`, `ORD-0001` without the year, year stored separately, each restarts on 1 April |
| Q62 | Customer reference `C0001` |
| Q64 | No HUID label on documents |
| Q67 | Roles owner, manager, staff, viewer as in spec 004 |
| Q68, Q69 | Discount and stone defaults of spec 012c |
| Q72 | Old gold fields exactly as the sample |
| Q73 | Modes cash, upi, card, cheque, bank_transfer, old_gold |
| Q74 | Cash warning at ₹2,00,000 or more, never blocks |
| Q76 | Orders created explicitly, optional link to invoices |
| Q77 | Shop copy and customer copy |
| Q81 | Daily folder copy while the app is open plus manual download |
| Q83 | No extra restriction for outside access |

Record in `docs/open-questions.md` (section "Defaults used in Wave 1") every other default or interpretation you make.

## Global invariants to test as properties (add them as you go)
- Settlement consistency (specs 017, 019): `received + due = payable`, no advance below zero, the ledger's last row equals the totals.
- Numbering: concurrent creates give distinct serials with no gaps, a failed create never uses a number, a series restarts per financial year and `(fy, printed number)` is unique.
- Frozen documents: changing settings, rates, customers or the calculation code never changes a saved invoice, receipt or old gold receipt, and reprints are identical.
- Permissions: every `/api` route is in the permission table test.
- Reading and printing change no business rows.

## Definition of done for Wave 1
1. All eleven specs built, their checklists ticked, `docs/specs/README.md` updated.
2. `npm run typecheck`, `npm test`, `npm run build` clean, `npm run e2e` passes (all scripts, including the earlier four).
3. The owner's reference documents reproduce exactly: invoice and settlement (`₹2,06,323.00`, balance due `₹1,89,323.00`), old gold (`₹2,55,962.27` to `₹2,55,962.00`), payment receipts (`₹14,500.00`, remaining `₹2,53,462.00`), checked by tests and by generated PDFs in `e2e/screenshots/`.
4. No secrets, GSTIN, phone numbers or bank numbers in the repo (run the scan below).
5. `docs/HANDOFF.md` rewritten for the new state, with the owner's deploy steps in order (all new migrations, the R2 bucket command, deploy) and a short manual test script for the real printer.
6. One pull request from `wave-1` to `main` with a description: summary per spec, test plan, deploy notes, defaults used, known gaps.

## Check before every commit
```
npm run typecheck && npm test && npm run build
# for UI work, in two terminals: npm run dev:e2e   and   npm run e2e
grep -rIn -E "[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.wrangler   # no GSTIN-shaped strings except obviously fake test values
```

## Final pass (step 12)
- Run every browser script on a fresh local database (delete `.wrangler/state`, migrate, seed owner, build, e2e).
- Click through the whole flow once as a person would and fix rough edges: customer, rates, new invoice, receive advance, old gold, settlement, print preview, ledger.
- Check every screen at 390 px for sideways scroll and every permission-hidden button for the `staff` and `viewer` roles.
- Search the code for `TODO` and unfinished placeholders, and for disabled "coming in spec" buttons that Wave 1 should have enabled (the invoice Print button, the customer Ledger tab).
- Write the handoff and the PR description. Do not deploy.

## After Wave 1 (do not start without the owner)
Wave 2 and 3 are in `docs/roadmap.md` and need their own specs, approved one by one. The owner will bring answers to `docs/open-questions.md` (rates feed provider, v84 HTML file, role details, discount and stone rules, U No. format). Offline-first (041) needs a design spec first because it affects every module.

## Final pass results (2026-11-02)
- Fresh local database (deleted state, migrated, owner seeded, built), full `e2e/run-all.mjs`: 233 checks pass.
- Every screen at 390 px: no sideways scroll (owner view, 15 routes).
- Old gold receipt settled as an advance: receipt and linked payment print without error (the earlier "print crash" report did not reproduce).
- Not done in this pass: a browser sweep of permission-hidden buttons for the `viewer` role; migration tests on seeded old rows (spec 003 R7, R8); a browser test of a changed number prefix (API tests only).
