# 019c: Credit sales with the rate fixed later (pending rate fixation)

Status: Built 2026-11-02 on branch `spec-019c-rate-fixation` (PR to main). All automated checks pass; owner review pending. Built with the defaults for Q89 to Q98 (the owner's instruction for this run). Verification results are in section 9.
Depends on: 011 (applicable rate, R8), 013 (invoices, revisions, void), 015 (payments and allocations, M1 to M8), 017 (advance use), 019 (ledger and outstanding), 014 (print)
Open questions used with defaults: Q89 to Q98 (listed in `docs/open-questions.md`, section R). Owner answer [22] (`docs/owner-answers-2026-11-01.md`) and decision D19 are the base. Q70 asked the same questions and stays open until the owner answers; Q89 to Q98 are the defaults used now.

## 1. Goal
A customer takes jewellery on credit, but the gold rate is not fixed on the day. The sale is recorded now with its weights, purity and labour (no gold rate, no amount). When the customer pays, the rate is fixed (the rate of that day), the final amount is saved as a new revision of the same invoice, and the money the customer has paid so far against this sale is applied to it. Partial payments and payments on several dates are allowed before the rate is fixed. Until then the sale is shown as "pending rate" and adds nothing to what the customer owes. A pending sale is a different kind of sale from a normal credit sale with a fixed amount, which the owner keeps using as before.

## 2. Rules

**The pending sale**
- R1. **Create** `POST /api/invoices/pending` `{ id?, invoiceDate, customerId, customerName, customerMobile?, customerAddress?, customerPan?, taxMode, reverseCharge?, remarks?, lines }`. A line has: description, purity (any of the seven purities of spec 013 R8), HSN `7113`, gross, net and polish weight (`polishBps`, spec 012b), and the **labour rate per kg typed now** (labour is fixed at the sale, Q89). A line has no gold rate and no discount or stone. 1 to 50 lines. The same date, customer, safe-retry (`id`) and numbering rules as spec 013 R3 to R5 and R9 apply.
- R2. **Customer required.** A pending sale needs a saved customer (`customerId`, not voided). A walk-in is refused (400, validation on `customerId`, with the message to choose a saved customer), because the money paid before the fixing belongs to the customer (Q94).
- R3. **Stored shape.** The invoice row has `rate_status = 'pending'`, `rate_fixed_on` null, `payable_paise` 0, the tax and total columns 0, and `rates_json` `{}`. The lines are stored with `gold_rate_paise_per_kg` 0, the labour rate, the weights and purity, and `amount_paise` 0. `payable_paise` 0 is a storage value only: a pending invoice never shows it as an amount (R9).
- R4. **Number** is allocated at the sale, from the `INV` series for the invoice date's financial year, in the same batch as the insert (spec 013 R3, Q93). A pending sale that fails validation does not use a number.

**Money before the rate is fixed**
- R5. **Payments on a pending sale.** `POST /api/payments` with `purpose: "pending_sale"` and `invoiceId` records money the customer pays against the sale: kind `advance`, numbered `PAY-` (spec 015 R6 receipt rules), with `pending_invoice_id` set to the sale. The customer is the sale's customer. Several payments, on several dates, are allowed. Mode, reference, cheque details and the cash limit work as for any payment (spec 015 R1, R5). Permission `payments.create` (Q91).
- R6. **No allocation to a pending sale.** A pending sale has no amount due, so no allocation may point to it: `at_sale`, `against_invoices` (auto or manual) and `advance-allocations` refuse it with 409 `rate_pending`. Money held against the sale waits as the customer's advance until R8 applies it.
- R7. **Voiding** a pending sale is refused (409 `has_payments`) while money is held against it (R5). Its weights can then be corrected only by fixing the rate and editing (R12). A pending sale with no money against it can be voided as any invoice (spec 013 R13).

**Fixing the rate**
- R8. **Fix** `POST /api/invoices/:id/fix-rate` `{ expectedRevision, rateDate?, reason?, typedRates? }`, permission `invoices.edit`:
  - `rateDate` (business date, default today in India) is the day whose rate is used. It may not be in the future (400 `future_date`) and not before the invoice date (400 `rate_date_before_sale`).
  - **Rate per line** (Q90): the line's purity maps to a rate kind (`22K916` to `gold_22k916`, `24K995` to `gold_24k995`, `silver` to `silver`, spec 013 R8). The rate is the applicable rate for `rateDate` (spec 011 R8, so a carried-forward rate is used and its `rateDate` is shown). `typedRates` `[{ lineNo, goldRatePaisePerKg }]` overrides the rate of that line and is needed for lines whose purity has no rate kind (18K750, 14K, 24K999, other) or whose applicable rate is none (400 `rate_missing` naming the lines).
  - The server then calculates the invoice with `calculateInvoice` (spec 013 R2, spec 012), with the stored labour rates, the stored tax mode and GST 3% (HSN 7113 only, R1).
  - The fixed invoice is saved as **a new revision** (spec 013 R10): the pending version stays in `record_revisions` and its lines stay readable with `?revision=1`. `rate_status` becomes `fixed`, `rate_fixed_on` is set, `rates_json` holds the three applicable rates for `rateDate` (spec 013 R7), and the totals are stored (Q92).
  - **Held money is applied in the same batch** (Q91): the live remaining of the payments with `pending_invoice_id` = this sale is allocated to it, oldest receipt first, each up to its remaining, and never more than the new payable. Anything left over stays the customer's advance (spec 015 M2). No money is counted twice.
  - Stale `expectedRevision` is 409 `stale_revision`. A fixed invoice is refused (409 `already_fixed`): after fixing, corrections are ordinary edits (R12).
  - Audit row `invoice_rate_fixed` with the rate date, the payable, the rates used and the allocated amount.
- R9. **Fixed once, on one day** (Q92). The rate is fixed for the whole sale at one time. The owner does not fix line by line or in parts. Money received before that is held (R5), and money received after the fixing is an ordinary payment or advance (spec 015).
- R10. **Refusals before fixing.** Edit (`PUT /api/invoices/:id`) on a pending sale is refused with 409 `rate_pending` (fix the rate first, or void it when R7 allows). A pending sale cannot be paid with `at_sale` or `invoice_payment` (R6).
- R11. **Money check after fixing.** The new payable must not be below what is already allocated to the sale (spec 015 M8, `payable_below_received`). Because the held money is applied only up to the payable, this check holds at the fixing.

**Editing after fixing**
- R12. **Corrections after fixing are ordinary edits** (spec 013 R10 to R12 and spec 015 M8): a new revision, the history, the reason. A wrong rate is corrected by editing the rate on the lines, and the calculation is done again on the server.

**Where the sale shows**
- R13. **Outstanding, totals and FIFO.** A pending sale has no amount due. It adds nothing to a customer's outstanding (spec 019 R5), is never picked by FIFO (spec 015 R3), and is not in the outstanding summary total. It is listed separately as "Pending rate": `GET /api/invoices?rateStatus=pending`, with its net plus polish weight (chargeable weight) and the money held against it (Q96). The Outstanding screen has a "Pending rate" section that shows them.
- R14. **Ledger.** A pending sale appears in the ledger on its invoice date as `Invoice (rate pending)` with no debit and no balance effect, and its description carries the chargeable weight. Money received on it is a `Payment received` line (advance held) as usual. After fixing, the invoice line shows the payable on the **invoice date**, because the sale happened then (Q98). The ledger still ends on the outstanding total (spec 019 R5).
- R15. **Print** (spec 014, Q95). A pending sale prints the header, the lines with purity, gross, net and polish weight, and the labour rate, and the amount block is replaced by the words "Rate and amount to be fixed when paid". No GST, rate or payable is printed. A fixed sale prints as any invoice, from its stored figures (spec 013 R6).
- R16. **Purity and weight stay visible.** A pending sale and a fixed sale both show the purity and the weights on the invoice page and in the lists. Purity does not change the amount (spec 013 R8).

**Access**
- R17. Every route needs a login and a named permission (spec 004): creating a pending sale `invoices.create`, fixing `invoices.edit`, the pending payment `payments.create`, lists and reads `invoices.view` or `payments.view`. Phone views are read-only (decision D5 as built): creating, paying and fixing are on the PC only. Each change writes one audit row in the same batch (spec 001 R11).

## 3. Data and API

**Data** (migration `0020_pending_rate.sql`, plain `ALTER TABLE` statements, no existing row or trigger changes):
- `invoices`: add `rate_status` TEXT NOT NULL DEFAULT `'fixed'` CHECK (`'fixed'`, `'pending'`), and `rate_fixed_on` TEXT (nullable). Existing invoices become `fixed` and nothing else changes.
- `payments`: add `pending_invoice_id` TEXT (nullable), with an index. Only set by R5.
- No new table. Pending lines are rows of `invoice_lines` with the rate 0 (R3).

**API**
- `POST /api/invoices/pending` (R1, R2, R4): 201 on create, 200 on safe retry (same `id` and content), 409 `id_conflict` for a different content. Returns `InvoiceResponse` with `rateStatus` `pending`.
- `POST /api/payments` with `purpose: "pending_sale"` and `invoiceId` (R5): response as spec 015 R2. Errors: `not_pending` (409, the sale is already fixed), `invoice_voided` (409), `customer_required` (400).
- `POST /api/invoices/:id/fix-rate` (R8 to R11): returns `InvoiceResponse` of the new revision.
- `GET /api/invoices?rateStatus=pending|fixed` (R13): list filter; the list rows carry `rateStatus`.
- Existing routes change only as the rules say: `PUT /api/invoices/:id` refuses pending (R10), `POST /api/invoices/:id/void` refuses held money (R7), the allocation checks refuse pending sales (R6).

**Shared types** (`packages/shared`, small edits): `rateStatus` and `rateFixedOn` on `InvoiceSummary`; `pending_sale` in the payment purposes; `paymentStatusOf` may return `pending_rate` for a pending sale. Schemas: `pendingInvoiceRequestSchema` and `fixRateRequestSchema`.

**Calculation** (`packages/calc/src/pendingRate.ts`, pure): the pending line validation (R1, R2), the chargeable weight of a pending line (net + polish, spec 012 R5), and the fixing calculation, which is `calculateInvoice` with the rates given (R8). A pending sale fixed at the same rate as a normal invoice gives the same figures.

**Permissions** (`apps/api/src/auth/permissionMap.ts`, appended in the payments/invoices section): `POST /api/invoices/pending` `invoices.create`; `POST /api/invoices/:id/fix-rate` `invoices.edit`. No new permission name.

## 4. Screens
**PC**
- **New invoice form:** a choice "Rate: Fixed now | Fixed when paid (credit)". For pending, the gold rate boxes on the lines are replaced by a note "Rate and amount to be fixed when the customer pays", the labour rate stays, the preview shows the chargeable weight and the labour only, and Save creates the pending sale. The customer is required (R2).
- **Invoice page, pending:** a "Rate pending" banner with the held money. Lines show weights and purity. The totals block says "Amount to be fixed when paid". Buttons: "Receive payment on this sale" (opens a small form: amount, mode, reference, date, remarks; posts `pending_sale`) and "Fix the rate" (dialog: rate date default today, each line with the rate that will be used or a box to type it when none, the held money that will be applied, Save). Edit and Void are shown as R7 and R10 allow.
- **Invoice page, fixed:** as any invoice. Its history shows the pending version as revision 1.
- **Outstanding screen:** a "Pending rate" section above the table: customer, sale number, date, weight, money held, link to the invoice. The totals above it do not include pending sales.
- **Invoice list:** the amount column shows "Pending rate" instead of an amount.

**Phone (D5, read-only):** the pending list, the invoice page and the ledger are readable. "Receive payment on this sale", "Fix the rate", and the pending form are hidden.

**Print (spec 014):** R15.

## 5. Edge cases
- Customer pays Rs 5,000 on 1 Nov, Rs 3,000 on 4 Nov, then the rate is fixed on 10 Nov: both payments are applied to the sale (up to the payable), and any extra stays the customer's advance.
- The payable after fixing is less than the held money: the extra stays as advance (R8), with its own ledger line.
- A purity with no rate kind (for example 18K750): the owner types the rate for that line in the fix dialog; without it the fix is refused (`rate_missing`).
- Rate for the fixing day not saved, only an earlier one: the carried-forward rate is used and its date is shown (spec 011 R8). If none exists at all, the owner types the rates (R8).
- Two devices fix the same sale at once: the second is 409 `stale_revision` or `already_fixed`.
- A pending sale with a customer later voided: the sale keeps its copy of the customer (spec 013 R5). Fixing it is still allowed; the customer's voided state does not block the fixing.
- The sale is dated 31 March and fixed on 1 April: the number keeps the sale's financial year (spec 013 R3). The rate date is 1 April and the rate of that day is used.
- Money held for a pending sale that is later voided is refused (R7), so no advance is left pointing at a voided sale.
- A line with HSN 9988 on a pending sale is refused (`pending_job_work`, Q94).

## 6. Test cases
**Pending sale (R1 to R4)**
- A silver line of 9.800 g with labour 0 saved as pending: `rate_status` pending, payable 0, rate 0 on the line, number `INV/2026-27/000x` from the sale date.
- A walk-in pending sale is 400 (validation on `customerId`) and uses no number (R2, R4).
- HSN 9988 pending is refused (`pending_job_work`). 0 lines and 51 lines are 400.
- The same id and content twice gives one invoice and the same number (R1).

**Money before fixing (R5 to R7)**
- Advance of Rs 5,000 with `pending_sale`: kind `advance`, numbered `PAY-`, `pending_invoice_id` set, customer advance held Rs 5,000, the sale's outstanding unchanged at 0.
- `at_sale` or `against_invoices` against the pending sale: 409 `rate_pending`. `advance-allocations` onto it: 409 `rate_pending`.
- Void of a pending sale with money held: 409 `has_payments`. Void with no money: allowed.

**Fixing (R8, R9, R11)**
- Silver 9.800 g, labour 0, fixed on a day with silver at Rs 285.72 per gram: payable Rs 2,884.00 (288,400 paise), taxable 280,006, CGST and SGST 4,200 each, round-off -6. Equal to the normal invoice of spec 013 with the same inputs.
- Held money of Rs 5,000 (first receipt) and Rs 3,000 (second receipt) on a sale of Rs 2,884: the first receipt gives Rs 2,884 and keeps Rs 2,116; the second receipt is not used and stays advance (Rs 5,116 advance held in total).
- Purity 22K916 uses the 22K916 applicable rate for the rate date; a day with no rate and a line with no typed rate: 400 `rate_missing` naming the line.
- A carried-forward rate is used, and `rates_json` and the response show its `rateDate`.
- Rate date in the future: 400. Rate date before the sale date: 400 `rate_date_before_sale`.
- Fixing twice: 409 `already_fixed`. Stale revision: 409.
- The pending version stays readable as revision 1 with `?revision=1` and in the history with the payable change from 0 to the new amount.

**After fixing (R10 to R12)**
- `PUT` on the pending sale before fixing: 409 `rate_pending`.
- After fixing, an edit that lowers the payable below the held and allocated money: 409 `payable_below_received` (spec 015 M8).
- After fixing, an ordinary edit creates revision 3 (or the next) with the recalculated totals.

**Where it shows (R13 to R16)**
- Outstanding total unchanged by a pending sale; the Pending rate list shows its weight (chargeable weight of net plus polish) and the held money.
- Ledger: `Invoice (rate pending)` line with 0 debit; after fixing the invoice line carries the payable on the sale date and the ledger still ends on the outstanding total (spec 019 R5 property).
- `GET /api/invoices?rateStatus=pending` returns only pending sales.
- Print of a pending sale shows the weights and the words "Rate and amount to be fixed when paid", and no payable.

**Access (R17)**
- Every new route is 401 without a session and 403 without its permission. Staff (who has `invoices.create` and `payments.create` but not `invoices.edit`) can create a pending sale and take the money, but cannot fix the rate.
- Each change writes one audit row (`invoice_pending_create`, `payment_create`, `invoice_rate_fixed`).

**Calculation (packages/calc, `pendingRate.test.ts`)**
- Pending validation table (valid, 9988, zero net, gross below net, polish negative, labour negative, too many lines).
- Chargeable weight = net + polish, polish from basis points.
- Fixing equals `calculateInvoice` with the same rates, for weight-only lines with and without polish, intra and inter, with several purities.

**Browser (`e2e/pendingRate.mjs`, last in `e2e/run-all.mjs`)**: create a pending sale with a saved customer and see "Pending rate" with no amount; take Rs 1,000 as a payment on the sale and see it held; see the sale in the Pending rate section and the outstanding total unchanged; fix the rate and see the amount and the payment applied; a phone view with no pending buttons.

**Known gaps (not built in this run)**
- The cash-limit confirmation (spec 015 R5) is not asked on the "Receive payment on this sale" dialog. The API still returns the `cash_limit` warning and the payment is saved.
- The pending-sale payment dialog has no customer picker: the sale's customer is used.
- Offline creation of pending sales is not part of this spec (041).

## 7. Out of scope
Fixing in parts or line by line (Q92 default is once), a rate timed to the hour, pending sales with stones, combined totals or discounts (Q94), job work 9988 on a pending sale (Q94), a pending credit note or a return of a pending sale (spec 019d), interest on a pending balance (Q26), a printed statement of pending sales (031), a notification to the customer about the rate, offline creation (041).

## 8. Defaults used (owner may change them in `docs/open-questions.md`)
- Q89: labour rate per kg is typed and fixed at the sale; the gold rate is the only part left open.
- Q90: the rate for a line is the applicable rate of its purity on the rate date (spec 011 R8, carried forward allowed); a typed rate overrides it per line; a line with no rate is refused until typed.
- Q91: money paid before fixing is an advance linked to the sale (kind `advance`, numbered, `pending_invoice_id`); it is applied up to the payable when the rate is fixed; the leftover stays the customer's advance. No allocation to a pending sale is allowed before fixing.
- Q92: the rate is fixed once for the whole sale on one day; later corrections are ordinary edits with history.
- Q93: the invoice number is allocated at the sale (not at fixing), from the `INV` series.
- Q94: pending sales: customer required, HSN 7113 only, weight-priced lines only (no stones, no combined totals, no discounts).
- Q95: a pending sale prints weights and purity and "Rate and amount to be fixed when paid"; no amount or GST is printed until fixed.
- Q96: pending sales are excluded from the outstanding total and from FIFO; listed in a separate "Pending rate" list with weight and money held.
- Q97: a pending sale with money held cannot be voided (fix it first, then edit it).
- Q98: a fixed sale appears in the ledger on its invoice date, not on the fixing date.

## 9. Acceptance checklist
Verified on 2026-11-02 in the worktree `jewellery-019c` (commands in the PR description):
- [x] R1 to R17 implemented and tested in `apps/api/test/pendingRate.test.ts` (27 API tests, one group per rule). R15 (print) is checked in the browser, not in the API tests.
- [x] Calculation tests in `packages/calc/src/pendingRate.test.ts` (19 tests). Existing calc tests were not edited and pass.
- [x] Migration `0020_pending_rate.sql` applied to the local database (`npm run db:migrate`) and to every test database (the migrations test). No existing migration was edited.
- [x] `npm run typecheck` clean; `npx vitest run` 606 tests, 34 files, all passing; `npm run build` passes.
- [x] Browser test `e2e/pendingRate.mjs` added last in `e2e/run-all.mjs` (17 checks). Full `run-all` against a local Worker on port 8802: 272 checks passed, 0 failed.
- [ ] Known gaps listed above (cash-limit prompt on the sale payment dialog) are not built.
- [ ] Owner approved the result (not yet).
- [ ] Migration 0020 on the remote database before deploy: `npm run db:migrate:remote -w @jewellery/api` (not run; no deploy done).
