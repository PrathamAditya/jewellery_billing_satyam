# 019d: Returns, exchanges and credit notes

Status: Built on branch `spec-019d-credit-notes` (Wave 2), owner review pending. The owner asked for the build with the defaults for Q90 to Q101. Stock is deferred to spec 021 (see R19).
Depends on: 013 (invoices), 015 (money model), 016 (refund modes), 018 (old gold invoice_adjustment), 017 (settlement), 019 (ledger), 004 (permissions)
Open questions used with defaults: Q90 to Q101 (listed in `docs/open-questions.md`, section S). Owner answer [25] (`docs/owner-answers-2026-11-01.md`) is the base: credit note, exchange, or old gold adjustment, linked to the original invoice, with balances updated. "Stock updated" is deferred (Q99).

## 1. Goal
A customer returns goods, or exchanges them, against a bill that already exists. The shop issues a **credit note** (`CN-0001` style number) that is linked to the original invoice. The original invoice is never changed. Its balance due goes down by what is credited, the credit that is left over is held for the customer (used on another bill or paid back), and the ledger, the settlement page and the printed credit note show it. Three kinds: a plain credit, an exchange (the credit is adjusted against a new invoice), and an old gold adjustment (the return is settled by an old gold receipt from spec 018).

## 2. Rules

**Kinds and lines**
- R1. A credit note has one `kind`: `credit` (plain return), `exchange` (the credit is also adjusted against a replacement invoice, R8), or `old_gold` (settled by an old gold receipt, R9). It always points to one original invoice (`invoice_id`). The invoice must not be voided.
- R2. The credit is built from the **returned lines** of the original invoice (its current revision). Each line: `invoiceLineNo` (an existing line) and `taxablePaise` (more than 0 and at most what is still creditable on that line: the line's taxable value minus the taxable value of earlier live credit notes on the same line). 1 to 50 lines, no line twice. A `reason` is required (1 to 300 characters).
- R3. **Calculation** (`calculateCreditNote` in `packages/calc`, pure): the GST rate and the tax mode come from the original invoice (intra gives CGST and SGST halves, inter gives IGST), tax is worked per rate group exactly like the invoice engine (spec 012 R9, R10). The total is rounded to the rupee with the same round-off rule as invoices (spec 012 R12), and the round-off is shown. The stored figures are frozen: a credit note is never recalculated for display.
- R4. **Cap:** the credit note amount may not exceed the original invoice's payable minus the amounts of its other live credit notes. This is enforced in the API and by a database trigger. A credit note therefore never credits more than the bill, and the amount the customer already paid is handled by R7 and R10.

**Numbering and date**
- R5. Number: series `CN` with the financial year of the credit note date, printed with the number settings of spec 003 (like invoices, R3 of spec 013). Unique within a financial year (like receipts, spec 015 M6). Allocated in the same batch as the insert, so a failed save uses no number, and a number is never reused, even after a void. A client id may be sent: the same id with the same content returns the saved credit note, a different content is 409 (spec 001 R5).
- R6. The credit note date is a business date, not in the future, and not before the original invoice's date (Q100).

**Applying the credit**
- R7. **Automatic first application.** On creation the credit is applied to the original invoice's balance due, up to that balance: `applied = min(amount, balance due)`. This is one `credit_applications` row in the same batch. A credit note whose amount is larger than the balance due keeps the rest as **credit held** (R10).
- R8. **Exchange.** `replacementInvoiceId` is required for `kind exchange`: a non-voided invoice of the same customer, not the original. The credit left after R7 is applied to the replacement invoice's balance due, up to that due (`min(credit held, replacement due)`), in the same batch. The customer then pays only the difference through the normal payment screens (spec 015). Any credit still held after that stays held (R10).
- R9. **Old gold.** `ogpId` is required for `kind old_gold`: an old gold receipt (spec 018) that is not voided, belongs to the same customer, has `invoice_id` equal to the original invoice, uses treatment `invoice_adjustment`, has a final amount equal to the credit note amount, and is not already linked to a live credit note (409 `already_linked`). The receipt's own allocation (spec 018 R5) already reduces the balance, so this kind creates **no** application and holds nothing. It records the return and links the two documents.
- R10. **Credit held** = amount minus live applications minus live payouts. It belongs to the customer. A credit held on an invoice with no customer (walk-in) is refused at creation (400 `walk_in_credit`): a walk-in credit must be fully applied in R7 (or R8).
- R11. **Apply** `POST /api/credit-notes/:id/apply` `{ invoiceId, amountPaise }`: applies held credit to another non-voided invoice of the same customer. More than the held amount is 400 (`validation`, with the held amount in the message). More than that invoice's balance due is 409 `exceeds_due`. Several applications are separate rows. The database triggers (`exceeds_due`, `exceeds_credit`) enforce the same limits for any other writer.
- R12. **Pay out** `POST /api/credit-notes/:id/payouts` `{ amountPaise, mode, reference?, paidDate, remarks? }`: money paid back to the customer. Amount more than 0 and at most the held credit (400 otherwise). Modes `cash`, `upi`, `bank_transfer`, `cheque` (same as spec 016 R8, refunds). Reference up to 60 characters. Paid date a business date, not in the future. A payout is not money received, it is never an allocation and never shows in "received" figures. A payout is reversible: `POST /api/credit-notes/payouts/:id/reverse` `{ reason }` gives the amount back to the held credit (Q93).
- R13. **Reverse an application** `POST /api/credit-notes/applications/:id/reverse` `{ reason }`: the invoice balance goes back up and the credit held goes back up. Already reversed is 409.

**Void**
- R14. **Void** `POST /api/credit-notes/:id/void` `{ reason }`: refused 409 `has_payouts` while a payout is live (reverse it first, R12). For kind `old_gold` the void changes no money (the receipt's settlement stands, spec 018), and the old gold receipt cannot be voided while a live credit note links to it (409 `linked_to_credit_note`, a small check added to spec 018 R9). Otherwise, in one batch: every live application is reversed (reason `Credit note voided: <reason>`), the credit note gets `voided_at`, `voided_by` and `void_reason`, and an audit row is written. The row and its number are kept and it stays visible with a VOID mark. A voided credit note cannot be applied, paid out or reversed again, and cannot be voided twice (409 `already_voided`).
- R15. **Invoice guards.** The original invoice cannot be voided while it has a live credit note (409 `has_credit_notes`, spec 013 R13 extended). An invoice edit (spec 013 R10) is refused (409 `payable_below_received`, Q95) if the new payable is below what is settled on it (allocations plus live applications, spec 015 M8) or below the live credit notes on it. The same check covers the replacement invoice of an exchange.

**Balances and reading**
- R16. **Invoice balance.** An invoice's settled amount = its live payment allocations + its live credit applications. Balance due = payable - settled, never below 0. The invoice list, the invoice page and the payment FIFO (spec 015 R3) use this figure. Payable, lines and stored calculation of the invoice never change (CLAUDE.md rule 5).
- R17. **Settlement page** (spec 017): received lines include a line per live application: type `Credit note`, reference = credit note number, date = application date. The auto-note gets one sentence per application: `Credit note {CN no} applied: {amount}. Credit still held in {CN no}: {held}.` Balance due moves with it.
- R18. **Ledger** (spec 019): new entries, all derived from stored rows. `Credit note` (credit note date): outstanding minus the first application, credit held plus the rest. `Credit applied` (application date): outstanding minus x, credit held minus x. `Credit application reversed`: the opposite. `Credit paid out` (payout date): credit held minus x. `Credit payout reversed`: the opposite. `Credit note voided` (void date): outstanding plus the live applications it reverses, credit held minus what it still held. Totals gain `creditHeldPaise`. `netPaise` = outstanding - advance held - credit held. The last ledger row still equals the totals (spec 019 R5). Outstanding list and summary subtract applications.
- R19. **Stock is deferred** (Q99). No stock table, no movement. The credit note lines carry a nullable `inventory_item_id` (same as invoice lines, spec 013), and `apps/api/src/creditNotes/stock.ts` has the single function `creditNoteStockMovements()` that returns an empty list. Spec 021 fills it in (returned goods back into stock, with the original line's item).
- R20. **Lists and read:** `GET /api/credit-notes?q&invoiceId&customerId&kind&status&from&to&cursor`. `q` matches credit note number, customer name and original invoice number. Status `live` or `voided`. 20 per page, newest first. `GET /api/credit-notes/:id` returns the credit note with its lines, applications (live and reversed), payouts, held amount and the original invoice's number. Reading writes nothing.
- R21. **Permissions** (Q94): list and read `invoices.view`; create `invoices.edit`; apply `payments.create`; payout and payout reversal `payments.refund`; void and application reversal `payments.void`. Every route is in `permissionMap.ts`.
- R22. **Audit:** every change writes one audit row in the same batch: `credit_note_create`, `credit_note_apply`, `credit_application_reverse`, `credit_note_payout`, `credit_note_payout_reverse`, `credit_note_void`.
- R23. **No deletes**: triggers on every new table (CLAUDE.md rule 4). Application and payout rows are frozen except for their reversal fields.

## 3. Data and API

**Migration `0021_credit_notes.sql`** (plain SQL, `--> statement-breakpoint` between statements). It does not change existing rows:
- `credit_notes`: standard columns; `cn_no` with `fy` (unique together, the same rule as receipts), `fy`, `serial`, `cn_date`, `kind` (checked), `invoice_id` (original), `invoice_revision_no`, `replacement_invoice_id` (exchange only), `ogp_id` (old gold only), `customer_id` (nullable), snapshot `customer_name`, `customer_mobile`, `customer_address`, `customer_pan`, `tax_mode` (checked), `reason`, `taxable_paise`, `tax_paise`, `total_before_round_off_paise`, `round_off_paise`, `amount_paise` (`> 0` and a multiple of 100), `calc_json`, `header_json`, void columns. Index on `invoice_id`, `customer_id`, `cn_date`. Partial unique index on `ogp_id` where not voided.
- `credit_note_lines`: `id`, `credit_note_id`, `line_no`, `invoice_line_no`, `description`, `hsn`, `gst_rate_bps`, `taxable_paise` (`> 0`), `tax_paise`, `inventory_item_id` (nullable, unused, R19), `created_at`, `created_by`. Unique `(credit_note_id, line_no)`.
- `credit_applications`: `id`, `credit_note_id`, `invoice_id`, `amount_paise` (`> 0`), `created_at`, `created_by`, `reversed_at`, `reversed_by`, `reverse_reason`.
- `credit_note_payouts`: `id`, `credit_note_id`, `amount_paise` (`> 0`), `mode` (checked), `reference`, `paid_date`, `remarks`, `created_at`, `created_by`, `reversed_at`, `reversed_by`, `reverse_reason`.
- Triggers: no-delete on all four; `credit_applications` and `credit_note_payouts` frozen on their amounts and links; `credit_notes` frozen on amounts and links (only void columns may change). `RAISE` messages `exceeds_invoice` (R4), `exceeds_due` (R7 to R11), `exceeds_credit` (R10 to R12).
- **The allocation trigger changes:** `payment_alloc_not_over_due` (spec 015 M4) is dropped and recreated so the invoice's room also subtracts live credit applications. Same message `exceeds_due`.

**API** (mounted at `/api/credit-notes`, plus two reversal routes):
- `GET /` list (R20). `GET /:id` read (R20).
- `POST /` create `{ id?, invoiceId, cnDate, kind, lines: [{ invoiceLineNo, taxablePaise }], reason, replacementInvoiceId?, ogpId? }`. 201, or 200 on a safe retry.
- `POST /:id/apply` `{ invoiceId, amountPaise }` (R11).
- `POST /:id/payouts` (R12). `POST /:id/void` `{ reason }` (R14).
- `POST /applications/:id/reverse` `{ reason }` (R13). `POST /payouts/:id/reverse` `{ reason }` (R12).
- Changed: `settlementOf` (spec 017), invoice responses and the FIFO open items (through one shared SQL expression), the ledger and the outstanding list (spec 019), the old gold adjustment check (spec 018 R5), the invoice void and edit checks (R15).

## 4. Screens
- **Invoice page (PC):** a "Credit note" button (hidden for voided invoices, phone and users without `invoices.edit`). It opens the dialog below. The Settlement tab lists the credit applications (R17) and links to each credit note.
- **Credit note dialog:** kind (Return, Exchange with a replacement invoice picker, Old gold with a receipt picker), date, reason, and a table of the original invoice's lines with a "Return taxable value (₹)" box per line (empty means not returned) and the GST shown. Totals preview: taxable, tax, round-off, amount. The server recalculates on save and shows its own figures. Note on the dialog: "Stock is not updated yet (spec 021)."
- **Credit notes list** (top bar "Credit notes"): search, filter for kind and status, results with number, date, invoice, customer, amount, held, status chip.
- **Credit note page:** header, lines (taxable, GST, tax, amount), applications with Reverse, payouts with Reverse, held amount, buttons Apply to invoice, Pay out, Void, Print. Read-only on phone (D5).
- **Print** (spec 014): `#/print/credit-note/:id`, A4 portrait, one copy, from the stored header and rows only (Q101).

## 5. Edge cases
- Invoice of ₹10,000 with ₹4,000 paid at sale. Return of ₹10,000 taxable plus GST: credit of ₹11,800 (say), applied ₹6,000 to the balance, ₹5,800 held. Payout of ₹5,800 leaves held 0.
- Two credit notes on one invoice: the second is capped by what is left of the bill (R4); the second cannot return a line that the first already returned in full (R2).
- Old gold receipt linked to a credit note cannot be linked again (R9), and cannot be voided while the credit note is live (R14).
- Exchange where the replacement is smaller than the credit: the rest stays held (R8) and can be paid out.
- Invoice paid in full, then fully returned: balance 0, the whole credit is held, payout returns it.
- Walk-in invoice: a credit fully applied at creation is allowed; anything held is refused (R10).
- Replacement invoice voided after the exchange: refused while the application is live (spec 013 R13 and the applications count as received, R16).
- A credit note dated before a payment on the same invoice: allowed; the balance is what counts today.
- Phone: nothing can be created, applied, paid out or voided; lists and pages are readable.

## 6. Test cases
**Calculation** (`packages/calc/src/creditNote.test.ts`, table-driven): intra and inter split; two rate groups; a line returned in part; round-off up and down at the rupee; zero or negative lines refused; the invoice's own rounding reproduced when a whole invoice is returned.

**API** (`apps/api/test/creditNotes.test.ts`, one test per rule):
- R1 kinds: unknown kind 400; voided invoice 409.
- R2 lines: unknown line 400; taxable above the creditable 400; a second return of the same line after the first is capped; no lines and 51 lines 400; a reason is required.
- R3 figures: the stored totals equal `calculateCreditNote`, and reading returns the stored figures after a changed rate.
- R4 cap: a credit that would take the total over the bill is 409 `exceeds_invoice`; the trigger refuses an insert that bypasses the API.
- R5 numbering: `CN` series, financial year of the credit date, no gap after a failed save, idempotent id (same content 200, different 409).
- R6 dates: future date 400, date before the invoice 400.
- R7 auto-application: balance reduced by the applied amount, rest held; invoice received includes the application.
- R8 exchange: replacement balance reduced by the rest; a replacement of another customer 400; the original as replacement 400.
- R9 old gold: linking a receipt with a different amount 400; a receipt not for this invoice 400; linking the same receipt twice 409; no application created.
- R10 walk-in: fully applied allowed, held refused 400.
- R11 apply: over held 400; over the invoice's due 409; another customer's invoice 400; two applications sum correctly.
- R12 payouts: over held 400; mode `card` 400; reversal gives the amount back; payout never appears in received.
- R13 reverse application: balance up, held up; second reverse 409.
- R14 void: refused with live payouts (409 `has_payouts`) and writes nothing; after reversal it works, applications reversed, number kept, second void 409; old gold kind voids without money change, and the linked old gold receipt cannot be voided meanwhile (409 `linked_to_credit_note`).
- R15 invoice guards: void of an invoice with a live credit note 409; edit below the credit total 409; edit above it works.
- R16 balance: list, detail and FIFO show the reduced due; payment FIFO skips a fully credited invoice.
- R17 settlement: credit line present, balance due matches, auto-note sentence text exact.
- R18 ledger: scenario (invoice 1,00,000, paid 40,000 at sale, credit 70,000 on the bill (applied 60,000, held 10,000), payout 10,000) with every row's outstanding and held asserted; the last row equals the totals; a property test over 100 random sequences of credits, applications, payouts and voids (outstanding + held reconcile with the invoice payables).
- R19 stock hook: `creditNoteStockMovements` returns [] and is called on create (asserted by a spy-free check: the line's `inventory_item_id` is null).
- R20 list: search by CN number, customer name and invoice number; filters; 5,000 credit notes under 200 ms; reading writes nothing (row counts unchanged).
- R21 permissions: staff cannot create (403), can apply, cannot pay out or void; viewer reads only.
- R22 audit: one row per action with the names in R22.
- R23 no delete: DELETE on each table fails.

**Browser** (`e2e/creditNotes.mjs`, added last in `e2e/run-all.mjs`): create a bill, return one line from its page, see the balance fall, apply held credit to a second bill, pay out the rest, reverse the payout, void, print preview of the credit note, phone view read-only with no sideways scroll.

## 7. Out of scope
Stock movements and returned goods back into stock (spec 021, Q99). Purchase returns and supplier debit notes. GST return reporting of credit notes (spec 031). E-invoice or IRN fields. Editing a credit note (void and re-issue instead, as with invoices). Keeping the excess as a payment-style advance (Q92). Cheque refunds beyond the payout modes above.

## 8. Defaults used (owner may change later; each is in `docs/open-questions.md` section S)
- Q90: three kinds: credit, exchange, old gold (R1, R8, R9).
- Q91: the return is entered per original line as taxable value; GST, tax mode and rounding follow the original invoice; reason required; cap at the bill (R2 to R4).
- Q92: the credit is applied to the original balance at creation; the rest is held for the customer, used on another bill or paid out. Nothing is stored as a payment (R7, R10, R11).
- Q93: payouts by cash, UPI, bank transfer or cheque; reversible (R12).
- Q94: permissions: create `invoices.edit` (owner, manager), apply `payments.create`, payout `payments.refund`, void and reverse `payments.void` (R21).
- Q95: a voided bill cannot have credit notes; an edit cannot go below what is settled or credited (R15).
- Q96: exchange credit goes first to the original balance, then to the replacement invoice of the same customer (R8).
- Q97: old gold kind links an existing invoice-adjustment receipt of the same amount and creates no application (R9).
- Q98: balances: applications count as settled money on the invoice; held credit is shown beside advance held, not inside it; net includes held credit (R16 to R18).
- Q99: stock deferred to spec 021; hook kept (R19).
- Q100: credit note date between the invoice date and today; numbered from series `CN` in the financial year of its date (R5, R6).
- Q101: print A4 portrait, one copy, stored data only.

## 9. Acceptance checklist
- [x] R1 to R23 implemented and tested (`apps/api/test/creditNotes.test.ts`, 46 tests, plus `packages/calc/src/creditNote.test.ts`). Not yet tested: the 5,000-note search timing (R20).
- [x] Migration `0021_credit_notes.sql` applied to the local database; the test database applies it on every run. The allocation trigger change is covered by the existing tests, not by a separate test.
- [x] Spec 013, 015, 017, 018 and 019 tests still pass: the full suite is 615 tests, and no existing test was changed.
- [x] Browser test `e2e/creditNotes.mjs` passes and is last in `e2e/run-all.mjs`. The full browser run passed (272 checks). One earlier run had two `ledger.mjs` failures on a cold start that passed on rerun; the cause is not explained.
- [ ] Print of a credit note checked on the stored data: screen preview only, no printer check (spec 053)
- [ ] Owner approves the kinds and defaults (Q90 to Q101)
