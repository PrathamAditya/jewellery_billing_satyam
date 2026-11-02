import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteDatabase } from "../src/db/sqlite";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Spec 080: which database the tests run on. `DB_BACKEND=sqlite` (default) uses the local SQLite adapter
 * (src/db/sqlite.ts). `DB_BACKEND=d1` uses D1 in Miniflare (real workerd), as before spec 080.
 */
export type DbBackend = "sqlite" | "d1";

export function dbBackend(): DbBackend {
  const value = process.env.DB_BACKEND ?? "sqlite";
  if (value === "sqlite" || value === "d1") return value;
  throw new Error(`DB_BACKEND must be "sqlite" or "d1", got "${value}"`);
}

/** The migration file names in the order they run. */
export function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
}

/** A fresh empty database on the chosen backend, with no migrations applied yet. */
export async function openEmptyDb(): Promise<{ db: D1Database; dispose: () => Promise<void> | void }> {
  if (dbBackend() === "sqlite") {
    const sqlite = new SqliteDatabase(":memory:");
    // The adapter implements the subset of D1 the API uses; the cast gives it the D1 type the code is written against.
    return { db: sqlite as unknown as D1Database, dispose: () => sqlite.close() };
  }
  const { Miniflare } = await import("miniflare");
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "test-db" },
  });
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  return { db, dispose: () => mf.dispose() };
}

/** Runs one migration file, statement by statement. */
export async function applyMigration(db: D1Database, file: string) {
  const statements = readFileSync(join(migrationsDir, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) await db.prepare(sql).run();
}

/** A fresh database on the chosen backend with every migration applied, in order. */
export async function createTestDb() {
  const { db, dispose } = await openEmptyDb();
  for (const file of migrationFiles()) await applyMigration(db, file);
  return { db, dispose };
}
