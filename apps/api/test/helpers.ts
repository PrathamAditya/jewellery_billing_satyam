import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** The migration file names in the order they run. */
export function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
}

/** A fresh in-memory D1 (real workerd) with no migrations applied yet. */
export async function openEmptyDb() {
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

/** A fresh in-memory D1 (real workerd) with every migration applied, in order. */
export async function createTestDb() {
  const { db, dispose } = await openEmptyDb();
  for (const file of migrationFiles()) await applyMigration(db, file);
  return { db, dispose };
}
