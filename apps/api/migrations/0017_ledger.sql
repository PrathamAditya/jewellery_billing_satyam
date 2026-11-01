-- Spec 019: opening balances (what customers owed or held in the old system). Not sales, not receipts.
CREATE TABLE opening_balances (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  as_of_date TEXT NOT NULL,
  reference TEXT,
  remarks TEXT,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT
);
--> statement-breakpoint
CREATE INDEX opening_balances_customer_idx ON opening_balances (customer_id);
--> statement-breakpoint
-- Money cannot be allocated beyond what an opening receivable still owes (same rule as invoices).
CREATE TRIGGER payment_alloc_not_over_opening BEFORE INSERT ON payment_allocations
WHEN NEW.opening_balance_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'exceeds_due')
  WHERE NEW.amount_paise > (SELECT amount_paise FROM opening_balances WHERE id = NEW.opening_balance_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM payment_allocations WHERE opening_balance_id = NEW.opening_balance_id AND reversed_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER opening_balances_no_delete BEFORE DELETE ON opening_balances
BEGIN
  SELECT RAISE(ABORT, 'opening balances are voided, never deleted');
END;
