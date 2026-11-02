# 021: Stock movements and automatic stock reduction on invoices

Status: Built (Wave 2) on branch `spec-020-021-inventory`, owner review pending. Defaults for Q160 to Q164 are in section 8 (`docs/open-questions.md` section V). Built with the defaults; tests in `apps/api/test/stockMovements.test.ts` and `e2e/stockMovements.mjs`.
Depends on: 013 (invoice lines carry a nullable `inventory_item_id`), 020 (individual items and their history), 020b (bulk items and movements), 004 (permissions), 015 and 019d (the checks that already refuse a void or an edit)
Next: 021b (locations and transfers; bulk items get locations then)

## 1. Goal
When an invoice is saved, the stock it sells leaves the stock list by itself, and the owner does not type the same item twice. An invoice line may point at one individual item (its U No.) or at a bulk item with a quantity. Saving moves the item to `sold` or takes the quantity out. Editing changes only what was changed. Voiding gives the stock back. Every move is kept in the item history or the bulk movements, and nothing is counted twice. Invoice calculations, rounding, the print layout and reprints do not change.

## 2. Rules

**Lines and links**
- S1. A line links at most one stock item: one individual item (its U No.) or one bulk item with a quantity of 1 or more. A line with no link moves no stock. A line never links both.
- S2. The request carries, on a line, optionally `stockUNo` (the U No., any case) or `bulkItemId` with `bulkQuantity`. The server finds the live item (not voided) with that U No. An unknown U No. is 400 on that line (`lines.N.stockUNo`).
- S3. One individual item can be on one line of one revision (a second line with it is 400). A bulk item may be on several lines; their quantities add up.
- S4. Pending sales (spec 019c, rate fixed later) take no stock links in this spec.

**Save (new invoice)**
- S5. An individual item on a new invoice must be `in_stock` and not voided. If not, the save is refused with 409 `item_not_in_stock` and the line number. Nothing is stored and no invoice number is used.
- S6. Each individual item moves `in_stock` to `sold` in the same batch as the invoice, with one `inventory_item_history` row, reason "Sold on invoice <invoice number>".
- S7. Each bulk line writes one `sold` movement of its quantity, reason "Invoice <invoice number>". A quantity above what is in stock is refused with 409 `insufficient_quantity` and the line number (nothing stored, no number used).

**Edit (new revision)**
- S8. The edit compares the links of the current revision with the new one, and only the difference moves stock (Q164):
  - an item taken off the invoice goes back to `in_stock`, reason "Invoice <number> changed to revision <n>: item taken off";
  - an item added goes to `sold`, reason "Sold on invoice <invoice number>";
  - an item kept must still be sold on this invoice (its last history row says "Sold on invoice <number>"). If it is not (for example the owner moved it to Returned), the edit is refused with 409 `item_not_in_stock` and the line number;
  - bulk: for each bulk item whose total quantity on the invoice changed, one `adjusted` movement for the difference, reason "Invoice <number> changed to revision <n>". A rise above what is in stock is refused (409 `insufficient_quantity`).
- S9. An item taken off the invoice that is no longer sold on this invoice is left as it is (its status is not changed back). The removal is not refused.
- S10. An edit that changes no link moves no stock.

**Void**
- S11. Voiding gives stock back. Each individual item still sold on this invoice goes to `in_stock`, reason "Invoice <number> voided". An item no longer sold on this invoice is left alone (Q163). Each bulk line gives its quantity back with an `adjusted` movement of `+quantity`, reason "Invoice <number> voided".
- S12. Voiding keeps every refusal it has now (credit notes, payments, a pending rate). No new refusal is added to void.

**Safety in the database**
- S13. A trigger on `invoice_lines` (before insert) refuses an individual item that is not `in_stock` or is voided. The one exception is an item that is still sold on this same invoice (a kept line in a new revision). A trigger refuses a line that links both kinds, or a bulk link without a quantity of 1 or more. A partial unique index refuses one item twice on one revision.
- S14. The existing bulk trigger (020b B5) refuses a bulk movement that takes the quantity below zero. No other write path can do it either.
- S15. Stock changes, the invoice change and its audit row are in one D1 batch. Statements are ordered so that the line triggers see the state before the item moves (the lines are inserted first, then the items move to `sold`).

**Who can do what**
- S16. No new permission. Saving and voiding keep `invoices.create`, `invoices.edit` and `invoices.void` (owner, manager and staff for create; owner and manager for edit and void, as now). The stock change happens inside those actions. Item and bulk screens stay on `inventory.view` and `inventory.edit`.

**Not changed**
- S17. Invoice calculation, rounding, the invoice first page, the print layout, reprints (spec 014 R1: a reprint makes no transaction) and the calculator screen do not change.
- S18. A saved line keeps its links. Reading an invoice, reprinting it and fixing a rate never change stock.

## 3. Data and API

**Data**: migration `0026_stock_movements.sql` (new columns and triggers only, no existing row changes)
- `invoice_lines`: add `bulk_item_id` (text, nullable) and `bulk_quantity` (integer, nullable). `inventory_item_id` (spec 013) is now filled.
- Trigger `invoice_lines_stock_guard` (BEFORE INSERT): aborts with `item_not_in_stock` unless the item is `in_stock` and not voided, or it is sold, not voided, and its last history row says "Sold on invoice <this invoice's number>".
- Trigger `invoice_lines_stock_shape` (BEFORE INSERT): aborts with `invalid_stock_link` when both links are set, or the bulk link has no quantity of 1 or more, or a quantity is set without a bulk item.
- Partial unique index `invoice_lines_item_rev_unique` on `(invoice_id, revision_no, inventory_item_id)` where `inventory_item_id` is not null.
- No change to `inventory_items`, `inventory_item_history`, `bulk_items` or `bulk_item_movements`. Their rules (020 I13, 020b B4) are used as they are.

**API** (existing routes, all under `/api/invoices`)
- `POST /` and `PUT /:id`: each line accepts `stockUNo` (text or null), `bulkItemId` (uuid or null) and `bulkQuantity` (integer or null). Missing means no link. The pending route (`POST /pending`) does not accept them.
- Every line in the responses (`GET /:id`, `GET /:id?revision=N`, the save responses) carries `stockUNo` (the U No. or null), `bulkItemId`, `bulkItemName`, `bulkUnit` and `bulkQuantity` (null when no bulk link). Read from the stored columns, joined to the item names.
- Refusals: 409 `item_not_in_stock` and 409 `insufficient_quantity`, each with `lineNo` (the 1-based line of the request) and a `message`. A bad U No. or bulk item is 400 `validation` on `lines.N.stockUNo` or `lines.N.bulkItemId`.

## 4. Screens
- **New and edit invoice, line editor** (PC): a "Stock" cell on each line, clearly optional: a choice "No stock" (default), "U No.", "Bulk item". "U No." shows a text box (for example RING01). "Bulk item" shows a list of bulk items and a "Qty" box. An error from the server shows on that line, next to the Remove button, for example "RING01 is Sold, so it cannot go on this invoice". The calculator screen does not show this cell.
- **Invoice page** (read only, PC and phone): a "Stock on this invoice" list under the lines: each U No. with its line number, and each bulk item with its quantity and unit. Nothing else changes on the page. Print is unchanged.
- A sale whose rate is fixed later (spec 019c) has no Stock cells. If a row still carries a stock choice when that mode is picked, the save is refused with a message to switch back and clear it (S4).
- No sideways page scroll at 390 px.

## 5. Edge cases
- Two invoices at once for the same item: the first save takes it, the second is refused by the database guard and the screen shows it on the line. Nothing is stored for the second.
- A U No. typed in lower case is found (it is upper-cased).
- The same item typed on two lines of one invoice: refused on the form before saving (S3).
- A bulk item on two lines: the quantities add up and are checked together.
- An item sold on an invoice, then the owner moves it to Returned (spec 020 status change). The invoice still shows it. Editing that invoice and keeping the item is refused (S8). Voiding it leaves the item as Returned (S11). Taking it off the invoice in an edit is allowed (S9).
- An edit that changes only the weight of a linked line: no stock change; the item stays sold.
- A void after a later edit: the stock given back is the stock on the current revision.
- Failed saves (refused line, stock short, database refusal) store nothing, write no history row, no movement and no audit row, and use no number.
- Reprints and reading an invoice write nothing to stock.

## 6. Test cases
- `apps/api/test/stockMovements.test.ts`:
  - save reduces an item from `in_stock` to `sold`, with one history row "Sold on invoice INV/..." and the audit row;
  - a second invoice with the same item is refused with 409 `item_not_in_stock` and the line number; no number is used and nothing is stored;
  - a sale of an item that is `sold`, `reserved`, `on_memo`, `returned`, `written_off` or voided is refused (one table test per status);
  - a bulk sale takes the quantity out (one `sold` movement, reason "Invoice ..."); more than in stock is 409 `insufficient_quantity`, nothing stored;
  - void gives an item back (`in_stock`, history "Invoice ... voided") and a bulk line back (`adjusted` +quantity); a void after the item moved to Returned leaves it Returned;
  - an edit that keeps an item and changes its weight writes no stock row (no double count); an edit that adds an item marks it sold once; an edit that removes a line returns its item once (history reason names the revision);
  - a bulk edit from 3 to 5 takes two more out; from 5 to 3 gives two back; changing the bulk item moves one to the other;
  - an edit that keeps an item no longer sold on the invoice is 409;
  - a line with both links, a bulk link with quantity 0, an unknown U No., and the same item twice on one revision are refused (400, or the database guard in a direct insert);
  - the triggers refuse a direct insert of a line with a sold item, from another invoice;
  - a failed save writes nothing (no invoice, no lines, no history, no movement, no audit row) and consumes no invoice number;
  - audit rows are written in the same batch for save, edit and void;
  - staff with `invoices.create` can save with a link; a viewer cannot save (403); the permission matrix is unchanged;
  - calculation and totals are unchanged by a link (the same bill with and without a link has the same payable amount).
- Browser `e2e/stockMovements.mjs`: create an item through the API, make an invoice that uses it on the form, see the item sold on the item page with its history, see the invoice page list the stock, void the invoice, see the item back in stock. A second invoice for the same item shows the message on the line.
- Regression: `e2e/invoices.mjs` and the vitest files listed in the build notes still pass.

## 7. Out of scope
Locations and transfers (021b). Purchases that add stock (022). Credit notes that put returned goods back in stock automatically (Q162: a status change with a reason, spec 020). Stock counts (025). Stock in the invoice print. Pending sales with stock links. Offline stock (041). Stock value and cost.

## 8. Defaults used (owner may change later)
- Q160 (sale of an item not in stock): refused. Only an individual item that is `in_stock` and not voided can go on an invoice; a bulk line needs enough quantity. The refusal names the line.
- Q161 (bulk stock pool): a bulk sale takes from the one quantity of the bulk item until 021b adds locations.
- Q162 (returns): a return credit note (spec 019d) does not put goods back in stock. The owner changes the item with the spec 020 status change and a reason ("Returned from invoice ..."), so the history shows who and why.
- Q163 (void): voiding gives back what the invoice still holds. An item the owner has since moved on (returned, or sold on another invoice) is not touched by the void.
- Q164 (edit): only the difference moves stock. A kept item does not move; a removed item goes back; an added item is sold; bulk moves by the change in quantity.

## 9. Acceptance checklist
- [ ] Owner approves the defaults in section 8 (Q160 to Q164)
- [x] S1 to S18 implemented and tested in `apps/api/test/stockMovements.test.ts` (29 tests)
- [x] Browser test `e2e/stockMovements.mjs` added to `run-all` (after `bulkItems`) and green (18 checks)
- [x] `e2e/invoices.mjs` (25 checks), `calculator.mjs` and `pendingRate.mjs` still pass; invoice print unchanged (`InvoicePrint.tsx` not touched)

Status line: built on branch `spec-020-021-inventory`, owner review pending.
