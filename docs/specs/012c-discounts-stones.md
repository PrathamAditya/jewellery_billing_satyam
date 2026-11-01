# 012c: Discounts, stones and diamonds

Status: Approved (Wave 1, owner approved in advance 2026-11-01), not built
Depends on: 012, 012b, 013
Open questions used with defaults: Q68 (discounts), Q69 (stones). Both answers below are defaults for the owner to confirm later. The calculation order is chosen so that changing a default later only changes this spec's engine functions.

## 1. Goal
An invoice line can be priced three ways (weight and rate as now, weight and rate plus a separate stone amount, or one combined total), and the invoice can carry discounts on the gold amount, on the labour amount and on the total, each as a fixed rupee amount or a percentage. GST is worked out on the amount after discount. Everything stays exact, traceable and stored with the invoice.

## 2. Rules

**Pricing methods per line** (owner answer 9, chosen per item)
- R1. A line has `pricingMode`:
  - `weight` (default, spec 012 and 012b): amount from weight and rates.
  - `separate`: gold amount from weight and rates as in `weight`, plus a stone part: `stoneWeightMg` (information, part of the gross weight and not of the net weight) and `stoneAmountPaise` (typed fixed amount, at least 0). Line amount = metal amount + stone amount.
  - `combined`: one item weight and one typed `totalAmountPaise` (more than 0). Gold and labour rates are not used. Line amount = that total. The display rate = amount / weight (weight = net weight, polish stays 0).
- R2. The line's GST rate comes from its HSN as in 012b. The stone amount is taxed at the line's rate (default for Q69).
- R3. Gold part, labour part and stone part are kept per line: `combined` lines have gold 0, labour 0, stone 0 (their whole amount is neither), `separate` lines have a stone part, `weight` lines have stone 0.

**Discounts** (owner answer 10)
- R4. An invoice may carry up to three discounts, one per target: `gold`, `labour`, `total`. Each is `{ kind: "fixed" | "percent", value }`. Fixed value is paise (at least 0), percent value is basis points (0 to 10,000, at most 2 decimals of a percent). A target without a discount has none.
- R5. Order of calculation (default for Q68), all in whole paise:
  1. Line amounts, gold parts, labour parts and stone parts as in 012 and 012b.
  2. **Gold discount** base = sum of the gold parts of all lines. Fixed amount cannot exceed the base (error). Percent = `round(base x bps / 10,000)` half up. The discount is shared across lines in proportion to their gold parts.
  3. **Labour discount** the same, on the labour parts.
  4. **Total discount** base = sum of line amounts after steps 2 and 3. Same limits, shared across lines in proportion to their remaining amounts.
  5. A line's **taxable amount** = its amount minus its three shares. Lines are grouped by GST rate, taxable amounts are summed per group, and tax is calculated once per group (spec 012 R9), after discount.
  6. Round-off to the rupee at the end as before.
- R6. **Sharing** uses the largest-remainder method on integer paise so the shares always add up to the discount exactly (ties go to the earlier line). A discount on a base of 0 is rejected ("nothing to discount").
- R7. A discount can never make a line's taxable amount negative (a fixed amount bigger than the base is rejected, so this cannot happen).
- R8. The result carries, per line: `stoneAmountPaise`, `discountPaise` (all three shares added) and `taxablePaise`, and per invoice `discounts` as entered, `discountGoldPaise`, `discountLabourPaise`, `discountTotalPaise` and `discountPaise` (their sum). "Amount before tax" in the totals block becomes: `Total value`, `Less: discount`, `Taxable value`.
- R9. The saved invoice stores the discount inputs and every figure (frozen like everything else). Editing recalculates and keeps the earlier revision.

## 3. Data
- Engine (`packages/calc/src/invoice.ts`): `InvoiceLineInput` gets `pricingMode`, `stoneWeightMg`, `stoneAmountPaise`, `totalAmountPaise`. `InvoiceInput` gets `discounts?: { gold?, labour?, total? }`. Result extended per R8. Old inputs without the new fields behave exactly as before (all earlier tests unchanged).
- Migration: `invoice_lines` gets `pricing_mode` (default `weight`), `stone_weight_mg`, `stone_amount_paise`, `total_amount_paise` (all default 0), `discount_paise`, `taxable_paise`. `invoices` gets `discount_json` and `discount_paise`.
- API: invoice request lines and body accept the new fields (zod in `packages/shared/src/invoice.ts`), server recalculates, responses return them.

## 4. Screens
**Lines editor** (calculator and invoice form): a "Pricing" choice per line (`Gold by weight`, `+ Stone`, `Combined total`). `+ Stone` shows stone weight and stone amount boxes. `Combined total` hides the rate boxes and shows one amount box. **Discounts panel** under the lines: three rows (Gold, Labour, Total), each with a Fixed or Percent switch and a value box, empty means none. The totals block shows the new rows. The invoice page shows the stored discount and stone figures.

## 5. Edge cases
- A percent discount on a base with odd paise rounds half up before sharing.
- Gold discount with only `combined` lines: base is 0, rejected.
- A total discount larger than the sum of line amounts after the other discounts: rejected.
- A bill mixing 7113 and 9988 lines: the gold, labour and total discounts are shared across all lines, then tax is per group.
- Discounts and round-off: round-off is computed on the discounted total.

## 6. Test cases
**A. Discounts across two lines** (HSN 7113, same state): line 1 net 10.000 g gold ₹6,000 per g, labour ₹500 per g (gold part 6,000,000 paise, labour part 500,000, amount 6,500,000). Line 2 net 5.000 g gold ₹6,000, labour ₹400 (3,000,000 + 200,000 = 3,200,000). Discounts: gold 1% (percent), labour fixed ₹300, total fixed ₹1,000.

| Step | Value |
|------|-------|
| Gold discount | 1% of 9,000,000 = 90,000, shares 60,000 and 30,000 |
| Labour discount | 30,000, shares 21,429 and 8,571 (largest remainder of 21,428.57 and 8,571.43) |
| Amounts after gold and labour | 6,418,571 and 3,161,429, sum 9,580,000 |
| Total discount | 100,000, shares 67,000 and 33,000 |
| Taxable per line | 6,351,571 and 3,128,429, sum 9,480,000 |
| CGST, SGST | 142,200 each (9,480,000 x 1.5%) |
| Total before round-off, round-off, payable | 9,764,400, 0, 9,764,400 (₹97,644.00) |
| Discount total | 220,000 (₹2,200.00) |

**B. Separate stone:** HSN 7113, net 5.000 g gold ₹6,000 per g, labour 0, stone weight 0.300 g, stone amount ₹12,500: metal amount 3,000,000, stone 1,250,000, amount 4,250,000, CGST and SGST 63,750 each, total 4,377,500, round-off 0, payable 4,377,500 (₹43,775.00).

**C. Combined:** weight 6.000 g, total ₹50,000: amount 5,000,000, display rate 833,333 paise per gram (₹8,333.33), CGST and SGST 75,000 each, total 5,150,000, payable 5,150,000 (₹51,500.00).

**D. Percent total discount:** one line of 6,500,000 with a 5% total discount: discount 325,000, taxable 6,175,000.

**E. Rules and errors:**
- Gold discount fixed above the gold base, labour discount on a base of 0, a total discount above the remaining total, percent 100.01%, a negative value, and a fractional paise value are each rejected with a message naming the target.
- Shares always sum to the discount (property test over 200 generated cases) and no taxable amount is ever negative.
- A `combined` line ignores sent rates, a `separate` line requires a stone amount (0 is allowed), a `weight` line sent with stone fields ignores them.
- Inputs without the new fields reproduce every example in specs 012 and 012b unchanged (the old test tables still pass without edits).

**F. API and screens:** saving an invoice with discounts and a stone line returns and stores the figures, reading it returns the stored values, an edit adding a discount keeps revision 1 readable, and the calculator, the form and the invoice page agree to the paisa. Browser (`e2e/discounts.mjs`): choose each pricing mode, apply the three discounts and see example A's totals, and phone view hides the editing.

## 7. Out of scope
Discount approval limits, discount reasons, per-line discounts typed on the line, stone inventory, stone rate per carat, GST at a different rate for stones.

## 8. Defaults used
Q68: GST on the discounted amount, a total discount shared in proportion across lines, no negative discount, no approval limit. Q69: separate stone amount typed as a fixed amount, stone weight is informational and part of gross, stones taxed at the line's rate, combined mode is a single typed total.

## 9. Acceptance checklist
- [ ] R1 to R9 implemented and tested, old calc tests unchanged and green
- [ ] Migration applied locally and by CI
- [ ] Browser test matches example A, B and C to the paisa
