-- Spec 032: daily cash closing. One closing per business date. Closings and their notes are never edited or deleted.

CREATE TABLE cash_closings (
  id TEXT PRIMARY KEY NOT NULL,
  business_date TEXT NOT NULL UNIQUE,
  opening_paise INTEGER NOT NULL CHECK (opening_paise >= 0),
  expected_paise INTEGER NOT NULL,
  counted_paise INTEGER NOT NULL CHECK (counted_paise >= 0),
  difference_paise INTEGER NOT NULL,
  reason TEXT,
  totals_json TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK (difference_paise = counted_paise - expected_paise),
  CHECK (difference_paise = 0 OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);
--> statement-breakpoint
CREATE TABLE cash_closing_notes (
  id TEXT PRIMARY KEY NOT NULL,
  business_date TEXT NOT NULL,
  note TEXT NOT NULL CHECK (length(trim(note)) > 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX cash_closing_notes_date_idx ON cash_closing_notes (business_date, created_at);
--> statement-breakpoint
-- A correction can only be written against a day that is closed.
CREATE TRIGGER cash_closing_notes_needs_close BEFORE INSERT ON cash_closing_notes
WHEN NOT EXISTS (SELECT 1 FROM cash_closings WHERE business_date = NEW.business_date)
BEGIN
  SELECT RAISE(ABORT, 'day_not_closed');
END;
--> statement-breakpoint
CREATE TRIGGER cash_closings_no_update BEFORE UPDATE ON cash_closings
BEGIN
  SELECT RAISE(ABORT, 'cash closings are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER cash_closings_no_delete BEFORE DELETE ON cash_closings
BEGIN
  SELECT RAISE(ABORT, 'cash closings are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER cash_closing_notes_no_update BEFORE UPDATE ON cash_closing_notes
BEGIN
  SELECT RAISE(ABORT, 'cash closing notes are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER cash_closing_notes_no_delete BEFORE DELETE ON cash_closing_notes
BEGIN
  SELECT RAISE(ABORT, 'cash closing notes are never deleted');
END;
--> statement-breakpoint
-- Roles are data, seeded by 0012. Owner and manager may close the day (cash.close).
-- The owner's role is extended in place, so any change made on the People screen is kept.
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'cash.close')
  WHERE name IN ('owner', 'manager')
    AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions_json) WHERE value = 'cash.close');
--> statement-breakpoint
-- Spec 051: the audit history is for the owner. Manager and view-only lose audit.view, which 0012 had given them.
UPDATE roles SET permissions_json = (SELECT json_group_array(value) FROM json_each(roles.permissions_json) WHERE value <> 'audit.view')
  WHERE name IN ('manager', 'viewer');
