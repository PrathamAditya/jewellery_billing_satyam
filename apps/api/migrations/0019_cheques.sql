-- Spec 019b: cheque details on a payment, and an append-only history of the cheque's status.
-- Existing payments are not changed. Existing cheque payments get one 'received' event, dated when they were created.
ALTER TABLE payments ADD COLUMN cheque_bank TEXT;
--> statement-breakpoint
ALTER TABLE payments ADD COLUMN cheque_date TEXT;
--> statement-breakpoint
ALTER TABLE payments ADD COLUMN cheque_drawer TEXT;
--> statement-breakpoint
CREATE TABLE cheque_events (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'deposited', 'cleared', 'bounced')),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX cheque_events_payment_idx ON cheque_events (payment_id, at);
--> statement-breakpoint
CREATE TRIGGER cheque_events_no_update BEFORE UPDATE ON cheque_events
BEGIN
  SELECT RAISE(ABORT, 'cheque_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER cheque_events_no_delete BEFORE DELETE ON cheque_events
BEGIN
  SELECT RAISE(ABORT, 'cheque_events cannot be deleted');
END;
--> statement-breakpoint
INSERT INTO cheque_events (id, payment_id, status, at, actor, reason, created_at, created_by)
  SELECT lower(hex(randomblob(16))), id, 'received', created_at, created_by, NULL, created_at, created_by
  FROM payments WHERE mode = 'cheque';
