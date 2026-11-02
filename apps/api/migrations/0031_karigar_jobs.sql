-- Spec 023: karigar job work. Karigars, jobs (metal issued to a karigar against JOB- numbers), and the append-only
-- karigar entries (issue, return, wastage, labour, payout, adjust). The metal moves through raw_metal_movements (spec 022)
-- and the seeded Karigar place (spec 021b), so there is no second stock table. New tables, triggers, one nullable column
-- and the karigar permissions only; no existing business row changes.

CREATE TABLE karigars (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 100),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 15),
  remarks TEXT CHECK (remarks IS NULL OR length(remarks) <= 300)
);
--> statement-breakpoint
CREATE TRIGGER karigars_no_delete BEFORE DELETE ON karigars
BEGIN
  SELECT RAISE(ABORT, 'karigars rows are never deleted');
END;
--> statement-breakpoint
CREATE TABLE karigar_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  job_no TEXT NOT NULL CHECK (length(job_no) > 0),
  fy TEXT NOT NULL,
  serial INTEGER NOT NULL CHECK (serial >= 1),
  karigar_id TEXT NOT NULL REFERENCES karigars (id),
  job_date TEXT NOT NULL CHECK (job_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_location_id TEXT NOT NULL REFERENCES stock_locations (id),
  labour_basis TEXT NOT NULL CHECK (labour_basis IN ('gram', 'piece')),
  labour_rate_paise INTEGER NOT NULL CHECK (labour_rate_paise >= 0),
  wastage_bps INTEGER NOT NULL CHECK (wastage_bps BETWEEN 0 AND 1000),
  remarks TEXT CHECK (remarks IS NULL OR length(remarks) <= 300),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  closed_at TEXT,
  closed_by TEXT,
  close_remarks TEXT,
  CHECK ((status = 'open' AND closed_at IS NULL AND closed_by IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL))
);
--> statement-breakpoint
-- Numbers restart each financial year (like invoices and purchases), so the number is unique within its year.
CREATE UNIQUE INDEX karigar_jobs_fy_no_unique ON karigar_jobs (fy, job_no);
--> statement-breakpoint
CREATE INDEX karigar_jobs_karigar_idx ON karigar_jobs (karigar_id, job_date);
--> statement-breakpoint
CREATE TRIGGER karigar_jobs_no_delete BEFORE DELETE ON karigar_jobs
BEGIN
  SELECT RAISE(ABORT, 'karigar_jobs rows are closed, never deleted');
END;
--> statement-breakpoint
-- A job changes once: from open to closed. Its terms (karigar, dates, labour, allowance, place) never change.
CREATE TRIGGER karigar_jobs_locked BEFORE UPDATE ON karigar_jobs
WHEN OLD.status = 'closed' OR NEW.status <> 'closed'
  OR NEW.id IS NOT OLD.id OR NEW.job_no IS NOT OLD.job_no OR NEW.fy IS NOT OLD.fy OR NEW.serial IS NOT OLD.serial
  OR NEW.karigar_id IS NOT OLD.karigar_id OR NEW.job_date IS NOT OLD.job_date OR NEW.source_location_id IS NOT OLD.source_location_id
  OR NEW.labour_basis IS NOT OLD.labour_basis OR NEW.labour_rate_paise IS NOT OLD.labour_rate_paise
  OR NEW.wastage_bps IS NOT OLD.wastage_bps OR NEW.remarks IS NOT OLD.remarks
BEGIN
  SELECT RAISE(ABORT, 'job_locked: a closed job is never edited, and an open job only changes to closed');
END;
--> statement-breakpoint
-- Spec 023: every movement of metal or money for a karigar. Append-only. A payout has no job.
CREATE TABLE karigar_job_entries (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  karigar_id TEXT NOT NULL REFERENCES karigars (id),
  job_id TEXT REFERENCES karigar_jobs (id),
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'return', 'wastage', 'labour', 'payout', 'adjust')),
  entry_date TEXT NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  part TEXT CHECK (part IS NULL OR part IN ('finished', 'remainder')),
  metal TEXT CHECK (metal IS NULL OR metal IN ('gold', 'silver')),
  purity TEXT,
  weight_mg INTEGER,
  pieces INTEGER CHECK (pieces IS NULL OR pieces >= 0),
  tested_purity TEXT,
  basis TEXT CHECK (basis IS NULL OR basis IN ('gram', 'piece')),
  rate_paise INTEGER CHECK (rate_paise IS NULL OR rate_paise >= 0),
  amount_paise INTEGER,
  payment_mode TEXT CHECK (payment_mode IS NULL OR payment_mode IN ('cash', 'upi', 'bank_transfer', 'cheque')),
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 60),
  location_id TEXT REFERENCES stock_locations (id),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  -- The client id of the save that wrote this line: a retried save replays the lines instead of writing them twice.
  batch_id TEXT,
  CHECK (
    (kind = 'issue' AND job_id IS NOT NULL AND metal IS NOT NULL AND purity IS NOT NULL AND weight_mg > 0 AND location_id IS NOT NULL
      AND part IS NULL AND pieces IS NULL AND amount_paise IS NULL AND payment_mode IS NULL)
    OR (kind = 'return' AND job_id IS NOT NULL AND part IS NOT NULL AND metal IS NOT NULL AND purity IS NOT NULL AND weight_mg > 0 AND location_id IS NOT NULL
      AND amount_paise IS NULL AND payment_mode IS NULL
      AND ((part = 'finished' AND pieces >= 1 AND tested_purity IS NOT NULL) OR (part = 'remainder' AND pieces IS NULL AND tested_purity IS NULL)))
    OR (kind = 'wastage' AND job_id IS NOT NULL AND metal IS NOT NULL AND purity IS NOT NULL AND weight_mg > 0 AND location_id IS NOT NULL
      AND part IS NULL AND pieces IS NULL AND amount_paise IS NULL AND payment_mode IS NULL)
    OR (kind = 'labour' AND job_id IS NOT NULL AND basis IS NOT NULL AND rate_paise IS NOT NULL AND amount_paise >= 0 AND part IS NULL AND payment_mode IS NULL
      AND ((basis = 'gram' AND weight_mg > 0) OR (basis = 'piece' AND pieces >= 1)))
    OR (kind = 'payout' AND job_id IS NULL AND amount_paise > 0 AND payment_mode IS NOT NULL AND weight_mg IS NULL AND metal IS NULL)
    OR (kind = 'adjust' AND reason IS NOT NULL AND (weight_mg IS NOT NULL OR amount_paise IS NOT NULL)
      AND (weight_mg IS NULL OR (metal IS NOT NULL AND purity IS NOT NULL)))
  )
);
--> statement-breakpoint
CREATE INDEX karigar_job_entries_karigar_idx ON karigar_job_entries (karigar_id, entry_date, at);
--> statement-breakpoint
CREATE INDEX karigar_job_entries_job_idx ON karigar_job_entries (job_id);
--> statement-breakpoint
CREATE INDEX karigar_job_entries_batch_idx ON karigar_job_entries (batch_id);
--> statement-breakpoint
CREATE TRIGGER karigar_job_entries_no_update BEFORE UPDATE ON karigar_job_entries
BEGIN
  SELECT RAISE(ABORT, 'karigar_job_entries is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER karigar_job_entries_no_delete BEFORE DELETE ON karigar_job_entries
BEGIN
  SELECT RAISE(ABORT, 'karigar_job_entries is append-only');
END;
--> statement-breakpoint
-- An entry names the job's own karigar, and a job takes entries only while it is open.
CREATE TRIGGER karigar_job_entries_job_open BEFORE INSERT ON karigar_job_entries
WHEN NEW.job_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM karigar_jobs j WHERE j.id = NEW.job_id AND j.karigar_id = NEW.karigar_id AND j.status = 'open'
)
BEGIN
  SELECT RAISE(ABORT, 'job_closed: this job is closed (or belongs to another karigar), so nothing can be added to it');
END;
--> statement-breakpoint
-- Spec 023 K6, K10: the metal a job still holds for a purity may not go below zero.
CREATE TRIGGER karigar_job_entries_job_holding BEFORE INSERT ON karigar_job_entries
WHEN NEW.kind IN ('return', 'wastage') AND (
  SELECT COALESCE(SUM(CASE e.kind WHEN 'issue' THEN e.weight_mg WHEN 'adjust' THEN COALESCE(e.weight_mg, 0) ELSE -e.weight_mg END), 0)
  FROM karigar_job_entries e
  WHERE e.job_id = NEW.job_id AND e.metal = NEW.metal AND e.purity = NEW.purity AND e.kind IN ('issue', 'return', 'wastage', 'adjust')
) - NEW.weight_mg < 0
BEGIN
  SELECT RAISE(ABORT, 'return_exceeds_holding: the karigar does not hold that much metal of this purity on this job');
END;
--> statement-breakpoint
-- Spec 023 K13: a payout may not take the karigar's labour payable below zero.
CREATE TRIGGER karigar_job_entries_payout_balance BEFORE INSERT ON karigar_job_entries
WHEN NEW.kind = 'payout' AND (
  SELECT COALESCE(SUM(CASE e.kind WHEN 'payout' THEN -e.amount_paise ELSE e.amount_paise END), 0)
  FROM karigar_job_entries e
  WHERE e.karigar_id = NEW.karigar_id AND e.kind IN ('labour', 'payout', 'adjust')
) - NEW.amount_paise < 0
BEGIN
  SELECT RAISE(ABORT, 'payout_over_balance: the payout is more than the labour still owed to this karigar');
END;
--> statement-breakpoint
-- Spec 023 K15: the raw movement of a karigar entry is linked to it (null for every other raw movement).
ALTER TABLE raw_metal_movements ADD COLUMN karigar_entry_id TEXT REFERENCES karigar_job_entries (id);
--> statement-breakpoint
CREATE INDEX raw_metal_movements_karigar_entry_idx ON raw_metal_movements (karigar_entry_id);
--> statement-breakpoint
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'karigar.view', '$[#]', 'karigar.edit') WHERE name IN ('owner', 'manager');
--> statement-breakpoint
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'karigar.view') WHERE name IN ('staff', 'viewer');
