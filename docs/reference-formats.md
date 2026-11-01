# Reference formats (the existing system's printed documents)

Source: four PDFs the owner shared on 2026-11-01, copied to `docs/reference/`. They are the output of the owner's current HTML billing system, filled with test data (customer "SATYAM", mobile and PAN "123", account name "ABC JEWELLER"). Nothing real is in them. They are the reference for specs 014 (invoice print), 015 (payment receipt), 017 (settlement page) and 018 (old gold receipt). The owner's instruction is to preserve these calculations and layouts.

| File | What it is | Page |
|------|------------|------|
| `tax-invoice-and-settlement.pdf` | GST tax invoice (page 1) and settlement page (page 2, reverse side) | A4 **portrait**, 2 pages |
| `old-gold-purchase-receipt-a5.pdf` | Old gold purchase receipt OGP-0001 | A5 landscape |
| `payment-receipt-a5-upi-advance.pdf` | Payment receipt PAY-0001, advance by UPI | A5 landscape |
| `payment-receipt-a5-old-gold-advance.pdf` | Payment receipt PAY-0002, advance created from old gold | A5 landscape |

**Look and feel** (same on all four): shop name "BABA JEWELLERS" with a "BJ" monogram in a diamond (a small grey JPEG inside the PDF, 1015 x 249, so a proper logo file is still wanted), the line "FINE GOLD · CRAFTED JEWELLERY", serif headings (Cormorant Garamond) and sans-serif text (Montserrat), both free fonts. Colours: burgundy-black table headers and total box, gold accent lines, cream background with a faint diamond watermark. Every document has "computer-generated" footer text and an "AUTHORISED SIGNATORY" line.

## 1. Tax invoice, page 1
- Top right: copy label (`SHOP COPY`; presumably also a customer copy), title "Tax Invoice", "GST REGISTERED INVOICE", "PAGE 1".
- **Invoice number `INV-0001`** and **date `01 November 2026`**.
- "Billed to (customer details)" box: name, a country line (`INDIA`), contact/mobile, PAN number, Aadhaar / ID ref. A tag "RETAIL BUYER / CONSUMER".
- Item table: `#`, Description, HSN/SAC, Purity, Gross Wt., Nett Wt., Wast./Pol., Rate, Amount. Description has the item name (`Ring`), a `HUID` label (blank) and the metal (`Gold`). Wast./Pol. is printed as a weight (`1.202 g`). Rate is printed per gram (`₹ 15,150.00/g`).
- Left: "Invoice note & tax structure" text and "Amount in words" box.
- Right: "GST invoice summary": Taxable Goods Value (3%), CGST @ 1.5%, SGST @ 1.5%, signed Round Off (`+ ₹ 0.30`), and a large dark box "Total invoice value, all taxes inc.".
- Strip: "Settlement details are printed on the reverse side. Quote Invoice No. INV-0001 for all future payments."
- Bottom: Bank / payment details (account name, bank name, A/C no., IFSC, UPI ID), Terms & conditions (3 lines), "This is a computer-generated tax invoice", Authorised signatory.

## 2. Settlement page, page 2 (reverse side)
- Header: "Settlement & Payment Record", "Reverse side, linked to the tax invoice", and Invoice No., Invoice Date, Customer, page number.
- Table "Advance Payments (received before / against sale)": Date, Mode, Reference / Transaction no., Type, Amount. Sample rows: UPI PAY-0001 ₹14,500.00, and Old Gold PAY-0002 ₹2,500.00. Total Advance Payments.
- "Advance reference" strip: `PAY-0001, PAY-0002`.
- "Settlement note": fixed text plus an automatic line ("Old Gold advance adjustment: PAY-0001 ₹14,500.00, PAY-0002 ₹2,500.00 (Source: OGP-0001). Remaining balance in PAY-0002: ₹253,462.00.").
- Totals: Invoice Value, Less: Advance Received, **Balance Due** in a dark box.

## 3. Payment receipt (A5 landscape)
- Receipt number `PAY-0001`, receipt date, "Received from" box (same customer fields).
- Table: Particular (`Payment Received`), Payment mode with its reference (`UPI`, `Txn: DKJSDF`), **Against Order** (`ORD-0001`), Amount. A tag "ADVANCE RECEIPT".
- Total amount received (large), amount in words.
- Payment type (`Advance Payment`), Advance summary: Previous Advance Remaining, This Receipt Remaining, Total Available for Order.
- Remarks. Footer: "Receipt acknowledges money received; it is not a tax invoice."
- **`Old Gold` is a payment mode** (PAY-0002: mode `Old Gold`, reference `OGP-0001`): an old gold purchase that is moved to customer advance creates a payment receipt this way.

## 4. Old gold purchase receipt (A5 landscape)
- Receipt no. `OGP-0001`, date, **Settlement treatment** (`Transfer to Customer Advance`).
- "Received from" box: name, country line, contact, PAN, **Customer ref. `C0001`**, Aadhaar / ID ref. Tag "OLD GOLD SELLER".
- Table: S.No., Description (`Old Gold`), **Gross Wt (gm) 25.00, Less (gm) 2.02, Net Wt (gm) 22.98, Purity (%) 75.26, Rate (₹/gm) 14800.00, Amount 2,55,962.27**.
- Settlement method (`Ledger Adjustment`), Order / Advance reference (`ORD-0001`), Payment status (`Advance Created`).
- Amount summary: Original Amount ₹2,55,962.27, Round Off −₹0.27, **Final Amount ₹2,55,962.00**. Amount in words, settlement note, footer line "OLD GOLD TODAY, A BRIGHTER TOMORROW".

## 5. Number formats and references seen
| Thing | Format in the samples | Plan so far | Action |
|-------|----------------------|-------------|--------|
| Invoice | `INV-0001` | `INV/2026-27/0001` | Change to the sample format, see Q61 |
| Payment receipt | `PAY-0001` | `PR/2026-27/0001` | Change to `PAY-0001` |
| Old gold receipt | `OGP-0001` | `OG/2026-27/0001` | Change to `OGP-0001` |
| Order | `ORD-0001` | not planned | New: an order reference for advances (spec 016) |
| Customer reference | `C0001` | `C-0001` (live) | Change to `C0001` (display only), see Q62 |

The owner says each sequence resets every 1 April. With no year in the number, `INV-0001` repeats every financial year. That is legal (the number must be unique within a financial year), but search results and references must carry the year when they could be mixed up (Q61).

## 6. Worked examples taken from the samples (verified)
**Invoice (HSN 7113, gold 22K916, 3% GST, same state):** gross 12.020 g, net 12.020 g, polish 10% = 1.202 g (the Wast./Pol. column), chargeable 13.222 g, rate ₹15,150.00 per gram (combined, labour 0), amount 13.222 x 15,150 = **₹2,00,313.30**. CGST 1.5% = 3,004.6995 -> **₹3,004.70**, SGST **₹3,004.70**, total 2,06,322.70, round-off **+₹0.30**, total **₹2,06,323.00**. The existing engine gives exactly this.

**Settlement:** invoice ₹2,06,323.00, advance received ₹14,500 (PAY-0001, UPI) + ₹2,500 (PAY-0002, taken from the old gold advance), total ₹17,000, balance due **₹1,89,323.00**. PAY-0002 was ₹2,55,962.00, so ₹2,53,462.00 stays available (only the amount used is deducted).

**Old gold:** net 22.98 g x purity 75.26% x ₹14,800 per gram = 25,596,227 paise = **₹2,55,962.27**, round-off −₹0.27, final **₹2,55,962.00**. Purity is typed as a percentage on each receipt (75.26 here) and the rate is typed per receipt. "Less" is a weight deduction typed on the receipt (gross 25.00 - 2.02 = net 22.98). The amount formula itself has no other deduction, as the owner said.

## 7. Differences from what was assumed earlier
1. Invoice page is **A4 portrait** in the sample, but the owner's answers say A4 landscape. Which one (Q63)?
2. Numbers have no financial-year part (section 5).
3. Old gold has a **Less (gm)** column and a typed **purity percentage**, not a fixed list.
4. **Order references (`ORD-`)** exist, and advances are tied to an order.
5. The invoice prints one combined **Rate** and a **Wast./Pol.** weight. Gold rate and labour rate stay internal (as the owner said), the printed rate is the display rate.
6. The invoice has a `HUID` label, but the owner says HUID printing is not required (Q64).
7. The tax note on the invoice says "HSN 7113 / 7114". The owner says only 7113 and 9988 are needed.
8. Terms differ from the paper bill's terms (the sample has "Quote invoice number...", "Certified 100% hallmarked...", "Balance amount is payable as per the agreed arrangement"). The text must be editable in Settings.
9. Copy label (`SHOP COPY`) suggests printing a shop copy and a customer copy.
