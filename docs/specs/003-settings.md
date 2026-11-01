# 003: Settings, number formats and document headers

Status: Approved (Wave 1). Built and checked on branch `spec-003-leftovers` (2026-11-02, PR open, not yet owner-checked): settings API, validation, revisions and audit, Settings screen with all tabs, logo upload, header snapshot on invoices, payments, old gold receipts and orders, number formats from the settings (prefix, digits, year), per-year uniqueness, set-next-number, missing-details banner on Home and on the invoice print preview (screen only, never printed). Not done: migration tests on seeded old rows (R7, R8), and browser tests for a changed prefix (API tests only).
Depends on: 000, 001, 002, 010, 013
Open questions used with defaults: Q61, Q62, Q64, Q74, Q77 (see section 8)

## 1. Goal
The owner types the showroom's business details once (name, address, GSTIN, phones, email, bank, terms, logo) and every printed document uses them. Document numbers follow the owner's format (`INV-0001`, `PAY-0001`, `OGP-0001`, `ORD-0001`, customers `C0001`), still restarting each 1 April. A document keeps the header it was issued with.

## 2. Rules

**Settings storage**
- R1. One table `settings(key, value_json, updated_at, updated_by)`. Each key has a zod schema in `packages/shared/src/settings.ts`. Every change stores the old value in `record_revisions` (entity `settings`, entity_id = key) and writes an audit row naming the key only (never the GSTIN, bank or phone values).
- R2. Keys and fields (all validated, all optional unless stated):
  - `business`: `legalName` (required, 2 to 100), `tagline` (default `FINE GOLD · CRAFTED JEWELLERY`, at most 80), `addressLines` (up to 3 lines of at most 100), `city`, `state` (default `Himachal Pradesh`), `stateCode` (default `02`, two digits), `pincode` (6 digits), `gstin` (15 characters in the GSTIN pattern `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, uppercased), `pan` (10 characters in the PAN pattern), `phones` (up to 3, 10 digits each, cleaned like customer mobiles), `email`.
  - `bank`: `accountName`, `bankName`, `accountNo` (digits, 6 to 20), `ifsc` (`^[A-Z]{4}0[A-Z0-9]{6}$`), `upiId` (`name@bank` shape).
  - `texts`: `invoiceTerms` (up to 8 lines of at most 200), `declaration`, `invoiceNote` (default: `GST on Gold & Silver: 3% (1.5% CGST + 1.5% SGST) applied on finished ornaments under HSN 7113. Job work under HSN 9988 carries 5% GST.`), `settlementNote` (default: `Settlement adjustments on this page are linked to the invoice above. Keep both pages together for your records.`), `receiptFooter` (default: `Receipt acknowledges money received; it is not a tax invoice.`), `oldGoldSlogan` (default: `OLD GOLD TODAY, A BRIGHTER TOMORROW`), `copyLabels` (default `["SHOP COPY", "CUSTOMER COPY"]`).
  - `limits`: `cashWarningPaise` (default 20,000,000, which is ₹2,00,000. A cash receipt of this amount or more shows a warning, never blocks, Q74).
  - `numbering`: `prefixes` (defaults `INV`, `PAY`, `OGP`, `ORD`, `CN`), `fyInNumber` (default false, Q61), `padDigits` (default 4).
  - `print`: `showBisLogo` (default false), `showMetalLine` (default true).
  - `logo`: `{ mime: "image/png" | "image/jpeg" | "image/svg+xml", dataUrl }`, at most 300 KB. When missing, documents print a monogram of the legal name's initials in a diamond (generated SVG).
- R3. **Permissions** (spec 004): everyone who is logged in can read settings (`settings.view`), only `settings.manage` (owner) can change them.
- R4. **No secrets in git.** The settings screen is the only place GSTIN, PAN, bank and phone numbers are typed. Tests use obviously fake values.

**Header snapshot (rule 5)**
- R5. `GET /api/settings/snapshot` returns the bundle a printed document needs (`business`, `bank`, `texts`, `numbering`, `print`, logo). When an invoice, payment receipt, old gold receipt or order is created, the server stores that bundle as `header_json` on the row. Editing the invoice later does not change its `header_json`. Printing reads `header_json`, never the current settings. (Old rows without one print with the current settings.)

**Number formats**
- R6. The printed number is `PREFIX-NNNN` (`INV-0001`), padded to at least `padDigits` and growing beyond. If `fyInNumber` is on it is `PREFIX-2026-27-NNNN`. Customers are `C0001` (the `C` series, never resets, no hyphen). The format used is stored with the document (`invoice_no` etc.), so changing settings later never renames old documents.
- R7. Every numbered table stores `fy` (text `2026-27`) and `serial` (integer) next to the printed number, and is unique on `(fy, printed number)` (not on the printed number alone, because `INV-0001` repeats every year). The counter stays `number_series(series, fy)`.
- R8. **Migration of existing rows** (test data only): `invoices` gets `fy`, `serial`, `header_json`; the unique index on `invoice_no` is dropped and a unique index on `(fy, invoice_no)` is added; existing rows are backfilled (`fy` from the invoice date, `serial` from the old number, `invoice_no` rewritten to `INV-0001` style). `customers.customer_no` is rewritten from `C-0001` to `C0001`, and `formatCustomerNumber`, the customer search number matching (`c1`, `c-1`, `C0001` all find it) and the picker are updated.
- R9. **Set next number** (owner only): for a series and financial year, the owner may raise the next number (for example to continue the paper book at 2762). It is refused if a document with that serial or a higher one already exists in that series and year, or if the new value is lower than the current one. It sets `number_series.last_no` to `n - 1`, writes an audit row with series, year, old and new value.
- R10. Allocation helper `allocateNumberStatements(db, series, date)` replaces `allocateNumberStatement`: returns the statements for the counter bump and an SQL expression for the printed number, using the prefix and format read just before the batch. All numbered features (013 invoices, 015, 016, 018) use it.

## 3. Data
- New tables: `settings`. New columns: `invoices.fy`, `invoices.serial`, `invoices.header_json`. Migrations follow the earlier conventions (generate, then a hand-written file for data backfill and the index change).
- API: `GET /api/settings` (all keys), `GET /api/settings/snapshot`, `PUT /api/settings/:key` (full value, validated, returns the saved value, 400 with field messages), `POST /api/settings/next-number` `{ series, fy, nextNumber }`, `GET /api/settings/numbering` (current counters per series and year, for the screen).

## 4. Screens
**Settings** (top bar "Settings", visible with `settings.view`, editable with `settings.manage`): tabs Business, Bank, Texts, Limits, Numbers, Logo and print. Each tab is a form with inline messages and a Save button. The Numbers tab shows each series with the current year's last used number and the "Set next number" action. A banner on Home and on the invoice print preview warns while `business.legalName`, `gstin` or `address` is still empty ("Business details are not filled in yet"). Phone: readable, editing hidden.

## 5. Edge cases
- Changing the prefix mid-year: old documents keep their text, new ones use the new prefix, numbering continues from the same counter.
- Turning `fyInNumber` on mid-year: same.
- GSTIN left empty: documents print without it and the banner shows, nothing is blocked.
- Logo too large or the wrong type: 400 with a clear message, old logo kept.
- Setting the next number to the same value as now: no change, no audit row.

## 6. Test cases
- Each key's zod schema: valid and invalid samples (GSTIN `22AAAAA0000A1Z5` valid, `22AAAAA0000A1Z` invalid; IFSC `SBIN0001234` valid; PAN `ABCDE1234F` valid; phone cleaning `+91 98765-43210` -> `9876543210`; logo of 300 KB + 1 byte rejected).
- Reading without a session is 401, reading with any role works, writing without `settings.manage` is 403.
- A change stores one revision with the old value and one audit row whose detail has the key and no values.
- Snapshot: create an invoice, change `business.legalName`, read the invoice's `header_json`: still the old name. Edit the invoice: `header_json` unchanged.
- Numbering: first invoice of 2026-27 is `INV-0001` with `fy` `2026-27` and `serial` 1; the first of 2027-28 is `INV-0001` again with `fy` `2027-28`; a search for `INV-0001` returns both, each showing its year; `fyInNumber` on gives `INV-2026-27-0002`; `padDigits` 6 gives `INV-000003`; serial 10000 prints `INV-10000`.
- Customers: new customer is `C0001`; search `c1`, `C-1` and `C0001` find it; the old `C-0001` rows were migrated.
- Migration test: seed old-format rows, run the migration SQL, assert the new columns, the rewritten numbers, and that two rows with the same printed number in different years are accepted while a duplicate in the same year is rejected.
- Set next number: raising from 5 to 2762 makes the next invoice `INV-2762`, lowering is refused, a value at or below an existing serial is refused, and an audit row exists.
- 20 invoices saved at once still get 20 distinct serials with no gap (the allocation stays atomic).
- Browser (`e2e/settings.mjs`): fill the business tab, save, see the banner disappear, upload a small PNG logo, set the next number, and see the phone view without edit buttons.

## 7. Out of scope
Multiple businesses, tax settings, per-user preferences, e-invoice fields, email sending.

## 8. Defaults used (owner may change later)
Q61: `INV-0001` format without the year, year stored separately, repeats yearly. Q62: `C0001`. Q64: no HUID label on documents. Q74: cash warning at ₹2,00,000 or more. Q77: two copy labels (shop and customer).

## 9. Acceptance checklist
- [ ] R1 to R10 implemented and tested. Implemented and tested: R1, R3, R5, R6 (prefix, digits, year), R9, and the snapshot and numbering examples in section 6. Not done: a migration test on seeded old rows (R7, R8; migration 0011 runs on an empty database in every test). R10 is done with `printedNumberSql` and `printedNumberValues` in `apps/api/src/db/numbering.ts`, not the name `allocateNumberStatements`. The PAN sample and the 300 KB logo file-size check (done in the form, not the API) have no test of their own.
- [x] Migrations apply to an empty local database (`npm run db:migrate -w @jewellery/api`) and to every test database. The live database is not migrated (owner).
- [x] Settings screen works in the browser (`e2e/settings.mjs`: save, banner, logo, next number, phone view), header snapshot proven through the API response (`e2e/settings.mjs` and `apps/api/test/settings.test.ts`)
- [x] Customer and invoice numbers show the new formats everywhere: list, page, search and picker (`e2e/customers.mjs`, `e2e/invoices.mjs`)
- [x] Earlier tests and browser scripts updated for the new formats and still green (vitest 513 tests, `e2e/run-all.mjs` all passed)
