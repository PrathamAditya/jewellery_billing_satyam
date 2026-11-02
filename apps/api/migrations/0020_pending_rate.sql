-- Spec 019c: credit sales with the rate fixed later.
-- A sale waits for its rate with rate_status 'pending' (payable stored as 0, not an amount). Existing invoices become 'fixed'.
-- A payment received against a pending sale is an advance linked to it (pending_invoice_id). No existing row is changed.
ALTER TABLE invoices ADD COLUMN rate_status TEXT NOT NULL DEFAULT 'fixed' CHECK (rate_status IN ('fixed', 'pending'));
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN rate_fixed_on TEXT;
--> statement-breakpoint
ALTER TABLE payments ADD COLUMN pending_invoice_id TEXT;
--> statement-breakpoint
CREATE INDEX payments_pending_invoice_idx ON payments (pending_invoice_id);
