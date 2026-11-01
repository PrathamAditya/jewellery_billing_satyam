-- Spec 004: roles and permissions. Users get a display name, a last-login time and a forced password change.
CREATE TABLE roles (
  name TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO roles (name, label, permissions_json, system, created_at, created_by, updated_at, updated_by) VALUES
  ('owner', 'Owner', '["customers.view", "customers.create", "customers.edit", "customers.void", "rates.view", "rates.edit", "invoices.view", "invoices.create", "invoices.edit", "invoices.void", "invoices.print", "payments.view", "payments.create", "payments.void", "payments.refund", "advances.view", "advances.create", "advances.cancel", "oldgold.view", "oldgold.create", "oldgold.void", "ledger.view", "ledger.opening", "settings.view", "settings.manage", "users.manage", "backups.view", "backups.manage", "reports.view", "audit.view"]', 1, '2026-11-01T00:00:00.000Z', 'system', '2026-11-01T00:00:00.000Z', 'system'),
  ('manager', 'Manager', '["customers.view", "customers.create", "customers.edit", "customers.void", "rates.view", "rates.edit", "invoices.view", "invoices.create", "invoices.edit", "invoices.void", "invoices.print", "payments.view", "payments.create", "payments.void", "payments.refund", "advances.view", "advances.create", "advances.cancel", "oldgold.view", "oldgold.create", "oldgold.void", "ledger.view", "ledger.opening", "settings.view", "backups.view", "reports.view", "audit.view"]', 0, '2026-11-01T00:00:00.000Z', 'system', '2026-11-01T00:00:00.000Z', 'system'),
  ('staff', 'Shop staff', '["customers.view", "customers.create", "customers.edit", "rates.view", "invoices.view", "invoices.create", "invoices.print", "payments.view", "payments.create", "advances.view", "advances.create", "oldgold.view", "oldgold.create", "ledger.view", "settings.view"]', 0, '2026-11-01T00:00:00.000Z', 'system', '2026-11-01T00:00:00.000Z', 'system'),
  ('viewer', 'View only', '["customers.view", "rates.view", "invoices.view", "payments.view", "advances.view", "oldgold.view", "ledger.view", "settings.view", "backups.view", "reports.view", "audit.view", "invoices.print"]', 0, '2026-11-01T00:00:00.000Z', 'system', '2026-11-01T00:00:00.000Z', 'system');
--> statement-breakpoint
ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_login_at TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE users SET display_name = username WHERE display_name = '';
--> statement-breakpoint
CREATE TRIGGER roles_no_delete BEFORE DELETE ON roles
BEGIN
  SELECT RAISE(ABORT, 'roles are changed, never deleted');
END;
