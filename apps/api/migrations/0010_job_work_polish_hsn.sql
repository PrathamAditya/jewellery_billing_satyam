ALTER TABLE invoice_lines ADD COLUMN polish_bps INTEGER NOT NULL DEFAULT 0 CHECK (polish_bps >= 0 AND polish_bps <= 10000);
