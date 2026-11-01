-- Customers are voided, never deleted (spec 001 R9, spec 010 R13).
CREATE TRIGGER customers_no_delete BEFORE DELETE ON customers
BEGIN
  SELECT RAISE(ABORT, 'customers rows are voided, never deleted');
END;
