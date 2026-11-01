# 014: Printing (invoice and settlement, payment and old gold receipts)

Status: Built 2026-11-02 on branch `spec-014-print` (PR to `main`, stacked on the unmerged spec 019 PR #21). Waiting for the owner's Brother print check (open-questions C3) and approval.
Depends on: 003, 013, 015, 016, 017, 018 (build it after them)
Open questions used with defaults: Q63 (portrait, DONE), Q64 (no HUID), Q77 (copies)
Reference: `docs/reference-formats.md` and the four PDFs in `docs/reference/`. The printed result must look like them and print the same figures.

## 1. Goal
Print the owner's existing document designs from the saved data on a Brother DCP-T830DW: the tax invoice on A4 portrait with the settlement page on the reverse of the same sheet (automatic duplex), and the payment receipt and old gold receipt as A5 landscape designs printed on A4 paper to cut or tear. Reprinting changes nothing.

## 2. Rules

**General**
- R1. Printing is read-only. Print views are web pages at `#/print/invoice/:id`, `#/print/payment/:id`, `#/print/old-gold/:id` that show only the document (no app chrome), a toolbar that is hidden when printing (Print, copies, back), and call `window.print()` on request. Opening or printing a document never writes business data. The Print button may write one audit row (`invoice_print` with the copy label), nothing else (CLAUDE.md rule 6).
- R2. Everything printed comes from stored data: the document's own saved figures and its `header_json` snapshot (spec 003 R5), its stored customer copy and settings texts at issue time. Never from a fresh calculation or the current settings (CLAUDE.md rule 5).
- R3. **Look:** the design of the reference PDFs: monogram or logo, `BABA JEWELLERS`-style name from the settings, tagline, cream background with a faint diamond watermark, burgundy table headers, gold rules, dark total box. Fonts **Cormorant Garamond** (headings) and **Montserrat** (text) bundled with the app (`@fontsource` packages, so printing works offline). Colours as CSS variables in one print stylesheet. UI controls and internal fields never print.
- R4. Internal fields never print: gold rate and labour rate separately, discount shares, polish percentage, order of calculation. Printed are the display rate and the figures of the reference (invoice: Rate and Amount per line, GST summary, round-off, total).
- R5. Amounts: `₹ 2,00,313.30` Indian grouping, weights `12.02` (at least 2, at most 3 decimals, trimmed: `9.80`, `12.345`), polish weight as `1.202 g`. Dates `01 November 2026`. `amountInWords` from spec 015 R13.
- R6. Page set-up with CSS `@page`: invoice and settlement `A4 portrait`, margin 0, each document page is one `210mm x 297mm` block with `break-after: page`. Receipts: an `A5 landscape` block (`210mm x 148.5mm`) placed at the top of an `A4 portrait` sheet, with a dashed cut line under it. A "Print two copies on one sheet" option repeats it in the bottom half.
- R7. Duplex: the invoice is page 1 (front) and the settlement is page 2 (back) of one sheet, for long-edge flip, so the back is upright. If the invoice has more lines than fit on one page (14 lines per page), continuation pages are inserted so the settlement is still the back of the last sheet: a blank back page follows every earlier continuation sheet. The Print dialog hint tells the owner to choose A4, two-sided, long-edge.
- R8. **Copies:** a selector `Shop copy`, `Customer copy` or `Both` (labels from settings `texts.copyLabels`). `Both` prints two sheets (two fronts and two backs, in order shop front, shop back, customer front, customer back). The copy label shows top right as in the sample.

**Invoice, page 1** (as `tax-invoice-and-settlement.pdf` page 1)
- R9. Header: logo, legal name, tagline, copy label, `Tax Invoice`, `GST REGISTERED INVOICE`, `PAGE n`. Under it the number block: `INVOICE NUMBER` (the stored printed number) and `INVOICE DATE`. Business address, phones, email and GSTIN print under the header only when present (the sample header has none: print them in a small line, never blank labels). Revised invoices print a small `Revised (version n)` mark; voided ones print a large `VOID` stamp.
- R10. **Billed to** box: customer name, address line (the sample prints `INDIA` when there is none), mobile, PAN, and `Aadhaar / ID ref` only when the customer has one (printed masked to the last four digits). Tag `RETAIL BUYER / CONSUMER`.
- R11. **Item table:** `#`, Description (item name, then the metal line `Gold` or `Silver` derived from purity, `Job work` for HSN 9988, no HUID label), HSN/SAC, Purity (`22K916`), Gross Wt., Nett Wt., Wast./Pol. (the polish weight in grams), Rate (display rate per gram, `₹ 15,150.00/g`), Amount (the line amount, for `separate` stones the total with a `incl. stone ₹...` sub-line, for `combined` the typed total).
- R12. **Left block:** `Invoice note & tax structure` text from settings, and the `Amount in words` box (of the payable amount).
- R13. **GST summary:** `Total value` and `Less: discount` rows only when a discount exists, then `Taxable Goods Value (3%)` per rate group, `CGST @ 1.5%`, `SGST @ 1.5%` (or `IGST @ 3%`), signed `Round Off` (`+ ₹ 0.30`), and the dark box `TOTAL INVOICE VALUE` with `ALL TAXES INC.`.
- R14. Strip: `Settlement details are printed on the reverse side. Quote Invoice No. {number} for all future payments.`
- R15. **Footer:** `Bank / payment details` (account name, bank name, A/C no., IFSC, UPI ID, only those filled in), `Terms & conditions` (numbered lines from settings), the computer-generated line and `AUTHORISED SIGNATORY`.
- R16. The values in the reference sample must come out exactly (spec 012b example A): taxable ₹2,00,313.30, CGST and SGST ₹3,004.70, round-off + ₹0.30, total ₹2,06,323.00.

**Settlement page, page 2** (as the sample's page 2)
- R17. Header `Settlement & Payment Record`, `REVERSE SIDE · LINKED TO THE TAX INVOICE`, and Invoice No., Invoice Date, Customer, page number. The table `Advance Payments` (`RECEIVED BEFORE / AGAINST SALE`): Date, Mode, Reference / Transaction No., Type, Amount, with `Total Advance Payments`. `Advance reference`, the settlement note box (fixed text + automatic note + remarks, spec 017), and the totals box `Invoice Value`, `Less: Advance Received`, dark `Balance Due`. Data from `GET /api/invoices/:id/settlement` at the moment of printing.

**Payment receipt, A5** (as `payment-receipt-a5-*.pdf`)
- R18. Title `Payment Receipt` / `PAYMENT ACKNOWLEDGEMENT`, `RECEIPT NUMBER`, `RECEIPT DATE`, `Received from (customer details)`, table `Particular | Payment Mode (with its reference, e.g. Txn: DKJSDF) | Against Order | Amount` (the order column shows the order number or the invoice number or `-`), `Total amount received`, `Amount in words`, `Payment type` (`Advance Payment`, `Payment Against Invoice`, `Later Payment`), `Advance summary` (from the stored `advance_summary_json`), `Remarks`, the footer line from settings. An at-sale payment has no receipt of its own and prints no receipt (it shows on the settlement page).

**Old gold receipt, A5** (as `old-gold-purchase-receipt-a5.pdf`)
- R19. Title `Old Gold Purchase`, `PURCHASE RECEIPT NO.`, date, `SETTLEMENT TREATMENT`, `Received from (customer details)` with the customer reference (`C0001`), the table with Gross, Less, Net, Purity (%), Rate (₹/gm), Amount, then settlement method, order/advance reference, payment status, `Amount summary` (original amount, round-off, final amount), amount in words, settlement note, the slogan line from settings.

## 3. Data
No new tables. A shared `PrintPage` React layer, document components in `apps/web/src/print/`, a print stylesheet, `formatWeightPrint` and metal-from-purity helpers in `packages/shared`. API: `POST /api/invoices/:id/print-event` (audit only). `@fontsource/cormorant-garamond` and `@fontsource/montserrat` as dependencies.

## 4. Screens
The Print buttons (invoice page, payment page, old gold page) open the print view with the preview on screen and a toolbar: copies, "Print", and a one-line instruction ("A4, two-sided, long-edge flip, scale 100%, margins none"). Disabled when the user lacks `invoices.print` (or the module's view permission for receipts).

## 5. Edge cases
- 15 to 28 lines: two front pages and the settlement as the back of the second. More than 14 lines never shrinks the type.
- Very long customer or item text wraps inside its box and never overlaps.
- A voided invoice prints with the VOID stamp and keeps its numbers.
- A customer without PAN or mobile: the labels are omitted, no empty boxes.
- An old invoice created before spec 003 has no `header_json`: print uses the current settings.
- Empty business details print without blank lines and the print view shows the "Business details are not filled in" warning (not printed).

## 6. Test cases
Printing is tested three ways:
1. **Content tests** (vitest, jsdom or direct render): the document components given the stored data of the reference documents render the exact strings of the PDFs (invoice number, `2,00,313.30`, `3,004.70`, `+ ₹ 0.30`, `2,06,323.00`, `Rupees Two Lakh Six Thousand Three Hundred Twenty Three Only.`, settlement `1,89,323.00`, old gold `2,55,962.27`, `- ₹ 0.27`, `2,55,962.00`, payment `14,500.00`), `formatWeightPrint` table (`12020 -> 12.02`, `9800 -> 9.80`, `12345 -> 12.345`, `1202 -> 1.202`), metal derivation, 15 and 28 lines pagination, blank back pages, copy order, VOID stamp, omitted empty fields, internal rates absent from the HTML.
2. **PDF checks in the browser test** (`e2e/print.mjs`): load each print route in Chrome, make `page.pdf({ preferCSSPageSize: true })`, assert page count (invoice 2, invoice with 20 lines 4, receipt 1, old gold 1), the page size (595 x 842 points for A4 portrait, the receipt block 595 x 421 on an A4 sheet), and use `pdftotext -layout` to assert the key strings above. Save the PDFs under `e2e/screenshots/` for the owner to inspect.
3. **Read-only proof:** printing and reprinting leave every business table's row count unchanged (only an audit row for the print event), and the print route works for an invoice of every status.
- Also: the print toolbar and every `.no-print` element have `display: none` in print media (assert via `emulateMedia({ media: 'print' })`), fonts load from the app (no network request to another host), and the page has no horizontal overflow on the screen preview at 390 px.
- Real-printer check on the Brother (owner): listed in `docs/open-questions.md` as a manual step, since duplex alignment cannot be proven in software.

## 7. Out of scope
PDF download or emailing, WhatsApp sharing, bulk printing, label printing, GST reports (Wave 2), credit note layout (019d), the second-page header for continuation sheets beyond a `PAGE n` mark.

## 8. Defaults used
Q64: no `HUID` label. Q77: shop copy and customer copy with a selector. Print settings advice (A4, duplex long-edge, 100%) is only text.

## 9. Acceptance checklist
- [x] R1 to R19 implemented, all three kinds of test pass. Not built, with reasons: R9 Aadhaar line (invoices do not store Aadhaar), R13 discount rows and R11 stone sub-lines (spec 012c), the order column of R18 (receipts do not carry the order number yet), the "Business details are not filled in" warning in section 5. See open-questions J, D-g.
- [x] The reference documents reproduce exactly (strings and figures): invoice ₹2,06,323.00 with taxable 2,00,313.30, CGST and SGST 3,004.70, round-off + ₹0.30, the amount in words, settlement balance 1,89,323.00; old gold 2,55,962.27, round-off - ₹0.27, final 2,55,962.00. Checked in `e2e/print.mjs` and `apps/web/src/print/InvoicePrint.test.ts`. The payment receipt example (14,500.00) is not checked yet.
- [ ] PDFs saved for the owner to compare against the originals (`e2e/screenshots/print-*.pdf`, git-ignored, made by `npm run e2e`) and to print on the Brother (open-questions C3)
- [x] Browser tests and earlier tests green: 505 unit and API tests, all browser scripts including `e2e/print.mjs`
