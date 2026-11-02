# 025: Monthly stock reconciliation

Status: Built (Wave 3) on branch `spec-025-reconciliation`, owner review pending. The owner has not yet approved the draft: the defaults for Q190 to Q199 are in section 8 (`docs/open-questions.md` section Z). Tests in `apps/api/test/reconciliation.test.ts` and `e2e/reconciliation.mjs`.
Depends on: 020 (individual items and status history), 020b (bulk movements), 021 (invoices reduce stock), 021b (places, transfers and per-place balances), 004 (permissions), 001 (database, audit)
Next: none in Wave 3. Q78 (who approves a count adjustment) is answered by section 8 (Q196) until the owner decides.

## 1. Goal
Once a month, or when the owner wants, the stock at a place is counted by hand and compared with the system. Every difference is recorded with a reason, and the system is corrected by normal stock adjustments, so the stock is right and the differences form a history. A closed reconciliation is never edited; a correction is a new reconciliation.

## 2. Rules

**Opening**
- R1. A reconciliation is for one month (`YYYY-MM`) and one place, or for all active places. Only one open reconciliation may exist for the same month and the same place (or for the same month and all places) at a time (409 `already_open`, naming the open one).
- R2. Opening takes the system stock at that moment and stores it on each line (the opening figure, Q190). Lines are created for:
  - every individual item that is `in_stock`, not voided, and at a place in scope;
  - every bulk item at every place in scope (a line with the opening balance, which may be 0), so that a surplus can be counted too.
- R3. The place must be active (409 `location_inactive`). The hidden system place `Missing` (R12) is never in scope.

**Expected figure and differences**
- R4. The system figure used for the difference is the figure now (Q193): the opening figure plus the movements made since the opening. For an individual item it is 1 when the item is in stock at the line's place, otherwise 0. For a bulk item it is the balance at the line's place. A sale or transfer made during the count is therefore reflected, and does not show as a false shortage.
- R5. The difference of a line is `counted - expected`. For an individual item, counted is 1 (found) or 0 (not found). For a bulk item, counted is the number typed. The report shows the opening figure, the movement since the opening, the expected figure, the counted figure and the difference.
- R6. An individual item may be added to an open reconciliation as an extra line (`added later`) when it is found but not in the list: any item not voided and not written off, at any place. An item already on a line of the same reconciliation cannot be added again (409 `already_on_count`).

**Counting**
- R7. Counting is line by line, while the reconciliation is open. An item line is marked found or not found. A bulk line takes a whole number of 0 or more. Each line may carry a note (up to 300 characters).
- R8. A count may be saved many times. A line not yet counted has no difference. Saving counts on a closed reconciliation is refused (409 `reconciliation_closed`) and writes nothing.

**Closing**
- R9. Closing is final and written in one database batch. It is refused (409 `already_closed`) when it is already closed, and (409 `lines_not_counted`, with the number) when a line is not counted yet. Nothing is written in either case.
- R10. Closing writes one adjustment for each line with a difference (Q191 to Q197):
  - a bulk line with difference `d` writes one `adjusted` movement of `d` at its place, with the reason "Reconciliation <month>: counted C, expected E" (spec 020b, the database trigger refuses a balance below zero);
  - an individual item found but missing from the system (difference +1) gets a status move to `in_stock`, if it is not in stock, with the reason "Reconciliation <month>: found at count" (spec 020 history row), and a transfer to the line's place, if it is somewhere else (spec 021b);
  - an individual item not found (difference -1) is transferred to the place `Missing` (R12) with the reason "Reconciliation <month>: not found at count". Its status does not change.
  - a `written_off` item found is refused (409 `item_not_movable`) and nothing is written.
- R11. Each adjustment writes its audit row in the same batch. The lines keep the expected figure, the difference, the adjustment reference and the reason, and the reconciliation becomes `closed` with `closed_at` and `closed_by` in the same batch. After the close the lines and the reconciliation are never changed (database triggers).
- R12. Items not found are moved to a hidden place `Missing` (id `loc-missing`, seeded by migration 0030). It is hidden from the place lists and the place dropdowns, it cannot be renamed or made inactive, and an item at `Missing` cannot go on an invoice (spec 021 check, Q192). A found piece is brought back with a reconciliation extra line, or with a transfer.

**Who can do what**
- R13. `reconciliation.view`: list, read, the difference report (owner, manager, staff, viewer). `reconciliation.edit`: open, save counts, add an extra line, close (owner and manager, Q196).
- R14. Every route is listed in the permission map (spec 004 R3).

**Data**
- R15. Reconciliations and lines are business records: no delete (database triggers). Lines are inserted and updated only while their reconciliation is open. A reconciliation can only move from `open` to `closed`.

## 3. Data and API

**Data**: migration `0030_stock_reconciliation.sql`
- `stock_locations`: add `hidden` (0 or 1, default 0). Seeds the place `loc-missing` ("Missing", active, hidden). A trigger refuses a rename or an inactive change of a hidden place.
- `invoice_lines_stock_guard` is replaced: an individual item at `loc-missing` cannot be sold (spec 021 S13).
- `stock_reconciliations`: id, standard columns, `month`, `location_id` (null means all active places), `status` (`open` or `closed`), `opened_at`, `opened_by`, `closed_at`, `closed_by`. A unique index on `(month, IFNULL(location_id, '*'))` where open. No delete. An update of a closed one is refused.
- `stock_reconciliation_lines`: id, standard columns, `reconciliation_id`, `line_kind` (`item` or `bulk`), `inventory_item_id`, `bulk_item_id`, `location_id`, `system_status` (items: status at opening), `system_quantity` (opening figure), `added_later`, `counted_status` (`found` or `not_found`, items only), `counted_quantity`, `note`, and at close `expected_quantity`, `difference`, `adjustment_ref`, `adjustment_note`. Unique per reconciliation for an item, and per bulk item and place. Insert and update refused when the reconciliation is closed; no delete.
- Permissions: `reconciliation.view` and `reconciliation.edit` appended to the list in `packages/shared/src/permissions.ts`. The migration adds them to the live roles: owner and manager get both, staff and viewer get view.

**API** (under `/api/inventory/reconciliations`)
- `GET /` (view): list, newest first, optional `month`.
- `POST /` (edit): open `{ id?, month, locationId }`, `locationId` null for all places. Returns 201, or 200 on a replay with the same id and content (other content: 409 `id_conflict`).
- `GET /:id` (view): the header and every line with the expected figure and the difference.
- `GET /:id/report` (view): the header, the counts (lines, counted, not counted, adjustments that close will write, missing, extra), and the lines with a difference.
- `PUT /:id/counts` (edit): `{ lines: [{ id, counted, note? }] }`. `counted` is `found`, `not_found`, or a whole number from 0 for bulk, or null to clear.
- `POST /:id/lines` (edit): add an extra item line `{ id?, inventoryItemId, locationId }`.
- `POST /:id/close` (edit): close. Returns the header and the number of adjustments written.

## 4. Screens
- **Stock reconciliation** (`#/inventory/reconciliations`): the list (month, place, status, opened, closed). A form on PC to open one: month and place (or all places). Phone: list only.
- **Count page** (`#/inventory/reconciliations/:id`): one line per item and bulk item, with place, opening figure, movement since opening, expected, counted (Found / Not found for items, a number for bulk), difference (live, while open) and note. "Save counts" button. "Add an item found" (U No. search). "Close" opens a confirmation that states how many adjustments will be written, and that a closed reconciliation cannot be changed. PC only for the buttons; phone is read only.
- No sideways scroll at 390 px.

## 5. Edge cases
- A sale during the count: the sold piece is not counted, the difference is 0, and no adjustment is written.
- A transfer of a counted piece to another place during the count: its line expects 0 at this place; a "not found" count is 0 difference.
- A found piece that was sold: a difference of +1; the close moves it back to stock (status history row with the reason).
- Two closes at the same time: the first wins; the second finds the reconciliation closed and writes nothing.
- A bulk line counted at 0 when the balance is 0 has no difference.

## 6. Test cases
- `apps/api/test/reconciliation.test.ts`:
  - one open reconciliation per month and place: a second is 409 `already_open`; another month or place is allowed;
  - a bulk count above the system writes a positive `adjusted` movement; a count below writes a negative one; the balance after the close equals the count;
  - a not-found piece moves to `Missing` with the reason in the transfer, the status does not change, and it is hidden from the place list;
  - a found extra piece that was sold returns to stock with a status history row, and its place is set;
  - closing twice is refused (409 `already_closed`) and writes nothing the second time;
  - a closed reconciliation rejects a save of counts (409 `reconciliation_closed`) and a new line;
  - the bulk quantity cannot go below zero by a close: a negative count is 400, and a sale during the count that takes the balance to 0 with a count of 0 writes nothing;
  - the system figure is the opening figure plus movements: a sale during the count is reflected, so the difference is 0;
  - lines not counted block the close (409 `lines_not_counted`);
  - the Missing place cannot be renamed or made inactive, and a missing item cannot go on an invoice;
  - permissions: staff and viewer can read and cannot open or close (403); owner and manager can;
  - the tables refuse delete, and a closed reconciliation refuses update (triggers).
- Browser `e2e/reconciliation.mjs` (appended to `e2e/run-all.mjs`): open a reconciliation for a fresh month and place, count a bulk item and a ring, save, see the difference live, close with the confirmation text, see the closed status; the phone (390 px) shows the list read only with no sideways scroll.

## 7. Out of scope
Backdated openings (a count as at the 1st or a chosen date, Q190), a visible list of missing pieces, a second approval for a close (Q196), reserved, on-memo and returned items in the count (Q195), printing the count sheet, and purchases or karigar jobs (022, 023).

## 8. Defaults used (owner may change later)
- Q190 (opening moment): the system figure is the stock at the moment the reconciliation is opened, not at the 1st of the month or a chosen date. A backdated opening is not built.
- Q191 (scope): one place, or all active places (not the hidden `Missing` place).
- Q192 (missing pieces): a piece not found moves to the hidden place `Missing` with the transfer reason. It cannot be sold there. Status history does not change, because spec 020 has no missing status and the status list cannot be changed without rebuilding the table.
- Q193 (sales during the count): the difference uses the opening figure plus the movements since the opening, so a sale during the count is not counted as a shortage.
- Q194 (uncounted lines): a close is refused while any line is uncounted. Nothing is assumed.
- Q195 (reserved, on memo and returned items): not in the system stock for the count. A reserved, on-memo or returned piece found on the counter is added as an extra line, and the close moves it to in stock.
- Q196 (who closes): anyone with `reconciliation.edit` (owner and manager). No second approval.
- Q197 (extra items): a found item that is not in stock is put back in stock by a status move with a reason, and moved to the counted place. A written-off item is refused.
- Q198 (reasons): each adjustment gets an automatic reason naming the month. The owner's note on a line is kept on the line.
- Q199 (bulk lines): every bulk item gets a line at every place in scope, including those at zero, so that surplus can be counted.

## 9. Acceptance checklist
- [ ] Owner approves the defaults in section 8 (Q190 to Q199)
- [x] R1 to R15 implemented and tested in `apps/api/test/reconciliation.test.ts`
- [x] Browser test `e2e/reconciliation.mjs` added to `run-all` and green
- [x] Earlier tests and browser tests still pass (permissions matrix, invoices, stock locations, purchases)

Status line: built on branch `spec-025-reconciliation`, owner review pending.
