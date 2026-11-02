-- Spec 020: inventory items with an individual U No. (one ornament, or one pair), item types, and the status history.
-- New tables only, plus the two inventory permissions added to the roles that hold them. No existing row changes otherwise.

CREATE TABLE inventory_item_types (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  name TEXT NOT NULL,
  item_code TEXT NOT NULL CHECK (length(item_code) = 4 AND item_code NOT GLOB '*[^A-Z0-9]*'),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_item_types_code_unique ON inventory_item_types (item_code);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_item_types_name_unique ON inventory_item_types (name COLLATE NOCASE);
--> statement-breakpoint
CREATE TRIGGER inventory_item_types_no_delete BEFORE DELETE ON inventory_item_types
BEGIN
  SELECT RAISE(ABORT, 'inventory_item_types rows are changed, never deleted');
END;
--> statement-breakpoint
INSERT INTO inventory_item_types (id, created_at, created_by, updated_at, updated_by, name, item_code, active) VALUES
  ('type-ring', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Ring', 'RING', 1),
  ('type-chain', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Chain', 'CHAI', 1),
  ('type-earring', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Earring', 'EARR', 1),
  ('type-bangle', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Bangle', 'BANG', 1),
  ('type-necklace', '2026-11-02T00:00:00.000Z', 'system', '2026-11-02T00:00:00.000Z', 'system', 'Necklace', 'NECK', 1);
--> statement-breakpoint
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  u_no TEXT NOT NULL CHECK (length(u_no) = 6 AND substr(u_no, 1, 4) = item_code AND serial BETWEEN 1 AND 99),
  item_code TEXT NOT NULL CHECK (length(item_code) = 4),
  serial INTEGER NOT NULL,
  type_id TEXT NOT NULL REFERENCES inventory_item_types (id),
  pieces INTEGER NOT NULL DEFAULT 1 CHECK (pieces BETWEEN 1 AND 10),
  metal TEXT NOT NULL CHECK (metal IN ('gold', 'silver')),
  purity TEXT NOT NULL CHECK (purity IN ('22K916', '24K995', 'silver', '18K750', '14K', '24K999', 'other')),
  gross_weight_mg INTEGER NOT NULL CHECK (gross_weight_mg > 0),
  net_weight_mg INTEGER NOT NULL CHECK (net_weight_mg > 0 AND net_weight_mg <= gross_weight_mg),
  hsn TEXT NOT NULL CHECK (hsn IN ('7113', '9988')),
  labour_note TEXT,
  location TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_stock', 'sold', 'reserved', 'on_memo', 'returned', 'written_off')),
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_items_u_no_unique ON inventory_items (u_no) WHERE voided_at IS NULL;
--> statement-breakpoint
CREATE INDEX inventory_items_code_serial_idx ON inventory_items (item_code, serial);
--> statement-breakpoint
CREATE INDEX inventory_items_status_idx ON inventory_items (status);
--> statement-breakpoint
CREATE TRIGGER inventory_items_no_delete BEFORE DELETE ON inventory_items
BEGIN
  SELECT RAISE(ABORT, 'inventory_items rows are voided, never deleted');
END;
--> statement-breakpoint
CREATE TABLE inventory_item_history (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES inventory_items (id),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('in_stock', 'sold', 'reserved', 'on_memo', 'returned', 'written_off')),
  to_status TEXT NOT NULL CHECK (to_status IN ('in_stock', 'sold', 'reserved', 'on_memo', 'returned', 'written_off')),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX inventory_item_history_item_idx ON inventory_item_history (item_id, at);
--> statement-breakpoint
CREATE TRIGGER inventory_item_history_no_update BEFORE UPDATE ON inventory_item_history
BEGIN
  SELECT RAISE(ABORT, 'inventory_item_history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER inventory_item_history_no_delete BEFORE DELETE ON inventory_item_history
BEGIN
  SELECT RAISE(ABORT, 'inventory_item_history is append-only');
END;
--> statement-breakpoint
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'inventory.view', '$[#]', 'inventory.edit') WHERE name IN ('owner', 'manager');
--> statement-breakpoint
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'inventory.view') WHERE name IN ('staff', 'viewer');
