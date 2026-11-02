# 020: Inventory items with individual U No.

Status: Built (Wave 2) on branch `spec-020-021-inventory`, owner review pending. The owner's answers 35, 36 and 39 are the base. Defaults for the open details are in section 8 (Q150 to Q156, `docs/open-questions.md` section V).
Depends on: 001 (database), 004 (permissions), 013 (invoice lines carry a nullable `inventory_item_id`, not used here)
Next: 020b (bulk quantity items), 021 (stock movements and automatic reduction on invoices), 021b (locations and transfers)

## 1. Goal
Every ornament the showroom holds, or every pair, is one record with its own U No. (the owner's stock number). The record shows what it is, its weights, purity, location and status, and every status change is kept. This spec only builds the master list and its history. Invoices do not change stock yet (that is 021).

## 2. Rules

**Items**
- I1. One record is one ornament, or one pair (for example earrings). A pair has `pieces` = 2 and its weights are for the whole pair. `pieces` is 1 to 10, default 1.
- I2. Fields: U No., item type, pieces, metal (`gold` or `silver`), purity (the invoice purities: 22K916, 24K995, 18K750, 14K, 24K999, silver, other), gross weight and net weight (integer milligrams, net greater than 0 and not above gross), HSN (7113 default, or 9988 as on invoices), labour note (free text, up to 200 characters, information only), location (free text up to 60 characters, replaced by locations in 021b), status, created date.
- I3. Metal `silver` needs purity `silver`, and purity `silver` needs metal `silver`. Purity `other` is allowed with either metal.
- I4. A new item starts with status `in_stock`.

**U No.**
- I5. Format: a 4-character item code (A to Z and 0 to 9, from the item type) followed by a 2-digit serial from 01 to 99, for example `RING01`. The serial restarts for each item code. Default for Q150.
- I6. Automatic: when no U No. is given, the next serial for the type's code is used: one more than the highest serial ever used for that code, voided items included. A voided number is never issued again.
- I7. Typed by hand: allowed when it matches I5 and starts with the code of the chosen type. It must not be used by a live (not voided) item.
- I8. Uniqueness: a unique index on U No. among items that are not voided. A duplicate gives 409 `u_no_taken`. If two saves race, the database index decides and the loser gets the same 409.
- I9. The 100th item of one code is refused (409 `serial_full`): the message asks for a new item code.

**Item types**
- I10. Seeded types: Ring (`RING`), Chain (`CHAI`), Earring (`EARR`), Bangle (`BANG`), Necklace (`NECK`). Default for Q151.
- I11. The owner adds a type with a name (up to 60 characters, unique, not case-sensitive) and a 4-character code (unique). A type can be renamed or made inactive. It is never deleted. An inactive type cannot be used for a new item, but its items stay.

**Status and history**
- I12. Statuses: `in_stock`, `sold`, `reserved`, `on_memo`, `returned`, `written_off`. Labels: In stock, Sold, Reserved, On memo, Returned, Written off.
- I13. A status change needs a reason (1 to 300 characters) and writes one row in `inventory_item_history` (from status, to status, time, who, reason) in the same batch as the item change and its audit row. Moving to the status the item already has is refused (409 `same_status`) and writes nothing. `written_off` is final (409 `invalid_status_move`). Any other move is allowed (Q154).
- I14. History is append-only (triggers refuse update and delete). Creating an item writes the first row: from nothing to `in_stock`, reason "Created".
- I15. Items are never deleted. Void: only for an item in `in_stock` or `written_off`, with a reason. It sets `voided_at`, leaves the status and the history alone, hides the item from lists unless asked, and frees its U No. for the unique index (not for the automatic serial, see I6).

**Create and search**
- I16. Create accepts an optional client `id`. A retry with the same id and the same content returns the first result; the same id with different content is 409 `id_conflict` (spec 001 R5).
- I17. Search on the list: U No. (case-insensitive, spaces ignored, any part of it), item type and status. 20 per page with an offset cursor. Voided items only with `includeVoided=1`.
- I18. Each create, status change and void writes one audit row in the same batch (spec 001 R11).

**Who can do what** (Q67 default, spec 004)
- I19. `inventory.view`: list, read, history, types list. Owner, manager, staff and viewer have it.
- I20. `inventory.edit`: create items, change status, void, add and change item types. Owner and manager have it. Staff and viewer see the screens, with no buttons.

**Stock**
- I21. Nothing here changes stock or invoices. The invoice line's `inventory_item_id` stays empty. Spec 021 does the reduction and the link.

## 3. Data and API

**Data**: migration `0024_inventory_items.sql`
- `inventory_item_types`: id, standard columns, `name`, `item_code` (4 characters, unique), `active`.
- `inventory_items`: id, standard columns, `u_no` (unique among not voided), `item_code`, `serial`, `type_id`, `pieces`, `metal`, `purity`, `gross_weight_mg`, `net_weight_mg`, `hsn`, `labour_note`, `location`, `status`, `voided_at`, `voided_by`, `void_reason`. A CHECK ties `u_no` to `item_code` and `serial`.
- `inventory_item_history`: id, `item_id`, `from_status` (null for the first row), `to_status`, `at`, `actor`, `reason`, created columns. Append-only.
- Triggers: no delete on the two business tables (spec 001 R9), no update and no delete on the history.
- The migration also adds `inventory.view` and `inventory.edit` to the roles that hold them (owner and manager get both, staff and viewer get view), so the live roles table matches the defaults in code.

**API** (under `/api/inventory`)
- `GET /types` (view), `POST /types` (edit), `PATCH /types/:id` (edit): name and active.
- `GET /items` (view): `q`, `typeId`, `status`, `includeVoided`, `cursor`.
- `POST /items` (edit): create. Returns 201, or 200 on an idempotent replay.
- `GET /items/:id` (view), `GET /items/:id/history` (view), `POST /items/:id/status` (edit) `{ status, reason }`, `POST /items/:id/void` (edit) `{ reason }`.

## 4. Screens
- **Inventory list** (`#/inventory`): search box for U No., type and status filters, table (U No., type, pieces, purity, net weight, status, location). "New item" button and links to Item types and Bulk items: PC only, shown with the permission. Phone: list and search only.
- **Item page** (`#/inventory/items/:id`): all fields, status change form (status, reason, "Change status"), void (PC only), history table (when, from, to, who, reason).
- **New item** (`#/inventory/new`): type, pieces, metal, purity, gross and net weights (grams, 3 decimals), HSN, labour note, location, optional U No. (blank = automatic, and the page shows the U No. it got). PC only.
- **Item types** (`#/inventory/types`): list, add, rename, make inactive. PC only for changes.
- No horizontal scroll at 390 px.

## 5. Edge cases
- Two creates for the same type at the same moment: one gets the next serial, the other a 409 `u_no_taken` and can retry.
- A typed U No. of a voided item can be used again (the unique index allows it); a generated one never is.
- A written-off item cannot be changed again, so it is never moved back to stock by mistake.
- An item that is `sold`, `reserved`, `on_memo` or `returned` cannot be voided (I15), so its history and any later invoice link stay.

## 6. Test cases
- `apps/api/test/inventoryItems.test.ts`:
  - automatic U No.: `RING01`, `RING02` for the same type; a chain gets `CHAI01`; a voided `RING02` is not reissued.
  - a typed U No. with the wrong code is refused; a duplicate live U No. is 409 `u_no_taken`; a voided one can be typed again.
  - the 100th item of a code is 409 `serial_full` (create 99 quickly with a loop).
  - a pair (`pieces` 2) stores one record with both pieces; net above gross is refused; silver metal with a gold purity is refused.
  - status: change to `reserved` writes one history row with the reason; same status 409; `written_off` then any change 409; history order oldest first; the reason is required.
  - search: by U No. substring (spaces ignored), by type, by status, 20 per page with a cursor; search over 3000 rows is under 200 ms.
  - idempotent create: same id twice returns the same item; same id with other content is 409.
  - inactive type cannot be used; a type can be added with a code that is already used (409).
  - permissions: staff and viewer can list and read, cannot create or change status (403); owner and manager can.
  - the history and item tables refuse UPDATE of history and DELETE of items (triggers).
- Browser `e2e/inventoryItems.mjs`: create an item from the form (the U No. shown), search it by U No., change its status with a reason, see the history row; the phone view (390 px) shows the list and the item, with no new-item or status buttons, and no sideways scroll.

## 7. Out of scope
Stock reduction and invoice links (021), locations and transfers (021b), purchases (022), stock counts (025), editing an item's details after saving (a wrong item is voided and recreated until Q155 is answered), photos, purchase cost and selling price (listed in requirements section 9, not stored yet), bulk items (020b).

## 8. Defaults used (owner may change later)
- Q150 (U No. format): item code of 4 characters + 2-digit serial 01 to 99 per code, as the owner's `RING01`, `RING02` and `T00001` examples. `CHAIN01` has 5 characters, so Chain uses code `CHAI`. Typed numbers are checked against the same rule.
- Q151 (types): Ring, Chain, Earring, Bangle, Necklace seeded; owner adds more.
- Q152 (purity and metal): the invoice purity list; metal gold or silver.
- Q153 (pairs): one record with `pieces` 1 to 10, weight for the whole set.
- Q154 (status moves): any move except out of `written_off`; a reason is always required.
- Q155 (edits): no edit of details in this spec; void and recreate, or an edit screen later.
- Q156 (void): only `in_stock` or `written_off`, with a reason; voided U No. stays out of the automatic series.

## 9. Acceptance checklist
- [ ] Owner approves the defaults in section 8 (Q150 to Q156)
- [ ] I1 to I21 implemented and tested in `apps/api/test/inventoryItems.test.ts`
- [ ] Browser test `e2e/inventoryItems.mjs` added to `run-all` and green
- [ ] Earlier tests and browser tests still pass (permissions matrix updated for inventory.view and inventory.edit)

Status line: built on branch `spec-020-021-inventory`, owner review pending.
