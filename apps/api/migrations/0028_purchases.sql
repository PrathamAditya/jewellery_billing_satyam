-- Spec 022: purchases of three types (finished, raw gold and silver, karigar-made), raw metal stock by metal,
-- purity and place, and the purchases.view and purchases.edit permissions. New tables, triggers, a view and role
-- permissions only; no existing row changes. purchases.location_id carries no REFERENCES clause (a non-null default
-- cannot be combined with one in D1, spec 021b); the unknown-location trigger does that job.

CREATE TABLE purchases (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  purchase_no TEXT NOT NULL CHECK (length(purchase_no) > 0),
  fy TEXT NOT NULL,
  serial INTEGER NOT NULL CHECK (serial >= 1),
  purchase_type TEXT NOT NULL CHECK (purchase_type IN ('finished', 'raw_metal', 'karigar_made')),
  purchase_date TEXT NOT NULL CHECK (purchase_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  supplier_name TEXT NOT NULL CHECK (length(trim(supplier_name)) > 0),
  supplier_bill_no TEXT,
  karigar_name TEXT,
  location_id TEXT NOT NULL DEFAULT 'loc-showroom',
  remarks TEXT,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  CHECK ((purchase_type = 'karigar_made' AND karigar_name IS NOT NULL AND length(trim(karigar_name)) > 0) OR (purchase_type <> 'karigar_made' AND karigar_name IS NULL)),
  CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL))
);
--> statement-breakpoint
-- Numbers restart each financial year (like invoices, migration 0011), so the number is unique within its year.
CREATE UNIQUE INDEX purchases_fy_no_unique ON purchases (fy, purchase_no);
--> statement-breakpoint
CREATE INDEX purchases_date_idx ON purchases (purchase_date, created_at);
--> statement-breakpoint
CREATE TRIGGER purchases_no_delete BEFORE DELETE ON purchases
BEGIN
  SELECT RAISE(ABORT, 'purchases rows are voided, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER purchases_location_known BEFORE INSERT ON purchases
WHEN NOT EXISTS (SELECT 1 FROM stock_locations WHERE id = NEW.location_id)
BEGIN
  SELECT RAISE(ABORT, 'unknown_location: the stock location does not exist');
END;
--> statement-breakpoint
-- A purchase changes once: the void columns are set, and nothing else ever changes.
CREATE TRIGGER purchases_update_guard BEFORE UPDATE ON purchases
WHEN OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at
  OR NEW.purchase_no IS NOT OLD.purchase_no OR NEW.fy IS NOT OLD.fy OR NEW.serial IS NOT OLD.serial
  OR NEW.purchase_type IS NOT OLD.purchase_type OR NEW.purchase_date IS NOT OLD.purchase_date
  OR NEW.supplier_name IS NOT OLD.supplier_name OR NEW.supplier_bill_no IS NOT OLD.supplier_bill_no
  OR NEW.karigar_name IS NOT OLD.karigar_name OR NEW.location_id IS NOT OLD.location_id OR NEW.remarks IS NOT OLD.remarks
BEGIN
  SELECT RAISE(ABORT, 'purchases change only once, to be voided');
END;
--> statement-breakpoint
CREATE TABLE purchase_lines (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES purchases (id),
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  line_kind TEXT NOT NULL CHECK (line_kind IN ('item', 'bulk', 'raw_metal', 'metal_used')),
  inventory_item_id TEXT REFERENCES inventory_items (id),
  bulk_item_id TEXT REFERENCES bulk_items (id),
  quantity INTEGER,
  metal TEXT CHECK (metal IS NULL OR metal IN ('gold', 'silver')),
  purity TEXT,
  weight_mg INTEGER,
  amount_paise INTEGER CHECK (amount_paise IS NULL OR amount_paise >= 0),
  UNIQUE (purchase_id, line_no),
  CHECK (
    (line_kind = 'item' AND inventory_item_id IS NOT NULL AND bulk_item_id IS NULL AND quantity IS NULL AND metal IS NULL AND purity IS NULL AND weight_mg IS NULL)
    OR (line_kind = 'bulk' AND bulk_item_id IS NOT NULL AND quantity IS NOT NULL AND quantity >= 1 AND inventory_item_id IS NULL AND metal IS NULL AND purity IS NULL AND weight_mg IS NULL)
    OR (line_kind IN ('raw_metal', 'metal_used') AND metal IS NOT NULL AND purity IS NOT NULL AND weight_mg IS NOT NULL AND weight_mg >= 1 AND inventory_item_id IS NULL AND bulk_item_id IS NULL AND quantity IS NULL)
  )
);
--> statement-breakpoint
-- The line kind must fit the purchase type (a CHECK cannot read another table).
CREATE TRIGGER purchase_lines_kind_fits_type BEFORE INSERT ON purchase_lines
WHEN NOT EXISTS (
  SELECT 1 FROM purchases p
  WHERE p.id = NEW.purchase_id AND (
    (p.purchase_type = 'finished' AND NEW.line_kind IN ('item', 'bulk'))
    OR (p.purchase_type = 'raw_metal' AND NEW.line_kind = 'raw_metal')
    OR (p.purchase_type = 'karigar_made' AND NEW.line_kind IN ('item', 'metal_used'))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_purchase_line: this kind of line does not belong to this purchase type');
END;
--> statement-breakpoint
CREATE INDEX purchase_lines_purchase_idx ON purchase_lines (purchase_id);
--> statement-breakpoint
CREATE TRIGGER purchase_lines_no_update BEFORE UPDATE ON purchase_lines
BEGIN
  SELECT RAISE(ABORT, 'purchase_lines is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER purchase_lines_no_delete BEFORE DELETE ON purchase_lines
BEGIN
  SELECT RAISE(ABORT, 'purchase_lines is append-only');
END;
--> statement-breakpoint
-- Spec 022: raw gold and silver, by metal, purity and place, in whole milligrams. Append-only.
CREATE TABLE raw_metal_movements (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  metal TEXT NOT NULL CHECK (metal IN ('gold', 'silver')),
  purity TEXT NOT NULL CHECK (length(trim(purity)) > 0),
  weight_mg INTEGER NOT NULL CHECK (weight_mg <> 0),
  location_id TEXT NOT NULL REFERENCES stock_locations (id),
  purchase_id TEXT REFERENCES purchases (id),
  purchase_line_id TEXT REFERENCES purchase_lines (id),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT
);
--> statement-breakpoint
CREATE INDEX raw_metal_movements_key_idx ON raw_metal_movements (metal, purity, location_id);
--> statement-breakpoint
CREATE INDEX raw_metal_movements_purchase_idx ON raw_metal_movements (purchase_id);
--> statement-breakpoint
CREATE TRIGGER raw_metal_movements_no_update BEFORE UPDATE ON raw_metal_movements
BEGIN
  SELECT RAISE(ABORT, 'raw_metal_movements is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER raw_metal_movements_no_delete BEFORE DELETE ON raw_metal_movements
BEGIN
  SELECT RAISE(ABORT, 'raw_metal_movements is append-only');
END;
--> statement-breakpoint
-- Spec 022 PU23: the raw balance of a metal, purity and place may not go below zero.
CREATE TRIGGER raw_metal_movements_not_below_zero BEFORE INSERT ON raw_metal_movements
WHEN (
  SELECT COALESCE(SUM(r.weight_mg), 0) FROM raw_metal_movements r
  WHERE r.metal = NEW.metal AND r.purity = NEW.purity AND r.location_id = NEW.location_id
) + NEW.weight_mg < 0
BEGIN
  SELECT RAISE(ABORT, 'raw_stock_below_zero: not enough raw metal of this purity at this place');
END;
--> statement-breakpoint
CREATE VIEW raw_metal_balances AS
  SELECT metal, purity, location_id, SUM(weight_mg) AS weight_mg
  FROM raw_metal_movements
  GROUP BY metal, purity, location_id;
--> statement-breakpoint
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'purchases.view', '$[#]', 'purchases.edit') WHERE name IN ('owner', 'manager');
--> statement-breakpoint
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'purchases.view') WHERE name IN ('staff', 'viewer');
