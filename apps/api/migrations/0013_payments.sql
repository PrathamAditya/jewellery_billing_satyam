-- Spec 015: payments, receipts and allocations (the money model).

CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('advance', 'invoice_payment', 'at_sale', 'opening_advance', 'old_gold')),
  receipt_no TEXT,
  fy TEXT NOT NULL DEFAULT '',
  serial INTEGER,
  receipt_date TEXT NOT NULL,
  customer_id TEXT,
  payer_name TEXT NOT NULL DEFAULT '',
  payer_mobile TEXT,
  payer_pan TEXT,
  payer_address TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'card', 'cheque', 'bank_transfer', 'old_gold')),
  reference TEXT,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  order_id TEXT,
  source_ogp_id TEXT,
  remarks TEXT,
  input_json TEXT NOT NULL,
  advance_summary_json TEXT,
  header_json TEXT,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX payments_receipt_unique ON payments (fy, receipt_no) WHERE receipt_no IS NOT NULL;
--> statement-breakpoint
CREATE INDEX payments_customer_idx ON payments (customer_id);
--> statement-breakpoint
CREATE INDEX payments_date_idx ON payments (receipt_date);
--> statement-breakpoint
CREATE TABLE payment_allocations (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL,
  invoice_id TEXT,
  opening_balance_id TEXT,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  reversed_at TEXT,
  reversed_by TEXT,
  reverse_reason TEXT,
  CHECK ((invoice_id IS NULL) <> (opening_balance_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX payment_allocations_payment_idx ON payment_allocations (payment_id);
--> statement-breakpoint
CREATE INDEX payment_allocations_invoice_idx ON payment_allocations (invoice_id);
--> statement-breakpoint
-- Spec 015 M3, M4: money cannot be allocated beyond what an invoice still owes, or beyond the payment.
-- Enforced here (not only in the API), so two payments saved at the same moment cannot over-allocate.
CREATE TRIGGER payment_alloc_not_over_due BEFORE INSERT ON payment_allocations
WHEN NEW.invoice_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'exceeds_due')
  WHERE NEW.amount_paise > (SELECT payable_paise FROM invoices WHERE id = NEW.invoice_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM payment_allocations WHERE invoice_id = NEW.invoice_id AND reversed_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER payment_alloc_not_over_payment BEFORE INSERT ON payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'exceeds_payment')
  WHERE NEW.amount_paise > (SELECT amount_paise FROM payments WHERE id = NEW.payment_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM payment_allocations WHERE payment_id = NEW.payment_id AND reversed_at IS NULL);
END;
--> statement-breakpoint
-- An allocation is reversed, never changed (spec 015 M3).
CREATE TRIGGER payment_alloc_frozen BEFORE UPDATE ON payment_allocations
WHEN NEW.amount_paise <> OLD.amount_paise OR NEW.payment_id <> OLD.payment_id
  OR COALESCE(NEW.invoice_id, '') <> COALESCE(OLD.invoice_id, '')
  OR COALESCE(NEW.opening_balance_id, '') <> COALESCE(OLD.opening_balance_id, '')
BEGIN
  SELECT RAISE(ABORT, 'allocations are reversed, not changed');
END;
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payments are voided, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER payment_allocations_no_delete BEFORE DELETE ON payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'allocations are reversed, never deleted');
END;
