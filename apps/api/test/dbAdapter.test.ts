import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbBackend, createTestDb, openEmptyDb } from "./helpers";

/**
 * Spec 080: the database surface the API relies on behaves the same on both backends. These tests run on
 * whichever backend DB_BACKEND selects (sqlite by default, d1 for Miniflare), so run both:
 *   DB_BACKEND=sqlite npx vitest run apps/api/test/dbAdapter.test.ts
 *   DB_BACKEND=d1 npx vitest run apps/api/test/dbAdapter.test.ts
 */

let t: Awaited<ReturnType<typeof openEmptyDb>>;
beforeAll(async () => {
  t = await openEmptyDb();
  await t.db.prepare("CREATE TABLE parent (id TEXT PRIMARY KEY)").run();
  await t.db
    .prepare("CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent (id), code TEXT UNIQUE, amount INTEGER NOT NULL)")
    .run();
  await t.db
    .prepare(
      "CREATE TRIGGER child_cap BEFORE INSERT ON child WHEN NEW.amount > 100 BEGIN SELECT RAISE(ABORT, 'exceeds_due'); END",
    )
    .run();
});
afterAll(() => t.dispose());

const row = (id: string, code: string, amount = 10) => t.db.prepare("INSERT INTO child (id, code, amount) VALUES (?1, ?2, ?3)").bind(id, code, amount);

describe(`database adapter parity (${dbBackend()})`, () => {
  it("batch rolls back the earlier statements when a later one fails", async () => {
    await expect(t.db.batch([row("b1", "B1"), row("b2", "B2"), row("b3", "B1")])).rejects.toThrow(/UNIQUE constraint failed/);
    const left = await t.db.prepare("SELECT COUNT(*) AS n FROM child WHERE id IN ('b1', 'b2')").first<{ n: number }>();
    expect(left).toEqual({ n: 0 });
  });

  it("batch commits every statement when all succeed, and returns the results in order", async () => {
    const res = await t.db.batch([
      t.db.prepare("SELECT 'first' AS tag"),
      row("c1", "C1"),
      t.db.prepare("SELECT code FROM child WHERE id = ?1").bind("c1"),
    ]);
    expect(res).toHaveLength(3);
    expect(res[0]!.results).toEqual([{ tag: "first" }]);
    expect(res[2]!.results).toEqual([{ code: "C1" }]);
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM child WHERE id = 'c1'").first<{ n: number }>()).toEqual({ n: 1 });
  });

  it("an empty batch is refused, as D1 refuses it", async () => {
    await expect(t.db.batch([])).rejects.toThrow("No SQL statements detected");
  });

  it("a RAISE(ABORT) trigger surfaces its message, which contains the code text", async () => {
    const err = await row("d1", "D1", 500).run().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("exceeds_due");
  });

  it("a RAISE(ABORT) inside a batch rolls the batch back", async () => {
    await expect(t.db.batch([row("e1", "E1"), row("e2", "E2", 500)])).rejects.toThrow("exceeds_due");
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM child WHERE id = 'e1'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("a UNIQUE violation message contains UNIQUE constraint failed", async () => {
    await row("f1", "F1").run();
    const err = await row("f2", "F1").run().catch((e: Error) => e);
    expect((err as Error).message).toContain("UNIQUE constraint failed");
  });

  it("a foreign key violation is an error (foreign keys are on, as in D1)", async () => {
    const err = await t.db.prepare("INSERT INTO child (id, parent_id, code, amount) VALUES ('g1', 'no-such-parent', 'G1', 1)").run().catch((e: Error) => e);
    expect((err as Error).message).toContain("FOREIGN KEY constraint failed");
    expect(await t.db.prepare("PRAGMA foreign_keys").first()).toEqual({ foreign_keys: 1 });
  });

  it("a syntax error rejects the promise and is not thrown synchronously", async () => {
    let thrown: unknown = null;
    let promise: Promise<unknown> | null = null;
    try {
      promise = t.db.prepare("SELEC 1").first();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    await expect(promise!).rejects.toThrow(/syntax error/);
  });

  it("RETURNING works through first() and all()", async () => {
    const one = await t.db.prepare("INSERT INTO child (id, code, amount) VALUES ('h1', 'H1', 7) RETURNING id, amount").first<{ id: string; amount: number }>();
    expect(one).toEqual({ id: "h1", amount: 7 });
    const many = await t.db.prepare("UPDATE child SET amount = amount + 1 WHERE id IN ('h1', 'c1') RETURNING id").all<{ id: string }>();
    expect(many.results.map((r) => r.id).sort()).toEqual(["c1", "h1"]);
  });

  it("first() returns null when there are no rows", async () => {
    expect(await t.db.prepare("SELECT id FROM child WHERE id = 'nobody'").first()).toBeNull();
    expect(await t.db.prepare("SELECT id FROM child WHERE id = ?1").bind("nobody").first<{ id: string }>()).toBeNull();
  });

  it("all() returns { results } with plain row objects, and an empty array when nothing matches", async () => {
    const res = await t.db.prepare("SELECT id, code FROM child WHERE id = ?1 ORDER BY id").bind("c1").all<{ id: string; code: string }>();
    expect(res.success).toBe(true);
    expect(res.results).toEqual([{ id: "c1", code: "C1" }]);
    expect(Object.getPrototypeOf(res.results[0])).toBe(Object.prototype);
    const none = await t.db.prepare("SELECT id FROM child WHERE 1 = 0").all();
    expect(none.results).toEqual([]);
  });

  it("run() reports changes and the last inserted row id", async () => {
    const upd = await t.db.prepare("UPDATE child SET amount = 20 WHERE id IN ('c1', 'h1')").run();
    expect(upd.meta.changes).toBe(2);
    const ins = await row("i1", "I1").run();
    expect(ins.meta.changes).toBe(1);
    expect(ins.meta.last_row_id).toBeGreaterThan(0);
    expect(ins.results).toEqual([]);
  });

  it("a prepared statement can be reused in a batch and with bind(), and bind() does not change the original", async () => {
    const base = t.db.prepare("SELECT code FROM child WHERE id = ?1");
    const a = base.bind("c1");
    const b = base.bind("h1");
    expect(await a.first()).toEqual({ code: "C1" });
    expect(await b.first()).toEqual({ code: "H1" });
    const [inBatch] = await t.db.batch([a]);
    expect(inBatch!.results).toEqual([{ code: "C1" }]);
    expect(await a.first()).toEqual({ code: "C1" });
  });

  it("booleans bind as 1 and 0", async () => {
    expect(await t.db.prepare("SELECT ?1 AS v, ?2 AS w").bind(true, false).first()).toEqual({ v: 1, w: 0 });
  });

  it("null binds as null", async () => {
    expect(await t.db.prepare("SELECT ?1 AS v").bind(null).first()).toEqual({ v: null });
  });

  it("refuses undefined and bigint values at bind(), as D1 does", () => {
    expect(() => t.db.prepare("SELECT ?1 AS v").bind(undefined)).toThrow("not supported");
    expect(() => t.db.prepare("SELECT ?1 AS v").bind(5n)).toThrow("not supported");
  });

  it("refuses a wrong number of bound values", async () => {
    await expect(t.db.prepare("SELECT ?1 AS v, ?2 AS w").bind(1).first()).rejects.toThrow("Wrong number of parameter bindings");
    await expect(t.db.prepare("SELECT ?1 AS v").bind(1, 2).first()).rejects.toThrow("Wrong number of parameter bindings");
  });

  it("run() executes every statement in a multi-statement text (migration chunks)", async () => {
    await t.db.prepare("CREATE TABLE multi_a (x INTEGER); CREATE TABLE multi_b (x INTEGER); INSERT INTO multi_b VALUES (1)").run();
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM multi_b").first()).toEqual({ n: 1 });
    expect(await t.db.prepare("SELECT name FROM sqlite_master WHERE name = 'multi_a'").first()).toEqual({ name: "multi_a" });
  });

  it("a DDL statement with a CHECK constraint still runs every statement after it (ALTER ... CHECK in a migration)", async () => {
    await t.db
      .prepare(
        "ALTER TABLE child ADD COLUMN kind TEXT NOT NULL DEFAULT 'a' CHECK (kind IN ('a', 'b')); ALTER TABLE parent ADD COLUMN note TEXT",
      )
      .run();
    expect(await t.db.prepare("SELECT note FROM parent WHERE 1 = 0").all()).toEqual({ success: true, results: [], meta: expect.anything() });
  });

  it("the append-only trigger of the real schema refuses a delete with its message", async () => {
    const real = await createTestDb();
    try {
      // A BEFORE DELETE trigger only fires for a row, so insert one first.
      await real.db
        .prepare(
          `INSERT INTO customers (id, created_at, created_by, updated_at, updated_by, customer_no, name, name_search)
           VALUES ('parity-c1', '2026-11-02T10:00:00.000Z', 'test', '2026-11-02T10:00:00.000Z', 'test', 'C-9001', 'Parity Customer', 'parity customer')`,
        )
        .run();
      const err = await real.db.prepare("DELETE FROM customers").run().catch((e: Error) => e);
      expect((err as Error).message).toContain("customers rows are voided, never deleted");
    } finally {
      await real.dispose();
    }
  });
});
