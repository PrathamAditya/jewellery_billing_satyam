# 018: Old gold purchase (`OGP-0001`)

Status: Built 2026-11-02 (calculation, receipts, four settlements, void, screens, tests). Owner review pending.
Depends on: 003, 004, 010, 013, 015, 016
Open questions used with defaults: Q22/Q72 (fields and purity), Q24 (payout modes). The accounting, GST and stock treatment is the CA's decision (O3): nothing is posted to stock or GST (decisions D7, D21).

## 1. Goal
The owner buys old gold from a customer, prints an A5 receipt, and settles the value in one of four ways: pay the customer, move it to the customer's advance, adjust it against an invoice, or split between these. It works from an invoice or on its own. The invoice's first page and calculations are never touched: the old gold only appears on the settlement page.

## 2. Rules
- R1. **Receipt:** table `old_gold_purchases`: `receipt_no` (series `OGP`, resets each 1 April, `OGP-0001`) with `fy`, `serial`, `receipt_date`, `customer_id` (required: the seller is always a saved customer, so advances and the ledger work), customer snapshot (name, mobile, PAN, address, ID reference), `invoice_id` (nullable: standalone when empty), `order_id` (nullable), `treatment`, amounts, `settlement_note`, `header_json`, standard columns, void columns, and the revision rule for edits (below).
- R2. **Rows** `old_gold_lines` (at least 1, at most 10 per receipt, the sample has one): `description` (default `Old Gold`), `gross_mg`, `less_mg` (weight deducted, typed), `net_mg = gross - less` (computed, must be more than 0), `karat` (`22K`, `24K` or `other`, the label), `purity_bps` (purity percent x 100, typed with at most 2 decimals, more than 0 and at most 100%), `rate_paise_per_kg` (typed per gram, stored per kg like other rates; always typed on each receipt, never fetched, owner answer 28).
- R3. **Amount per row** = `net x purity % x rate`, exact and rounded once: `divRoundHalfUp(net_mg x purity_bps x rate_paise_per_kg, 10,000 x 1,000,000)` (paise). No melting-loss or other deduction (owner answer 27). Karat only suggests a purity in the form (22K gives 91.60, 24K gives 99.90) and the owner may type any value, as the sample's 75.26.
- R4. **Totals:** `original amount` = sum of rows (with paise), `round-off` to the rupee (below 50 paise down, 50 or more up, signed), `final amount` = original + round-off, always whole rupees. The receipt shows all three, as the sample does.
- R5. **Settlement treatments** (owner answer 30, requirements 6.4):
  - `direct_payment`: the customer is paid the final amount by `bank_transfer`, `upi` or `cheque` (no cash or card, default for Q24). Recorded as a payout row.
  - `advance`: the final amount becomes customer advance: one payment of kind `old_gold`, mode `old_gold`, `source_ogp_id` set, numbered `PAY-`, with the optional `orderId`, and the receipt's payment status is `Advance Created`.
  - `invoice_adjustment`: the final amount is allocated to the chosen invoice (needs `invoiceId`, the amount must not exceed the invoice's balance due, otherwise use `split`). One `old_gold` payment, numbered, fully allocated.
  - `split`: `directPaise` (payout) + `advancePaise` + `invoiceAdjustPaise` must equal the final amount, each part at least 0. One `old_gold` payment of `advance + invoiceAdjust` (allocation of the invoice part, the rest remains), plus a payout for the direct part. Matches the owner's PAY-0002 sample (₹2,55,962 payment, ₹2,500 used on the invoice, ₹2,53,462 remaining).
- R6. **Payment status text** on the receipt: `Paid` (direct), `Advance Created`, `Adjusted Against Invoice`, `Split Settlement`.
- R7. **Settlement method text** on the receipt (`Ledger Adjustment` when any part goes to advance or an invoice, `Direct Payment` for direct only) and **settlement treatment** header (`Transfer to Customer Advance`, `Adjust Against Invoice`, `Direct Payment to Customer`, `Split Settlement`), with an automatic settlement note in the style of the sample (`Old gold purchased from the customer. The receipt value is recorded as customer advance and linked to the Order ID shown above.` and equivalents per treatment).
- R8. **From an invoice:** the invoice's settlement panel (spec 017) has "Add old gold receipt". It opens this form with the invoice and customer filled in and `invoice_adjustment` as the default treatment. Saving only adds the receipt and its payment, the invoice's own record is unchanged, the settlement page recalculates (owner critical instruction 4).
- R9. **Edit and void.** A receipt is not edited after saving except its remarks. A wrong receipt is voided and re-entered. Voiding (`POST /api/old-gold/:id/void` with a reason, `oldgold.void`) reverses its allocations, voids its payment and payouts, keeps the number. It is refused (409) if the created payment has been used elsewhere (allocations to other invoices or refunds exist beyond the receipt's own invoice adjustment): reverse those first.
- R10. **Not posted:** the screen shows a note "Stock and GST posting for old gold is switched off until the CA decides". No stock or GST rows are created (D7, D21).
- R11. **Search** `GET /api/old-gold?q&customerId&status&from&to&cursor`: `q` matches receipt number, customer name. `GET /api/old-gold/:id` returns the receipt with rows, treatment parts and the created payment and payouts.
- R12. Calculation lives in `packages/calc/src/oldGold.ts` (`calculateOldGold`), pure and table-tested. Amount in words uses spec 015 R13.

## 3. Data
Tables `old_gold_purchases`, `old_gold_lines`, `old_gold_payouts` (`id`, `ogp_id`, `mode`, `reference`, `amount_paise`, `paid_date`, standard and reversal columns). `payments.source_ogp_id` exists from spec 015. API per R8 to R11 plus `POST /api/old-gold` (idempotent with client id). Permissions `oldgold.view|create|void`.

## 4. Screens
**Old gold** list and **New old gold receipt** form: customer picker, date, rows table (description, gross g, less g, net g shown, karat, purity %, rate per g, amount shown), totals with round-off, treatment choice with the amounts for split, payout mode and reference, order and invoice link, remarks. A5 print preview (spec 014). Receipt page with status, linked payment receipt and Void.

## 5. Edge cases
- Less equal to gross gives net 0: 400. Purity over 100%: 400.
- Split parts that do not add up to the final amount: 400 with the difference shown.
- Invoice adjustment larger than the invoice's due: 400 with the due amount in the message.
- Standalone receipt with `invoice_adjustment`: 400.
- Two rows, amount with paise, round-off up and down.
- The customer is later voided: the receipt and its payment stay.

## 6. Test cases
**A. The owner's sample** (`docs/reference/old-gold-purchase-receipt-a5.pdf`): gross 25.00 g, less 2.02 g, net 22.98 g, purity 75.26%, rate ₹14,800 per gram (1,480,000,000 per kg): amount 25,596,227 paise (₹2,55,962.27), round-off -27, final 25,596,200 (₹2,55,962.00). With treatment `advance` and order `ORD-0001`: payment `PAY-0002` style, mode `old_gold`, amount 25,596,200, remaining 25,596,200, status `Advance Created`.

**B. Two rows:** row 1: 22K, net 10.000 g, 91.60%, ₹6,000.50 per gram (600,050,000 per kg) = 5,496,458; row 2: 24K, net 5.250 g, 99.90%, ₹6,500 per gram (650,000,000 per kg) = 3,409,088. Original 8,905,546 (₹89,055.46), round-off -46, final 8,905,500 (₹89,055.00). Round-up check: an original of 8,905,550 gives round-off +50, final 8,905,600.

**C. The owner's settlement sample** (`tax-invoice-and-settlement.pdf`): `split` of 25,596,200 as direct 0, invoice adjustment 250,000 (₹2,500) to an invoice due 20,632,300, advance 25,346,200: one payment 25,596,200, allocation 250,000, remaining 25,346,200 (₹2,53,462.00). The invoice's received is 250,000.

**D. All four treatments:** direct (mode `cash` rejected, `upi` accepted) creates a payout and no payment, `advance`, `invoice_adjustment` (with due larger and smaller than the amount), and `split` with parts adding up and not adding up.

**E. Rules:** net, purity and rate validation; `calculateOldGold` table of 15 rows including rounding halves; idempotent create; the receipt stores `header_json` and customer snapshot and reprints from them; reading returns stored figures.

**F. Void:** void reverses allocation and voids the payment, number kept, invoice due restored; void refused when the advance part was partly used on another invoice or refunded; voided receipt's payment cannot be voided separately (spec 015 M7).

**G. Search and permissions:** search by number and name, 5,000 receipts under 200 ms, staff can create but not void (403), viewer reads only.

**H. Browser** (`e2e/old-gold.mjs`): enter the owner's sample (see 25,596,227 and the final 2,55,962.00), settle to advance with an order, add one from an invoice's settlement panel and see the balance drop, split settlement, void, phone read-only.

## 7. Out of scope
Stock inward of old gold, GST or ledger posting (CA decision), melting and refining records, multiple purity bands per row, photos, printing (spec 014).

## 8. Defaults used
Q22/Q72: rows with Gross, Less, Net, typed purity percent and typed rate, karat only suggests a purity, final amount rounded to the rupee with the original amount shown. Q24: payouts only by bank transfer, UPI or cheque.

## 9. Acceptance checklist
- [ ] R1 to R12 implemented and tested, `calculateOldGold` table-tested
- [ ] Migrations applied locally and by CI
- [ ] Sample amounts match to the paisa in API tests and the browser
