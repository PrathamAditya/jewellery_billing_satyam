-- Spec 021b: stock locations and transfers. New tables, columns (every existing row reads as Showroom),
-- a view, and the bulk balance guard replaced so it works per location. No existing row changes otherwise.
-- inventory_items.location_id and bulk_item_movements.location_id carry no REFERENCES clause: D1 refuses to add a
-- referencing column with a non-null default, so the unknown-location triggers below do that job.

CREATE TABLE stock_locations (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_locations_name_unique ON stock_locations (name COLLATE NOCASE);
--> statement-breakpoint
CREATE TRIGGER stock_locations_no_delete BEFORE DELETE ON stock_locations
BEGIN
  SELECT RAISE(ABORT, 'stock_locations rows are changed, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER stock_locations_showroom_stays_active BEFORE UPDATE OF active ON stock_locations
WHEN OLD.id = 'loc-showroom' AND NEW.active = 0
BEGIN
  SELECT RAISE(ABORT, 'showroom_locked: the Showroom location cannot be made inactive');
END;
--> statement-breakpoint
INSERT INTO stock_locations (id, created_at, created_by, updated_at, updated_by, name, active) VALUES
  ('loc-showroom', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Showroom', 1),
  ('loc-display', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Display', 1),
  ('loc-locker', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Locker', 1),
  ('loc-karigar', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Karigar', 1),
  ('loc-testing', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Testing centre', 1),
  ('loc-refining', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Refining centre', 1);
--> statement-breakpoint
ALTER TABLE inventory_items ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc-showroom';
--> statement-breakpoint
ALTER TABLE bulk_item_movements ADD COLUMN location_id TEXT NOT NULL DEFAULT 'loc-showroom';
--> statement-breakpoint
CREATE TRIGGER inventory_items_location_known BEFORE INSERT ON inventory_items
WHEN NOT EXISTS (SELECT 1 FROM stock_locations WHERE id = NEW.location_id)
BEGIN
  SELECT RAISE(ABORT, 'unknown_location: the stock location does not exist');
END;
--> statement-breakpoint
CREATE TRIGGER inventory_items_location_update_known BEFORE UPDATE OF location_id ON inventory_items
WHEN NOT EXISTS (SELECT 1 FROM stock_locations WHERE id = NEW.location_id)
BEGIN
  SELECT RAISE(ABORT, 'unknown_location: the stock location does not exist');
END;
--> statement-breakpoint
CREATE TRIGGER bulk_item_movements_location_known BEFORE INSERT ON bulk_item_movements
WHEN NOT EXISTS (SELECT 1 FROM stock_locations WHERE id = NEW.location_id)
BEGIN
  SELECT RAISE(ABORT, 'unknown_location: the stock location does not exist');
END;
--> statement-breakpoint
CREATE TABLE stock_transfers (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('item', 'bulk')),
  inventory_item_id TEXT REFERENCES inventory_items (id),
  bulk_item_id TEXT REFERENCES bulk_items (id),
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  from_location_id TEXT NOT NULL REFERENCES stock_locations (id),
  to_location_id TEXT NOT NULL REFERENCES stock_locations (id),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  CHECK (from_location_id <> to_location_id),
  CHECK (
    (kind = 'item' AND inventory_item_id IS NOT NULL AND bulk_item_id IS NULL AND quantity = 1)
    OR (kind = 'bulk' AND bulk_item_id IS NOT NULL AND inventory_item_id IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX stock_transfers_item_idx ON stock_transfers (inventory_item_id, at);
--> statement-breakpoint
CREATE INDEX stock_transfers_bulk_idx ON stock_transfers (bulk_item_id, at);
--> statement-breakpoint
CREATE INDEX stock_transfers_at_idx ON stock_transfers (at);
--> statement-breakpoint
CREATE TRIGGER stock_transfers_no_update BEFORE UPDATE ON stock_transfers
BEGIN
  SELECT RAISE(ABORT, 'stock_transfers is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER stock_transfers_no_delete BEFORE DELETE ON stock_transfers
BEGIN
  SELECT RAISE(ABORT, 'stock_transfers is append-only');
END;
--> statement-breakpoint
-- Spec 021b B4: a bulk transfer may not take more than the balance at its from location.
CREATE TRIGGER stock_transfers_bulk_not_below_zero BEFORE INSERT ON stock_transfers
WHEN NEW.kind = 'bulk' AND (
  (SELECT COALESCE(SUM(m.quantity_change), 0) FROM bulk_item_movements m WHERE m.bulk_item_id = NEW.bulk_item_id AND m.location_id = NEW.from_location_id)
  + (SELECT COALESCE(SUM(t.quantity), 0) FROM stock_transfers t WHERE t.bulk_item_id = NEW.bulk_item_id AND t.to_location_id = NEW.from_location_id)
  - (SELECT COALESCE(SUM(t.quantity), 0) FROM stock_transfers t WHERE t.bulk_item_id = NEW.bulk_item_id AND t.from_location_id = NEW.from_location_id)
) < NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'quantity_below_zero: not enough of the bulk item at the from location');
END;
--> statement-breakpoint
-- Spec 021b B3: replaces the spec 020b total check. A movement may not take its location below zero.
DROP TRIGGER bulk_item_movements_not_below_zero;
--> statement-breakpoint
CREATE TRIGGER bulk_item_movements_not_below_zero BEFORE INSERT ON bulk_item_movements
WHEN (
  (SELECT COALESCE(SUM(m.quantity_change), 0) FROM bulk_item_movements m WHERE m.bulk_item_id = NEW.bulk_item_id AND m.location_id = NEW.location_id)
  + (SELECT COALESCE(SUM(t.quantity), 0) FROM stock_transfers t WHERE t.bulk_item_id = NEW.bulk_item_id AND t.to_location_id = NEW.location_id)
  - (SELECT COALESCE(SUM(t.quantity), 0) FROM stock_transfers t WHERE t.bulk_item_id = NEW.bulk_item_id AND t.from_location_id = NEW.location_id)
  + NEW.quantity_change
) < 0
BEGIN
  SELECT RAISE(ABORT, 'quantity_below_zero');
END;
--> statement-breakpoint
-- Spec 021b B2: the balance of every bulk item at every active location.
CREATE VIEW bulk_item_location_quantities AS
  SELECT b.id AS bulk_item_id,
         l.id AS location_id,
         COALESCE((SELECT SUM(m.quantity_change) FROM bulk_item_movements m WHERE m.bulk_item_id = b.id AND m.location_id = l.id), 0)
         + COALESCE((SELECT SUM(t.quantity) FROM stock_transfers t WHERE t.bulk_item_id = b.id AND t.to_location_id = l.id), 0)
         - COALESCE((SELECT SUM(t.quantity) FROM stock_transfers t WHERE t.bulk_item_id = b.id AND t.from_location_id = l.id), 0) AS quantity
  FROM bulk_items b
  CROSS JOIN stock_locations l
  WHERE l.active = 1;
