# 015: Payments and receipts (the money model)

Status: Approved (Wave 1, owner approved in advance 2026-11-01), not built
Depends on: 003, 004, 010, 013
Open questions used with defaults: Q73 (payment modes), Q74 (cash limit), Q75 (cheques come in Wave 2), Q77 (copies)
This spec defines the money model used by 016 (orders and advances), 017 (settlement), 018 (old gold) and 019 (ledger). Read it first.

## 1. Goal
Record every rupee received: at the time of sale, as an advance, or later against one or several invoices. Each payment is one row, with allocations that say which invoice (or opening balance) it paid. What is left unallocated is the customer's advance. A payment can be spread over several invoices, never counted twice, and can be printed as an A5 receipt (`PAY-0001`).

## 2. Money model (rules for all money specs)
- M1. A **payment** is money in. It is never edited (only its remarks). A mistake is corrected by voiding it and entering a new one.
- M2. A payment's **remaining** = amount - sum of its non-reversed allocations - sum of its non-reversed refunds. Remaining money is the customer's **advance**. It can be allocated to invoices later, in parts. Only the allocated amount is deducted, the rest stays.
- M3. An **allocation** links a payment to exactly one target: an invoice or an opening receivable (spec 019). It has an amount of more than 0 and is never deleted: it is **reversed** (`reversed_at`, `reversed_by`, `reverse_reason`) and the money goes back to the payment's remaining.
- M4. An invoice's **received** = sum of its non-reversed allocations. **Balance due** = payable - received, never below 0 (an allocation cannot exceed the due amount).
- M5. A customer's **outstanding** = sum of due amounts of their non-voided invoices + their opening receivables due. Their **advance held** = sum of remaining of their non-voided payments. (Spec 019 shows both.)
- M6. **Kinds of payment:** `at_sale` (recorded on the invoice at the time of sale, no receipt number, shows in payment history and the settlement page), `advance` (taken before or without an invoice, numbered), `invoice_payment` (taken later against invoices, numbered), `opening_advance` (spec 016), `old_gold` (created by spec 018). Numbered kinds get a `PAY-0001` receipt number (series `PAY`, resets each 1 April, spec 003). `at_sale` and `opening_advance` get no receipt number (owner answers: no separate serial for payments recorded in the invoice, and old-booklet advances are not new receipts).
- M7. Voiding a payment reverses its allocations in the same batch. It is refused (409) if the payment has non-reversed refunds (reverse them first) or if it was created by an old gold receipt (void that receipt instead).
- M8. Voiding an invoice is refused (409 `has_payments`) while it has non-reversed allocations. Editing an invoice is refused (409 `payable_below_received`) if the new payable would be below what has been received. These two checks are added to the spec 013 routes here.

## 3. Rules for this spec
- R1. **Modes:** `cash`, `upi`, `card`, `cheque`, `bank_transfer`, `old_gold` (only created by spec 018). A `reference` (UPI transaction number, cheque number, card last digits) is optional text up to 60 characters.
- R2. **Create** `POST /api/payments` `{ id?, customerId?, date, mode, reference?, amountPaise, purpose, orderId?, allocation?, invoiceId?, atSale?, remarks? }`:
  - `purpose: "advance"`: no allocation, needs `customerId`, kind `advance`, optional `orderId`.
  - `purpose: "against_invoices"`: allocate to invoices. `allocation: "auto"` (default) uses oldest first (FIFO, below), or `allocation: [{ invoiceId | openingBalanceId, amountPaise }]` for a manual choice. Whatever is not allocated stays as advance (the receipt shows it). Kind `invoice_payment`.
  - `invoiceId` + `atSale: true`: a payment recorded on one invoice at the time of sale: kind `at_sale`, no receipt number, the amount must not exceed the invoice's balance due, `customerId` copied from the invoice (null for a walk-in).
- R3. **FIFO:** open items of the customer (opening receivables and non-voided invoices with balance due) ordered by date (invoice date or as-of date) and then by creation time. The payment fills each in turn up to its due amount, then the next. The result is returned and stored as allocations, so the choice is visible and reversible.
- R4. **Validation:** amount more than 0 and at most ₹10,00,00,000; every manual allocation at most the target's due; sum of allocations at most the amount; targets must belong to the payment's customer and be non-voided; the date is a business date, today or earlier; an advance needs a customer; a payment against invoices may have no customer only for `at_sale` on a walk-in invoice.
- R5. **Cash limit warning** (spec 003 `limits.cashWarningPaise`): a `cash` payment of that amount or more is saved and the response has `warnings: [{ code: "cash_limit", limitPaise }]`. The screen asks for confirmation before sending. It never blocks (owner answer 24).
- R6. **Receipt snapshot.** On creation of a numbered payment the server stores `customer snapshot` (name, mobile, PAN, address), `header_json` (spec 003), and `advance_summary_json`: `previousRemainingPaise` (remaining of the other advance-like payments in the same scope before this one: the order if `orderId` is set, otherwise the customer's), `thisRemainingPaise` (amount minus allocated now), `totalAvailablePaise` (their sum). Reprints show these stored values.
- R7. **Reverse an allocation** `POST /api/allocations/:id/reverse` `{ reason }` (needs `payments.void`): sets the reversal fields, the money returns to the payment's remaining, an audit row is written. Already reversed is 409.
- R8. **Void a payment** `POST /api/payments/:id/void` `{ reason }` per M7.
- R9. **Search** `GET /api/payments?q&customerId&mode&kind&status&from&to&cursor`: `q` matches receipt number, customer name, reference. 20 per page, newest first.
- R10. **Read** `GET /api/payments/:id`: the payment with its allocations (invoice number, amount, reversed or not) and remaining.
- R11. **Remarks** can be edited `PATCH /api/payments/:id` `{ remarks }` with a revision and an audit row. Nothing else.
- R12. Invoices' API responses and list rows gain `receivedPaise`, `balanceDuePaise` and `paymentStatus` (`unpaid`, `part_paid`, `paid`, `voided`) computed from allocations (never stored).
- R13. `amountInWords(paise)` in `packages/shared`: Indian style, `Rupees Two Lakh Six Thousand Three Hundred Twenty Three Only.`, and with paise `Rupees One Thousand and Fifty Paise Only.` (format: `Rupees ... and NN Paise Only.`), zero is `Rupees Zero Only.`. Used by receipts and invoices.

## 4. Data
Tables (all with standard columns and no-delete triggers):
- `payments`: `kind`, `receipt_no` (nullable), `fy`, `serial` (nullable), `receipt_date`, `customer_id` (nullable), `payer_name`, `payer_mobile`, `payer_pan`, `payer_address`, `mode`, `reference`, `amount_paise` (`CHECK > 0`), `order_id`, `source_ogp_id`, `remarks`, `advance_summary_json`, `header_json`, void columns. Unique `(fy, receipt_no)` where `receipt_no` is not null. Index on `customer_id`, `receipt_date`.
- `payment_allocations`: `id`, `payment_id`, `invoice_id`, `opening_balance_id`, `amount_paise` (`CHECK > 0`), `created_at`, `created_by`, `reversed_at`, `reversed_by`, `reverse_reason`, and `CHECK` that exactly one target is set. Indexes on `payment_id`, `invoice_id`.
- `invoices` and `payments` get no stored paid totals: everything is computed from allocations with SQL aggregates.
API: as in R2, R7 to R11. Permissions: `payments.view`, `payments.create` (also `advances.create` for advances), `payments.void`.

## 5. Screens
- **Payments** (top bar): list with search, filters (mode, kind, dates, status), "Receive payment" button.
- **Receive payment dialog** (also opened from an invoice page and from a customer page): customer picker (fixed when opened from an invoice), amount, mode, reference, date, remarks, and a choice "Advance (no invoice)" or "Pay invoices". For invoices it lists the customer's open invoices with due amounts, an "Auto (oldest first)" default showing the planned allocation, or manual amounts per invoice. The leftover shows as "Kept as advance: ₹...". Cash limit confirmation. From an invoice page the "Received at the time of sale" box (checked by default when the invoice is dated today) records an `at_sale` payment.
- **Payment page:** details, allocations with Reverse buttons, remaining, Void, Print (spec 014).
- Invoice list and page show received, balance due and a status chip.

## 6. Edge cases
- A payment of ₹10,000 against two invoices due ₹4,000 and ₹5,000 under auto: ₹4,000 to the oldest, ₹5,000 to the next, ₹1,000 stays as advance.
- Two receipts entered at once against the same invoice cannot exceed its due (the second is trimmed or refused with 409 `exceeds_due`, decided inside the batch by re-reading the due amount).
- Voiding an invoice that has a fully reversed allocation: allowed.
- Reversing an allocation on a voided payment: not needed (already reversed).
- A payment dated before the invoice's date: allowed (advance paid earlier).
- Amount with paise (₹1,234.50) is allowed in receipts. The invoice total itself is always whole rupees.

## 7. Test cases
- Create an advance of ₹14,500 UPI with reference `DKJSDF`: kind `advance`, number `PAY-0001`, remaining 1,450,000, `advance_summary_json` previous 0, this 1,450,000, total 1,450,000. A second advance for the same order gets previous 1,450,000.
- At-sale payment on an invoice: no receipt number, invoice received and due updated, status `part_paid` then `paid` when equal to payable.
- FIFO (R3): invoices dated 1, 5, 9 Nov with dues 4,000, 5,000, 6,000, payment 10,000 auto gives 4,000, 5,000, 1,000 and 0 advance. Payment 16,000 gives 4,000, 5,000, 6,000 and 1,000 advance. Manual allocation 3,000 and 7,000 to the 1st and 3rd works, 5,000 to an invoice due 4,000 is 400 `exceeds_due`.
- One payment over several invoices: allocations list, each invoice's received, reversal of one allocation returns that amount to remaining and re-opens that invoice's due, with an audit row each time.
- Void a payment: its allocations reverse, invoices' due are restored, the number is never reused. Void refused with refunds present. Void refused for an `old_gold` payment.
- M8: voiding an invoice with allocations is 409 `has_payments`. Editing an invoice below the received amount is 409 `payable_below_received`, editing above it works and the due increases.
- Cash limit: a ₹2,00,000 cash payment saves with the warning, ₹1,99,999.99 does not warn, UPI never warns.
- Validation: other customer's invoice, voided invoice, amount 0, future date, advance without customer, allocation sum over the amount, all 400 or 409 with messages.
- Idempotent create: same id twice returns one payment and one number.
- `amountInWords` table, using the owner's samples: 20,632,300 -> `Rupees Two Lakh Six Thousand Three Hundred Twenty Three Only.`, 1,450,000 -> `Rupees Fourteen Thousand Five Hundred Only.`, 25,596,200 -> `Rupees Two Lakh Fifty Five Thousand Nine Hundred Sixty Two Only.`, 0, 100, 150 paise, 1 crore, 12,34,56,789.
- 5,000 payments: search under 200 ms. 20 parallel payments get 20 distinct serials.
- Permissions: staff can create, cannot void or reverse (403), viewer sees list only.
- Browser (`e2e/payments.mjs`): receive an advance, receive a payment against two invoices with auto allocation and see the leftover, record an at-sale payment from an invoice, reverse an allocation, void, cash warning dialog, phone view read-only.

## 8. Out of scope
Cheque status tracking and bounce (019b, Wave 2), returns and credit notes (019d), pending rate fixation (019c), cash closing (032), printing the receipt (spec 014, which needs R6's stored data).

## 9. Defaults used
Q73: modes are the five from the requirements plus `old_gold`, a reference is optional. Q75: cheques are recorded as a mode with a reference until Wave 2. Q77: one receipt per print, "print twice" option in spec 014.

## 10. Acceptance checklist
- [ ] M1 to M8 and R1 to R13 implemented and tested
- [ ] Migrations applied locally and by CI
- [ ] Spec 013 routes updated for M8 with tests
- [ ] Browser test passes and earlier browser tests still pass
