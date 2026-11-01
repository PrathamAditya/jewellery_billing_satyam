-- Spec 012c: pricing modes (weight, separate stone, combined total) and discounts on gold, labour and total.
-- Existing lines keep their meaning: pricing mode 'weight', no stone, no discount, taxable = amount.
ALTER TABLE invoice_lines ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'weight' CHECK (pricing_mode IN ('weight', 'separate', 'combined'));
ALTER TABLE invoice_lines ADD COLUMN stone_weight_mg INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_lines ADD COLUMN stone_amount_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_lines ADD COLUMN total_amount_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_lines ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_lines ADD COLUMN taxable_paise INTEGER NOT NULL DEFAULT 0;
UPDATE invoice_lines SET taxable_paise = amount_paise;
ALTER TABLE invoices ADD COLUMN discount_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE invoices ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0;
