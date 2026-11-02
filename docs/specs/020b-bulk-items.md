# 020b: Bulk quantity items (Tilli and similar)

Status: Built (Wave 2) on branch `spec-020-021-inventory`, owner review pending. Defaults for Q157 to Q159 are in section 8 (`docs/open-questions.md` section V).
Depends on: 020 (inventory permissions and screens), 001 (database), 004 (permissions)
Next: 021 (invoices reduce stock, bulk items included)

## 1. Goal
Some small items are not worth a U No. each: Tilli and similar pieces counted in a tray. They are kept as one bulk item with a unit and a quantity. The quantity moves by received, sold and adjusted movements, each with a reason where needed. The full movement history stays. Nothing here touches invoices (021 does that).

## 2. Rules

**Bulk items**
- B1. A bulk item has a name (1 to 60 characters, unique, not case-sensitive), a unit (`pcs`, `pairs`, `sets` or `packets`, Q157) and a created date. It has no U No.
- B2. The quantity is a whole number of units. It can never be below zero (B4).
- B3. Creating an item may give an opening quantity (0 or more, default 0). When it is above 0 a `received` movement with the reason "Opening stock" is written in the same batch.

**Movements**
- B4. Movement kinds and the sign they add to the quantity:
  - `received`: adds the quantity typed (1 or more);
  - `sold`: takes the quantity typed out (1 or more);
  - `adjusted`: adds or takes out the quantity typed (not 0). A reason is required (1 to 300 characters).
  - `received` and `sold` may have a reason (up to 300 characters).
- B5. A movement that would take the quantity below zero is refused: 409 `insufficient_quantity`, with the quantity in stock in the message. The database refuses it too (a trigger on insert), so no other write path can make a negative quantity.
- B6. Movements are append-only: the database refuses update and delete (spec 001 R10 style). A mistake is corrected with an `adjusted` movement that has a reason. Bulk items are not voided in this spec.
- B7. The current quantity is the sum of the movements. It is a database view (`bulk_item_quantities`), not a stored column, so it cannot drift from the history. The stored history is the only source.
- B8. History is listed oldest first (time, then the order written), and each row shows the balance after it.

**Writing**
- B9. Create and movement accept an optional client `id`. The same id with the same content returns the first result, and different content is 409 `id_conflict` (spec 001 R5).
- B10. Each create and each movement writes one audit row in the same batch (spec 001 R11).
- B11. A duplicate name is 409 `duplicate_name`.

**Who can do what** (as spec 020)
- B12. `inventory.view`: list, read, history (owner, manager, staff, viewer). `inventory.edit`: create an item and record a movement (owner, manager).

**Stock and invoices**
- B13. No invoice links here. The invoice does not reduce bulk quantity until 021.

## 3. Data and API

**Data**: migration `0025_bulk_items.sql`
- `bulk_items`: id, standard columns, `name` (unique, not case-sensitive), `unit`.
- `bulk_item_movements`: id, `bulk_item_id`, `kind`, `quantity_change` (signed; `received` positive, `sold` negative, `adjusted` either sign but not 0), `at`, `actor`, `reason`, created columns. Index on `(bulk_item_id, at)`.
- Triggers: no update and no delete on both tables (movements append-only; bulk items are never deleted), and a BEFORE INSERT trigger on movements that aborts when the balance would go below zero.
- View `bulk_item_quantities`: `bulk_item_id`, `quantity` (sum of movements, 0 when none).

**API** (under `/api/inventory/bulk`)
- `GET /` (view): list with `q` (name, part of it) and the current quantity. All items in one list (the list is short; no paging).
- `POST /` (edit): create `{ id?, name, unit, openingQuantity? }`. Returns 201, or 200 on a replay.
- `GET /:id` (view): one item with its quantity.
- `POST /:id/movements` (edit): `{ id?, kind, quantity, reason? }`. For `sold` the quantity is typed as a positive number and the server takes it out. For `adjusted` the quantity is signed (for example `-2` takes two out). Returns 201 with `{ movement, quantity }`.
- `GET /:id/history` (view): the movements with `balanceAfter`.

## 4. Screens
- **Bulk items list** (`#/inventory/bulk`): name, unit, quantity; search by name; "New bulk item" form (name, unit, opening quantity), PC only. Links back to inventory.
- **Bulk item page** (`#/inventory/bulk/:id`): the quantity in large type, the movements table (when, kind, change, balance after, by, reason), and a "Record movement" button that opens a dialog (kind, quantity, reason) on the PC only.
- Phone: list and item page read only (no button, no dialog). No sideways scroll at 390 px.

## 5. Edge cases
- Two sales of the last three pieces at the same moment: the second is refused (the database guard in B5), and the first stands.
- A sale of more than is in stock is refused with the quantity in the message, and writes nothing (no movement, no audit row).
- An adjustment that takes the quantity to exactly zero is allowed.
- A retry of a movement with the same id after a timeout returns the first movement and changes nothing.

## 6. Test cases
- `apps/api/test/bulkItems.test.ts`:
  - no negative quantity: selling more than in stock is 409 `insufficient_quantity`, the quantity and the history do not change, and no audit row is written;
  - a direct insert below zero is refused by the database trigger;
  - a movement adjusts the total: received 10, sold 3, adjusted -2 leaves 5, and the view and the history agree;
  - adjusted with no reason is 400; received or sold with 0 is 400; adjusted with 0 is 400;
  - history order: oldest first, with the balance after each row;
  - opening quantity writes one received row "Opening stock"; opening 0 writes none;
  - a duplicate name (any case) is 409; a replay of the same movement id returns it once; a different content on the same id is 409;
  - updating or deleting a movement or an item is refused by the database;
  - permissions: staff and viewer can read and cannot create or record (403); manager can.
- Browser `e2e/bulkItems.mjs`: create "Tilli" with an opening quantity, record a sale, see the new quantity, try to sell more than is left and see the message, record an adjustment with a reason, check the history order and balances; phone read-only.

## 7. Out of scope
Invoice links and stock reduction (021), voiding a bulk item, stock counts (025), purchases that add stock (022), locations (021b), value of stock (cost and selling prices are not stored yet).

## 8. Defaults used (owner may change later)
- Q157 (units): `pcs`, `pairs`, `sets`, `packets`; Tilli is counted in pcs.
- Q158 (negative quantity): refused in the API and in the database; corrections are adjusted movements with a reason.
- Q159 (opening quantity): given when the item is created, as a received movement "Opening stock".

## 9. Acceptance checklist
- [ ] Owner approves the defaults in section 8 (Q157 to Q159)
- [ ] B1 to B13 implemented and tested in `apps/api/test/bulkItems.test.ts`
- [ ] Browser test `e2e/bulkItems.mjs` added to `run-all` and green
- [ ] Earlier tests and browser tests still pass

Status line: built on branch `spec-020-021-inventory`, owner review pending.
