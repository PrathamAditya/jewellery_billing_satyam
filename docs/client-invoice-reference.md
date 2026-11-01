# Client invoice reference (M/S Baba Jewellers)

Source: a photo of one of the showroom's current paper invoices (pink triplicate book, invoice no. 2761, dated 3 Feb 2026), shared by the owner on 2026-11-01. The software must be able to produce this invoice, so this is the reference for specs 012 (calculation), 013 (invoice) and 014 (print layout).

**Not recorded here on purpose:** the GSTIN, PAN, phone numbers and the customer's name. Repo rule 10 says never commit them. The GSTIN, PAN, phones and bank details are entered in the app's Settings later (decision O4) and live only in the database.

## 1. Showroom details printed in the header
- Name: M/S. BABA JEWELLERS
- Line under the name: "Specialist :- Gold & Silver Ornaments 100% Guarantee on KDM"
- Address: Popular Complex Shop No. 9, NADAUN, Distt. Hamirpur (H.P.) - 177033
- State: Himachal Pradesh, state code 02
- Printed at the top left: GST No., PAN No., "H.P. State Code 02". Three phone numbers at the top right.

## 2. Layout (what is printed, in order)
- Top: GST number, PAN, state code (left), the title "GST INVOICE" (centre), phone numbers (right).
- Showroom name, specialist line, address.
- "Reverse Charge : Yes/No" (a choice on the paper form).
- INVOICE No. (left) and Dated (right).
- Name/Address of the customer, and the customer's PAN No.
- Item table with columns: Sr. No. | Description of Goods | HSN Code | WEIGHT (gms, mgs) | Wastage Polish | RATE | Taxable Amount 3% (Rs. and P. as separate columns).
- Bottom left block: Total Payment, UPI, Balance, Cash, Balance, Invoice Value (in words), Mode of Payment.
- Bottom right block: Amount Before Tax, (+) SGST @ 1.5 %, (+) CGST @ 1.5 %, (+) IGST @ ....%, Total Amount after Tax, "GST Payable on Reverse Purchase".
- Terms & Conditions (3 lines): 1. Goods once sold are not returnable. 2. All Disputes Subject to NADAUN Jurisdiction only. 3. Interest @ 24% will be Charged if bill is not paid within 7 days. Then "E. & O. E."
- Bottom right: "For M/s. Baba Jewellers" and "Authorised Signatory".
- Amounts are written in rupees and paise in two columns (for example 2800 | 06).

## 3. What it tells us for the build
- **GST scheme (helps O8):** the invoice shows SGST and CGST lines and an IGST line, so it is billed under the regular scheme. Within Himachal Pradesh (state code 02), jewellery at 3% is SGST 1.5% plus CGST 1.5%. The IGST line is for sales to other states. To confirm with the CA: how out-of-state sales are billed (IGST 3%), and that composition is not used.
- **HSN:** 7113 (articles of jewellery) is used for the silver ornament.
- **Rate is per gram with 2 decimals:** `285.72` per gram for silver, which is ₹2,85,720 per kg. This fits spec 011 (typed per gram, stored per kg).
- **Weight is in grams and milligrams:** `9.800` is 9 g 800 mg, which is 9,800 mg.
- **Wastage / Polish column exists but is empty on this invoice** (still open question O2).
- **The taxable amount is weight times rate, rounded to paise.**
- **Round-off:** this invoice kept the paise. The total was 2884.06, the customer paid 2884.00 by UPI and the balance of 0.06 was paid in cash, so the balance became Nil. The new software rounds the final amount to the rupee (requirement 4.7, 50 paise or more rounds up), so this same bill would total 2884.00.
- **Numbering:** the paper book uses a plain running number (2761). Locked decision D11 uses a financial-year series (`INV/2026-27/0001`). The owner may want the running number continued. Ask before spec 013.
- **Print:** the paper form is a single page with the payment split (UPI, cash, balance) printed on the same page. The settlement back page in the requirements is new.

## 4. Worked example (use as a test case in spec 012)

Silver ornament, HSN 7113, net weight 9,800 mg, rate ₹285.72 per gram, GST 3% (1.5% + 1.5%).

| Step | Calculation | Result |
|------|-------------|--------|
| Rate per kg stored | 285.72 per gram x 1000 g x 100 | 28,572,000 paise per kg |
| Amount | 9,800 mg x 28,572,000 / 1,000,000 | 280,005.6 paise, rounded once to **280,006 paise = ₹2,800.06** |
| SGST 1.5% | 2,800.06 x 1.5% = 42.0009 | **₹42.00** |
| CGST 1.5% | 2,800.06 x 1.5% = 42.0009 | **₹42.00** |
| Total after tax | 2,800.06 + 42.00 + 42.00 | **₹2,884.06** |
| Paid | UPI 2,884.00 and cash 0.06 | balance Nil |
| Total with the new round-off rule | 2,884.06, below 50 paise rounds down | ₹2,884.00 |

Open for spec 012: whether tax is computed on the rounded taxable amount (as here) or on the unrounded one, and how the rounded-off paise are shown. This example gives the same answer either way, so it does not decide it.
