-- Spec 021: stock movements and automatic stock reduction on invoices. New columns, triggers and a
-- partial unique index only. No existing row changes (every new column is NULL for old lines).

ALTER TABLE invoice_lines ADD COLUMN bulk_item_id TEXT REFERENCES bulk_items (id);
--> statement-breakpoint
ALTER TABLE invoice_lines ADD COLUMN bulk_quantity INTEGER;
--> statement-breakpoint
-- Spec 021 S13: an individual item on a line must be in stock and not voided. A kept line of a new revision
-- is allowed when the item is still sold on this same invoice (its last history row says so).
CREATE TRIGGER invoice_lines_stock_guard BEFORE INSERT ON invoice_lines
WHEN NEW.inventory_item_id IS NOT NULL AND NOT (
  EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = NEW.inventory_item_id AND i.status = 'in_stock' AND i.voided_at IS NULL)
  OR EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.id = NEW.inventory_item_id AND i.status = 'sold' AND i.voided_at IS NULL
      AND (SELECT h.reason FROM inventory_item_history h WHERE h.item_id = i.id ORDER BY h.at DESC, h.rowid DESC LIMIT 1)
          = 'Sold on invoice ' || (SELECT v.invoice_no FROM invoices v WHERE v.id = NEW.invoice_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'item_not_in_stock: an item on this invoice is not in stock');
END;
--> statement-breakpoint
-- Spec 021 S13: a line links one individual item, or one bulk item with a quantity of 1 or more, or nothing.
CREATE TRIGGER invoice_lines_stock_shape BEFORE INSERT ON invoice_lines
WHEN (NEW.inventory_item_id IS NOT NULL AND NEW.bulk_item_id IS NOT NULL)
  OR (NEW.bulk_item_id IS NULL AND NEW.bulk_quantity IS NOT NULL)
  OR (NEW.bulk_item_id IS NOT NULL AND (NEW.bulk_quantity IS NULL OR NEW.bulk_quantity < 1))
BEGIN
  SELECT RAISE(ABORT, 'invalid_stock_link: a line links one stock item, or one bulk item with a quantity');
END;
--> statement-breakpoint
-- Spec 021 S13: one individual item at most once on one revision of an invoice.
CREATE UNIQUE INDEX invoice_lines_item_rev_unique ON invoice_lines (invoice_id, revision_no, inventory_item_id) WHERE inventory_item_id IS NOT NULL;
