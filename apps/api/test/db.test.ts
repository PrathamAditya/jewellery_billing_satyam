import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { allocateNumber, allocateNumberStatement } from "../src/db/numbering";
import { auditStatement } from "../src/db/audit";
import { revisionStatement } from "../src/db/revisions";
import { noDeleteTriggerSql } from "../src/db/triggers";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.dispose());

const count = async (sql: string, ...args: unknown[]) =>
  (await t.db.prepare(sql).bind(...args).first<{ n: number }>())!.n;

describe("numbering (R12)", () => {
  beforeEach(async () => {
    await t.db.prepare("DELETE FROM number_series").run();
  });

  it("follows the financial-year table in the spec", async () => {
    expect(await allocateNumber(t.db, "INV", "2026-03-31")).toBe("INV/2025-26/0001");
    expect(await allocateNumber(t.db, "INV", "2026-04-01")).toBe("INV/2026-27/0001");
    expect(await allocateNumber(t.db, "INV", "2026-04-01")).toBe("INV/2026-27/0002");
    expect(await allocateNumber(t.db, "PR", "2026-04-01")).toBe("PR/2026-27/0001");
    expect(await allocateNumber(t.db, "INV", "2027-03-31")).toBe("INV/2026-27/0003");
  });

  it("grows past 4 digits", async () => {
    await t.db.prepare("INSERT INTO number_series (series, fy, last_no) VALUES ('INV', '2026-27', 9999)").run();
    expect(await allocateNumber(t.db, "INV", "2026-04-01")).toBe("INV/2026-27/10000");
  });

  it("20 parallel allocations give unique numbers 1..20 with no gaps", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => allocateNumber(t.db, "OG", "2026-05-01")));
    const nums = results.map((r) => Number(r.split("/")[2])).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("a batch that fails after allocating leaves the counter unchanged", async () => {
    await allocateNumber(t.db, "INV", "2026-04-01"); // counter = 1
    await expect(
      t.db.batch([
        allocateNumberStatement(t.db, "INV", "2026-04-01"),
        t.db.prepare("INSERT INTO audit_log (id) VALUES ('missing-required-columns')"),
      ]),
    ).rejects.toThrow();
    expect(await count("SELECT last_no AS n FROM number_series WHERE series = 'INV' AND fy = '2026-27'")).toBe(1);
    expect(await allocateNumber(t.db, "INV", "2026-04-01")).toBe("INV/2026-27/0002");
  });

  it("rejects an unknown series and an invalid date", async () => {
    await expect(allocateNumber(t.db, "XYZ" as never, "2026-04-01")).rejects.toThrow(RangeError);
    await expect(allocateNumber(t.db, "INV", "2026-02-30")).rejects.toThrow(RangeError);
  });
});

describe("append-only tables (R10, R11)", () => {
  it("audit_log accepts inserts but blocks UPDATE and DELETE", async () => {
    await t.db.batch([auditStatement(t.db, { actor: "owner", action: "create", entity: "demo", entityId: "a1", detail: { x: 1 } })]);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = 'a1'")).toBe(1);
    await expect(t.db.prepare("UPDATE audit_log SET actor = 'x'").run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM audit_log").run()).rejects.toThrow(/append-only/);
  });

  it("record_revisions blocks UPDATE and DELETE", async () => {
    await t.db.batch([revisionStatement(t.db, { entity: "demo", entityId: "r0", snapshot: { v: 0 }, actor: "owner" })]);
    await expect(t.db.prepare("UPDATE record_revisions SET reason = 'x'").run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM record_revisions").run()).rejects.toThrow(/append-only/);
  });

  it("revision numbers count up per record, in a batch or alone", async () => {
    const rev = (id: string) => revisionStatement(t.db, { entity: "demo", entityId: id, snapshot: { id }, reason: "edit", actor: "owner" });
    await t.db.batch([rev("r1"), rev("r1")]);
    await rev("r1").run();
    await rev("r2").run();
    const rows = await t.db
      .prepare("SELECT entity_id, revision_no FROM record_revisions WHERE entity_id IN ('r1','r2') ORDER BY entity_id, revision_no")
      .all<{ entity_id: string; revision_no: number }>();
    expect(rows.results).toEqual([
      { entity_id: "r1", revision_no: 1 },
      { entity_id: "r1", revision_no: 2 },
      { entity_id: "r1", revision_no: 3 },
      { entity_id: "r2", revision_no: 1 },
    ]);
  });

  it("the same (entity, entity_id, revision_no) cannot be inserted twice", async () => {
    const insert = () =>
      t.db
        .prepare(
          "INSERT INTO record_revisions (entity, entity_id, revision_no, snapshot_json, created_at, created_by) VALUES ('demo','dup',1,'{}','2026-01-01T00:00:00.000Z','owner')",
        )
        .run();
    await insert();
    await expect(insert()).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it("audit row and change succeed or fail together", async () => {
    await t.db.prepare("CREATE TABLE audit_demo (id TEXT PRIMARY KEY)").run();
    const insertDemo = () => t.db.prepare("INSERT INTO audit_demo (id) VALUES ('d1')");
    const audit = () => auditStatement(t.db, { actor: "owner", action: "create", entity: "audit_demo", entityId: "d1" });

    await t.db.batch([insertDemo(), audit()]);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'audit_demo'")).toBe(1);

    await expect(t.db.batch([insertDemo(), audit()])).rejects.toThrow(); // duplicate id fails
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'audit_demo'")).toBe(1);
  });
});

describe("no hard deletes (R9)", () => {
  it("the trigger from noDeleteTriggerSql aborts DELETE and keeps the row", async () => {
    await t.db.prepare("CREATE TABLE nodelete_demo (id TEXT PRIMARY KEY)").run();
    await t.db.prepare(noDeleteTriggerSql("nodelete_demo")).run();
    await t.db.prepare("INSERT INTO nodelete_demo (id) VALUES ('keep')").run();
    await expect(t.db.prepare("DELETE FROM nodelete_demo WHERE id = 'keep'").run()).rejects.toThrow(/never deleted/);
    expect(await count("SELECT COUNT(*) AS n FROM nodelete_demo")).toBe(1);
  });
});
