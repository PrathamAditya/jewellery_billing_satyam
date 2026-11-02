import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqliteDatabase } from "../db/sqlite";

/**
 * Spec 081 (temporary): applies the migration files in `apps/api/migrations` to the local database, in name order,
 * each file in its own transaction, and records each applied name in `d1_migrations` (the table Wrangler uses).
 * Spec 082 replaces this with the real runner (recording, backup before an upgrade).
 */
export const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const SPLIT = "--> statement-breakpoint";

export function listMigrationFiles(dir = DEFAULT_MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

const TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

async function appliedNames(db: SqliteDatabase): Promise<Set<string>> {
  const rows = await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
  return new Set(rows.results.map((row) => row.name));
}

/** Names of migration files not yet recorded in the database. */
export async function pendingMigrations(db: SqliteDatabase, dir = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  await db.prepare(TRACKING_TABLE).run();
  const done = await appliedNames(db);
  return listMigrationFiles(dir).filter((f) => !done.has(f));
}

export async function migrateLocalDatabase(db: SqliteDatabase, dir = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  const pending = await pendingMigrations(db, dir);
  for (const file of pending) {
    const statements = readFileSync(join(dir, file), "utf8")
      .split(SPLIT)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql));
    statements.push(db.prepare("INSERT INTO d1_migrations (name) VALUES (?1)").bind(file));
    await db.batch(statements);
  }
  return pending;
}
