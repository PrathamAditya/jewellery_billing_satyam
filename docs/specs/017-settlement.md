# 017: Settlement (the invoice's money page)

Status: Approved (Wave 1, owner approved in advance 2026-11-01), not built
Depends on: 013, 015, 016, 018
Open questions used with defaults: Q66 (the HTML "v84" file may arrive later and refine this, never contradict D1)

## 1. Goal
For every invoice, one place shows everything that settles it: payments received at the time of sale, advances used, old gold adjusted, later payments, and the balance due. It recalculates automatically when anything is added or reversed, supports partial settlement, keeps editable notes, and is exactly what prints on the reverse of the invoice (spec 014).

## 2. Rules (money model in spec 015)
- R1. `GET /api/invoices/:id/settlement` returns: the invoice header (number, date, customer), `payablePaise`, the **received lines**, `receivedPaise`, `balanceDuePaise`, the `advanceReference` string, the `autoNote`, and the owner's `remarks`.
- R2. **Received lines** = the invoice's non-reversed allocations, oldest first, each with: `date`, `mode` (`UPI`, `Cash`, `Card`, `Cheque`, `Bank Transfer`, `Old Gold`), `reference` (the payment's receipt number such as `PAY-0001`, or for an at-sale payment its transaction reference), `type` (`At sale`, `Advance`, `Opening advance`, `Later payment`, `Old gold`), `amountPaise` (the amount allocated to this invoice, not the payment's whole amount), plus the payment's `remainingPaise`, `allocationId` and `paymentId`. Matches the sample page: `UPI PAY-0001 ₹14,500.00`, `Old Gold PAY-0002 ₹2,500.00`.
- R3. **Totals:** `Total advance payments` is the sum of received lines, `Less: Advance Received` equals it, `Balance Due` = payable - received (never below 0). Invoice value = payable.
- R4. **Advance reference** = the receipt numbers of the received lines that have one, in order, joined by `, ` (sample `PAY-0001, PAY-0002`).
- R5. **Automatic note** (deterministic, tested text), one sentence per source, after the fixed settlement text from settings (`texts.settlementNote`):
  - for each old gold line: `Old gold {OGP no} adjusted through {PAY no}: ₹{allocated}. Remaining in {PAY no}: ₹{remaining}.`
  - for each advance line: `Advance {PAY no} used: ₹{allocated}. Remaining in {PAY no}: ₹{remaining}.`
  - for each at-sale or later payment there is no sentence (they show in the table).
  Amounts use the Indian format.
- R6. **Remarks** (owner answers 26): a free-text box saved on `invoice_settlements(invoice_id, remarks, updated_at, updated_by)`, any text up to 1,000 characters, editable any time (each change stores the old value as a revision and an audit row). Remarks are never cleared by adding payments, reversing allocations or any reset of other fields. The printed page shows the fixed text, the automatic note and then the remarks.
- R7. **Actions** from the settlement panel, all through existing endpoints and all recalculating the page:
  - Receive payment (spec 015, `at_sale` or later, advance leftover rules apply).
  - **Use advance:** `POST /api/invoices/:id/advance-allocations` `{ allocations: [{ paymentId, amountPaise }] }`. Each payment must belong to the invoice's customer, be non-voided and have remaining at least the amount, and the total must not exceed the balance due. Several advances in one call are applied atomically. The panel lists the customer's available advances (order-linked first) with their remaining.
  - Add old gold receipt (spec 018).
  - Reverse an allocation (spec 015 R7), with a reason.
- R8. **Partial settlement** is the normal state: any balance due above 0 keeps the invoice open. The invoice list shows the status chip from spec 015 R12.
- R9. **Voided invoices** show their settlement read-only. **Earlier revisions** of an invoice show the current settlement (money is not versioned).
- R10. Never counted twice: the page sums allocations, which are the only link between money and invoice (spec 015 M3). The advance's remaining is computed from the same allocations.
- R11. Reading the settlement never changes data (CLAUDE.md rule 6).

## 3. Data
Table `invoice_settlements` (`invoice_id` primary key, `remarks`, standard columns, revision via `record_revisions`). API: R1, `PUT /api/invoices/:id/settlement` `{ remarks }`, R7's advance endpoint. Permissions: `invoices.view` to read, `payments.create` to receive and use advances, `payments.void` to reverse, `invoices.edit` to change remarks.

## 4. Screens
A **Settlement** tab on the invoice page (between Details and History): the received-lines table (date, mode, reference, type, amount, Reverse), totals box with the big **Balance Due**, the advance reference, the automatic note and the remarks box with its own Save, buttons Receive payment, Use advance (dialog with the available advances and amounts, default: as much as the due, oldest first), Add old gold receipt. The invoice header shows the balance due chip.

## 5. Edge cases
- Using ₹3,000 of an advance with ₹2,53,462 remaining leaves ₹2,50,462.
- Using an advance on two invoices in turn never exceeds its remaining.
- Balance due 0: Use advance and Receive payment are disabled.
- A reversed allocation disappears from the table (history is in the audit trail and on the payment page).
- Remarks typed, then a payment added: remarks unchanged.

## 6. Test cases
**A. The owner's settlement page** (`docs/reference/tax-invoice-and-settlement.pdf` page 2): invoice payable 20,632,300 (₹2,06,323.00), payment PAY-0001 UPI ₹14,500 allocated in full, payment PAY-0002 mode old gold (from OGP-0001, 25,596,200) with 250,000 allocated: lines UPI `PAY-0001` 1,450,000 and Old Gold `PAY-0002` 250,000, received 1,700,000 (₹17,000), balance due 18,932,300 (₹1,89,323.00), advance reference `PAY-0001, PAY-0002`, and the automatic note ends with `Old gold OGP-0001 adjusted through PAY-0002: ₹2,500.00. Remaining in PAY-0002: ₹2,53,462.00.`

**B. Actions:** receive an at-sale payment (no receipt number, reference shown), use two advances in one call, a use larger than remaining is 400, larger than the due is 400, an advance of another customer is 400, a voided advance is 409, partial then final payment moves the status from `part_paid` to `paid`.

**C. Reverse:** reversing the old gold allocation restores the due and the advance's remaining, the line disappears, and the audit has one row.

**D. Remarks:** save, edit (revision kept), long text 400, remarks survive adding and reversing payments, and appear after the automatic note.

**E. Consistency property test:** over 200 random sequences of payments, allocations, reversals and voids, `received + due = payable` for every invoice, no advance's remaining is negative, and the sum of all allocations equals the sum of all received amounts.

**F. Permissions and reading:** staff can use advances, not reverse (403), viewer can read only, the settlement GET writes nothing (row counts unchanged).

**G. Browser** (`e2e/settlement.mjs`): rebuild the owner's sample end to end (invoice, advance by UPI, old gold advance, use both) and see ₹1,89,323.00, write remarks, add a payment and see remarks stay, reverse one line, phone view read-only with no sideways scroll.

## 7. Out of scope
Credit notes and returns (019d), cheque statuses (019b), pending rate fixation (019c), printing (014), interest on late payment.

## 8. Defaults used
Q66: the PDF sample and requirements section 7 define the page. If the owner later provides the v84 HTML file and it differs, compare and amend this spec in a new commit.

## 9. Acceptance checklist
- [ ] R1 to R11 implemented and tested, including the property test
- [ ] Owner's sample page reproduced exactly in an API test and the browser
- [ ] Browser test passes, earlier tests green
