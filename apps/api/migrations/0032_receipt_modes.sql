-- Feedback point 3: one receipt with several payment modes (cash and UPI on the same receipt).
-- A receipt with more than one mode is stored as one payment row per mode: the first row (the "lead") owns the receipt
-- number, and each further row points at it with lead_payment_id and repeats the same number. Every row keeps its own
-- mode, amount, allocations and cheque details, so cash closing, reports and the ledger keep adding up by mode.
-- A single-mode receipt is unchanged (lead_payment_id stays NULL). No existing row is changed.

ALTER TABLE payments ADD COLUMN lead_payment_id TEXT;
--> statement-breakpoint
-- Only the lead row of a receipt must have a unique number: the further rows repeat it on purpose.
DROP INDEX payments_receipt_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX payments_receipt_unique ON payments (fy, receipt_no) WHERE receipt_no IS NOT NULL AND lead_payment_id IS NULL;
--> statement-breakpoint
CREATE INDEX payments_lead_idx ON payments (lead_payment_id) WHERE lead_payment_id IS NOT NULL;
