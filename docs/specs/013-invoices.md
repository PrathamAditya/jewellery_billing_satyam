# 013: Invoices (create, save, search, edit, void, history)

Status: Built 2026-11-01, awaiting deploy and owner check
Depends on: 000, 001, 002, 010 (customers), 011 (rates), 012 (calculation)
Open questions: none block this spec. Safe defaults are chosen for Q3, Q4, Q7, Q55 to Q58 in `docs/open-questions.md`, each marked as a default there.

## 1. Goal
The owner makes a bill on the PC: picks or types the customer, enters the lines, sees the amounts from spec 012, and saves. The saved invoice gets its number, keeps every figure it was saved with, can be found again by number, customer name or mobile, can be corrected (the old version stays readable), and can be voided. Android can search and view invoices (view-only, D5).

Printing is spec 014, payments and settlement are 015 to 017. This spec only stores and shows the invoice.

## 2. Rules

**Saving**
- R1. An invoice has: invoice date, customer, tax mode (`intra` default or `inter`), reverse-charge flag (default No), remarks (internal, never printed), and 1 to 50 lines. A line has: description, purity, HSN, gross, net and polish weight, gold rate, labour rate and GST rate (spec 012 R1).
- R2. **The server always recalculates** with `calculateInvoice` (spec 012). Totals sent by a screen are ignored. If the calculation reports errors (for example HSN 9988, spec 012 R13), the save is refused with the same messages and nothing is stored.
- R3. **Number:** allocated when the invoice is saved, from the series `INV` and the invoice date's financial year (`INV/2026-27/0001`, decisions D11, spec 001 R12). The number is allocated in the same atomic batch as the insert, so a failed save never uses up a number, and a number is never reused, even after a void.
- R4. **Date:** the invoice date is a business date (India). It defaults to today, may be an earlier date (screen shows "This is not today's date"), and never a future date. The date decides the financial year of the number.
- R5. **Customer:** either a saved customer (`customerId`, must exist and not be voided) or a walk-in (no id). In both cases the invoice stores its own copy of name, mobile, address and PAN as typed or loaded at save time (spec 010 R12). Name is required (2 to 100 characters), the rest are optional. Editing the customer later never changes the invoice.
- R6. **Frozen figures:** each line stores the rates, GST rate and every calculated figure it was saved with, and the invoice stores the full calculation result (spec 012 R14). Changing today's rate, a customer, or the calculation code later never changes a saved invoice, and the saved figures are shown from the database, never recalculated for display.
- R7. **Rate record:** the invoice also stores the three applicable rates for its date (spec 011 R8) as they were at save time, for reference. The line's gold rate is what was typed or filled in, and is not forced to equal the applicable rate.
- R8. **Purity** on a line is one of `22K916`, `24K995`, `silver`, `18K750`, `14K`, `24K999`, `other`. For `22K916`, `24K995` and `silver`, the screen fills the gold rate from the applicable rate and the owner may overtype it. For the other purities the owner types the rate (until O9 is answered). Purity is stored as text and does not change the calculation.
- R9. **Safe retry:** the client may send its own invoice id. The same id with the same content returns the saved invoice (200), the same id with different content is 409 (spec 001 R5). So a double click cannot make two invoices.

**Editing**
- R10. An edit keeps the invoice id and number. The previous version (header and lines) stays stored and readable as the next revision, with an optional reason, and the invoice then holds the new version, recalculated by the server (R2). Editing a voided invoice is refused (409). An edit that changes nothing writes nothing.
- R11. Lines are never deleted. Each revision keeps its own lines, so any earlier version of the bill can be shown exactly.
- R12. The history shows every revision with who, when, the reason, the old and new payable amount, and the changed fields. Any earlier revision can be opened in full.

**Voiding**
- R13. An invoice can be voided with a reason. It keeps its number and stays visible and searchable with a "voided" mark, and its amounts are excluded from future totals and reports. A voided invoice cannot be edited or un-voided in this spec. (A wrongly voided bill is replaced by a new bill. See Q57.)
- R14. When payments, advances or old-gold receipts exist for an invoice (specs 015 to 018), voiding and editing the amounts are checked against them. Those checks are added and tested in those specs, not here.

**Search and view**
- R15. One search box matches, case-insensitively: invoice number (any part, for example `0012` or `2026-27/0012`), customer name (any part), and mobile (3 or more digits). Optional filters: date from and to, active or voided. Newest invoice date first, then newest saved first, 20 per page with a cursor.
- R16. Every route needs a login (002). `created_by` and `updated_by` are the user id. Everything that changes data writes an audit row in the same batch (001 R11).

## 3. Data
New tables (migrations follow 001 conventions, including no-delete triggers):
- `invoices`: standard columns; `invoice_no` (unique); `invoice_date`; `customer_id` (nullable); snapshot columns `customer_name`, `customer_mobile`, `customer_address`, `customer_pan`; `tax_mode` (checked); `reverse_charge` (0 or 1); `remarks`; `rates_json`; totals `taxable_paise`, `tax_paise`, `total_before_round_off_paise`, `round_off_paise`, `payable_paise` (payable `CHECK >= 0` and a multiple of 100); `calc_json`; `revision_no` (current, starts at 1); void columns `voided_at`, `voided_by`, `void_reason`. Indexes on `invoice_no`, `(invoice_date, created_at)`, `customer_id`, `customer_name_search`, `customer_mobile`.
- `invoice_lines`: `id`, `invoice_id`, `revision_no`, `line_no`, `description`, `purity`, `hsn`, `gross_weight_mg`, `net_weight_mg`, `polish_mg`, `gold_rate_paise_per_kg`, `labour_rate_paise_per_kg`, `gst_rate_bps`, `chargeable_weight_mg`, `gold_amount_paise`, `labour_amount_paise`, `amount_paise`, `display_rate_paise_per_g`, `inventory_item_id` (nullable, filled by spec 021). Unique `(invoice_id, revision_no, line_no)`.
- Old header versions go in `record_revisions` (entity `invoice`) with the old `revision_no`, per spec 001 R10.

API (all under `/api/invoices`):
- `POST /` create (client id optional). 201 on create, 200 on safe retry.
- `GET /?q=&status=&from=&to=&cursor=`: search.
- `GET /:id`: the invoice with its current lines and calculation.
- `GET /:id?revision=N`: an earlier version in full.
- `PUT /:id`: edit (full new content plus optional `reason`).
- `GET /:id/history`: the revisions list.
- `POST /:id/void` with `{ reason }`.

## 4. Screens and printing
**PC**
- **Invoices list** (new "Invoices" link in the top bar): search box, date filters, status filter, results table (number, date, customer, payable, status), "New invoice" button.
- **New invoice / Edit invoice form:** customer picker from spec 010 (picking fills name, mobile, address, PAN, all still editable; or just type a walk-in name), date, tax mode switch, reverse-charge switch, remarks. The lines editor is the one from the Calculator (spec 012) plus a purity choice that fills the gold rate from today's rates. Live totals under it use the same calculation code, and the saved result comes from the server. Save button. Messages from the server appear next to the right line and field.
- **Invoice page** (read-only): header (number, date, customer), the lines with their figures, the totals block in the paper bill's order (Amount Before Tax, SGST, CGST or IGST, Total after Tax, Round-off, Payable), remarks, History tab, Edit, Void. A disabled "Print" button says "Print layout comes in spec 014".
- **History tab:** each revision with when, who, reason and the change in payable. Opening one shows that version exactly, marked "Earlier version".
- The Calculator screen from spec 012 stays as it is and shares the lines editor.

**Android (view-only, D5):** list, search and invoice page are readable and responsive. New, Edit and Void are hidden.

**Printing:** none in this spec.

## 5. Edge cases
- Two saves in the same moment get different numbers with no gap (001).
- A save that fails because of one bad line does not use up a number.
- Invoice dated 31 March and one dated 1 April get numbers from different financial years, and a back-dated invoice can get a number lower than the latest one issued (the number follows the invoice date's year, and the counter keeps counting up within each year). See Q58.
- Customer renamed after the bill: the bill still shows the old name.
- Rate changed after the bill: the bill still shows the old rate.
- Customer later voided: old invoices keep their copy and still open.
- Walk-in with only a name and no mobile: saved. It will not appear in a mobile search.
- Edit that removes a line: the removed line stays in the earlier revision and is gone from the current version.
- Two devices edit the same invoice at once: the later save sees a different `revision_no` than the one it started from and is refused with 409 "This invoice was changed. Reload it." (every edit sends the revision it started from).
- Offline: saving needs a connection in this spec. Offline queue and sync are spec 041, and the client id already makes retries safe.

## 6. Test cases
**Saving and numbering (R1 to R4)**
- The client's real bill (`docs/client-invoice-reference.md`) saved with date 2026-02-03: number `INV/2025-26/0001`, payable 288,400, totals equal the engine's output (280,006 taxable, 4,200 + 4,200 tax, round-off -6).
- Next invoice dated 2026-02-04: `INV/2025-26/0002`. Dated 2026-04-01: `INV/2026-27/0001`. Dated 2027-03-31: `INV/2026-27/0002`.
- Totals sent by the client with wrong numbers are ignored, and the stored totals equal the engine's.
- A line with HSN 9988 is refused (400 with the engine's message), nothing is stored, and the next number is not skipped.
- A future date is 400, a back date is accepted, `2026-02-30` is 400.
- 0 lines and 51 lines are 400.
- 20 saves at once give 20 unique numbers with no gaps.

**Customer (R5)**
- Saved customer: copies match what was sent, and renaming the customer afterwards leaves the invoice unchanged.
- Voided or unknown `customerId`: 400/409, nothing stored.
- Walk-in with only a name: saved with `customer_id` null. Name of 1 character: 400.

**Frozen figures (R6, R7)**
- Save with silver rate 285.72 per gram. Then save a new day's rate of 300 per gram: the old invoice still shows 285.72 and the same amounts.
- The stored `rates_json` equals the applicable rates for the invoice date at save time.
- Reading the invoice returns stored figures: change the engine's output in a test double and the saved invoice still returns what was stored.

**Safe retry (R9)**
- Same id and same content twice: one invoice, 200 the second time, same number. Same id with different content: 409.

**Editing (R10 to R12)**
- Edit the weight: the id and number are unchanged, `revision_no` is 2, the old header is in `record_revisions` with revision 1, revision 1 lines are still readable with `?revision=1`, revision 2 totals are recalculated.
- Edit that removes a line: revision 1 still shows it.
- An edit with no real change: no revision, no audit row.
- Edit a voided invoice: 409. Edit sent with an old `revision_no`: 409.
- History lists each revision with by, at, reason, old and new payable, newest first.
- `DELETE` on `invoices` and `invoice_lines` fails.

**Voiding (R13)**
- Void needs a reason. A voided invoice still appears in search with its number and a voided mark, its number is never allocated again, and a voided invoice cannot be edited.

**Search (R15)**
- Find by `0002`, by `2025-26/0002`, by part of a name in a different case, by the last 4 digits of the mobile. A 2-digit query does not search mobiles. Filters by date and by status work. Paging returns every invoice exactly once. 5,000 generated invoices: search returns in under 200 ms.

**Access (R16)**
- Every route is 401 without a session. `created_by` is the user id. Each change writes one audit row, and the audit detail has no customer PAN.

**Browser**
- Create the client's bill through the form (fill the example, pick a customer, save), see it on the invoice page with the same figures as the calculator, edit and see the history, void and see the mark, search from the list, and on a phone see list and invoice page with no edit buttons.

## 7. Out of scope
Printing and PDF (014), payments, advances and settlement (015 to 018), the customer ledger (019), choosing an inventory item and automatic stock reduction (021, the line already has a nullable `inventory_item_id`), HSN 9988 job-work (O1), converting polish percent to weight (O2), credit notes (see Q55), offline saving (041), WhatsApp or SMS sending.

## 8. Defaults chosen (change them in `docs/open-questions.md`)
- Q55: **Editing is allowed**, with every earlier version kept. The CA may prefer a credit note instead of editing a bill that was already handed to the customer.
- Q56: **Walk-in customers are allowed** (name only).
- Q57: A voided invoice **cannot be un-voided**. A new bill replaces it.
- Q58: The invoice number follows the **invoice date's financial year**, so a back-dated bill can carry a lower number than newer bills.

## 9. Acceptance checklist
- [x] R1 to R16 implemented and tested (300 tests in total, 28 of them new for invoices)
- [ ] Migrations 0008 and 0009 applied on the remote database (applied locally and in tests; CI applies them to an empty database)
- [x] Create, edit, history, earlier version, void, search and filters work in a real browser against a local Worker (PC), and the phone view is read-only with no sideways scroll
- [ ] The same checked on the live site, after deploy
- [x] The client's real bill saves with the same figures as the paper bill (INV/2025-26/0001, payable 2,884.00)
- [x] Nothing in earlier specs broke (tests and the customers, rates and calculator browser runs all still pass)
- [ ] Owner approved the result
