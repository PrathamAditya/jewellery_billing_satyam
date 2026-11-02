import { createHash } from "node:crypto";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteDatabase, type SqliteStatement } from "../db/sqlite";

/**
 * Spec 082: the local migration runner. It replaces the temporary step of spec 081 (`d1_migrations`).
 *
 * - Applies the migration files in `apps/api/migrations` in name order, each file in its own transaction.
 * - Records each applied file in `schema_migrations (name, checksum, applied_at)`.
 * - Refuses a file that changed after it was applied (checksum), a recorded file that is gone, and a new file
 *   that sorts before an applied one. Applied migrations are never rewritten.
 * - Before any change to a database that already has applied migrations, copies it to a backup next to it
 *   (`VACUUM INTO`, so the copy includes what is still in the WAL file). Keeps the 5 newest backups.
 * - Recognises a database made by the earlier temporary step (spec 081): see `detectExistingSchema`.
 *
 * The cloud version does not use this file: it keeps using `wrangler d1 migrations`.
 */
export const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const SPLIT = "--> statement-breakpoint";
/** How many backups of the same kind are kept. */
export const BACKUPS_KEPT = 5;

export type MigrationFile = {
  name: string;
  /** The numeric prefix, for example "0018". */
  version: string;
  /** The file split into statements, as the test helper splits them. */
  statements: string[];
  checksum: string;
};

/** A refusal or a failure. The message is for the owner or the developer; `backupPath` is the copy made before the upgrade, if any. */
export class MigrationError extends Error {
  constructor(
    message: string,
    readonly backupPath: string | null = null,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export type MigrationReport = {
  /** Migrations this call ran, in order. */
  applied: string[];
  /** Migrations that were already recorded and were left alone. */
  skipped: string[];
  /** Migrations recognised in a database from the earlier temporary step and recorded without being run. */
  adopted: string[];
  /** The backup copy made before the change, or null when none was needed. */
  backup: string | null;
  /** Older backups of the same kind that were deleted. */
  pruned: string[];
};

export type RunMigrationsOptions = {
  /** The live database file. Backups are written next to it. */
  databasePath: string;
  /** The folder with the migration files. Default: apps/api/migrations. */
  migrationsDir?: string;
};

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function splitStatements(text: string): string[] {
  return text
    .split(SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function listMigrationFiles(dir = DEFAULT_MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const text = readFileSync(join(dir, name), "utf8");
      return { name, version: name.split("_")[0] ?? name, statements: splitStatements(text), checksum: sha256(text) };
    });
}

const SCHEMA_TABLE = "schema_migrations";
const TEMPORARY_TABLE = "d1_migrations";
const CREATE_SCHEMA_TABLE = `CREATE TABLE schema_migrations (
  name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;
const RECORD_SQL = "INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?1, ?2, ?3)";

async function tableExists(db: SqliteDatabase, name: string): Promise<boolean> {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(name).first();
  return row !== null;
}

/**
 * The schema as text: every table, index, trigger and view (type, name, table and SQL, spaces collapsed).
 * The tracking tables are left out. Two databases with the same migrations applied have the same fingerprint,
 * because each one ran the same SQL text.
 */
async function schemaFingerprint(db: SqliteDatabase): Promise<string> {
  const rows = await db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
  }>();
  const kept = rows.results
    .filter((r) => !r.name.startsWith("sqlite_") && r.name !== SCHEMA_TABLE && r.name !== TEMPORARY_TABLE)
    .map((r) => [r.type, r.name, r.tbl_name, r.sql === null ? null : r.sql.replace(/\s+/g, " ").trim()]);
  return JSON.stringify(kept);
}

async function applyStatements(db: SqliteDatabase, statements: string[]): Promise<void> {
  await db.batch(statements.map((sql) => db.prepare(sql)));
}

/**
 * Recognises a database with no `schema_migrations` table. It replays the migration files on an empty in-memory
 * database, one file at a time, and compares the schema with the live one after each file. The number of files
 * whose state matches is the number already applied.
 *
 * Refused (nothing is changed) when:
 * - no state matches (the schema was changed by hand, or is from another version);
 * - more than one state matches, which happens when a file changes no table, column, index or trigger, so the
 *   schema cannot tell whether that file ran;
 * - the earlier temporary step's `d1_migrations` table does not list exactly the files the schema matches.
 */
async function detectExistingSchema(db: SqliteDatabase, files: MigrationFile[], dbPath: string): Promise<number> {
  const live = await schemaFingerprint(db);
  const replay = new SqliteDatabase(":memory:");
  const matches: number[] = [];
  try {
    if ((await schemaFingerprint(replay)) === live) matches.push(0);
    for (let i = 0; i < files.length; i++) {
      await applyStatements(replay, files[i]!.statements);
      if ((await schemaFingerprint(replay)) === live) matches.push(i + 1);
    }
  } finally {
    replay.close();
  }

  if (matches.length === 0) {
    throw new MigrationError(
      `The database ${dbPath} has a schema that matches no state of the migration files, so the runner cannot tell which migrations it has. Nothing was changed. Restore a copy from before the change, or ask for help.`,
    );
  }
  if (matches.length > 1) {
    const unclear = files[matches[0]!]?.name ?? "the last migration";
    throw new MigrationError(
      `The database ${dbPath} matches more than one state of the migration files (${matches.join(" or ")} files applied). ${unclear} changes no table, column, index or trigger, so the runner cannot tell whether it ran. Nothing was changed.`,
    );
  }
  const count = matches[0]!;

  if (await tableExists(db, TEMPORARY_TABLE)) {
    const rows = await db.prepare(`SELECT name FROM ${TEMPORARY_TABLE} ORDER BY name`).all<{ name: string }>();
    const recorded = rows.results.map((r) => r.name);
    const expected = files.slice(0, count).map((f) => f.name);
    if (recorded.length !== expected.length || recorded.some((n, i) => n !== expected[i])) {
      throw new MigrationError(
        `The database ${dbPath} has a schema for ${count} migration(s), but its earlier migration record lists ${recorded.length}. Nothing was changed. Ask for help before upgrading this database.`,
      );
    }
  }
  return count;
}

/** The backup kind: `<database file>.backup-<timestamp>-from-<version>.sqlite`. */
function backupPattern(databaseFileName: string): RegExp {
  const escaped = databaseFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\.backup-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)-from-\\d+\\.sqlite$`);
}

/**
 * Keeps the newest `keep` backups of this database and deletes the older ones. Only files that match the backup
 * name are touched. The live database and any other file in the folder are never deleted.
 */
export function pruneBackups(databasePath: string, keep = BACKUPS_KEPT): string[] {
  const dir = dirname(databasePath);
  const pattern = backupPattern(basename(databasePath));
  const backups = readdirSync(dir)
    .map((name) => ({ name, stamp: pattern.exec(name)?.[1] }))
    .filter((b): b is { name: string; stamp: string } => b.stamp !== undefined)
    // The timestamp is fixed-width ISO text, so a string sort is a time sort. Newest first.
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
  const old = backups.slice(keep);
  for (const b of old) unlinkSync(join(dir, b.name));
  return old.map((b) => b.name);
}

async function backupBeforeChange(db: SqliteDatabase, databasePath: string, lastVersion: string): Promise<string> {
  if (databasePath === ":memory:") throw new MigrationError("An in-memory database cannot be backed up, so it cannot be upgraded.");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dirname(databasePath), `${basename(databasePath)}.backup-${stamp}-from-${lastVersion}.sqlite`);
  try {
    // VACUUM INTO writes one consistent file, including pages that are still in the WAL file. A plain file copy would miss them.
    await db.prepare("VACUUM INTO ?1").bind(target).run();
  } catch (error) {
    throw new MigrationError(
      `Could not make a backup before the upgrade (${(error as Error).message}). Nothing was changed.`,
    );
  }
  return target;
}

/**
 * Brings the database up to date. Safe to run on every start-up: an up-to-date database changes nothing and makes
 * no backup. Throws `MigrationError` on any refusal or failure; the message says what happened and, when a backup
 * was made, where it is.
 */
export async function runMigrations(db: SqliteDatabase, options: RunMigrationsOptions): Promise<MigrationReport> {
  const files = listMigrationFiles(options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  const byName = new Map(files.map((f) => [f.name, f]));
  const report: MigrationReport = { applied: [], skipped: [], adopted: [], backup: null, pruned: [] };

  const hasTracking = await tableExists(db, SCHEMA_TABLE);
  // name -> checksum of the migrations already applied.
  let done: Map<string, string>;
  if (hasTracking) {
    const rows = await db.prepare(`SELECT name, checksum FROM ${SCHEMA_TABLE} ORDER BY name`).all<{ name: string; checksum: string }>();
    done = new Map(rows.results.map((r) => [r.name, r.checksum]));
    for (const [name, checksum] of done) {
      const file = byName.get(name);
      if (!file) {
        throw new MigrationError(
          `Migration ${name} was applied to this database, but its file is missing from the migrations folder. Applied migrations are never removed or renamed. Nothing was changed.`,
        );
      }
      if (file.checksum !== checksum) {
        throw new MigrationError(
          `Migration ${name} was applied to this database and its file has changed since (the checksum differs). Applied migrations are never rewritten: put the file back as it was, and make a new migration for the change. Nothing was changed.`,
        );
      }
    }
  } else {
    const count = await detectExistingSchema(db, files, options.databasePath);
    done = new Map(files.slice(0, count).map((f) => [f.name, f.checksum]));
    report.adopted = [...done.keys()];
  }

  const pending = files.filter((f) => !done.has(f.name));
  const appliedNames = [...done.keys()].sort();
  const lastApplied = appliedNames[appliedNames.length - 1];
  if (lastApplied !== undefined) {
    const late = pending.find((f) => f.name < lastApplied);
    if (late) {
      throw new MigrationError(
        `New migration ${late.name} sorts before ${lastApplied}, which is already applied. Give new migrations a number after the last applied one. Nothing was changed.`,
      );
    }
  }

  if (hasTracking && pending.length === 0) {
    report.skipped = appliedNames;
    return report;
  }

  // Any change to a database with applied migrations starts with a backup.
  if (appliedNames.length > 0) {
    report.backup = await backupBeforeChange(db, options.databasePath, lastApplied!.split("_")[0]!);
    report.pruned = pruneBackups(options.databasePath);
  }

  if (!hasTracking) {
    const adopt = report.adopted.map((name) => {
      const file = byName.get(name)!;
      return db.prepare(RECORD_SQL).bind(file.name, file.checksum, new Date().toISOString());
    });
    await db.batch([db.prepare(CREATE_SCHEMA_TABLE), ...adopt]);
  }

  for (const file of pending) {
    const statements: SqliteStatement[] = file.statements.map((sql) => db.prepare(sql));
    statements.push(db.prepare(RECORD_SQL).bind(file.name, file.checksum, new Date().toISOString()));
    try {
      await db.batch(statements);
    } catch (error) {
      const why = (error as Error).message;
      const earlier = report.applied.length
        ? `The ${report.applied.length} migration(s) before it in this run (${report.applied.join(", ")}) were kept.`
        : "No migration in this run was applied.";
      const backup = report.backup
        ? `The database was copied before the upgrade to ${report.backup}.`
        : "No backup was needed, because the database had no applied migrations.";
      throw new MigrationError(
        `Migration ${file.name} failed and was rolled back, so it is not recorded: ${why}. ${earlier} ${backup}`,
        report.backup,
      );
    }
    report.applied.push(file.name);
  }
  report.skipped = appliedNames;
  return report;
}

/** Plain-language lines for a report, for the command-line scripts and the server start-up. */
export function describeMigrations(report: MigrationReport, dataDir: string): string[] {
  const lines = [`Database: ${dataDir}`];
  lines.push(
    report.applied.length
      ? `Applied ${report.applied.length} migration(s): ${report.applied.join(", ")}`
      : "No migrations to apply.",
  );
  lines.push(`Already applied and left alone: ${report.skipped.length}`);
  if (report.adopted.length) {
    lines.push(`Recognised ${report.adopted.length} migration(s) from the earlier temporary step (not run again).`);
  }
  lines.push(report.backup ? `Backup created before the upgrade: ${report.backup}` : "No backup needed.");
  if (report.pruned.length) {
    lines.push(`Deleted ${report.pruned.length} older backup(s), keeping the ${BACKUPS_KEPT} newest.`);
  }
  return lines;
}
