-- Spec 020b: bulk quantity items (Tilli and similar). A quantity is the sum of its append-only movements.
-- New tables and a view only. No existing row changes.

CREATE TABLE bulk_items (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) > 0),
  unit TEXT NOT NULL CHECK (unit IN ('pcs', 'pairs', 'sets', 'packets'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX bulk_items_name_unique ON bulk_items (name COLLATE NOCASE);
--> statement-breakpoint
CREATE TRIGGER bulk_items_no_delete BEFORE DELETE ON bulk_items
BEGIN
  SELECT RAISE(ABORT, 'bulk_items rows are changed, never deleted');
END;
--> statement-breakpoint
CREATE TABLE bulk_item_movements (
  id TEXT PRIMARY KEY NOT NULL,
  bulk_item_id TEXT NOT NULL REFERENCES bulk_items (id),
  kind TEXT NOT NULL CHECK (kind IN ('received', 'sold', 'adjusted')),
  quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  CHECK ((kind = 'received' AND quantity_change > 0) OR (kind = 'sold' AND quantity_change < 0) OR kind = 'adjusted')
);
--> statement-breakpoint
CREATE INDEX bulk_item_movements_item_idx ON bulk_item_movements (bulk_item_id, at);
--> statement-breakpoint
CREATE TRIGGER bulk_item_movements_no_update BEFORE UPDATE ON bulk_item_movements
BEGIN
  SELECT RAISE(ABORT, 'bulk_item_movements is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER bulk_item_movements_no_delete BEFORE DELETE ON bulk_item_movements
BEGIN
  SELECT RAISE(ABORT, 'bulk_item_movements is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER bulk_item_movements_not_below_zero BEFORE INSERT ON bulk_item_movements
WHEN (SELECT COALESCE(SUM(quantity_change), 0) FROM bulk_item_movements WHERE bulk_item_id = NEW.bulk_item_id) + NEW.quantity_change < 0
BEGIN
  SELECT RAISE(ABORT, 'quantity_below_zero');
END;
--> statement-breakpoint
CREATE VIEW bulk_item_quantities AS
  SELECT b.id AS bulk_item_id,
         COALESCE((SELECT SUM(m.quantity_change) FROM bulk_item_movements m WHERE m.bulk_item_id = b.id), 0) AS quantity
  FROM bulk_items b;
