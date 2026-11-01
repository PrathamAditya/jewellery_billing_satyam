-- Spec 018: old gold purchase receipts (OGP-0001), their rows and their payouts.

CREATE TABLE old_gold_purchases (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  receipt_no TEXT NOT NULL,
  fy TEXT NOT NULL,
  serial INTEGER NOT NULL,
  receipt_date TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  payer_name TEXT NOT NULL,
  payer_mobile TEXT,
  payer_pan TEXT,
  payer_address TEXT,
  treatment TEXT NOT NULL CHECK (treatment IN ('direct_payment', 'advance', 'invoice_adjustment', 'split')),
  invoice_id TEXT,
  order_id TEXT,
  direct_paise INTEGER NOT NULL DEFAULT 0 CHECK (direct_paise >= 0),
  advance_paise INTEGER NOT NULL DEFAULT 0 CHECK (advance_paise >= 0),
  invoice_adjust_paise INTEGER NOT NULL DEFAULT 0 CHECK (invoice_adjust_paise >= 0),
  original_paise INTEGER NOT NULL CHECK (original_paise >= 0),
  round_off_paise INTEGER NOT NULL,
  final_paise INTEGER NOT NULL CHECK (final_paise > 0 AND final_paise % 100 = 0),
  settlement_note TEXT NOT NULL,
  remarks TEXT,
  input_json TEXT NOT NULL,
  header_json TEXT,
  payment_id TEXT,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX old_gold_receipt_unique ON old_gold_purchases (fy, receipt_no);
--> statement-breakpoint
CREATE INDEX old_gold_customer_idx ON old_gold_purchases (customer_id);
--> statement-breakpoint
CREATE TABLE old_gold_lines (
  id TEXT PRIMARY KEY NOT NULL,
  ogp_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  description TEXT NOT NULL,
  gross_mg INTEGER NOT NULL CHECK (gross_mg > 0),
  less_mg INTEGER NOT NULL CHECK (less_mg >= 0),
  net_mg INTEGER NOT NULL CHECK (net_mg > 0),
  karat TEXT NOT NULL,
  purity_bps INTEGER NOT NULL CHECK (purity_bps > 0 AND purity_bps <= 10000),
  rate_paise_per_kg INTEGER NOT NULL CHECK (rate_paise_per_kg > 0),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  CHECK (net_mg = gross_mg - less_mg)
);
--> statement-breakpoint
CREATE UNIQUE INDEX old_gold_lines_unique ON old_gold_lines (ogp_id, line_no);
--> statement-breakpoint
-- Money paid out to the customer for old gold (bank transfer, UPI or cheque only, owner answer 24 / Q24).
CREATE TABLE old_gold_payouts (
  id TEXT PRIMARY KEY NOT NULL,
  ogp_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('bank_transfer', 'upi', 'cheque')),
  reference TEXT,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  paid_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  voided_at TEXT,
  voided_by TEXT
);
--> statement-breakpoint
CREATE INDEX old_gold_payouts_ogp_idx ON old_gold_payouts (ogp_id);
--> statement-breakpoint
CREATE TRIGGER old_gold_purchases_no_delete BEFORE DELETE ON old_gold_purchases
BEGIN
  SELECT RAISE(ABORT, 'old gold receipts are voided, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER old_gold_lines_no_delete BEFORE DELETE ON old_gold_lines
BEGIN
  SELECT RAISE(ABORT, 'old gold rows are kept, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER old_gold_payouts_no_delete BEFORE DELETE ON old_gold_payouts
BEGIN
  SELECT RAISE(ABORT, 'payouts are voided, never deleted');
END;
