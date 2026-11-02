import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIntegrityCli } from "../src/integrity/cli";
import { databaseFile, openLocalDatabase } from "../src/local/database";
import { runMigrations } from "../src/local/migrations";

/** Spec 052 I17: the command line, run as a function on a database file in a temporary JB_DATA_DIR. */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function freshDataDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "jb-integrity-"));
  dirs.push(dir);
  const db = openLocalDatabase(dir);
  try {
    await runMigrations(db, { databasePath: databaseFile(dir) });
  } finally {
    db.close();
  }
  return dir;
}

async function run(dir: string) {
  const lines: string[] = [];
  const code = await runIntegrityCli({ JB_DATA_DIR: dir }, (l) => lines.push(l));
  return { code, lines };
}

describe("npm run integrity", () => {
  it("exits 2 and changes nothing when there is no database file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-integrity-missing-"));
    dirs.push(dir);
    const { code, lines } = await run(dir);
    expect(code).toBe(2);
    expect(lines[0]).toContain("No database file");
  });

  it("exits 0 on a clean database and prints every check as ok", async () => {
    const dir = await freshDataDir();
    const { code, lines } = await run(dir);
    expect(code).toBe(0);
    expect(lines.filter((l) => l.startsWith("ok")).length).toBe(10);
    expect(lines.at(-1)).toBe("All 10 checks passed.");
  });

  it("exits 1 and names the record when a check fails", async () => {
    const dir = await freshDataDir();
    const db = openLocalDatabase(dir);
    try {
      await db
        .prepare(
          `INSERT INTO customers (id, created_at, created_by, updated_at, updated_by, customer_no, name, name_search)
           VALUES ('c-bad-1', '2026-11-02T10:00:00.000Z', 'test', '2026-11-02T10:00:00.000Z', 'test', 'C-12', 'Bad Number', 'bad number')`,
        )
        .run();
    } finally {
      db.close();
    }
    const { code, lines } = await run(dir);
    expect(code).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL  Customer numbers"))).toBe(true);
    expect(lines.some((l) => l.includes("c-bad-1"))).toBe(true);
    expect(lines.at(-1)).toBe("1 of 10 checks failed.");
  });
});
