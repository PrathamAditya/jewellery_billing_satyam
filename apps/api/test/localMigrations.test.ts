import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqliteDatabase } from "../src/db/sqlite";
import { databaseFile, openLocalDatabase } from "../src/local/database";
import { DEFAULT_MIGRATIONS_DIR, MigrationError, runMigrations, sha256 } from "../src/local/migrations";
import { startLocalServer, type LocalServer } from "../src/local/server";

/**
 * Spec 082: the local migration runner, on real SQLite files in a temporary folder. Each test builds its own data
 * folder, and its own copy of the migration folder when it needs an older or changed set of files.
 */

const ALL_FILES = readdirSync(DEFAULT_MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const LAST = ALL_FILES[ALL_FILES.length - 1]!;
const TEMPORARY_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;
const SPLIT = "--> statement-breakpoint";
const BACKUP = /^billing\.sqlite\.backup-\d{4}-\d{2}-\d{2}T[\d-]+Z-from-(\d+)\.sqlite$/;

const root = mkdtempSync(join(tmpdir(), "jb-migrations-test-"));
let counter = 0;
const open: SqliteDatabase[] = [];

afterAll(() => {
  for (const db of open) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function newDir(prefix: string): string {
  const dir = join(root, `${prefix}-${++counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A data folder, and the live database file in it. */
function newDataDir(): string {
  return newDir("data");
}

/** A copy of the migration folder with the files up to and including `version` (for example "0010"), plus extra files. */
function migrationsCopy(version?: string, extra: Record<string, string> = {}): string {
  const dir = newDir("migrations");
  for (const name of ALL_FILES) {
    if (version && name.split("_")[0]! > version) continue;
    copyFileSync(join(DEFAULT_MIGRATIONS_DIR, name), join(dir, name));
  }
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(dir, name), text);
  return dir;
}

function openDb(dataDir: string): SqliteDatabase {
  const db = openLocalDatabase(dataDir);
  open.push(db);
  return db;
}

function backupsIn(dataDir: string): string[] {
  return readdirSync(dataDir).filter((f) => f.includes(".backup-"));
}

/** Builds the database the way spec 081's temporary `local:migrate` did: each file in a transaction, then a row in `d1_migrations`. */
async function makeTemporaryStepDb(dataDir: string, dir: string, names: string[]): Promise<void> {
  const db = openDb(dataDir);
  await db.prepare(TEMPORARY_TABLE).run();
  for (const name of names) {
    const statements = readFileSync(join(dir, name), "utf8")
      .split(SPLIT)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql));
    statements.push(db.prepare("INSERT INTO d1_migrations (name) VALUES (?1)").bind(name));
    await db.batch(statements);
  }
  db.close();
}

async function tableNames(db: SqliteDatabase): Promise<string[]> {
  const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

async function recordedNames(db: SqliteDatabase): Promise<string[]> {
  const rows = await db.prepare("SELECT name FROM schema_migrations ORDER BY name").all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

/** Rows seeded in the shape they had before migration 0011 (the same seeding as migrations.test.ts). */
async function seedBefore0011(db: SqliteDatabase): Promise<void> {
  const ts = "2025-11-02T10:00:00.000Z";
  await db
    .prepare(
      `INSERT INTO customers (id, created_at, created_by, updated_at, updated_by, customer_no, name, name_search)
       VALUES (?1, ?2, 'test', ?2, 'test', 'C-0001', 'Old Customer', 'old customer')`,
    )
    .bind("c-old-1", ts)
    .run();
  const invoice = (id: string, no: string, date: string, payable: number) =>
    db
      .prepare(
        `INSERT INTO invoices (id, created_at, created_by, updated_at, updated_by, invoice_no, invoice_date, customer_name,
           customer_name_search, tax_mode, rates_json, input_json, taxable_paise, tax_paise, total_before_round_off_paise,
           round_off_paise, payable_paise, calc_json)
         VALUES (?1, ?2, 'test', ?2, 'test', ?3, ?4, 'Old Customer', 'old customer', 'intra', '{}', '{}', ?5, 0, ?5, 0, ?5, '{}')`,
      )
      .bind(id, ts, no, date, payable)
      .run();
  await invoice("inv-old-a", "INV-2025-26-0007", "2025-11-01", 288400);
  await invoice("inv-old-b", "INV-2026-27-0008", "2026-05-10", 206300);
  await db
    .prepare(
      `INSERT INTO invoice_lines (id, invoice_id, revision_no, line_no, description, purity, hsn, gross_weight_mg, net_weight_mg,
         polish_mg, gold_rate_paise_per_kg, labour_rate_paise_per_kg, gst_rate_bps, chargeable_weight_mg, gold_amount_paise,
         labour_amount_paise, amount_paise, display_rate_paise_per_gram)
       VALUES (?1, ?2, 1, 1, 'Silver', 'silver', '7113', 9800, 9800, 0, 28572000, 0, 300, 9800, 280006, 0, 280006, 28572)`,
    )
    .bind("line-old-a", "inv-old-a")
    .run();
}

/** The web folder the server needs (the server refuses to start without index.html). */
let webDir: string;
beforeAll(() => {
  webDir = newDir("web");
  writeFileSync(join(webDir, "index.html"), "<!doctype html><p>test</p>");
});

describe("fresh database (spec 082)", () => {
  it("applies every migration in order and records each one with its checksum", async () => {
    const dataDir = newDataDir();
    const db = openDb(dataDir);
    const report = await runMigrations(db, { databasePath: databaseFile(dataDir) });

    expect(report.applied).toEqual(ALL_FILES);
    expect(report.skipped).toEqual([]);
    expect(report.adopted).toEqual([]);
    expect(report.backup).toBeNull();
    expect(await recordedNames(db)).toEqual([...ALL_FILES].sort());

    const rows = await db.prepare("SELECT name, checksum, applied_at FROM schema_migrations").all<{ name: string; checksum: string; applied_at: string }>();
    for (const row of rows.results) {
      expect(row.checksum).toBe(sha256(readFileSync(join(DEFAULT_MIGRATIONS_DIR, row.name), "utf8")));
      expect(row.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(await tableNames(db)).toContain("invoices");
    expect(backupsIn(dataDir)).toEqual([]);
  });

  it("a second run on an up-to-date database applies nothing and makes no backup", async () => {
    const dataDir = newDataDir();
    const db = openDb(dataDir);
    await runMigrations(db, { databasePath: databaseFile(dataDir) });
    const again = await runMigrations(db, { databasePath: databaseFile(dataDir) });

    expect(again.applied).toEqual([]);
    expect(again.skipped).toEqual(ALL_FILES);
    expect(again.backup).toBeNull();
    expect(again.pruned).toEqual([]);
    expect(backupsIn(dataDir)).toEqual([]);
  });
});

describe("upgrade from an older set of migrations (spec 082)", () => {
  it("backs up first, applies 0011 to the last, and the seeded rows survive", async () => {
    const dataDir = newDataDir();
    const old = migrationsCopy("0010");
    const db = openDb(dataDir);
    await runMigrations(db, { databasePath: databaseFile(dataDir), migrationsDir: old });
    await seedBefore0011(db);

    const report = await runMigrations(db, { databasePath: databaseFile(dataDir) });
    expect(report.applied).toEqual(ALL_FILES.filter((f) => f.split("_")[0]! > "0010"));
    expect(report.skipped.length).toBe(11);
    expect(report.backup).not.toBeNull();

    // The backup is a copy of the database as it was before the first pending migration: 0000 to 0010 only.
    const backup = join(dataDir, report.backup!.split("/").pop()!);
    expect(backup).toBe(report.backup);
    expect(BACKUP.exec(report.backup!.split("/").pop()!)?.[1]).toBe("0010");
    const copy = new SqliteDatabase(backup);
    open.push(copy);
    const copied = await copy.prepare("SELECT COUNT(*) AS n FROM schema_migrations").first<{ n: number }>();
    expect(copied?.n).toBe(11);
    const oldNo = await copy.prepare("SELECT customer_no FROM customers WHERE id = ?1").bind("c-old-1").first<{ customer_no: string }>();
    expect(oldNo?.customer_no).toBe("C-0001");
    copy.close();

    // The live database has the rows, converted by the later migrations.
    const customer = await db.prepare("SELECT customer_no FROM customers WHERE id = ?1").bind("c-old-1").first<{ customer_no: string }>();
    expect(customer?.customer_no).toBe("C0001");
    const a = await db.prepare("SELECT invoice_no FROM invoices WHERE id = ?1").bind("inv-old-a").first<{ invoice_no: string }>();
    const b = await db.prepare("SELECT invoice_no FROM invoices WHERE id = ?1").bind("inv-old-b").first<{ invoice_no: string }>();
    expect(a?.invoice_no).toBe("INV-0007");
    expect(b?.invoice_no).toBe("INV-0008");
    expect(await recordedNames(db)).toEqual([...ALL_FILES].sort());
  });
});

describe("database from the earlier temporary step (spec 081) (spec 082)", () => {
  it("recognises a database with every migration and records them without running them again", async () => {
    const dataDir = newDataDir();
    await makeTemporaryStepDb(dataDir, DEFAULT_MIGRATIONS_DIR, ALL_FILES);
    const db = openDb(dataDir);
    // A row in the old number format. If 0011 ran again, it would be converted to C0009.
    await db
      .prepare(
        `INSERT INTO customers (id, created_at, created_by, updated_at, updated_by, customer_no, name, name_search)
         VALUES ('c-temp-9', '2025-11-02T10:00:00.000Z', 'test', '2025-11-02T10:00:00.000Z', 'test', 'C-0009', 'Temp', 'temp')`,
      )
      .run();

    const report = await runMigrations(db, { databasePath: databaseFile(dataDir) });
    expect(report.applied).toEqual([]);
    expect(report.adopted).toEqual(ALL_FILES);
    expect(report.backup).not.toBeNull(); // the database had applied migrations, so it is copied before the record table is written
    expect(await recordedNames(db)).toEqual([...ALL_FILES].sort());

    const row = await db.prepare("SELECT customer_no FROM customers WHERE id = 'c-temp-9'").first<{ customer_no: string }>();
    expect(row?.customer_no).toBe("C-0009");

    const again = await runMigrations(db, { databasePath: databaseFile(dataDir) });
    expect(again.applied).toEqual([]);
    expect(again.adopted).toEqual([]);
    expect(again.backup).toBeNull();
  });

  it("recognises a database at 0010 and applies only the migrations after it", async () => {
    const dataDir = newDataDir();
    const upTo = ALL_FILES.filter((f) => f.split("_")[0]! <= "0010");
    await makeTemporaryStepDb(dataDir, migrationsCopy(), upTo);
    const db = openDb(dataDir);

    // Only the files up to 0010 are known to this step: it recognises them and runs nothing.
    const report = await runMigrations(db, { databasePath: databaseFile(dataDir), migrationsDir: migrationsCopy("0010") });
    expect(report.adopted).toEqual(upTo);
    expect(report.applied).toEqual([]);

    const full = await runMigrations(db, { databasePath: databaseFile(dataDir) });
    expect(full.adopted).toEqual([]);
    expect(full.applied).toEqual(ALL_FILES.filter((f) => !upTo.includes(f)));
    expect(await recordedNames(db)).toEqual([...ALL_FILES].sort());
  });

  it("refuses a schema that matches no state of the migration files, and changes nothing", async () => {
    const dataDir = newDataDir();
    const db = openDb(dataDir);
    await db.prepare("CREATE TABLE customers (id TEXT PRIMARY KEY, handmade TEXT)").run();
    const before = await tableNames(db);

    await expect(runMigrations(db, { databasePath: databaseFile(dataDir) })).rejects.toThrow(/matches no state of the migration files/);
    expect(await tableNames(db)).toEqual(before);
    expect(before).not.toContain("schema_migrations");
    expect(backupsIn(dataDir)).toEqual([]);
  });

  it("refuses when two states match, because a migration changes no schema", async () => {
    const dir = newDir("migrations");
    writeFileSync(join(dir, "0000_a.sql"), "CREATE TABLE a (id TEXT PRIMARY KEY);");
    writeFileSync(join(dir, "0001_b.sql"), "INSERT INTO a (id) VALUES ('row');");
    const dataDir = newDataDir();
    const db = openDb(dataDir);
    await db.prepare("CREATE TABLE a (id TEXT PRIMARY KEY)").run();

    await expect(runMigrations(db, { databasePath: databaseFile(dataDir), migrationsDir: dir })).rejects.toThrow(/more than one state/);
    expect(await tableNames(db)).toEqual(["a"]);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM a").first<{ n: number }>()).toEqual({ n: 0 });
  });
});

describe("refusals (spec 082)", () => {
  it("refuses a migration whose file changed after it was applied, and never rewrites it", async () => {
    const dataDir = newDataDir();
    const dir = migrationsCopy();
    const db = openDb(dataDir);
    await runMigrations(db, { databasePath: databaseFile(dataDir), migrationsDir: dir });
    const before = await recordedNames(db);

    writeFileSync(join(dir, "0005_customers_no_delete.sql"), readFileSync(join(dir, "0005_customers_no_delete.sql"), "utf8") + "\n-- edited later\n");
    const err = await runMigrations(db, { databasePath: databaseFile(dataDir), migrationsDir: dir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as Error).message).toMatch(/0005_customers_no_delete\.sql.*has changed since/);
    expect((err as Error).message).toMatch(/never rewritten/);
    expect(await recordedNames(db)).toEqual(before);
    expect(backupsIn(dataDir)).toEqual([]); // refused before any backup or change
  });

  it("refuses a new migration that sorts before an applied one", async () => {
    const dataDir = newDataDir();
    const db = openDb(dataDir);
    await runMigrations(db, { databasePath: databaseFile(dataDir) });
    const dir = migrationsCopy(undefined, { "0005a_late.sql": "CREATE TABLE late_one (id TEXT);" });
    await expect(runMigrations(db, { databasePath: databaseFile(dataDir), migrationsDir: dir })).rejects.toThrow(/sorts before/);
    expect(await tableNames(db)).not.toContain("late_one");
  });
});

describe("a migration that fails halfway (spec 082)", () => {
  const extra = {
    "0022_ok.sql": "CREATE TABLE ok_one (id TEXT PRIMARY KEY);",
    "0023_broken.sql": "CREATE TABLE broken_one (id TEXT PRIMARY KEY);\n--> statement-breakpoint\nINSERT INTO no_such_table (id) VALUES ('x');",
  };
  let dataDir: string;
  let db: SqliteDatabase;

  beforeAll(async () => {
    dataDir = newDataDir();
    db = openDb(dataDir);
    await runMigrations(db, { databasePath: databaseFile(dataDir) });
  });

  it("rolls the failing file back, does not record it, keeps earlier migrations, and names the file and the backup", async () => {
    const dir = migrationsCopy(undefined, extra);
    const err = await runMigrations(db, { databasePath: databaseFile(dataDir), migrationsDir: dir }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MigrationError);
    const message = (err as Error).message;
    expect(message).toContain("0023_broken.sql");
    expect(message).toContain("rolled back");
    expect(message).toContain("0022_ok.sql");
    const backupPath = (err as MigrationError).backupPath;
    expect(backupPath).not.toBeNull();
    expect(message).toContain(backupPath!);
    expect(existsSync(backupPath!)).toBe(true);

    const names = await recordedNames(db);
    expect(names).toContain("0022_ok.sql");
    expect(names).not.toContain("0023_broken.sql");
    const tables = await tableNames(db);
    expect(tables).toContain("ok_one");
    expect(tables).not.toContain("broken_one"); // the CREATE in the failing file was rolled back too
    expect(tables).toContain("invoices");
  });

  it("the server does not start: it refuses, and the message names the file and the backup", async () => {
    const dir = migrationsCopy(undefined, extra);
    let server: LocalServer | undefined;
    const err = await startLocalServer({ dataDir, webDir, port: 0, migrationsDir: dir }).then(
      (s) => {
        server = s;
        return null;
      },
      (e: unknown) => e,
    );
    expect(server).toBeUndefined();
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as Error).message).toContain("0023_broken.sql");
    expect((err as MigrationError).backupPath).not.toBeNull();
    expect((err as Error).message).toContain((err as MigrationError).backupPath!);
  });
});

describe("backups (spec 082)", () => {
  it("keeps the 5 newest backups of this database, deletes older ones of the same kind, and never touches other files", async () => {
    const dataDir = newDataDir();
    const old = migrationsCopy("0010");
    const db = openDb(dataDir);
    await runMigrations(db, { databasePath: databaseFile(dataDir), migrationsDir: old });

    // Seven older backups of the same kind, one that is not a backup, and a stray note.
    const stamps = [1, 2, 3, 4, 5, 6, 7].map((d) => `2000-01-0${d}T00-00-00-000Z`);
    for (const stamp of stamps) writeFileSync(join(dataDir, `billing.sqlite.backup-${stamp}-from-0010.sqlite`), "old copy");
    writeFileSync(join(dataDir, "billing.sqlite.backup-notes.txt"), "not a backup");
    writeFileSync(join(dataDir, "notes.txt"), "stray");

    const report = await runMigrations(db, { databasePath: databaseFile(dataDir) });
    expect(report.backup).not.toBeNull();
    expect(report.pruned.length).toBe(3);

    const kept = backupsIn(dataDir).filter((f) => BACKUP.test(f)).sort();
    expect(kept.length).toBe(5);
    // The new backup and the four newest old ones (2000-01-07 to 2000-01-04).
    expect(kept).toContain(report.backup!.split("/").pop()!);
    for (const stamp of ["2000-01-07", "2000-01-06", "2000-01-05", "2000-01-04"]) {
      expect(kept.some((f) => f.includes(stamp))).toBe(true);
    }
    for (const stamp of ["2000-01-01", "2000-01-02", "2000-01-03"]) {
      expect(existsSync(join(dataDir, `billing.sqlite.backup-${stamp}T00-00-00-000Z-from-0010.sqlite`))).toBe(false);
    }
    expect(existsSync(join(dataDir, "billing.sqlite.backup-notes.txt"))).toBe(true);
    expect(existsSync(join(dataDir, "notes.txt"))).toBe(true);
    expect(existsSync(databaseFile(dataDir))).toBe(true);
    expect(await recordedNames(db)).toContain(LAST);
  });
});
