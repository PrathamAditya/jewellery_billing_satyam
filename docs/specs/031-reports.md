# 031: Reports in Excel and PDF

Status: Built 2026-11-02 on branch `spec-030-031-dashboard-reports` (Wave 2). Automated checks pass; owner review pending. Built with the defaults for Q146 to Q149.
Depends on: 013 (invoices and stored tax), 015 (payments and allocations), 019 (customer balances), 019d (credit applications inside "paid"), 004 (permissions), 030 (shares the balance code)
Open questions used with defaults: Q146 to Q149 (section V of `docs/open-questions.md`). Owner answer [43] (`docs/owner-answers-2026-11-01.md`) and decision D27 are the base. Q50 (which reports the CA asks for each month) is still open; the four reports of this spec are the first list. Credit notes and purchases reports are not in this spec.

## 1. Goal
The owner or the CA downloads the figures for a period as a spreadsheet or a PDF: the sales register with tax, the payments register, what customers owe, and the GST summary by rate. A period is a date range or a financial year (1 April to 31 March). Every file is made from stored rows, so it shows what was saved, not a recalculation.

## 2. Rules
- R1. **Four reports**, one slug each: `sales-register`, `payments-register`, `outstanding`, `gst-summary`. Any other slug is 404.
- R2. **Period.** Either `fy=2026-27` (from 1 April 2026 to 31 March 2027, both inclusive), or `from` and `to` (business dates, inclusive). `to` before `from` is 400 (`The end date is before the start date`). A malformed date or financial year is 400 with a message. The period is by invoice date (sales and GST) and by receipt date (payments). `outstanding` ignores the period (R8).
- R3. **Sales register.** Invoices with rate status fixed, not voided, with an invoice date in the period, sorted by date then invoice number. Columns: invoice number, date, customer (the name stored on the invoice), taxable value, CGST, SGST, IGST, total (the stored payable, after round-off), paid, balance. Paid = live payment allocations plus live credit applications (spec 019d R16). Balance = total less paid, never below 0. CGST, SGST and IGST are the sums of the tax groups stored in the invoice's calculation (spec 013 R6), so they are never recalculated.
- R4. **Totals row** of the sales register: the sums of the money columns and the number of invoices.
- R5. **Payments register.** Every payment dated in the period, sorted by date then creation. Columns: receipt number (`-` for an at-sale payment), date, payer, type (advance, against invoices, at sale, opening advance, old gold), mode, reference, amount, used on bills (live allocations), handed back (live refunds), left as advance, status (Live or Voided). A voided payment stays in the list, marked Voided, with zero in the last three money columns, and is left out of the totals row.
- R6. **Outstanding by customer.** Customers whose outstanding (spec 019 R5 definition, the same code as the dashboard) is above 0, largest first then by name. Columns: customer, mobile, outstanding, advance held. Totals row with the number of customers.
- R7. **GST summary by rate.** The sales of the period (R3 invoices), grouped by the GST rate of each tax group stored on the invoice: taxable value, CGST, SGST, IGST and total GST per rate. Rates sorted ascending and shown as `3%`. The totals row equals the sums of the sales register columns for the same period (tested).
- R8. **Outstanding is the balance on the day the report is made** (today, India time). It does not depend on the period. The sheet and the PDF say `As on <date>`.
- R9. **Pending-rate sales** (spec 019c) are not invoices yet. They are left out of the sales register and the GST summary, and add nothing to outstanding. The notes on the sheet say so.
- R10. **Voided invoices** are left out of the sales register and the GST summary. **Voided payments** are shown as Voided and left out of the totals.
- R11. **Money in the files** is exact: whole paise, shown as rupees with two decimals and Indian grouping (`1,23,456.78`). In Excel the amounts are numbers (so the CA can sum them) with a number format that groups Indian style up to crores. No float is used in any money figure.
- R12. **Read-only.** Downloads write no rows, no audit rows and allocate no numbers.
- R13. **Permission** `reports.view` on `GET /api/reports/:kind`. Owner and manager have it (spec 004 roles). The viewer role has it too, because spec 004 gives viewers every `.view` permission; this is recorded as Q149. Staff do not have it.
- R14. **File name.** `sales-register_2026-04-01_to_2026-11-02.xlsx`, `sales-register_FY2026-27.pdf`, `outstanding_2026-11-02.xlsx`. The response is an attachment with `Cache-Control: no-store`.

## 3. Data and API
- **No table, no migration.** The reports read existing tables (`invoices`, `payments`, `payment_allocations`, `payment_refunds`, `credit_applications`, `customers`) and the stored tax in `invoices.calc_json`.
- `GET /api/reports/:kind?from=&to=&fy=&format=xlsx|pdf` (default xlsx). Query schema: `reportQuerySchema` in `packages/shared/src/reports.ts`.
- Code: `apps/api/src/reports/routes.ts` (request), `data.ts` (the four tables, from SQL), `table.ts` (the table model and the money text), `xlsx.ts` (the Excel writer), `pdf.ts` (the PDF writer).
- Permission map: `GET /api/reports/:kind` maps to `reports.view`.

## 4. Excel and PDF: how the files are made
- **Excel (`.xlsx`): our own small writer, no dependency.** An `.xlsx` is a zip of small XML parts. `xlsx.ts` writes six parts (content types, root and workbook relations, workbook, styles, one sheet), with inline strings and numbers. The zip uses the "stored" method (no compression); every spreadsheet program reads it, and the files are small (a few KB for a month of a shop). The CRC-32 of each part is checked in the tests with Node's zlib. The sheet is named after the report, the title is in row 1, the period in row 2, the header row is frozen, and the totals are bold.
- **PDF: our own small writer, no dependency.** `pdf.ts` writes a PDF 1.4 file with two built-in fonts (Helvetica and Helvetica-Bold). Landscape A4, a title and period on each page, the header repeated on each page, "Page n of N" in the footer, and the totals and notes at the end. Helvetica has no rupee sign, so money is printed without a symbol and the headers say `(Rs)`; characters outside plain ASCII print as `?`. The file was checked with `pdfinfo` and `pdftotext` (poppler).
- Why not a library or a browser print: a library adds weight to the Worker for four tables, and a browser print would not give `GET ...?format=pdf` a file to download.

## 5. Screens
- **Reports** (top bar, shown with `reports.view`): the four reports as a choice, the period as a financial year (a list of the current and five previous years) or a date range (from and to, not after today), and two buttons, Download Excel and Download PDF. The outstanding report says the period does not apply. A bad period is shown in red; a download runs in the browser and the file is saved under its name.
- Phones: the same screen; no sideways scroll at 390 px. The files are for the PC.

## 6. Edge cases
- A period with no invoices: the file still opens, with the title, the period and an empty table with a total of 0.
- An invoice dated 31 March in one year and 1 April in the next: they fall in different financial years.
- A payment received on 1 April for a bill of 31 March: the payment is in the next year's register, the bill in the earlier one.
- An at-sale payment: receipt number `-`, type "At sale".
- A customer name with Hindi or other non-Latin letters: shown in Excel; in the PDF as `?`.
- A bill with a discount or a round-off: the stored taxable value and payable are used; the round-off is not a column.
- A bill with a credit note applied: paid includes the credit; balance falls.

## 7. Test cases
Unit and API (`apps/api/test/reports.test.ts`), with the spec 013 bill (9.800 g silver at ₹285.72 per gram, intra-state): taxable 2,800.06, CGST 42.00, SGST 42.00, payable 2,884.00 (round-off -0.06 is inside the total).
- The Excel file is a zip with the six parts, every CRC matches, the workbook has one sheet named `Sales register`, and the sheet holds `2800.06`, `42.00`, `2884.00` and the date `2 Nov 2026`.
- The number format of the money cells is the Indian three-part format.
- A voided invoice and a pending-rate sale are not in the sales register or the file.
- The payments register lists the voided payment as `Voided`; the totals row is 1,500.00 and not 1,599.00.
- The GST summary totals equal the sales register's taxable, CGST, SGST and IGST totals; one rate row, `3%`.
- The bill row carries 2,800.06 taxable, 2,884.00 total, 1,000.00 paid, 1,884.00 balance.
- Outstanding is "As on 2 Nov 2026" whatever period is asked; the largest balance first.
- The PDF starts with `%PDF-1.4`, ends with `%%EOF`, and every cross-reference offset points at its object. The money has Indian grouping and no rupee sign.
- Requests: unknown report 404; format csv, a period ending before it starts, a financial year like 2026-28, and no period 400; no login 401; owner and manager 200; staff 403; a role without `reports.view` 403.
- Money text: 0, 2,884.00, 1,23,456.78, 1,00,00,000.00 and -0.06.

Browser (`e2e/reports.mjs`): the Reports screen downloads an Excel file for the sales register for the current financial year (name, size, sheet named `Sales register`); the outstanding report in a date range (its sheet name `Outstanding by customer`); a PDF of the payments register (starts with `%PDF-1.4`, ends with `%%EOF`); a range ending before it starts shows the message on screen; no sideways scroll at 390 px.

## 8. Out of scope
Credit notes report, purchases, stock and inventory reports, karigar outstanding, old gold purchase report, GST return files (GSTR-1 JSON), printed customer statements, charts, scheduled or emailed reports, and Excel formulas (the totals are values, computed by the same code that makes the rows). Font embedding for Devanagari or other scripts in the PDF.

## 9. Defaults used (owner may change later)
- Q146: slugs `sales-register`, `payments-register`, `outstanding`, `gst-summary`; periods inclusive; financial year 1 April to 31 March; "Paid" includes credit applications; pending-rate sales and voided invoices are left out of the register and the GST summary.
- Q147: Excel written by our own code (stored zip, no dependency), money as numbers with Indian grouping up to crores.
- Q148: PDF written by our own code, A4 landscape, Helvetica, `(Rs)` in headers, no rupee sign, non-ASCII characters as `?`.
- Q149: `reports.view` for owner and manager (as spec 004 has it); the viewer role keeps it through the `.view` rule of spec 004; staff do not have it. Outstanding is always as on the day made.

## 10. Acceptance checklist
- [x] R1 to R14 implemented in `apps/api/src/reports/`
- [x] `apps/api/test/reports.test.ts` (15 tests)
- [x] Excel and PDF checked outside the code: `zipfile` and XML parsing for each `.xlsx` part, `pdfinfo` and `pdftotext` for the PDF
- [x] Browser test `e2e/reports.mjs` added to `run-all` and passes
- [ ] Owner or CA checks the layout of each report against the paper books (the format is not yet compared with the CA's own spreadsheets)
- [ ] Opened in Microsoft Excel and in the owner's PDF viewer. Not done here: this machine has neither Excel nor LibreOffice. The checks were the zip and XML parsers, and poppler (`pdfinfo`, `pdftotext`).
