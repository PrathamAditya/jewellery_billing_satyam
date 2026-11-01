-- Append-only tables: rows can be inserted, never changed or removed (spec 001, R10, R11).
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER record_revisions_no_update BEFORE UPDATE ON record_revisions
BEGIN
  SELECT RAISE(ABORT, 'record_revisions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER record_revisions_no_delete BEFORE DELETE ON record_revisions
BEGIN
  SELECT RAISE(ABORT, 'record_revisions is append-only');
END;
