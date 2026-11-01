-- Users are disabled, never deleted (spec 001, R9; spec 002, section 4).
CREATE TRIGGER users_no_delete BEFORE DELETE ON users
BEGIN
  SELECT RAISE(ABORT, 'users rows are voided, never deleted');
END;
