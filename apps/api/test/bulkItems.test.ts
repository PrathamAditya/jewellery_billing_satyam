import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type BulkHistoryResponse, type BulkItemListResponse, type BulkItemSaveResponse, type BulkMovementSaveResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 020b section 6: bulk quantity items, the no-negative rule, movements and history. */

let t: Awaited<ReturnType<typeof createTestDb>>;
const app = createApp({ now: () => new Date("2026-11-02T10:00:00.000Z") });
const PASSWORD = "a long test password";
const cookies: Record<string, string> = {};

type Opts = { method?: string; body?: unknown; as?: string };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (cookies[o.as ?? "owner"]) headers.Cookie = cookies[o.as ?? "owner"]!;
  if (method !== "GET") headers.Origin = "http://localhost";
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body) }, { DB: t.db });
}
const one = async <T>(sql: string, ...args: unknown[]) => t.db.prepare(sql).bind(...args).first<T>();
const count = async (sql: string, ...args: unknown[]) => (await one<{ n: number }>(sql, ...args))!.n;

async function person(username: string, role: string) {
  await t.db
    .prepare(`INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name)
              VALUES (?1, '2026-11-02T00:00:00.000Z', 'test', '2026-11-02T00:00:00.000Z', 'test', ?2, ?3, ?4, ?2)`)
    .bind(`u-${username}`, username, await hashPassword(PASSWORD, 1000), role)
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  cookies[username] = res.headers.get("set-cookie")!.split(";")[0]!;
}

beforeAll(async () => {
  t = await createTestDb();
  await person("owner", "owner");
  await person("manager1", "manager");
  await person("staff1", "staff");
  await person("viewer1", "viewer");
});
afterAll(() => t.dispose());

let n = 0;
async function bulk(name = `Tilli ${++n}`, openingQuantity = 0, as = "owner") {
  return call("/api/inventory/bulk", { method: "POST", as, body: { name, unit: "pcs", openingQuantity } });
}
const itemOf = async (res: Response) => ((await res.json()) as BulkItemSaveResponse).item;
async function move(id: string, body: Record<string, unknown>, as = "owner") {
  return call(`/api/inventory/bulk/${id}/movements`, { method: "POST", as, body });
}
const history = async (id: string) => ((await (await call(`/api/inventory/bulk/${id}/history`)).json()) as BulkHistoryResponse).items;

describe("spec 020b B1 to B3: items and opening quantity", () => {
  it("an item is created with a name, a unit and no U No.; the quantity starts at 0", async () => {
    const item = await itemOf(await bulk("Tilli Small"));
    expect(item.quantity).toBe(0);
    expect(item.unit).toBe("pcs");
    expect(await count("SELECT COUNT(*) AS n FROM bulk_item_movements WHERE bulk_item_id = ?1", item.id)).toBe(0);
  });

  it("an opening quantity is one received movement with the reason Opening stock", async () => {
    const item = await itemOf(await bulk("Tilli Opening", 25));
    expect(item.quantity).toBe(25);
    const rows = await history(item.id);
    expect(rows.map((r) => [r.kind, r.quantityChange, r.reason, r.balanceAfter])).toEqual([["received", 25, "Opening stock", 25]]);
  });

  it("a duplicate name is 409 duplicate_name, in any case", async () => {
    await bulk("Tilli Dup");
    const res = await bulk("tilli dup");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("duplicate_name");
  });

  it("a negative opening quantity or an unknown unit is refused", async () => {
    expect((await bulk("Tilli Neg", -1)).status).toBe(400);
    expect((await call("/api/inventory/bulk", { method: "POST", body: { name: "Tilli Unit", unit: "grams", openingQuantity: 0 } })).status).toBe(400);
  });

  it("the same id and content returns the first item; other content is 409", async () => {
    const id = newId();
    expect((await call("/api/inventory/bulk", { method: "POST", body: { id, name: `Tilli Id ${id.slice(0, 6)}`, unit: "pcs" } })).status).toBe(201);
    expect((await call("/api/inventory/bulk", { method: "POST", body: { id, name: `Tilli Id ${id.slice(0, 6)}`, unit: "pcs" } })).status).toBe(200);
    expect((await call("/api/inventory/bulk", { method: "POST", body: { id, name: "Other", unit: "pcs" } })).status).toBe(409);
  });
});

describe("spec 020b B4, B7: movements and the total", () => {
  it("received 10, sold 3 and adjusted -2 leave 5, and the view and the history agree", async () => {
    const item = await itemOf(await bulk("Tilli Totals"));
    expect((await move(item.id, { kind: "received", quantity: 10 })).status).toBe(201);
    expect((await move(item.id, { kind: "sold", quantity: 3 })).status).toBe(201);
    const adj = await move(item.id, { kind: "adjusted", quantity: -2, reason: "Counted short" });
    expect(((await adj.json()) as BulkMovementSaveResponse).quantity).toBe(5);
    const now = await itemOf(await call(`/api/inventory/bulk/${item.id}`));
    expect(now.quantity).toBe(5);
    const rows = await history(item.id);
    expect(rows.at(-1)!.balanceAfter).toBe(5);
    expect(rows.reduce((s, r) => s + r.quantityChange, 0)).toBe(5);
  });

  it("sold is typed as a positive number and is taken out; adjusted can add", async () => {
    const item = await itemOf(await bulk("Tilli Signs", 4));
    await move(item.id, { kind: "sold", quantity: 1 });
    await move(item.id, { kind: "adjusted", quantity: 2, reason: "Found in the tray" });
    const rows = await history(item.id);
    expect(rows.map((r) => r.quantityChange)).toEqual([4, -1, 2]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([4, 3, 5]);
  });

  it("an adjustment that takes the quantity to exactly zero is allowed", async () => {
    const item = await itemOf(await bulk("Tilli Zero", 3));
    const res = await move(item.id, { kind: "adjusted", quantity: -3, reason: "All broken" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as BulkMovementSaveResponse).quantity).toBe(0);
  });

  it("the input rules: adjusted needs a reason; received, sold and adjusted need a quantity other than 0; received and sold are positive", async () => {
    const item = await itemOf(await bulk("Tilli Rules", 5));
    expect((await move(item.id, { kind: "adjusted", quantity: -1 })).status).toBe(400);
    expect((await move(item.id, { kind: "adjusted", quantity: 0, reason: "x" })).status).toBe(400);
    expect((await move(item.id, { kind: "sold", quantity: 0 })).status).toBe(400);
    expect((await move(item.id, { kind: "received", quantity: -2 })).status).toBe(400);
    expect((await move(item.id, { kind: "sold", quantity: -2 })).status).toBe(400);
    expect((await move(item.id, { kind: "sold", quantity: 1.5 })).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM bulk_item_movements WHERE bulk_item_id = ?1", item.id)).toBe(1);
  });

  it("the history is oldest first, with the balance after each row", async () => {
    const item = await itemOf(await bulk("Tilli Order"));
    for (const body of [{ kind: "received", quantity: 2 }, { kind: "received", quantity: 3 }, { kind: "sold", quantity: 4 }, { kind: "adjusted", quantity: 1, reason: "Recount" }]) {
      await move(item.id, body);
    }
    const rows = await history(item.id);
    expect(rows.map((r) => r.kind)).toEqual(["received", "received", "sold", "adjusted"]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([2, 5, 1, 2]);
    expect(rows.every((r, i) => i === 0 || r.at >= rows[i - 1]!.at)).toBe(true);
  });
});

describe("spec 020b B5, B6: no negative quantity, append-only", () => {
  it("selling more than is in stock is 409 insufficient_quantity, and nothing is written", async () => {
    const item = await itemOf(await bulk("Tilli Short", 2));
    const audits = await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?1", item.id);
    const res = await move(item.id, { kind: "sold", quantity: 3 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("insufficient_quantity");
    expect(body.message).toContain("Only 2 pcs");
    expect((await itemOf(await call(`/api/inventory/bulk/${item.id}`))).quantity).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM bulk_item_movements WHERE bulk_item_id = ?1", item.id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?1", item.id)).toBe(audits);
  });

  it("the database refuses a movement below zero even without the API check", async () => {
    const item = await itemOf(await bulk("Tilli Trigger", 1));
    await expect(
      t.db
        .prepare(
          `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, created_at, created_by)
           VALUES (?1, ?2, 'adjusted', -2, '2026-11-02T10:00:00.000Z', 'test', '2026-11-02T10:00:00.000Z', 'test')`,
        )
        .bind(newId(), item.id)
        .run(),
    ).rejects.toThrow(/quantity_below_zero/);
  });

  it("movements and bulk items cannot be updated or deleted", async () => {
    const item = await itemOf(await bulk("Tilli Locked", 1));
    await expect(t.db.prepare("UPDATE bulk_item_movements SET quantity_change = 9 WHERE bulk_item_id = ?1").bind(item.id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM bulk_item_movements WHERE bulk_item_id = ?1").bind(item.id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM bulk_items WHERE id = ?1").bind(item.id).run()).rejects.toThrow(/never deleted/);
    await expect(t.db.prepare("UPDATE bulk_items SET name = 'Renamed' WHERE id = ?1").bind(item.id).run()).resolves.toBeDefined();
  });

  it("a retried movement with the same id is written once; a different one on that id is 409", async () => {
    const item = await itemOf(await bulk("Tilli Retry", 5));
    const id = newId();
    expect((await move(item.id, { id, kind: "sold", quantity: 2 })).status).toBe(201);
    const again = await move(item.id, { id, kind: "sold", quantity: 2 });
    expect(again.status).toBe(200); // a replay returns the first result, it does not write again
    expect(((await again.json()) as BulkMovementSaveResponse).quantity).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM bulk_item_movements WHERE id = ?1", id)).toBe(1);
    expect((await move(item.id, { id, kind: "sold", quantity: 1 })).status).toBe(409);
  });

  it("every movement writes an audit row", async () => {
    const item = await itemOf(await bulk("Tilli Audit", 3));
    await move(item.id, { kind: "sold", quantity: 1 });
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?1", item.id)).toBe(2);
  });
});

describe("spec 020b B8, B12: list and permissions", () => {
  it("the list shows each item with its current quantity, filtered by name", async () => {
    const item = await itemOf(await bulk("Tilli Listed", 7));
    const all = (await (await call("/api/inventory/bulk")).json()) as BulkItemListResponse;
    expect(all.items.find((i) => i.id === item.id)?.quantity).toBe(7);
    const some = (await (await call("/api/inventory/bulk?q=listed")).json()) as BulkItemListResponse;
    expect(some.items.map((i) => i.name)).toEqual(["Tilli Listed"]);
  });

  it("staff and viewer can read, not create or record; manager can", async () => {
    const item = await itemOf(await bulk("Tilli Perms", 1));
    for (const who of ["staff1", "viewer1"]) {
      expect((await call("/api/inventory/bulk", { as: who })).status).toBe(200);
      expect((await call(`/api/inventory/bulk/${item.id}`, { as: who })).status).toBe(200);
      expect((await call(`/api/inventory/bulk/${item.id}/history`, { as: who })).status).toBe(200);
      expect((await bulk("Tilli Denied", 0, who)).status).toBe(403);
      expect((await move(item.id, { kind: "sold", quantity: 1 }, who)).status).toBe(403);
    }
    expect((await move(item.id, { kind: "sold", quantity: 1 }, "manager1")).status).toBe(201);
  });
});
