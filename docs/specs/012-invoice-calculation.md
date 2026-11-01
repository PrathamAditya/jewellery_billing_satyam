# 012: Invoice calculation engine

Status: Built 2026-11-01, awaiting owner check
Depends on: 000, 011 (rates are paise per kg)
Open questions: O1 (HSN 9988 job-work) keeps those lines out of this spec, and O2 (how polish is typed) only affects the entry screen, not the engine. Q1 is answered in section 8. O8 is mostly answered by `docs/client-invoice-reference.md`.

## 1. Goal
One tested function turns invoice lines into every amount on the bill: line amounts, the gold and labour parts, display rate, taxable amount, CGST and SGST (or IGST), round-off, and the final payable amount. It is pure (no database, no clock), so the same inputs always give the same numbers, and a saved invoice can keep its numbers forever (CLAUDE.md rule 5).

The owner can check it right away against paper bills on a small **Invoice calculator** screen. Nothing is saved there. The real invoice screen comes in spec 013.

## 2. Rules

**Inputs and units**
- R1. Each line has: `hsn` (text), `grossWeightMg`, `netWeightMg`, `polishMg`, `goldRatePaisePerKg`, `labourRatePaisePerKg`, `gstRateBps` (basis points: 3% is `300`). Weights are integer milligrams, rates are integer paise per kg (spec 011), no floats anywhere.
- R2. Weights are typed in grams with up to 3 decimals (`9.800` is 9,800 mg). More decimals are rejected, not rounded.
- R3. Limits: net weight greater than 0 and at most 100 kg per line, gross weight not less than net weight, polish 0 or more, gold rate greater than 0, labour rate 0 or more, `gstRateBps` from 0 to 2800, at most 50 lines, at least 1 line. Anything else returns a clear error naming the line and the field.

**Line amount**
- R4. Internal rate = gold rate + labour rate (requirement 4.5).
- R5. Chargeable weight = net weight + polish.
- R6. Line amount (paise) = chargeable weight in mg x internal rate in paise per kg / 1,000,000, rounded **once** to the nearest paisa, half up. The product can exceed 2^53, so it is computed with BigInt.
- R7. Gold part = chargeable weight x gold rate / 1,000,000, rounded half up. Labour part = line amount minus gold part. So the two parts always add up to the line amount, and the labour figure is traceable.
- R8. Display rate (printing only, requirement 4.5) = line amount / chargeable weight, in paise per gram, rounded half up and shown as rupees with 2 decimals. On a normal line this is the internal rate per gram (₹285.72 on the client's invoice).

**GST**
- R9. Lines are grouped by `gstRateBps`. Tax is calculated **per rate group on the sum of that group's line amounts**, which matches the totals block on the paper invoice (Q1). Within one invoice, a rate group's taxable amount is the sum of its lines.
- R10. Tax mode is chosen per invoice: `intra` (default, same state: Himachal Pradesh, state code 02) or `inter` (another state).
  - `intra`: CGST = SGST = taxable x rate / 20,000, each rounded half up.
  - `inter`: IGST = taxable x rate / 10,000, rounded half up.
- R11. Totals: taxable total = sum of line amounts. Tax total = sum of every CGST, SGST and IGST. Total before round-off = taxable total + tax total.

**Round-off (requirement 4.7)**
- R12. Round-off is the difference to the nearest whole rupee: a remainder below 50 paise rounds down, 50 paise or more rounds up. It is shown as its own figure and can be negative. Payable = total before round-off + round-off, always whole rupees. It goes through the single `roundOffPaise` function in `packages/calc`, and the new half-up division sits in the same file (CLAUDE.md rule 2).

**Job-work and traceability**
- R13. A line with HSN `9988` is rejected with `job_work_not_supported` until O1 is answered. No guessing.
- R14. The result holds every intermediate number: per line (chargeable weight, gold part, labour part, amount, display rate, rate group), per rate group (taxable, CGST, SGST or IGST), the totals, round-off and payable. It is plain JSON, so spec 013 can store it with the invoice and old invoices are never recalculated.
- R15. A line with `gstRateBps` 0 is allowed (no tax). Mixed rates in one invoice are allowed.

## 3. Data
No database change. Code only:
- `packages/calc/src/invoice.ts`: `calculateInvoice(input)` and its types.
- `packages/calc/src/round.ts`: adds `divRoundHalfUp(numerator: bigint, denominator: bigint)` beside the existing `roundOffPaise`.
- `packages/shared/src/weight.ts`: `parseWeightGrams(text)` to mg, and `formatWeightGrams(mg)` (`9.800`), used by the screen now and by the invoice later.

## 4. Screens and printing
**PC: Invoice calculator** (link "Calculator" in the top bar, `#/calculator`). A preview only, nothing is saved.
- A table of lines: description (optional), HSN, gross g, net g, polish g, gold rate per gram, labour rate per gram, GST %. "Add line" and "Remove".
- Tax mode switch: Same state (CGST + SGST) or Other state (IGST).
- Below it, a breakdown laid out like the paper invoice's bottom block: Amount Before Tax, CGST, SGST (or IGST), Total after Tax, Round-off, Payable. Plus per line: chargeable weight, gold part, labour part, amount, display rate.
- A button "Fill with the Baba Jewellers example" loads the client's bill so the numbers can be compared.
- Not shown on the phone (it is a PC billing tool; Android is view-only, D5).

**Printing:** none in this spec.

## 5. Edge cases
- One line only, one rate group: same result as the paper invoice (section 6, example A).
- Gold rate with labour 0: internal rate = gold rate, labour part = 0.
- Labour rate larger than gold rate (silver with high making charge): fine.
- Polish makes the chargeable weight longer than net: display rate stays the internal rate per gram.
- A line whose amount rounds to 0 paise (tiny weight, tiny rate) is allowed and contributes 0.
- Two lines of 1.000 g can give 1 paisa less tax than line-by-line rounding (example C). That is why Q1 matters.
- 100 kg at the maximum rate: the product is 10^18, and the result must still be exact (BigInt).
- Inter-state and same-state give the same total tax when the rate is even (3% is 1.5% + 1.5%). They can differ by 1 paisa when the half-split rounds differently.

## 6. Test cases
All amounts are paise unless shown in rupees. Every row is a test.

**A. The client's real invoice** (`docs/client-invoice-reference.md`): silver, HSN 7113, net 9.800 g, gold rate ₹285.72/g = 28,572,000 per kg, labour 0, GST 3%, same state.

| Figure | Value |
|--------|-------|
| Chargeable weight | 9,800 mg |
| Line amount | 280,006 (₹2,800.06) |
| Display rate | 28,572 per gram (₹285.72) |
| CGST, SGST | 4,200 each (₹42.00) |
| Total before round-off | 288,406 (₹2,884.06) |
| Round-off | -6 |
| Payable | 288,400 (₹2,884.00) |

**B. Gold with labour:** 22K916, HSN 7113, net 12.345 g, gold ₹11,000.50/g (1,100,050,000 per kg), labour ₹450.25/g (45,025,000 per kg), GST 3%, same state.

| Figure | Value |
|--------|-------|
| Internal rate | 1,145,075,000 per kg |
| Line amount | 14,135,951 (₹1,41,359.51) |
| Gold part, labour part | 13,580,117 and 555,834 (sum 14,135,951) |
| Display rate | 1,145,075 per gram (₹11,450.75) |
| CGST, SGST | 212,039 each (₹2,120.39) |
| Total before round-off | 14,560,029 (₹1,45,600.29) |
| Round-off, payable | -29, 14,560,000 (₹1,45,600) |

**C. Two lines, one rate group (Q1):** two silver lines, each net 1.000 g at ₹285.72/g, GST 3%.

| Figure | Per rate group (proposed) | Line by line (alternative) |
|--------|---------------------------|----------------------------|
| Line amounts | 28,572 and 28,572 | same |
| Taxable | 57,144 | 57,144 |
| CGST and SGST each | 857 (57,144 x 1.5% = 857.16) | 429 + 429 = 858 |
| Total before round-off | 58,858 (₹588.58) | 58,860 |
| Round-off, payable | +42, 58,900 (₹589) | +40, 58,900 |

**D. Polish:** silver, net 10.000 g, polish 0.500 g, ₹285.72/g, GST 3%: chargeable 10,500 mg, amount 300,006 (₹3,000.06), display rate 28,572 per gram, CGST and SGST 4,500 each, total 309,006, round-off -6, payable 309,000.

**E. Other state:** example A with `inter`: IGST 8,400 (280,006 x 3% = 8,400.18), total before round-off 288,406, payable 288,400.

**F. Two rate groups:** line 1 as example A at 3%, line 2 as example B's line at 5% (HSN 7114, an HSN with no special rule): group 3% taxable 280,006 gives 4,200 each, group 5% taxable 14,135,951 gives 353,399 each (353,398.775 rounds up), total before round-off 15,131,155, round-off +45, payable 15,131,200.

**G. Round-off boundaries (R12):**

| Total before round-off | Round-off | Payable |
|------------------------|-----------|---------|
| 288,406 | -6 | 288,400 |
| 288,449 | -49 | 288,400 |
| 288,450 | +50 | 288,500 |
| 288,451 | +49 | 288,500 |
| 100,000 | 0 | 100,000 |
| 100,049 | -49 | 100,000 |
| 100,050 | +50 | 100,100 |

**H. Rounding and size:**
- `divRoundHalfUp`: 5/2 = 3, 4/2 = 2, 7/3 = 2, 0/5 = 0, and a product above 2^53 is exact.
- 100 kg (100,000,000 mg) at 10,000,000,000 per kg: amount 1,000,000,000,000 (exact).
- Labour 0: labour part 0 and gold part equals the amount.
- A tiny line (1 mg at 1 paise per kg): amount 0, no error.

**I. Validation (R2, R3, R13):**
- Net 0, negative net, net above 100 kg, gross below net, negative polish, gold rate 0, negative labour, `gstRateBps` 2,801, 51 lines, 0 lines: each is rejected with an error that names the line and field.
- Weight `9.8004` is rejected, `9.800` and `9.8` are accepted (9,800 mg), `abc` is rejected.
- HSN `9988` returns `job_work_not_supported`.

**J. Behaviour:**
- Same input twice gives identical output, and the input is not changed.
- Result is JSON-safe (no BigInt in the output), so it can be stored.
- Browser: type example A and see the paper figures. Switch to other state and see IGST. Add a second line and see both rate groups. The calculator is hidden on a phone.

## 7. Out of scope
Saving an invoice (013), picking a customer or an inventory item, copying the day's rate onto a line (013, and O9 decides which rate a purity uses), the "same rate for the first row and the next rows" shortcut (a screen convenience in 013, never printed), HSN 9988 job-work (O1), converting a polish percentage into weight (O2), payments, advances and old gold (015 to 018), printing (014).

## 8. Questions for the owner
- Q1 (answered 2026-11-01: **per rate group, as proposed**). **GST on several lines.** Should GST be worked out once per rate on the total of all lines (proposed, as the totals block on the paper invoice does), or line by line and then added up? Example C shows the difference: 1 paisa of tax. Per rate group is what most billing software does and what the paper totals show.
- Open and not blocking: O1 (job-work) lines are refused until you give the calculation with a worked example. O2 (polish as grams or percent) changes only how it is typed, so I will ask when we build the invoice screen.

## 9. Acceptance checklist
- [x] R1 to R15 implemented and tested (272 tests in total, 67 of them new)
- [x] Every worked example above (A to J) passes as a test
- [x] Calculator screen reproduces the client's paper invoice in a real browser (2,800.06 / 42.00 / 42.00 / 2,884.06, round-off -0.06, payable 2,884.00), and also examples B, D, E and F, the validation messages, and the hidden phone view
- [x] Nothing in specs 000, 001, 002, 010 and 011 broke (their tests still pass)
- [ ] Owner approved the result (check the Calculator against two or three more paper bills)
