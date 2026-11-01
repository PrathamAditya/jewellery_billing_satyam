import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** A fresh in-memory D1 (real workerd) with every migration applied, in order. */
export async function createTestDb() {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-07-01",
    d1Databases: { DB: "test-db" },
  });
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const statements = readFileSync(join(migrationsDir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sql of statements) await db.prepare(sql).run();
  }
  return { db, dispose: () => mf.dispose() };
}
