# The showroom's second feedback list (25 November 2026)

Fifteen points from the showroom, checked against the live system and this repository, then built and tested. Nothing in this list was in the specs before; where a spec said the opposite, the spec was changed (see "Specs changed"). The questions that remain are in `docs/open-questions.md` section AB (Q210 to Q217), each with the default that was built.

## The 15 points

| # | Point (as received) | Before | Now | Where | Tested by |
|---|---|---|---|---|---|
| 1 | 24K to 22K rate calculation automatic | 22K typed by hand | Typing the 24K rate fills 22K = 24K x 916 / 995 (editable, saved as a normal rate) | `packages/shared/src/rates.ts`, `apps/web/src/rates/RatesPage.tsx` | `rates.test.ts`, browser |
| 2 | Old gold turned into an advance gets a payment receipt, other cases do not | A PAY- receipt was made for every old gold settlement that moved money (also invoice adjustments) | Only the advance part makes a PAY- receipt | `apps/api/src/oldgold/routes.ts`, spec 018 | `oldgold.test.ts`, browser |
| 3 | Several payment modes on one receipt (cash and UPI) | One mode per receipt | Up to 6 modes, one PAY- number, one A5 receipt with a line per mode | migration 0032, `payments/routes.ts`, `ReceiveDialog.tsx`, `PaymentPage.tsx`, `ReceiptPrint.tsx` | `paymentModes.test.ts` (13), browser |
| 4 | HSN automatic | HSN chosen on every line | "Bill type" switch sets HSN and GST for all lines; a line can still differ | `LinesEditor.tsx` | browser |
| 5 | Copy rate, labour and polish of the first item, but they can differ | none | "Copy rate, labour and polish from line 1" for all lines, and "Same as line 1" per line; lines stay editable | `LinesEditor.tsx`, `lines.ts` | browser |
| 6 | Invoice text fields are very small | One-line description, thin boxes | Multi-line description (bill and old gold), bigger address and remarks boxes; line breaks print | `LinesEditor.tsx`, `InvoiceForm.tsx`, `OldGoldPages.tsx` | browser |
| 7 | Labour calculations not correct, including GST | none | Tick box "Labour rates I type include GST": the rate is worked back to the rate without GST (shown under the box). The engine is unchanged. **A best guess: see Q211** | `packages/calc/src/reverse.ts`, `LinesEditor.tsx` | `reverse.test.ts`, browser |
| 8 | Many items on an invoice get cluttered at the bottom | Rows ran into the footer and, from about 11 items, rows and totals were cut off | Rows go on pages by height; the footer follows the content; a page that does not fit gives up a row and is laid out again | `InvoicePrint.tsx`, `print.css`, `packages/shared/src/print.ts` | `print.test.ts`, `InvoicePrint.test.ts`, browser (14 items, real settings) |
| 9 | Add the advance of other customers to this invoice | Only the customer's own advance | "Use another customer's advance" in the settlement (owner only); both ledgers and the settlement note show it; reversible | `settlement/routes.ts`, `ledger/routes.ts`, `SettlementTab.tsx` | `crossCustomerAdvance.test.ts` (8, checked to fail without the fix), browser |
| 10 | Payment and old gold receipts on A5 | Already A5 landscape on A4 | Unchanged; now also correct with many rows or several modes | `ReceiptPrint.tsx` | browser (PDF) |
| 11 | Reverse calculations | none | "Reverse calculation": type the final amount, work out the gold rate, labour rate or net weight of a line | `ReversePanel.tsx`, `packages/calc/src/reverse.ts` | `reverse.test.ts`, browser |
| 12 | More lines in the old gold receipt | At most 10 rows, one A5 block | At most 50; more than about 4 rows continue on the next A5 block ("Sheet 1 of 2"), totals on the last | `oldGold.ts` (calc and shared), `ReceiptPrint.tsx` | `oldGold.test.ts`, `oldgold.test.ts`, browser |
| 13 | After adding old gold in a settlement, open that invoice's settlement page | The old gold receipt page opened | The invoice's settlement page opens again with the receipt one click away; the same after a payment taken there | `OldGoldPages.tsx`, `InvoicePage.tsx`, `SettlementTab.tsx` | browser |
| 14 | Receiving a payment directly shows the outstanding | Not shown | The dialog shows the customer's outstanding (and the number of invoices) as soon as the customer is chosen, and what remains after this receipt | `ReceiveDialog.tsx` | browser |
| 15 | Show previous advance when receiving an advance, and the total | Only on the printed receipt | Also in the dialog: advance already held, this receipt, advance after | `ReceiveDialog.tsx` | browser |

## Specs changed
- 011 R1 (22K filled from 24K), 014 R7 (pages by height, not 14 rows), 015 R1 (several modes), 017 R7 (other customer's advance, return to settlement), 018 R2 and R5 (50 rows; receipt only for an advance).
- Tests changed because the rule they checked changed: `packages/calc/src/oldGold.test.ts` (10 rows became 50) and `apps/web/src/print/InvoicePrint.test.ts` (14 rows per page became "every item once, totals once, nothing lost"). Four browser scripts look for the description box by `[aria-label=...]` instead of `input[aria-label=...]`, because it is a `<textarea>` now.

## Deploy (the owner runs these; nothing was deployed or migrated live)
```
npm run db:migrate:remote -w @jewellery/api    # applies 0032_receipt_modes.sql (adds one nullable column, swaps one index)
npm run deploy
```
Migration 0032 changes no existing row. Receipts made before the deploy keep their numbers and their single mode. To go back, deploy the previous build: the extra column is ignored by it, but a receipt that was saved with two modes would then show as two separate rows with the same number, so do not roll back after taking such a receipt without checking Payments.

## Checked
Typecheck, 1052 unit and API tests (also the payment, cheque and settlement tests on the real workerd D1 with `DB_BACKEND=d1`), the production build, and every browser script, including the new `e2e/satyamFeedback.mjs` that goes through all 15 points. Prints were rendered to PDF and looked at (invoice with 6, 9, 14 and 20 items and a real bank block and terms, a two-mode receipt, a 12-row old gold receipt).
