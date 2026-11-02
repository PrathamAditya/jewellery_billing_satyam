# 052: Data integrity checks (read-only, owner only)

Status: Built on branch `spec-052-integrity` (Wave 3), owner review pending. The owner asked for the build with the defaults for Q180 to Q189.
Depends on: 001 (database), 003 (number series), 010 (customers), 011 (rates), 013 (invoices), 015 (payments), 017 (settlement), 018 (old gold), 019 (ledger), 019d (credit notes), 032 (cash), 051 (audit viewer), 004 (permissions)
Open questions used with defaults: Q180 to Q189 (listed in `docs/open-questions.md`, section Y).

## 1. Goal
The owner can run a set of checks on the stored data at any time and see whether the money, the numbers and the audit trail still agree with each other. Each check either passes or lists the records that break it, with a link to the invoice or payment. The same checks run from the command line, so a database file can be checked on the showroom PC without the browser. Nothing is changed by a check.

## 2. Rules

**Reading only**
- I1. A check reads stored rows and writes nothing: no insert, update, delete, audit row, number or session change. Running checks twice gives the same result on unchanged data.
- I2. Each check returns `ok`, or `fail` with the list of problem records (record id, kind, a plain sentence, and a link where one exists). The list is capped at 100 problems per check in the response, and the count is always the full count.
- I3. Checks read every record, voided ones included, because a voided record can still hold money that must be reversed (Q184).
- I4. All money is compared in integer paise and weight in integer milligrams. No tolerance: a difference of one paisa is a failure (Q181).

**The checks** (`apps/api/src/integrity/checks.ts`; the list is the single source for the API, the screen and the command line)
- I5. `invoice_totals`: for every invoice whose rate is fixed: the stored payable equals `payable_paise` in `calc_json`; total before round-off = taxable + tax; round-off equals `roundOffPaise(total before round-off) - total before round-off` (spec 012 R12, the same function as the calculation); the sum of the current revision's line amounts equals `totalValuePaise` in `calc_json`. Pending-rate invoices are skipped (spec 019c).
- I6. `invoice_lines`: for every line of the current revision, with the stored `calc_json` line of the same position: for `weight` and `separate` lines, `amount = gold + labour + stone`. For `combined` lines (a typed total with no split, spec 012c), gold and labour must be 0 and the amount must be more than 0 (Q183).
- I7. `invoice_balance`: for every invoice, the non-reversed allocations plus the non-reversed credit applications (spec 019d) are at most the payable. So the balance due is never negative (spec 015 M4).
- I8. `payment_balance`: for every payment, remaining = amount - non-reversed allocations - non-reversed refunds, and remaining is never negative. Allocations + refunds + remaining = amount (spec 015 M2).
- I9. `links_exist`: every live allocation points to an invoice or an opening balance that exists, and to a payment that exists; every refund points to a payment that exists.
- I10. `number_series`: for each series (INV, PAY, OGP, ORD, CN, PUR), within each financial year: no two documents share a number, no two share a serial, the trailing digits of each number equal its stored serial, and the `number_series` counter for that year is not below the highest serial issued (spec 003 R10).
- I11. `customer_numbers`: every customer number matches `C` followed by at least 4 digits (`C0001`, Q188), no two customers share a number, and the customer counter is not below the highest number issued (spec 010 R2).
- I12. `ledger_totals`: (a) for every customer, the ledger's final outstanding and advance held (spec 019 R4, the event ledger) equal the customer's balance from the totals query (spec 019 R5); (b) the ledger summary's total outstanding equals the sum of the positive customer balances, and its total advance equals the sum of the positive advances.
- I13. `voided_links`: no voided invoice, payment, opening balance or credit note still has a live (non-reversed) allocation, credit application, refund or payout (spec 015 M7, M8; spec 019d).
- I14. `audit_rows`: every payment has a `payment_create` audit row and every invoice has an `invoice_create` or `invoice_pending_create` audit row, for the same entity id (CLAUDE.md rule 11).

**Access**
- I15. `GET /api/integrity` needs the new permission `integrity.view`. It is granted to the owner only (Q180): the owner role has every permission, and manager and viewer are built without it. The route is read-only.
- I16. The checks run on request. Nothing runs in the background or on a schedule (Q185, Q189).

**Command line**
- I17. `npm run integrity -w @jewellery/api` runs the same checks on the local database file in `JB_DATA_DIR` (spec 081, the same folder rule as `local:migrate`). It prints one line per check (`ok` or `FAIL`), then each problem record, and exits 1 when any check fails, 0 otherwise. If the database file does not exist, it says so and exits 2. It never creates or migrates the file (Q186).

## 3. Data and API

**Data**
- No migration. The checks read existing tables only.
- The permission `integrity.view` is in the shared list. The owner role is locked (spec 004 R2), so its permission list is the full shared list in code (`permissionsForRole` and the role list), and the stored `roles` row is not changed. A migration was tried first (`0029_integrity.sql`, the pattern of 0022 and 0028), but it changes only a row, and the spec 082 runner then refuses to upgrade a database made by the earlier temporary step, because it cannot tell whether the file ran. The code grant avoids that, and it covers any future permission for the owner too.

**API**
- `GET /api/integrity` (permission `integrity.view`): returns `{ ranAt, ok, failed, checks: [{ id, title, description, status: "ok" | "fail", count, problems: [{ recordId, kind, label, detail, link }], truncated }] }`.

**Shared types**
- `packages/shared/src/integrity.ts`: the response types above (used by the API, the screen and the test).

## 4. Screens
- **Data checks** (`#/integrity`): owner only. A "Run checks" button; after a run, a summary line ("9 of 10 checks passed", and when they all pass, "All checks passed"), the time of the run, and a "Run again" button. Each check is a row with its title, a status (OK or Problem), and, for a problem, the count and up to 100 problem records. A record links to its invoice (`#/invoices/<id>`) or payment (`#/payments/<id>`) page; records with no page (for example an opening balance or a customer number) show their id and text only.
- **Settings** (`#/settings`): a "Data checks" link, shown only to a user with `integrity.view`.
- No navigation bar item. The page is read-only, so the phone layout only shows the results.

## 5. Edge cases
- A fresh install with no business data: every check passes.
- A pending-rate invoice (spec 019c): skipped by I5, and its ledger line has no amount (I12 still holds).
- A combined-price line (I6) and a job-work line: their amounts follow the calculation, so the same rule holds.
- A payment voided after an allocation was reversed: the allocation is not live, so it does not count (I8, I13).
- A customer number above 9999 (`C10000`): valid under I11.
- A database written by a broken import: the checks report the rows; they never fix them.
- Phone: the page reads and runs the checks, with no sideways scroll at 390 px.

## 6. Test cases
- `apps/api/test/integrity.test.ts`:
  - Clean data created through the API (customers, invoices with a discount and a combined line, an advance, an invoice payment, a reversed allocation, a refund and its reversal, a voided payment, a voided invoice, an opening balance): every check passes (I1 to I14). A second run gives the same result (I1).
  - Each check fails on deliberately broken data written directly to the database in the test (the triggers are dropped in the test only):
    - I5: an invoice whose stored payable differs from its calc total;
    - I6: a line whose amount is not gold + labour + stone;
    - I7: allocations on an invoice above its payable;
    - I8: a payment whose allocations exceed its amount;
    - I9: an allocation pointing to a missing invoice;
    - I10: a duplicate invoice number in one financial year, and a counter below the highest serial;
    - I11: a customer number with the wrong format (`C-12`), and a duplicate;
    - I12: a customer's balance changed without an invoice or payment;
    - I13: a live allocation on a voided invoice;
    - I14: a payment with no `payment_create` audit row.
  - Each failing check lists the record id it found.
  - The route: owner gets 200 with the results, staff and manager get 403 (no `integrity.view`), no session gets 401, and the route writes nothing (row counts before and after are the same).
  - The command line: run as a function with a database file in a temporary folder: exit code 0 on clean data, 1 on broken data, 2 when the file does not exist.
- Browser (`e2e/integrity.mjs`, at the end of `e2e/run-all.mjs`): the owner opens Settings, follows "Data checks", runs the checks, sees every check OK after the earlier browser tests, presses "Run again", and the page shows no sideways scroll at 390 px.

## 7. Out of scope
Fixing a problem (the checks never change data; the owner corrects it through the normal screens or the void flow), scheduled runs, e-mail or WhatsApp alerts, checks on the cloud database from the command line, checks of stock (spec 021 to 022) and of the GST return figures (spec 031 reports), a history of past runs.

## 8. Defaults used (owner may change later)
- Q180 (who sees the page): the owner only, by `integrity.view`; no migration, see section 3.
- Q181 (rounding): exact integer comparison, no tolerance.
- Q182 (credit applications): counted as money received against the bill in I7, as the database triggers already do (spec 019d).
- Q183 (combined lines): gold and labour must be 0, and the amount is the typed total (no split to compare).
- Q184 (voided records): checked too, because a voided record can still hold a live allocation.
- Q185 (when it runs): only when the owner asks.
- Q186 (command line): reads the existing file, never creates or migrates it.
- Q187 (results kept): not stored anywhere; each run is fresh.
- Q188 (customer number format): `C` and at least 4 digits, growing beyond 9999.
- Q189 (ledger check scope): every customer on each run; no sampling.

## 9. Acceptance checklist
- [x] Owner approves this spec: built on the defaults for Q180 to Q189 (they stay as defaults until changed)
- [ ] I1 to I14 implemented in `apps/api/src/integrity/checks.ts`
- [ ] `GET /api/integrity` mapped in `PERMISSION_MAP`, permission `integrity.view` in the shared list; the owner gets it in code (no migration)
- [ ] Command line `npm run integrity -w @jewellery/api` with exit codes 0, 1 and 2
- [ ] Data checks screen linked from Settings, with "Run again"
- [ ] Unit and API tests in `apps/api/test/integrity.test.ts`, each check passes on clean data and fails on broken data
- [ ] Browser test `e2e/integrity.mjs` added at the end of `run-all`
- [ ] Earlier tests and browser tests still pass (permissions, migrations, audit viewer)

Status line: built on branch `spec-052-integrity` (Wave 3), owner review pending.
