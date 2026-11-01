DROP INDEX IF EXISTS invoices_invoice_no_unique;
CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
ALTER TABLE invoices ADD COLUMN fy TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN serial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN header_json TEXT;
UPDATE invoices SET fy = CASE WHEN CAST(substr(invoice_date, 6, 2) AS INTEGER) >= 4 THEN substr(invoice_date, 1, 4) || '-' || substr(CAST(substr(invoice_date, 1, 4) AS INTEGER) + 1, 3, 2) ELSE CAST(CAST(substr(invoice_date, 1, 4) AS INTEGER) - 1 AS TEXT) || '-' || substr(invoice_date, 3, 2) END, serial = CAST(substr(invoice_no, -4) AS INTEGER), invoice_no = 'INV-' || printf('%04d', CAST(substr(invoice_no, -4) AS INTEGER));
UPDATE customers SET customer_no = replace(customer_no, '-', '');
CREATE UNIQUE INDEX invoices_fy_invoice_no_unique ON invoices (fy, invoice_no);
