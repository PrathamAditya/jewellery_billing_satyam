# 022: Purchases (finished jewellery, raw gold and silver, karigar-made)

Status: Built (Wave 2) on branch `spec-020-021-inventory`, owner review pending. Defaults for Q170 to Q174 are in section 8 (`docs/open-questions.md` section V, after Q169). Tests in `apps/api/test/purchases.test.ts` and `e2e/purchases.mjs`.
Depends on: 020 (individual items and U No.), 020b (bulk quantities), 021b (places and the per-place balances), 004 (permissions), 001 (database, numbering, audit)
Next: 023 (karigar jobs, which can replace the metal part of Q173)

## 1. Goal
When the shop buys stock, the stock list grows by itself. A purchase is recorded once, with its supplier and bill number, and it creates the stock: individual items with their U No., bulk quantities, or raw gold and silver by purity. Jewellery made by a karigar from the shop's own metal is recorded the same way, and the metal it used comes out of raw stock. Every purchase has a number, its lines and a history, and a purchase can be voided only while the stock it made is still untouched. Nothing here changes an invoice, a payment or a price.

## 2. Rules

**Types and header**
- PU1. A purchase has one of three types:
  - `finished`: finished jewellery from a wholesaler. Item lines (one individual item each) and bulk lines (a bulk item and a quantity).
  - `raw_metal`: raw gold or silver. Raw metal lines only (metal, purity, weight).
  - `karigar_made`: jewellery made by a karigar from the shop's own metal. Item lines, and metal-used lines (the metal the karigar was given from raw stock, for the same purchase).
- PU2. Header: supplier name (required, 1 to 100 characters); supplier bill number (optional, up to 60 characters); purchase date (a business date, `YYYY-MM-DD`, any valid date); karigar name (required for `karigar_made`, 1 to 100 characters, empty for the other types); place (optional, default Showroom; it must exist and be active, spec 021b L4); remarks (optional, up to 300 characters).
- PU3. A purchase has at least one line. A line of a kind the type does not allow is 400 (`validation`, on `lines.N`).
- PU4. A line may carry an optional amount in paise (0 or more). It is typed for the record only: the purchase calculates no GST, no total and no payable amount (Q171).

**Lines**
- PU5. An item line uses the spec 020 creation fields: type, pieces (1 to 10), metal, purity, gross and net weight (both whole milligrams, net above 0 and not above gross), HSN, labour note and an optional U No. The rules of I1 to I8 apply as they do on the item form. The item is created at the purchase place.
- PU6. A bulk line names a bulk item (must exist) and a quantity of 1 or more. It goes to the purchase place.
- PU7. A raw metal line names a metal (`gold` or `silver`), a purity (silver needs purity `silver` and the reverse, as I3) and a weight in whole milligrams (1 or more). The purchase place holds it.
- PU8. A metal-used line (only for `karigar_made`) has the same fields as a raw metal line. It takes that weight out of raw stock at the purchase place.

**Saving**
- PU9. A save is one database batch: the number, the purchase row, the items created, the bulk received movements, the raw movements (in and out) and the audit row. A refused save writes nothing and uses no number.
- PU10. The number is `PUR-0001`, one series for each financial year of the purchase date, reset each 1 April (Q170). The number is allocated in the same batch as the purchase row, so a retry or a failed save never leaves a gap.
- PU11. Each item line writes an item with a U No. (I5 to I9, the automatic serial counted across the lines of the same purchase, typed U Nos. checked as in I7), status `in_stock`, and a history row from nothing to `in_stock` with the reason "Purchased on PUR-xxxx".
- PU12. Each bulk line writes one `received` bulk movement at the purchase place with the reason "Purchase PUR-xxxx" (spec 020b B4, 021b B1).
- PU13. Each raw metal line writes one raw movement of plus the weight at the purchase place, reason "Purchase PUR-xxxx". Raw metal is stored by metal, purity and place (Q172). No item and no U No. is made for raw metal.
- PU14. Each metal-used line writes one raw movement of minus the weight at the purchase place, reason "Used for karigar purchase PUR-xxxx". Raw stock never goes below zero: a save that would do that is refused with 409 `raw_stock_short` and a message that names the metal, the purity, the place and the balance. The database trigger is the final guard.
- PU15. Replay by client id (spec 001 R5): the same id with the same content returns the first purchase (200); the same id with different content is 409 `id_conflict`.

**Void**
- PU16. A void needs a reason (1 to 300 characters). It is refused with 409 `purchase_in_use`, and nothing is written, unless all of these hold (Q174):
  - every item the purchase created is `in_stock` and not voided;
  - for each bulk item received, the balance at the purchase place after the received quantity is taken out is not below zero, and no transfer has taken that bulk item out of the purchase place since the purchase;
  - for each metal and purity the purchase moved, the raw balance at each place after the purchase's movements are reversed is not below zero.
  The message names the first item or quantity that blocks the void.
- PU17. A void is one batch: each created item is voided (spec 020 void, reason "Purchase PUR-xxxx voided: <reason>"); one `adjusted` bulk movement takes out the received quantity at the purchase place (reason "Purchase PUR-xxxx voided"); one raw movement per metal, purity and place reverses the net of the purchase's raw movements (reason "Purchase PUR-xxxx voided"); the purchase is marked voided; one audit row. A voided purchase keeps its number, its lines and its history.
- PU18. A voided purchase cannot be voided again (409 `already_voided`).

**Who can do what** (spec 004)
- PU19. `purchases.view`: list, read and the raw stock. Owner, manager, staff and viewer.
- PU20. `purchases.edit`: save a purchase and void one. Owner and manager only. Staff and viewer see the screens without buttons and get 403 from the API.

**Protection in the database**
- PU21. `purchases`, `purchase_lines` and `raw_metal_movements` cannot be deleted. `purchase_lines` and `raw_metal_movements` cannot be updated either (append-only). `purchases` can be updated once, to set the void columns; any other change to a purchase is refused.
- PU22. A purchase line's kind must fit the purchase type (`item` and `bulk` for `finished`, `raw_metal` for `raw_metal`, `item` and `metal_used` for `karigar_made`). A trigger refuses a line of another kind (`invalid_purchase_line`).
- PU23. Raw metal movements may not take the balance of their metal, purity and place below zero (`raw_stock_below_zero`).

**Not changed**
- PU24. No invoice, payment, rate or print changes. An item made by a purchase is in stock and can be sold by the spec 021 path like any other item. Stock sold, moved or voided by others is not touched by this spec beyond what PU16 checks.

## 3. Data and API

**Data**: migration `0028_purchases.sql` (new tables, triggers, a view, and the two role permissions; no existing row changes)
- `PUR` is added to the number series list in `packages/calc` (`NUMBER_SERIES`). The `number_series` row is created by the first purchase of each financial year.
- `purchases`: id, standard columns, `purchase_no` (unique within its financial year: index on `(fy, purchase_no)`, as invoices, migration 0011), `fy`, `serial`, `purchase_type` (`finished`, `raw_metal`, `karigar_made`), `purchase_date`, `supplier_name` (required), `supplier_bill_no` (nullable), `karigar_name` (required for `karigar_made`, null otherwise, a CHECK), `location_id` (default `loc-showroom`, with an unknown-location trigger as in 021b, because a non-null default cannot carry a REFERENCES clause), `remarks`, `voided_at`, `voided_by`, `void_reason`. Index on `purchase_date`. Triggers: no delete; an update guard that allows only the void columns to change, once.
- `purchase_lines`: id, standard columns, `purchase_id` (references `purchases`), `line_no`, `line_kind` (`item`, `bulk`, `raw_metal`, `metal_used`), `inventory_item_id` (item lines), `bulk_item_id` and `quantity` (bulk lines), `metal`, `purity` and `weight_mg` (raw and metal-used lines), `amount_paise` (optional, 0 or more). A CHECK ties the columns to `line_kind`. A unique `(purchase_id, line_no)`. Triggers: no update, no delete; the kind-to-type trigger of PU22.
- `raw_metal_movements` (append-only): id, standard columns, `metal` (`gold` or `silver`), `purity`, `weight_mg` (signed, not 0), `location_id` (references `stock_locations`), `purchase_id`, `purchase_line_id` (null for the reversal rows of a void), `at`, `actor`, `reason`. Index on `(metal, purity, location_id)` and `(purchase_id)`. Triggers: no update, no delete, and a BEFORE INSERT trigger for PU23.
- View `raw_metal_balances`: `metal`, `purity`, `location_id`, `weight_mg` (the sum of the movements; rows with no movements are not listed).
- Permissions: `purchases.view` and `purchases.edit` are appended to the end of `PERMISSIONS`, and to `DEFAULT_ROLES` (owner and manager get both; staff and viewer get view). The migration appends them to the roles' `permissions_json`: owner and manager get both, staff and viewer get `purchases.view`.

**API** (under `/api/inventory/purchases`; routes in `apps/api/src/inventory/purchases.ts`)
- `GET /` (view): `type`, `from`, `to` (business dates), `q` (supplier name, part of it, case-insensitive), `includeVoided=1`, `cursor`. 20 per page, newest first. Returns `{ items, nextCursor }` with `purchaseNo`, `purchaseDate`, `purchaseType`, `purchaseTypeLabel`, `supplierName`, `supplierBillNo`, `lineCount`, `locationName`, `voided`.
- `POST /` (edit): `{ id?, purchaseType, purchaseDate, supplierName, supplierBillNo?, karigarName?, locationId?, remarks?, lines: [...] }`. A line is `{ kind: "item", ...item fields, amountPaise? }`, `{ kind: "bulk", bulkItemId, quantity, amountPaise? }`, `{ kind: "raw_metal", metal, purity, weightMg, amountPaise? }` or `{ kind: "metal_used", metal, purity, weightMg }` (karigar only). Returns 201, or 200 on a replay, with `{ purchase }` (the detail of GET /:id).
- `GET /raw-stock` (view): `{ items: [{ metal, purity, locationId, locationName, weightMg }] }`, the balances that are not zero (a place with no raw metal is not listed).
- `GET /:id` (view): `{ purchase }`, where `purchase` has the header fields, `voided`, `voidedAt`, `voidReason` and its `lines`. Each line has `lineNo`, `kind`, `amountPaise`, and the kind's data: for an item, `item: { id, uNo, typeName, status, statusLabel, voided }`; for a bulk line, `bulk: { id, name, unit, quantity }` (the quantity received by this line) and `bulk.balanceAtPlace`; for raw and metal-used lines, `metal`, `purity`, `weightMg`.
- `POST /:id/void` (edit) `{ reason }`: returns `{ purchase }`. 409 `purchase_in_use` with the message, or `already_voided`, writes nothing.
- Permission map (spec 004 R3): every route above has a rule. `GET /raw-stock` is listed before `GET /:id`.
- Error codes: `validation` (400, with `issues`), `id_conflict`, `u_no_taken`, `serial_full`, `type_inactive`, `location_inactive`, `raw_stock_short`, `purchase_in_use`, `already_voided`, `stale`, `not_found` (404).

## 4. Screens
- **Purchases** (`#/inventory/purchases`): the list (number, date, type, supplier, lines, place, voided), filters for type and dates, a supplier search box, "Load more". Below it the **Raw stock** section: metal, purity, place and weight in grams (3 decimals). "New purchase" button, PC only, with `purchases.edit`.
- **New purchase** (`#/inventory/purchases/new`, PC only):
  1. the type is chosen first, as three choices with a short line each;
  2. the header: date (today by default), supplier, bill number, karigar name (karigar type only), place (active places, Showroom by default), remarks;
  3. the lines for that type: an item line has the fields of the New item form; a bulk line has a bulk item choice and a quantity; a raw metal line has metal, purity and grams (3 decimals); a metal-used line (karigar type) has the same fields as a raw line, under the heading "Shop metal given to the karigar". Each line has an optional amount and a Remove button. "Add line" buttons follow the type.
  4. Save. A refusal shows the message at the top and the line's own message next to that line.
- **Purchase page** (`#/inventory/purchases/:id`): header and voided state (with the VOID stamp); the lines table; each item links to its item page (`#/inventory/items/:id`); bulk lines show the quantity received and the balance at the place; "Void purchase" (PC only, with `purchases.edit`) opens a dialog with the reason. A voided purchase shows the void reason and no buttons.
- Phone (390 px): the list, the raw stock and the purchase page are read-only, with no new purchase or void buttons and no sideways scroll.

## 5. Edge cases
- Two purchases of the same ring at once: each gets its own serial, or the second gets `u_no_taken` and the whole save is rolled back.
- A typed U No. used twice in one purchase is 400 on the second line. A typed U No. with the wrong code for its type is 400 (I7).
- A purchase dated in an earlier financial year gets that year's number series (PUR-0001 in that year if it is the first).
- A karigar purchase whose metal used is more than the raw stock at the place is refused with `raw_stock_short`, and no item is created.
- A void after one created item was sold on an invoice is refused, and names that item.
- A void after a bulk quantity was sold, or moved out of the place, is refused.
- A karigar purchase can be voided only if its items are still in stock and the raw metal it used is returned to stock by the reversal (the reversal adds back, so it can always be done).
- A raw purchase whose metal was used by a karigar purchase cannot be voided until that karigar purchase is voided.
- Failed saves (refused line, short raw stock, a database refusal) store nothing, use no number, write no item, movement or audit row.
- Reading a purchase, the list and the raw stock write nothing.

## 6. Test cases
- `apps/api/test/purchases.test.ts`:
  - numbering: the first purchase of a year is `PUR-0001`, the next `PUR-0002`; a purchase dated in the next financial year starts again at `PUR-0001`; a refused save uses no number (the next save gets the next number).
  - a finished purchase with one ring line creates the item with a U No. (`RING` and the next serial), status `in_stock`, the history row "Purchased on PUR-0001", and the audit row in the same batch.
  - a bulk purchase increases the quantity at the purchase place; the balance at other places does not move (`GET /bulk/:id` agrees).
  - a raw silver purchase increases the raw stock by metal and purity; `GET /raw-stock` shows it at the place.
  - a karigar purchase with metal used reduces raw stock; metal used above the balance is 409 `raw_stock_short` with the balance named, and nothing is written; a direct insert below zero is refused by the trigger (`raw_stock_below_zero`).
  - a void works while everything is untouched: the items are voided, the bulk quantity and the raw stock are back, and the purchase is marked voided with the reason.
  - a void is 409 `purchase_in_use` once an item is sold (an invoice takes it), once a bulk quantity is sold, once a bulk quantity is moved out of the place, and once raw stock is used by a karigar purchase; each refusal writes nothing (no void row, no movement, no audit row).
  - a second void is 409 `already_voided`.
  - replay by client id: the same id and content returns the first purchase with no second item; a different content on the same id is 409 `id_conflict`.
  - supplier name is required (400); karigar name is required for `karigar_made` (400) and is refused for the other types (400); a line of the wrong kind for the type is 400.
  - a typed U No. with the wrong code is 400; a typed U No. of a live item is 409 `u_no_taken`.
  - a place that is inactive is 409 `location_inactive`.
  - permissions: staff and viewer can list, read and see the raw stock, and cannot create or void (403); owner and manager can.
  - the purchase, line and raw movement tables refuse DELETE; lines and raw movements refuse UPDATE; a purchase refuses any update except the void columns.
- Browser `e2e/purchases.mjs`: record a finished purchase with one ring line and see the U No. created on its page; record a raw silver purchase and see it in the raw stock; void the raw purchase and see the raw stock go back; the phone (390 px) is read only with no sideways scroll.
- Regression: `inventoryItems`, `bulkItems`, `stockMovements`, `stockLocations`, `invoices`, `permissions` and `migrations` tests still pass.

## 7. Out of scope
Karigar jobs, the metal issued to a karigar on a job, wastage and labour (023). GST on purchases and purchase reports (Q171, the CA report of spec 043). Purchase rate per gram and purchase cost of items (requirements section 9 lists them; not stored yet). Bills in PDF or photos. Editing a purchase after saving (void and enter again, as for items). Returns to a supplier. Stock counts (025).

## 8. Defaults used (owner may change later)
- Q170 (purchase numbers): `PUR-0001` per financial year of the purchase date, reset each 1 April, in the same batch as the save. `DEFAULT: as described; the financial year is not printed in the number.`
- Q171 (GST and amounts): no GST, total or payable on a purchase here; an optional amount per line, for the record only. `DEFAULT: record only.`
- Q172 (raw gold and silver): raw stock by metal, purity and place in milligrams; no item and no U No. `DEFAULT: totals by purity and place.`
- Q173 (karigar-made): karigar name required; finished pieces become items at the place; the metal used is raw stock going out, never below zero. `DEFAULT: metal used recorded on the purchase until spec 023.`
- Q174 (void): only while the stock it made is untouched (PU16). `DEFAULT: refused with 409 once anything has been sold, moved or used.`
- Permissions: `purchases.view` for owner, manager, staff and viewer; `purchases.edit` for owner and manager.

**Decisions made while building** (the brief left these open; the owner can change them)
- Purchase numbers are unique within each financial year (index on `(fy, purchase_no)`), as invoices are (migration 0011), because `PUR-0001` comes back each year.
- A bulk received movement has no purchase column (spec 020b); it carries the purchase number in its reason. A void finds the bulk quantity from the purchase's lines.
- PU16 also refuses a void when a transfer took the bulk item out of the purchase place after the purchase, even if the balance still covers the quantity. A balance-only rule would let the goods leave unnoticed.
- A karigar name on a purchase of another type is refused (400), not dropped, so a wrong type is seen at once.
- The owner's answer [41] (`docs/owner-answers-2026-11-01.md`) is about refining. The purchase questions are the Q41 text in section G of `docs/open-questions.md`, which is still open; this spec answers them with Q170 to Q174.

## 9. Acceptance checklist
- [ ] Owner approves the defaults in section 8 (Q170 to Q174)
- [x] PU1 to PU24 implemented and tested in `apps/api/test/purchases.test.ts`
- [x] Browser test `e2e/purchases.mjs` added to `run-all` after `stockLocations` and green
- [x] Earlier tests and browser tests still pass (inventoryItems, bulkItems, stockMovements, stockLocations, invoices, permissions, migrations; browser customers, rates, inventoryItems, bulkItems, stockMovements, stockLocations)

Status line: built on branch `spec-020-021-inventory`, owner review pending.
