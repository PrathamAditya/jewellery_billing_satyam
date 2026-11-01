-- Spec 017: the settlement page keeps its remarks (one row per invoice; changes are revisions).
CREATE TABLE invoice_settlements (
  invoice_id TEXT PRIMARY KEY NOT NULL,
  remarks TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER invoice_settlements_no_delete BEFORE DELETE ON invoice_settlements
BEGIN
  SELECT RAISE(ABORT, 'settlement remarks are changed, never deleted');
END;
