# 021b: Stock locations and transfers

Status: Built (Wave 2) on branch `spec-020-021-inventory`, owner review pending. Defaults for Q165 to Q169 are in section 8 (`docs/open-questions.md` section V). Tests in `apps/api/test/stockLocations.test.ts` and `e2e/stockLocations.mjs`.
Depends on: 020 (individual items), 020b (bulk items and movements), 021 (invoices reduce stock), 004 (permissions)
Next: 022 (purchases), 023 (karigar jobs, which will use the Karigar location)

## 1. Goal
The owner keeps stock in several places: the showroom counter, the display, the locker, the karigar, the testing centre and the refining centre (owner answer 38). Every individual item and every bulk quantity sits at one location. Stock can be moved between locations with a transfer that is kept, and the owner can see what is at each place and the history of moves. Nothing here changes an invoice, a sale or a price.

## 2. Rules

**Locations**
- L1. A location has a name (1 to 60 characters, unique, not case-sensitive) and an active flag. Seeded at start (Q165): Showroom (the default), Display, Locker, Karigar, Testing centre, Refining centre.
- L2. A location is renamed or made inactive, never deleted (the database refuses delete). New locations can be added.
- L3. Showroom is the default place for every new item and bulk movement that names no location. It cannot be made inactive (409 `showroom_locked`; the database refuses it too).
- L4. An inactive location receives nothing: no new item, no bulk movement and no transfer into it (409 `location_inactive`). Stock already there is still counted in the totals.
- L5. A location that still holds stock cannot be made inactive (409 `location_has_stock`): the stock would vanish from the place lists. Stock here means items not sold and not voided with this location, or a bulk quantity above 0. (Added while building, not one of the owner's questions; see Q169 for the karigar place.)
- L6. A location id must exist. The items and bulk movements tables refuse an unknown location in the database.

**Individual items**
- I1. Every item has one location (`location_id`, default Showroom). The spec 020 free text `location` stays as an optional note; the screens no longer ask for it and show the location name.
- I2. An item moves by a transfer only when it is `in_stock` and not voided (Q168). Any other status, and a voided item, is refused (409 `item_not_in_stock`) and nothing is written.
- I3. The transfer names the place the item is expected to be in (`fromLocationId`). If the item is somewhere else now, the transfer is refused (409 `stale`) and nothing is written. The guard is the same as in the database batch, so two transfers at once cannot both succeed.
- I4. A transfer does not change the item's status and writes no status history row. The transfer row is the history of where the item was.
- I5. Sale, edit and void of an invoice (spec 021) do not move an item. A sold item keeps the place where it was sold.

**Bulk items**
- B1. Every bulk movement (received, sold, adjusted) has a location (default Showroom).
- B2. The balance of a bulk item at a location L is: the movements at L, plus the transfers into L, minus the transfers out of L. The total is the sum over all locations, and `bulk_item_quantities` (spec 020b B7) keeps meaning the total of the movements.
- B3. A movement that would take the balance at its location below zero is refused (409 `insufficient_quantity`, with the quantity at that location in the message). A place with no stock refuses a sale or an adjustment that takes out. The database trigger refuses it too.
- B4. A bulk transfer writes one transfer row only. It is refused (409 `insufficient_quantity`) when the quantity is more than the balance at the from location, and nothing is written. The database trigger refuses it too (`quantity_below_zero`).
- B5. The invoice path (spec 021) writes its bulk sales with no location, so they take the Showroom balance (Q167). A sale that Showroom cannot cover is refused with the spec 021 message, even when another place holds enough.

**Transfers**
- T1. A transfer row has a kind: `item` (one individual item, quantity 1) or `bulk` (one bulk item, quantity 1 or more). The from and to locations differ. The database checks the columns against the kind.
- T2. Transfers are append-only: the database refuses update and delete.
- T3. A transfer has a client `id` (spec 001 R5): the same id with the same content returns the first result; different content is 409 `id_conflict`.
- T4. Each transfer writes one audit row in the same batch as the transfer (and the item change for an item transfer).
- T5. The reason is optional, up to 300 characters (Q166).

**Who can do what** (no new permission)
- P1. `inventory.view`: list locations, the stock at a location, the transfers list (owner, manager, staff, viewer).
- P2. `inventory.edit`: add, rename and make inactive a location; make a transfer; choose a location on a new item, or on a bulk movement (owner and manager, as spec 020 and 020b).
- P3. Staff and viewer see the screens with no buttons on the PC, and no change in the API (403).

## 3. Data and API

**Data**: migration `0027_stock_locations.sql` (additions only; no existing row changes except the new column defaults)
- `stock_locations`: id, standard columns, `name` (unique, not case-sensitive), `active` (0 or 1). Seeds the six places. Triggers: no delete; Showroom cannot become inactive.
- `inventory_items`: add `location_id` TEXT NOT NULL DEFAULT `loc-showroom`. A trigger on insert and on update of `location_id` refuses a location that does not exist (`unknown_location`). The column carries no `REFERENCES` clause because D1 refuses to add a referencing column with a non-null default; the trigger does the same job.
- `bulk_item_movements`: add `location_id` TEXT NOT NULL DEFAULT `loc-showroom`, with the same unknown-location trigger. The trigger `bulk_item_movements_not_below_zero` is replaced: it checks the balance at the movement's location (rule B2).
- `stock_transfers`: id, standard columns, `kind` (`item` or `bulk`), `inventory_item_id`, `bulk_item_id`, `quantity`, `from_location_id`, `to_location_id`, `at`, `actor`, `reason`. CHECKs tie the columns to the kind and forbid from = to. Triggers: no update, no delete, and a BEFORE INSERT trigger for a bulk transfer that aborts with `quantity_below_zero` when the quantity is more than the from-location balance.
- View `bulk_item_location_quantities`: `bulk_item_id`, `location_id`, `quantity`, one row for every bulk item and every active location (balance by rule B2).
- View `bulk_item_quantities` is unchanged.

**API** (under `/api/inventory`; the routes are in `apps/api/src/inventory/locations.ts`)
- `GET /locations` (view): `{ items: [{ id, name, active, isDefault }] }`.
- `POST /locations` (edit): `{ id?, name }`. Returns 201, or 200 on a replay. A duplicate name is 409 `duplicate_name`.
- `PATCH /locations/:id` (edit): `{ name?, active? }`. Showroom inactive is 409 `showroom_locked`; a place with stock is 409 `location_has_stock`.
- `GET /locations/:id/stock` (view): `{ location, items: [{ id, uNo, typeName, status, statusLabel }], bulk: [{ bulkItemId, name, unit, quantity }] }`. Items are not voided and not sold; bulk rows have a quantity above 0.
- `POST /transfers` (edit): `{ id?, kind, inventoryItemId?, bulkItemId?, quantity?, fromLocationId, toLocationId, reason? }`. Returns 201, or 200 on a replay, with `{ transfer }`.
- `GET /transfers` (view): filters `itemId`, `bulkItemId`, `locationId` (from or to); 20 per page, cursor; newest first. Returns `{ items, nextCursor }`.
- Item create (spec 020 `POST /items`) accepts an optional `locationId` (default Showroom). Item responses carry `locationId` and `locationName`.
- Bulk create (`POST /bulk`) and movements (`POST /bulk/:id/movements`) accept an optional `locationId` (default Showroom). Movement responses and history rows carry `locationId`. `GET /bulk/:id` adds `byLocation`: the balance at each active location.
- Permission map: every new route is listed (spec 004 R3).

## 4. Screens
- **Locations** (`#/inventory/locations`): list (name, active), add (name), rename, make inactive. PC only for changes. Each name links to its stock page.
- **Stock by location** (`#/inventory/locations/:id`): the items at the place (U No., type, status) and the bulk quantities. Read only, on the PC and the phone.
- **Transfer** dialog on the item page and on the bulk item page (PC only): to location (required), from location (pre-filled from the current place, changeable only for bulk), quantity (bulk only), reason (optional). The item page also lists its transfers (date, from, to, who).
- **New item** (spec 020 form): the free text Location input is replaced by a location dropdown (default Showroom). Only active places are offered.
- **Bulk movement dialog** (spec 020b): a location dropdown (default Showroom). The bulk item page shows the balance at each active place.
- **Inventory list** (spec 020): the location column shows the location name, not the note.
- Phone (390 px): read only. No transfer, location or change buttons. No sideways scroll.

## 5. Edge cases
- Two transfers of the same item at the same moment: the first moves it; the second sees a different place and gets 409 `stale`.
- A transfer of a sold item, a voided item or a reserved item: 409 `item_not_in_stock`, the item stays where it was.
- A bulk transfer of exactly the balance at the from place is allowed (the place goes to 0).
- A bulk movement recorded at Display while Display has 0 is refused with the Display balance in the message, even when Showroom has plenty.
- A bulk sale on an invoice with stock only at Display is refused by the spec 021 path (Q167).
- A transfer retried after a timeout returns the first transfer and moves nothing again.
- Making Display inactive while it holds stock is refused (L5). After the stock is moved out, it can be made inactive.

## 6. Test cases
- `apps/api/test/stockLocations.test.ts`:
  - the six seeded locations exist, Showroom is the default and cannot be made inactive (409 `showroom_locked`, and the database refuses it in a direct update);
  - an item transfer moves `location_id`, writes one transfer row and one audit row, and the status and status history do not change;
  - a sold item cannot move (409 `item_not_in_stock`); a voided item cannot move; nothing is written;
  - a transfer from the wrong place is 409 `stale` and writes nothing;
  - bulk balances per place add up: movements at Showroom and at Display, a transfer of 3 from Showroom to Display, the total is unchanged, and the per-place numbers are right (`bulk_item_location_quantities` and `GET /bulk/:id` agree);
  - a bulk transfer of more than the balance is refused by the trigger (direct insert) and by the API (409 `insufficient_quantity`), and writes nothing;
  - a movement at a place with no stock (a sale at Locker) is refused (409 `insufficient_quantity`);
  - a new location can be added, renamed, and made inactive; names are unique in any case (409 `duplicate_name`); an inactive place refuses an item and a transfer (409 `location_inactive`);
  - a place that holds stock cannot be made inactive (409 `location_has_stock`);
  - the same transfer id with the same content returns the first result; different content is 409 `id_conflict`;
  - staff and viewer can read (locations, stock at a place, transfers) and cannot add, rename, transfer or move (403); owner and manager can;
  - the transfer and location tables refuse UPDATE and DELETE (triggers), and `stock_locations` refuses a delete.
- Browser `e2e/stockLocations.mjs`: add "Testing centre 2 <suffix>" (or use a seeded place), create an item, transfer it there from the item page, see its location name on the list and on the stock-by-location page; transfer a bulk quantity and check both per-place numbers; the phone (390 px) is read only.
- Regression: `inventoryItems`, `bulkItems`, `stockMovements`, `invoices` tests and the browser scripts still pass.

## 7. Out of scope
Karigar jobs and the metal balance with a karigar (023), purchases that put stock in a place (022), stock counts by place (025), transfers between shops, moving stock on an invoice line (a place chosen on the invoice; Q167), a report of stock value by place, and a karigar or refining record beyond the place name.

## 8. Defaults used (owner may change later)
- Q165 (places at start): Showroom (default), Display, Locker, Karigar, Testing centre, Refining centre. The owner adds, renames or makes inactive the others. `DEFAULT: those six places, seeded; Showroom is the default and cannot be made inactive; any place can be renamed, and a place that still holds stock cannot be made inactive.`
- Q166 (transfer reason and who): the reason is optional (up to 300 characters); anyone with `inventory.edit` (owner and manager) can make a transfer. `DEFAULT: reason optional; inventory.edit.`
- Q167 (bulk sale on an invoice): the invoice sale takes from the Showroom balance until a place can be chosen on the invoice line. `DEFAULT: Showroom only; a sale Showroom cannot cover is refused.`
- Q168 (items that are not in stock): only an item in stock and not voided moves. Sold, reserved, on memo, returned, written off and voided items do not move, and a sold item keeps the place where it was sold. `DEFAULT: only in_stock moves; the transfer is refused with the status named.`
- Q169 (karigar place): the Karigar location is only a place name for now. There is no karigar record and no balance with a karigar; spec 023 adds them. `DEFAULT: a place name only.`

## 9. Acceptance checklist
- [ ] Owner approves the defaults in section 8 (Q165 to Q169)
- [x] L1 to L6, I1 to I5, B1 to B5, T1 to T5, P1 to P3 implemented and tested in `apps/api/test/stockLocations.test.ts`
- [x] Browser test `e2e/stockLocations.mjs` added to `run-all` after `stockMovements` and green
- [x] Earlier tests and browser tests still pass (inventoryItems, bulkItems, stockMovements, invoices, permissions, migrations)

Status line: built on branch `spec-020-021-inventory`, owner review pending.
