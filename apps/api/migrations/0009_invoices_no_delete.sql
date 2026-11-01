-- Invoices and their lines are voided or revised, never deleted (spec 001 R9, spec 013 R11).
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices
BEGIN
  SELECT RAISE(ABORT, 'invoices rows are voided, never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_no_delete BEFORE DELETE ON invoice_lines
BEGIN
  SELECT RAISE(ABORT, 'invoice_lines rows are kept for every revision, never deleted');
END;
