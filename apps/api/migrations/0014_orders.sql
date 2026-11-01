-- Spec 016: orders (ORD-0001) and refunds of advances.

CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  order_no TEXT NOT NULL,
  fy TEXT NOT NULL,
  serial INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expected_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  remarks TEXT,
  header_json TEXT,
  cancel_resolution TEXT,
  closed_at TEXT,
  cancelled_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX orders_fy_no_unique ON orders (fy, order_no);
--> statement-breakpoint
CREATE INDEX orders_customer_idx ON orders (customer_id);
--> statement-breakpoint
CREATE TABLE payment_refunds (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'bank_transfer', 'cheque')),
  reference TEXT,
  refund_date TEXT NOT NULL,
  remarks TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  reversed_at TEXT,
  reversed_by TEXT,
  reverse_reason TEXT
);
--> statement-breakpoint
CREATE INDEX payment_refunds_payment_idx ON payment_refunds (payment_id);
--> statement-breakpoint
-- A refund can never be more than what the payment still holds (spec 016 R8, spec 015 M2).
CREATE TRIGGER payment_refund_not_over_remaining BEFORE INSERT ON payment_refunds
BEGIN
  SELECT RAISE(ABORT, 'exceeds_payment')
  WHERE NEW.amount_paise > (SELECT amount_paise FROM payments WHERE id = NEW.payment_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM payment_allocations WHERE payment_id = NEW.payment_id AND reversed_at IS NULL)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM payment_refunds WHERE payment_id = NEW.payment_id AND reversed_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER payment_refunds_frozen BEFORE UPDATE ON payment_refunds
WHEN NEW.amount_paise <> OLD.amount_paise OR NEW.payment_id <> OLD.payment_id
BEGIN
  SELECT RAISE(ABORT, 'refunds are reversed, not changed');
END;
--> statement-breakpoint
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
BEGIN
  SELECT RAISE(ABORT, 'orders are cancelled, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER payment_refunds_no_delete BEFORE DELETE ON payment_refunds
BEGIN
  SELECT RAISE(ABORT, 'refunds are reversed, never deleted');
END;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN order_id TEXT;
