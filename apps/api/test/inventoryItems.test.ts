import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type InventoryHistoryResponse, type InventoryItemListResponse, type InventoryItemSaveResponse, type InventoryTypesResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 020 section 6: inventory items, U No., pairs, status history, search, permissions. */

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

const typeId = async (name: string) => (await one<{ id: string }>("SELECT id FROM inventory_item_types WHERE name = ?1", name))!.id;
const ring = () => typeId("Ring");
const chain = () => typeId("Chain");

const base = (over: Record<string, unknown> = {}) => ({
  metal: "gold",
  purity: "22K916",
  grossWeightMg: 12_500,
  netWeightMg: 12_000,
  hsn: "7113",
  ...over,
});

async function create(over: Record<string, unknown> = {}, as = "owner") {
  return call("/api/inventory/items", { method: "POST", as, body: base({ typeId: await ring(), ...over }) });
}
const itemOf = async (res: Response) => ((await res.json()) as InventoryItemSaveResponse).item;

describe("spec 020 I5 to I7: the U No. format", () => {
  it("the seeded types are Ring, Chain, Earring, Bangle and Necklace", async () => {
    const res = await call("/api/inventory/types");
    const body = (await res.json()) as InventoryTypesResponse;
    expect(body.items.map((x) => x.itemCode).sort()).toEqual(["BANG", "CHAI", "EARR", "NECK", "RING"]);
  });

  it("the first two rings get RING01 and RING02; a chain gets CHAI01", async () => {
    const r1 = await itemOf(await create());
    const r2 = await itemOf(await create());
    const c1 = await itemOf(await create({ typeId: await chain() }));
    expect([r1.uNo, r2.uNo, c1.uNo]).toEqual(["RING01", "RING02", "CHAI01"]);
    expect(r2.serial).toBe(2);
    expect(r1.statusLabel).toBe("In stock");
  });

  it("a typed U No. must start with the type's code", async () => {
    const res = await create({ uNo: "CHAI09" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: { field: string }[] };
    expect(body.issues[0]!.field).toBe("uNo");
  });

  it("a typed U No. is accepted, and a duplicate live one is 409 u_no_taken", async () => {
    expect((await create({ uNo: "RING50" })).status).toBe(201);
    const dup = await create({ uNo: "RING50" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe("u_no_taken");
  });

  it("a voided U No. can be typed again, but the automatic serial is never reissued", async () => {
    const res = await create({ uNo: "RING51" });
    const item = await itemOf(res);
    const voided = await call(`/api/inventory/items/${item.id}/void`, { method: "POST", body: { reason: "Entered twice" } });
    expect(voided.status).toBe(200);
    expect((await create({ uNo: "RING51" })).status).toBe(201);
    const next = await itemOf(await create());
    expect(next.serial).toBeGreaterThan(51);
  });

  it("a typed serial of 00 is refused, and the 100th item of one code is 409 serial_full", async () => {
    expect((await create({ uNo: "RING00" })).status).toBe(400);
    // The 99 serials are written in one statement (a loop of 99 requests is too slow under a full test run).
    const bangle = await typeId("Bangle");
    await t.db
      .prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 99)
         INSERT INTO inventory_items (id, created_at, created_by, updated_at, updated_by, u_no, item_code, serial, type_id, pieces, metal, purity,
           gross_weight_mg, net_weight_mg, hsn, status)
         SELECT lower(hex(randomblob(16))), '2026-11-02T10:00:00.000Z', 'test', '2026-11-02T10:00:00.000Z', 'test',
           'BANG' || printf('%02d', n), 'BANG', n, ?1, 1, 'gold', '22K916', 1000, 900, '7113', 'in_stock'
         FROM seq`,
      )
      .bind(bangle)
      .run();
    const full = await create({ typeId: bangle });
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: string }).error).toBe("serial_full");
  });
});

describe("spec 020 I1 to I4: fields and validation", () => {
  it("a pair is one item with two pieces, and the weights are for the whole pair", async () => {
    const earring = await typeId("Earring");
    const pair = await itemOf(await create({ typeId: earring, pieces: 2, grossWeightMg: 6_200, netWeightMg: 6_000 }));
    expect(pair.pieces).toBe(2);
    expect(pair.uNo).toBe("EARR01");
    expect(pair.netWeightMg).toBe(6_000);
    expect(await count("SELECT COUNT(*) AS n FROM inventory_items WHERE type_id = ?1", earring)).toBe(1);
  });

  it("net weight above gross is refused, and so is a weight of 0", async () => {
    const bad = await create({ grossWeightMg: 1_000, netWeightMg: 1_200 });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { issues: { field: string }[] }).issues[0]!.field).toBe("netWeightMg");
    expect((await create({ netWeightMg: 0 })).status).toBe(400);
  });

  it("silver metal needs silver purity, and silver purity needs silver metal", async () => {
    expect((await create({ metal: "silver", purity: "22K916" })).status).toBe(400);
    expect((await create({ metal: "gold", purity: "silver" })).status).toBe(400);
    expect((await create({ metal: "silver", purity: "silver", grossWeightMg: 20_000, netWeightMg: 19_000 })).status).toBe(201);
  });

  it("the pieces must be 1 to 10 and the HSN 7113 or 9988", async () => {
    expect((await create({ pieces: 11 })).status).toBe(400);
    expect((await create({ hsn: "7114" })).status).toBe(400);
  });

  it("an inactive type cannot take new items, and a new type can be added and renamed", async () => {
    const type = await call("/api/inventory/types", { method: "POST", body: { name: "Pendant", itemCode: "pend" } });
    expect(type.status).toBe(201);
    const made = (await type.json()) as { id: string; itemCode: string };
    expect(made.itemCode).toBe("PEND");
    expect((await call("/api/inventory/types", { method: "POST", body: { name: "pendant", itemCode: "PENX" } })).status).toBe(409);
    expect((await call("/api/inventory/types", { method: "POST", body: { name: "Other pend", itemCode: "PEND" } })).status).toBe(409);
    expect((await create({ typeId: made.id })).status).toBe(201);
    const off = await call(`/api/inventory/types/${made.id}`, { method: "PATCH", body: { active: false } });
    expect(((await off.json()) as { active: boolean }).active).toBe(false);
    const refused = await create({ typeId: made.id });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("type_inactive");
    const renamed = await call(`/api/inventory/types/${made.id}`, { method: "PATCH", body: { name: "Locket" } });
    expect(((await renamed.json()) as { name: string }).name).toBe("Locket");
  });
});

describe("spec 020 I12 to I14: status and history", () => {
  it("a status change writes one history row with the reason, and the item shows the new status", async () => {
    const item = await itemOf(await create());
    const res = await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "reserved", reason: "Held for a bride" } });
    expect(res.status).toBe(200);
    expect((await itemOf(res)).status).toBe("reserved");
    const hist = (await (await call(`/api/inventory/items/${item.id}/history`)).json()) as InventoryHistoryResponse;
    expect(hist.items.map((h) => [h.fromStatus, h.toStatus, h.reason])).toEqual([
      [null, "in_stock", "Created"],
      ["in_stock", "reserved", "Held for a bride"],
    ]);
  });

  it("history is oldest first, and moves through several statuses in order", async () => {
    const item = await itemOf(await create());
    for (const [status, reason] of [["on_memo", "Sent to a customer"], ["returned", "Came back"], ["in_stock", "Back on the shelf"]] as const) {
      expect((await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status, reason } })).status).toBe(200);
    }
    const hist = (await (await call(`/api/inventory/items/${item.id}/history`)).json()) as InventoryHistoryResponse;
    expect(hist.items.map((h) => h.toStatus)).toEqual(["in_stock", "on_memo", "returned", "in_stock"]);
    expect(hist.items.every((h, i) => i === 0 || h.at >= hist.items[i - 1]!.at)).toBe(true);
  });

  it("the same status is 409 and writes nothing; the reason is required", async () => {
    const item = await itemOf(await create());
    const same = await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "in_stock", reason: "x" } });
    expect(same.status).toBe(409);
    expect(((await same.json()) as { error: string }).error).toBe("same_status");
    const noReason = await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "sold", reason: "  " } });
    expect(noReason.status).toBe(400);
    expect(((await (await call(`/api/inventory/items/${item.id}/history`)).json()) as InventoryHistoryResponse).items).toHaveLength(1);
  });

  it("written off is final: any change after it is 409", async () => {
    const item = await itemOf(await create());
    await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "written_off", reason: "Lost in cleaning" } });
    const again = await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "in_stock", reason: "Found" } });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("invalid_status_move");
  });

  it("the history and item tables refuse UPDATE of history and DELETE of items", async () => {
    const item = await itemOf(await create());
    await expect(t.db.prepare("UPDATE inventory_item_history SET reason = 'changed' WHERE item_id = ?1").bind(item.id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM inventory_item_history WHERE item_id = ?1").bind(item.id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM inventory_items WHERE id = ?1").bind(item.id).run()).rejects.toThrow(/voided, never deleted/);
  });

  it("every create and status change writes an audit row", async () => {
    const item = await itemOf(await create());
    await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "reserved", reason: "Hold" } });
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?1", item.id)).toBe(2);
  });

  it("void: only in stock or written off, with a reason; the record stays and the U No. is freed", async () => {
    const item = await itemOf(await create({ uNo: "NECK77", typeId: await typeId("Necklace") }));
    const sold = await itemOf(await create({ typeId: await typeId("Necklace") }));
    await call(`/api/inventory/items/${sold.id}/status`, { method: "POST", body: { status: "sold", reason: "Sold to a customer" } });
    const refused = await call(`/api/inventory/items/${sold.id}/void`, { method: "POST", body: { reason: "Mistake" } });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("item_in_use");
    const voided = await call(`/api/inventory/items/${item.id}/void`, { method: "POST", body: { reason: "Wrong entry" } });
    expect(((await voided.json()) as InventoryItemSaveResponse).item.voidReason).toBe("Wrong entry");
    expect(await count("SELECT COUNT(*) AS n FROM inventory_items WHERE id = ?1", item.id)).toBe(1);
    const list = (await (await call("/api/inventory/items?q=NECK77")).json()) as InventoryItemListResponse;
    expect(list.items).toHaveLength(0);
    const all = (await (await call("/api/inventory/items?q=NECK77&includeVoided=1")).json()) as InventoryItemListResponse;
    expect(all.items).toHaveLength(1);
  });
});

describe("spec 020 I16, I17: idempotent create and search", () => {
  it("the same client id and content returns the first item; other content is 409 id_conflict", async () => {
    const id = newId();
    const first = await create({ id, location: "Case 2" });
    expect(first.status).toBe(201);
    const again = await create({ id, location: "Case 2" });
    expect(again.status).toBe(200);
    expect((await itemOf(again)).id).toBe(id);
    expect((await create({ id, location: "Case 3" })).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM inventory_items WHERE id = ?1", id)).toBe(1);
  });

  it("search finds an item by part of its U No. (spaces ignored), filters by type and status, pages 20 at a time", async () => {
    const ringRow = await itemOf(await create({ location: "Search case" }));
    const hit = (await (await call(`/api/inventory/items?q=${ringRow.uNo.slice(0, 3).toLowerCase()}%20${ringRow.uNo.slice(3)}`)).json()) as InventoryItemListResponse;
    expect(hit.items.map((i) => i.uNo)).toContain(ringRow.uNo);
    const byType = (await (await call(`/api/inventory/items?typeId=${await chain()}`)).json()) as InventoryItemListResponse;
    expect(byType.items.every((i) => i.typeName === "Chain")).toBe(true);
    const byStatus = (await (await call("/api/inventory/items?status=sold")).json()) as InventoryItemListResponse;
    expect(byStatus.items.every((i) => i.status === "sold")).toBe(true);
    expect((await call("/api/inventory/items?status=lost")).status).toBe(400);
  });

  it("paging: 20 items per page with a cursor", async () => {
    const bracelet = await typeId("Bangle");
    const bangles = (await (await call(`/api/inventory/items?typeId=${bracelet}`)).json()) as InventoryItemListResponse;
    expect(bangles.items.length).toBe(20);
    expect(bangles.nextCursor).toBe("20");
    const page2 = (await (await call(`/api/inventory/items?typeId=${bracelet}&cursor=20`)).json()) as InventoryItemListResponse;
    expect(page2.items.length).toBeGreaterThan(0);
    expect(page2.items[0]!.uNo).not.toBe(bangles.items[0]!.uNo);
  });

  it("search over 3000 rows answers in under 200 ms", async () => {
    // 31 item codes of 99 serials each: 3069 rows, written in one set-based statement.
    const typeNecklace = await typeId("Necklace");
    await t.db
      .prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 3000)
         INSERT INTO inventory_items (id, created_at, created_by, updated_at, updated_by, u_no, item_code, serial, type_id, pieces, metal, purity,
           gross_weight_mg, net_weight_mg, hsn, status)
         SELECT lower(hex(randomblob(16))), '2026-11-02T10:00:00.000Z', 'test', '2026-11-02T10:00:00.000Z', 'test',
           'Q' || substr('000' || ((n - 1) / 99), -3) || printf('%02d', (n - 1) % 99 + 1),
           'Q' || substr('000' || ((n - 1) / 99), -3), (n - 1) % 99 + 1, ?1, 1, 'gold', '22K916', 1000, 900, '7113', 'in_stock'
         FROM seq`,
      )
      .bind(typeNecklace)
      .run();
    expect(await count("SELECT COUNT(*) AS n FROM inventory_items WHERE item_code LIKE 'Q%'")).toBe(3000);
    await call("/api/inventory/items?q=Q0"); // warm-up: the first request also loads the session
    const started = Date.now();
    const res = await call("/api/inventory/items?q=Q0");
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(((await res.json()) as InventoryItemListResponse).items.length).toBe(20);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("spec 020 I19, I20: who can do what", () => {
  it("staff and viewer can read, not create, change status or void; manager can", async () => {
    const item = await itemOf(await create());
    for (const who of ["staff1", "viewer1"]) {
      expect((await call("/api/inventory/items", { as: who })).status).toBe(200);
      expect((await call(`/api/inventory/items/${item.id}`, { as: who })).status).toBe(200);
      expect((await call(`/api/inventory/items/${item.id}/history`, { as: who })).status).toBe(200);
      expect((await create({}, who)).status).toBe(403);
      expect((await call(`/api/inventory/items/${item.id}/status`, { method: "POST", as: who, body: { status: "sold", reason: "x" } })).status).toBe(403);
      expect((await call(`/api/inventory/items/${item.id}/void`, { method: "POST", as: who, body: { reason: "x" } })).status).toBe(403);
    }
    expect((await create({}, "manager1")).status).toBe(201);
    expect((await call("/api/inventory/types", { method: "POST", as: "staff1", body: { name: "Coin", itemCode: "COIN" } })).status).toBe(403);
  });
});
