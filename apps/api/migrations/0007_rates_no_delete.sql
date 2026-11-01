-- Rates are corrected by editing, never deleted (spec 001 R9, spec 011 R11).
CREATE TRIGGER rates_no_delete BEFORE DELETE ON rates
BEGIN
  SELECT RAISE(ABORT, 'rates rows are corrected by editing, never deleted');
END;
