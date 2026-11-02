-- Spec 025: monthly stock reconciliation. New tables, one column, one hidden place, one replaced trigger and the two
-- reconciliation permissions. No existing business row changes.

-- Spec 025 R12: a hidden place that holds items not found at a count. It is not listed, cannot be renamed or made
-- inactive, and an item there cannot be sold.
ALTER TABLE stock_locations ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1));
--> statement-breakpoint
INSERT INTO stock_locations (id, created_at, created_by, updated_at, updated_by, name, active, hidden) VALUES
  ('loc-missing', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Missing', 1, 1);
--> statement-breakpoint
CREATE TRIGGER stock_locations_system_locked BEFORE UPDATE ON stock_locations
WHEN OLD.hidden = 1 AND (NEW.active <> OLD.active OR NEW.name <> OLD.name)
BEGIN
  SELECT RAISE(ABORT, 'system_locked: this place is kept by the system and cannot be renamed or made inactive');
END;
--> statement-breakpoint
-- Spec 025 R12: the sale guard of spec 021 S13 also refuses an item at the Missing place. Replaces the 0026 trigger.
DROP TRIGGER invoice_lines_stock_guard;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_stock_guard BEFORE INSERT ON invoice_lines
WHEN NEW.inventory_item_id IS NOT NULL AND NOT (
  EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = NEW.inventory_item_id AND i.status = 'in_stock' AND i.voided_at IS NULL AND i.location_id <> 'loc-missing'
  )
  OR EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = NEW.inventory_item_id AND i.status = 'sold' AND i.voided_at IS NULL
      AND (SELECT h.reason FROM inventory_item_history h WHERE h.item_id = i.id ORDER BY h.at DESC, h.rowid DESC LIMIT 1)
          = 'Sold on invoice ' || (SELECT v.invoice_no FROM invoices v WHERE v.id = NEW.invoice_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'item_not_in_stock: an item on this invoice is not in stock');
END;
--> statement-breakpoint
-- Spec 025 R1, R15: a reconciliation for one month and one place (or all places, when location_id is null).
CREATE TABLE stock_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  month TEXT NOT NULL CHECK (length(month) = 7 AND month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  location_id TEXT REFERENCES stock_locations (id),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  opened_at TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,
  CHECK ((status = 'open' AND closed_at IS NULL AND closed_by IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_reconciliations_open_unique ON stock_reconciliations (month, IFNULL(location_id, '*')) WHERE status = 'open';
--> statement-breakpoint
CREATE TRIGGER stock_reconciliations_no_delete BEFORE DELETE ON stock_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'stock_reconciliations rows are closed, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER stock_reconciliations_closed_no_update BEFORE UPDATE ON stock_reconciliations
WHEN OLD.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'reconciliation_closed: a closed reconciliation is never edited');
END;
--> statement-breakpoint
-- Spec 025 R2, R7, R11, R15: one line per item or bulk item and place. Lines change only while the reconciliation is open.
CREATE TABLE stock_reconciliation_lines (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  reconciliation_id TEXT NOT NULL REFERENCES stock_reconciliations (id),
  line_kind TEXT NOT NULL CHECK (line_kind IN ('item', 'bulk')),
  inventory_item_id TEXT REFERENCES inventory_items (id),
  bulk_item_id TEXT REFERENCES bulk_items (id),
  location_id TEXT NOT NULL REFERENCES stock_locations (id),
  system_status TEXT CHECK (system_status IS NULL OR system_status IN ('in_stock', 'sold', 'reserved', 'on_memo', 'returned', 'written_off')),
  system_quantity INTEGER NOT NULL CHECK (system_quantity >= 0),
  added_later INTEGER NOT NULL DEFAULT 0 CHECK (added_later IN (0, 1)),
  counted_status TEXT CHECK (counted_status IS NULL OR counted_status IN ('found', 'not_found')),
  counted_quantity INTEGER CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  expected_quantity INTEGER,
  difference INTEGER,
  adjustment_ref TEXT,
  adjustment_note TEXT,
  CHECK (
    (line_kind = 'item' AND inventory_item_id IS NOT NULL AND bulk_item_id IS NULL AND system_quantity IN (0, 1)
      AND (counted_quantity IS NULL OR counted_quantity IN (0, 1))
      AND (counted_status IS NULL OR (counted_status = 'found') = (counted_quantity = 1)))
    OR (line_kind = 'bulk' AND bulk_item_id IS NOT NULL AND inventory_item_id IS NULL AND system_status IS NULL AND counted_status IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_reconciliation_lines_item_unique ON stock_reconciliation_lines (reconciliation_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX stock_reconciliation_lines_bulk_unique ON stock_reconciliation_lines (reconciliation_id, bulk_item_id, location_id) WHERE bulk_item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX stock_reconciliation_lines_recon_idx ON stock_reconciliation_lines (reconciliation_id);
--> statement-breakpoint
CREATE TRIGGER stock_reconciliation_lines_no_delete BEFORE DELETE ON stock_reconciliation_lines
BEGIN
  SELECT RAISE(ABORT, 'stock_reconciliation_lines rows are kept, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER stock_reconciliation_lines_insert_open BEFORE INSERT ON stock_reconciliation_lines
WHEN (SELECT status FROM stock_reconciliations WHERE id = NEW.reconciliation_id) <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'reconciliation_closed: lines cannot be added to a closed reconciliation');
END;
--> statement-breakpoint
CREATE TRIGGER stock_reconciliation_lines_update_open BEFORE UPDATE ON stock_reconciliation_lines
WHEN (SELECT status FROM stock_reconciliations WHERE id = OLD.reconciliation_id) <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'reconciliation_closed: a closed reconciliation is never edited');
END;
--> statement-breakpoint
-- Spec 025 R13: owner and manager count and close; staff and viewer read.
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'reconciliation.view', '$[#]', 'reconciliation.edit') WHERE name IN ('owner', 'manager');
--> statement-breakpoint
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'reconciliation.view') WHERE name IN ('staff', 'viewer');
