-- Spec 019d: returns, exchanges and credit notes. New tables only, plus the allocation trigger
-- that must also respect credit applications. No existing row changes.

CREATE TABLE credit_notes (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  cn_no TEXT NOT NULL,
  fy TEXT NOT NULL,
  serial INTEGER NOT NULL,
  cn_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credit', 'exchange', 'old_gold')),
  invoice_id TEXT NOT NULL,
  invoice_revision_no INTEGER NOT NULL,
  replacement_invoice_id TEXT,
  ogp_id TEXT,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  customer_mobile TEXT,
  customer_address TEXT,
  customer_pan TEXT,
  tax_mode TEXT NOT NULL CHECK (tax_mode IN ('intra', 'inter')),
  reason TEXT NOT NULL,
  taxable_paise INTEGER NOT NULL CHECK (taxable_paise > 0),
  tax_paise INTEGER NOT NULL CHECK (tax_paise >= 0),
  total_before_round_off_paise INTEGER NOT NULL,
  round_off_paise INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0 AND amount_paise % 100 = 0),
  calc_json TEXT NOT NULL,
  header_json TEXT,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  CHECK ((kind = 'exchange') = (replacement_invoice_id IS NOT NULL)),
  CHECK ((kind = 'old_gold') = (ogp_id IS NOT NULL))
);
--> statement-breakpoint
-- Numbers are unique within a financial year (the same rule as receipts, spec 015 M6).
CREATE UNIQUE INDEX credit_notes_no_unique ON credit_notes (fy, cn_no);
--> statement-breakpoint
CREATE INDEX credit_notes_invoice_idx ON credit_notes (invoice_id);
--> statement-breakpoint
CREATE INDEX credit_notes_customer_idx ON credit_notes (customer_id);
--> statement-breakpoint
CREATE INDEX credit_notes_date_idx ON credit_notes (cn_date);
--> statement-breakpoint
-- Spec 019d R9: one live credit note per old gold receipt.
CREATE UNIQUE INDEX credit_notes_ogp_unique ON credit_notes (ogp_id) WHERE ogp_id IS NOT NULL AND voided_at IS NULL;
--> statement-breakpoint
CREATE TABLE credit_note_lines (
  id TEXT PRIMARY KEY NOT NULL,
  credit_note_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  invoice_line_no INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hsn TEXT NOT NULL,
  gst_rate_bps INTEGER NOT NULL,
  taxable_paise INTEGER NOT NULL CHECK (taxable_paise > 0),
  tax_paise INTEGER NOT NULL CHECK (tax_paise >= 0),
  inventory_item_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX credit_note_lines_unique ON credit_note_lines (credit_note_id, line_no);
--> statement-breakpoint
CREATE INDEX credit_note_lines_original_idx ON credit_note_lines (invoice_line_no);
--> statement-breakpoint
CREATE TABLE credit_applications (
  id TEXT PRIMARY KEY NOT NULL,
  credit_note_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  reversed_at TEXT,
  reversed_by TEXT,
  reverse_reason TEXT
);
--> statement-breakpoint
CREATE INDEX credit_applications_invoice_idx ON credit_applications (invoice_id);
--> statement-breakpoint
CREATE INDEX credit_applications_note_idx ON credit_applications (credit_note_id);
--> statement-breakpoint
CREATE TABLE credit_note_payouts (
  id TEXT PRIMARY KEY NOT NULL,
  credit_note_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'bank_transfer', 'cheque')),
  reference TEXT,
  paid_date TEXT NOT NULL,
  remarks TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  reversed_at TEXT,
  reversed_by TEXT,
  reverse_reason TEXT
);
--> statement-breakpoint
CREATE INDEX credit_note_payouts_note_idx ON credit_note_payouts (credit_note_id);
--> statement-breakpoint
-- Spec 019d R4: a credit note never credits more than the bill less its other live credit notes.
CREATE TRIGGER credit_notes_not_over_bill BEFORE INSERT ON credit_notes
BEGIN
  SELECT RAISE(ABORT, 'exceeds_invoice')
  WHERE NEW.amount_paise > (SELECT payable_paise FROM invoices WHERE id = NEW.invoice_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM credit_notes WHERE invoice_id = NEW.invoice_id AND voided_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER credit_notes_frozen BEFORE UPDATE ON credit_notes
WHEN NEW.amount_paise <> OLD.amount_paise OR NEW.cn_no <> OLD.cn_no OR NEW.kind <> OLD.kind
  OR NEW.invoice_id <> OLD.invoice_id OR NEW.invoice_revision_no <> OLD.invoice_revision_no
  OR COALESCE(NEW.ogp_id, '') <> COALESCE(OLD.ogp_id, '')
  OR COALESCE(NEW.replacement_invoice_id, '') <> COALESCE(OLD.replacement_invoice_id, '')
  OR NEW.taxable_paise <> OLD.taxable_paise OR NEW.tax_paise <> OLD.tax_paise
BEGIN
  SELECT RAISE(ABORT, 'credit notes are not changed; void it and issue a new one');
END;
--> statement-breakpoint
CREATE TRIGGER credit_note_lines_frozen BEFORE UPDATE ON credit_note_lines
BEGIN
  SELECT RAISE(ABORT, 'credit note lines are not changed');
END;
--> statement-breakpoint
-- Spec 019d R7 to R11: an application never takes an invoice above what it still owes ...
CREATE TRIGGER credit_app_not_over_due BEFORE INSERT ON credit_applications
BEGIN
  SELECT RAISE(ABORT, 'exceeds_due')
  WHERE NEW.amount_paise > (SELECT payable_paise FROM invoices WHERE id = NEW.invoice_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM payment_allocations WHERE invoice_id = NEW.invoice_id AND reversed_at IS NULL)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM credit_applications WHERE invoice_id = NEW.invoice_id AND reversed_at IS NULL);
END;
--> statement-breakpoint
-- ... and never takes more than the credit note still holds (spec 019d R10).
CREATE TRIGGER credit_app_not_over_credit BEFORE INSERT ON credit_applications
BEGIN
  SELECT RAISE(ABORT, 'exceeds_credit')
  WHERE NEW.amount_paise > (SELECT amount_paise FROM credit_notes WHERE id = NEW.credit_note_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM credit_applications WHERE credit_note_id = NEW.credit_note_id AND reversed_at IS NULL)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM credit_note_payouts WHERE credit_note_id = NEW.credit_note_id AND reversed_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER credit_app_frozen BEFORE UPDATE ON credit_applications
WHEN NEW.amount_paise <> OLD.amount_paise OR NEW.credit_note_id <> OLD.credit_note_id OR NEW.invoice_id <> OLD.invoice_id
BEGIN
  SELECT RAISE(ABORT, 'credit applications are reversed, not changed');
END;
--> statement-breakpoint
CREATE TRIGGER credit_payout_not_over_credit BEFORE INSERT ON credit_note_payouts
BEGIN
  SELECT RAISE(ABORT, 'exceeds_credit')
  WHERE NEW.amount_paise > (SELECT amount_paise FROM credit_notes WHERE id = NEW.credit_note_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM credit_applications WHERE credit_note_id = NEW.credit_note_id AND reversed_at IS NULL)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM credit_note_payouts WHERE credit_note_id = NEW.credit_note_id AND reversed_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER credit_payout_frozen BEFORE UPDATE ON credit_note_payouts
WHEN NEW.amount_paise <> OLD.amount_paise OR NEW.credit_note_id <> OLD.credit_note_id OR NEW.mode <> OLD.mode OR NEW.paid_date <> OLD.paid_date
BEGIN
  SELECT RAISE(ABORT, 'payouts are reversed, not changed');
END;
--> statement-breakpoint
CREATE TRIGGER credit_notes_no_delete BEFORE DELETE ON credit_notes
BEGIN
  SELECT RAISE(ABORT, 'credit notes are voided, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER credit_note_lines_no_delete BEFORE DELETE ON credit_note_lines
BEGIN
  SELECT RAISE(ABORT, 'credit note lines are never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER credit_applications_no_delete BEFORE DELETE ON credit_applications
BEGIN
  SELECT RAISE(ABORT, 'credit applications are reversed, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER credit_note_payouts_no_delete BEFORE DELETE ON credit_note_payouts
BEGIN
  SELECT RAISE(ABORT, 'credit note payouts are reversed, never deleted');
END;
--> statement-breakpoint
-- Spec 015 M4 (changed by 019d R7): an allocation also respects the credit applications on the invoice.
DROP TRIGGER IF EXISTS payment_alloc_not_over_due;
--> statement-breakpoint
CREATE TRIGGER payment_alloc_not_over_due BEFORE INSERT ON payment_allocations
WHEN NEW.invoice_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'exceeds_due')
  WHERE NEW.amount_paise > (SELECT payable_paise FROM invoices WHERE id = NEW.invoice_id)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM payment_allocations WHERE invoice_id = NEW.invoice_id AND reversed_at IS NULL)
      - (SELECT COALESCE(SUM(amount_paise), 0) FROM credit_applications WHERE invoice_id = NEW.invoice_id AND reversed_at IS NULL);
END;
