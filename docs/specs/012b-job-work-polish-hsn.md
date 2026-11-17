# 012b: Job work (HSN 9988), polish percent, HSN categories

Status: Built and merged (in main). Verified 2026-11-02: calculation tests, examples A and B to the paisa, typecheck and build. Owner review pending.
Depends on: 012, 013
Open questions: none for this spec. One interpretation to confirm is listed in section 8. Discounts and stones are spec 012c.

## 1. Goal
The invoice follows the owner's rules exactly: only two HSN categories (jewellery 7113 at 3%, job work 9988 at 5%), polish typed as a percentage of net weight and shown as a weight in the Wastage column, and the job-work formula for HSN 9988. This replaces the "HSN 9988 is refused" placeholder from spec 012.

## 2. Rules
- R1. **HSN categories.** An invoice line's HSN is `7113` (jewellery) or `9988` (job work), nothing else. The GST rate comes from the HSN and is not typed: `7113` is 3% (300 basis points), `9988` is 5% (500). The server sets it, and any rate sent by a screen is ignored. Invoices saved before this change keep what they were saved with.
- R2. **Polish is a percentage.** The line carries `polishBps` (percent x 100, so 2% is `200`), from 0% to 100% with at most 2 decimals. `Polish weight (mg) = Net weight (mg) x polishBps / 10,000`, rounded to the nearest milligram, halves up. The line stores both the percentage and the calculated weight. The weight is what goes into the engine and what prints in the Wastage column.
- R3. **Chargeable weight** is still net + polish weight (spec 012 R5).
- R4. **Jewellery lines (7113)** are unchanged: amount = chargeable weight x (gold rate + labour rate), rounded once to the paisa (spec 012 R4 to R7).
- R5. **Job-work lines (9988).** The amount is the job-work (labour) amount only, in one exact calculation rounded once:

  `amount = ( chargeable x (gold rate + labour rate) - net x gold rate ) / 1 kg`

  with weights in mg and rates in paise per kg, exactly the owner's formula `((Net + Polish) x (Gold + Labour)) - (Net x Gold)`. GST is 5%. No other labour calculation is allowed.
- R6. **Parts for 9988 (traceability only).** Gold part = value of the polish gold = `round(chargeable x gold) - round(net x gold)`. Labour part = amount minus gold part. They always add up to the amount. This split is the developer's reading, see section 8.
- R7. **Display rate** = amount / chargeable weight, in paise per gram, rounded half up, for both kinds of line (owner answer 7). For a 9988 line this is the calculated rate that prints in the Rate column.
- R8. The gold rate is required on a 9988 line (the formula needs it) and must be greater than 0. Labour rate may be 0.
- R9. An invoice may mix 7113 and 9988 lines. Tax is worked out once per rate group as before (3% group and 5% group).
- R10. **Engine:** `calculateInvoice` accepts HSN 9988 and the error `job_work_not_supported` is removed. `polishMg` stays the engine input, and a new helper `polishWeightMg(netMg, polishBps)` in `packages/calc` does the R2 rounding so the screen, the server and the tests share one rule.

## 3. Data
- Migration: `invoice_lines.polish_bps` (integer, not null, default 0, `CHECK 0 <= polish_bps <= 10000`).
- Request body: lines send `polishBps` instead of `polishMg` and no longer send `gstRateBps`. The server computes `polish_mg` and the GST rate.
- Older invoice lines (created before this change, test data only) have `polish_bps` 0 and keep their saved `polish_mg`. If one of them is edited, polish is recalculated from the percentage typed.

## 4. Screens and printing
- **Calculator and invoice form:** the HSN box becomes a choice (`7113 Jewellery 3%`, `9988 Job work 5%`). The "GST %" box becomes a read-only figure that follows the HSN. The "Polish g" box becomes "Polish %", and next to it the calculated weight shows ("= 0.196 g").
- **Invoice page:** the Polish column shows the percentage and the weight.
- Nothing prints in this spec. Spec 014 prints the weight in the Wastage column and the display rate in the Rate column.

## 5. Edge cases
- A polish percentage that gives a fraction of a milligram rounds half up (section 6, example C).
- Polish 0%: chargeable = net. For a 9988 line the amount is then net x labour only.
- Labour 0 on a 9988 line with polish: amount is just the polish gold (net x 0 + polish x gold).
- A bill with only 9988 lines has one rate group at 5%.
- Gross weight still cannot be below net.

## 6. Test cases
**A. The owner's reference invoice** (the owner's tax invoice sample (not in this repository)): HSN 7113, gross and net 12.020 g, polish 10% = 1.202 g, gold rate ₹15,150 per gram, labour 0, same state.

| Figure | Value |
|--------|-------|
| Polish weight | 1,202 mg |
| Chargeable | 13,222 mg |
| Amount | 20,031,330 (₹2,00,313.30) |
| CGST, SGST | 300,470 each (₹3,004.70) |
| Total before round-off | 20,632,270 (₹2,06,322.70) |
| Round-off | +30 (₹0.30) |
| Payable | 20,632,300 (₹2,06,323.00) |

**B. Job work (9988):** net 10.000 g, polish 2%, gold ₹11,000.50 per gram, labour ₹450.25 per gram, same state.

| Figure | Value |
|--------|-------|
| Polish weight | 200 mg |
| Chargeable | 10,200 mg |
| Amount | 679,265 (₹6,792.65) = 10,200 x 1,145,075,000 / 1e6 - 10,000 x 1,100,050,000 / 1e6 |
| Gold part, labour part | 220,010 and 459,255 |
| Display rate | 66,595 per gram (₹665.95) |
| CGST, SGST (2.5% each) | 16,982 each (679,265 x 2.5% = 16,981.625) |
| Total before round-off | 713,229 |
| Round-off, payable | -29, 713,200 (₹7,132.00) |
| Other state | IGST 33,963 (5% = 33,963.25), total 713,228, round-off -28, payable 713,200 |

**C. Polish rounding (R2):** net 9,800 mg at 2.5% = 245 mg. 9,801 mg = 245 (245.025). 9,810 mg = 245 (245.25). 9,820 mg = 246 (245.5 rounds up). 9,999 mg = 250 (249.975). Net 10,000 mg at 0% = 0.

**D. Silver with polish:** HSN 7113, net 9.800 g, polish 2% = 196 mg, rate ₹285.72 per gram: chargeable 9,996 mg, amount 285,606 (₹2,856.06), display rate 28,572 per gram, CGST and SGST 4,284 each, total 294,174, round-off +26, payable 294,200.

**E. Mixed bill:** D plus B: amounts 285,606 and 679,265, 3% group half-tax 4,284, 5% group half-tax 16,982, total before round-off 1,007,403, round-off -3, payable 1,007,400.

**F. Rules:**
- A 9988 line with labour 0 and polish 0 has amount 0 (the formula gives 0), and is accepted.
- Gold rate 0 on a 9988 line is rejected. HSN `7114`, `9989`, blank and ` 9988 ` handled: `7114` and `9989` are rejected on invoices ("Choose 7113 or 9988"), spaces are trimmed.
- Polish `-1%`, `100.01%` and `2.555%` are rejected. `0`, `2`, `2.5` and `100` are accepted.
- A rate sent for GST is ignored: an HSN 9988 line sent with `gstRateBps: 300` is saved at 500.
- The gold part plus the labour part equals the amount for every line, 7113 or 9988, in a table of 20 generated cases.

**G. Invoice API and screens:**
- A saved 9988 invoice stores `polish_bps`, `polish_mg` and the calculation, and reading it returns the stored figures.
- Editing an invoice changes polish by percentage and the old version still shows the old percentage and weight.
- Browser: HSN choice sets the GST figure, polish % shows its weight, example A matches the paper figures, example B matches the job-work figures, the calculator and the form agree.

## 7. Out of scope
Discounts and stones (012c), printing (014), converting old invoices, any HSN other than the two.

## 8. Interpretation to confirm (does not block building)
The owner's formula gives the job-work amount in total. Splitting it into a "gold part" (the polish gold) and a "labour part" (R6) is only for display and traceability, and does not change any total. Please confirm that this is how you want the 9988 line described, or say if the gold part should always be 0.

## 9. Acceptance checklist
- [x] R1 to R10 implemented and covered by calculation/API tests
- [x] Migration added for local/CI application (remote application is owner-controlled)
- [x] The reference invoice (example A) and the job-work example (B) match to the paisa in calculation tests
- [x] Typecheck and production build pass
- [ ] Owner approved the result
