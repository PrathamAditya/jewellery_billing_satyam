import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newId,
  type BulkItemDetailResponse,
  type BulkItemSaveResponse,
  type InventoryHistoryResponse,
  type InventoryItemSaveResponse,
  type LocationStockResponse,
  type StockLocationListResponse,
  type StockLocationSaveResponse,
  type StockTransferListResponse,
  type StockTransferSaveResponse,
} from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 021b section 6: stock places, item and bulk transfers, per-place balances, permissions, append-only tables. */

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
const json = async <T>(res: Response) => (await res.json()) as T;

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

const SHOWROOM = "loc-showroom";
const DISPLAY = "loc-display";
const LOCKER = "loc-locker";

// ---- builders ----
const ringType = async () => (await one<{ id: string }>("SELECT id FROM inventory_item_types WHERE name = 'Ring'"))!.id;

async function newItem(over: Record<string, unknown> = {}, as = "owner") {
  const res = await call("/api/inventory/items", {
    method: "POST",
    as,
    body: { typeId: await ringType(), metal: "gold", purity: "22K916", grossWeightMg: 12_500, netWeightMg: 12_000, hsn: "7113", ...over },
  });
  expect(res.status).toBe(201);
  return (await json<InventoryItemSaveResponse>(res)).item;
}
const getItem = async (id: string) => (await json<InventoryItemSaveResponse>(await call(`/api/inventory/items/${id}`))).item;

async function newBulk(name: string, openingQuantity = 0) {
  const res = await call("/api/inventory/bulk", { method: "POST", body: { name, unit: "pcs", openingQuantity } });
  expect(res.status).toBe(201);
  return (await json<BulkItemSaveResponse>(res)).item.id;
}
const bulkDetail = async (id: string) => json<BulkItemDetailResponse>(await call(`/api/inventory/bulk/${id}`));
const bulkAt = async (id: string, location: string) => (await bulkDetail(id)).byLocation.find((b) => b.locationId === location)!.quantity;
async function bulkMove(id: string, body: Record<string, unknown>, as = "owner") {
  return call(`/api/inventory/bulk/${id}/movements`, { method: "POST", as, body: { kind: "received", quantity: 1, ...body } });
}
async function transfer(body: Record<string, unknown>, as = "owner") {
  return call("/api/inventory/transfers", { method: "POST", as, body });
}
const itemTransfer = (itemId: string, fromLocationId: string, toLocationId: string, extra: Record<string, unknown> = {}) =>
  transfer({ kind: "item", inventoryItemId: itemId, fromLocationId, toLocationId, ...extra });
const bulkTransfer = (bulkItemId: string, quantity: number, fromLocationId: string, toLocationId: string, extra: Record<string, unknown> = {}) =>
  transfer({ kind: "bulk", bulkItemId, quantity, fromLocationId, toLocationId, ...extra });
async function newPlace(name: string) {
  const res = await call("/api/inventory/locations", { method: "POST", body: { name } });
  expect(res.status).toBe(201);
  return (await json<StockLocationSaveResponse>(res)).location;
}

describe("spec 021b L1, L3: the seeded places", () => {
  it("six places are seeded; Showroom is the default and is active", async () => {
    const list = await json<StockLocationListResponse>(await call("/api/inventory/locations"));
    expect(list.items.map((l) => l.name).sort()).toEqual(["Display", "Karigar", "Locker", "Refining centre", "Showroom", "Testing centre"]);
    const showroom = list.items.find((l) => l.id === SHOWROOM)!;
    expect(showroom).toMatchObject({ name: "Showroom", active: true, isDefault: true });
  });

  it("Showroom cannot be made inactive (409 showroom_locked), and the database refuses it too", async () => {
    const res = await call(`/api/inventory/locations/${SHOWROOM}`, { method: "PATCH", body: { active: false } });
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toBe("showroom_locked");
    await expect(t.db.prepare("UPDATE stock_locations SET active = 0 WHERE id = ?1").bind(SHOWROOM).run()).rejects.toThrow(/showroom_locked/);
    expect(await count("SELECT COUNT(*) AS n FROM stock_locations WHERE id = ?1 AND active = 1", SHOWROOM)).toBe(1);
  });

  it("the stock table refuses a location that does not exist", async () => {
    const item = await newItem();
    await expect(t.db.prepare("UPDATE inventory_items SET location_id = 'loc-nowhere' WHERE id = ?1").bind(item.id).run()).rejects.toThrow(/unknown_location/);
    expect((await getItem(item.id)).locationId).toBe(SHOWROOM);
  });
});

describe("spec 021b I1 to I4: items move between places", () => {
  it("a new item is at Showroom by default, and at the place it names", async () => {
    const a = await newItem();
    expect(a).toMatchObject({ locationId: SHOWROOM, locationName: "Showroom" });
    const b = await newItem({ locationId: DISPLAY, location: "Glass case 2" });
    expect(b).toMatchObject({ locationId: DISPLAY, locationName: "Display", location: "Glass case 2" });
    const stock = await json<LocationStockResponse>(await call(`/api/inventory/locations/${DISPLAY}/stock`));
    expect(stock.items.map((i) => i.uNo)).toContain(b.uNo);
  });

  it("a transfer moves the item, writes one transfer row and one audit row; status and status history do not change", async () => {
    const item = await newItem();
    const res = await itemTransfer(item.id, SHOWROOM, DISPLAY, { reason: "Front display" });
    expect(res.status).toBe(201);
    const saved = await json<StockTransferSaveResponse>(res);
    expect(saved.transfer).toMatchObject({ kind: "item", uNo: item.uNo, quantity: 1, fromLocationName: "Showroom", toLocationName: "Display", reason: "Front display" });
    const now = await getItem(item.id);
    expect(now).toMatchObject({ locationId: DISPLAY, locationName: "Display", status: "in_stock" });
    expect(await count("SELECT COUNT(*) AS n FROM stock_transfers WHERE inventory_item_id = ?1", item.id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'stock_transfer' AND entity_id = ?1", item.id)).toBe(1);
    const history = await json<InventoryHistoryResponse>(await call(`/api/inventory/items/${item.id}/history`));
    expect(history.items.map((h) => h.toStatus)).toEqual(["in_stock"]);
  });

  it("the item's transfers are listed with the item filter, newest first", async () => {
    const item = await newItem();
    await itemTransfer(item.id, SHOWROOM, LOCKER);
    await itemTransfer(item.id, LOCKER, SHOWROOM);
    const list = await json<StockTransferListResponse>(await call(`/api/inventory/transfers?itemId=${item.id}`));
    expect(list.items.map((r) => [r.fromLocationName, r.toLocationName])).toEqual([
      ["Locker", "Showroom"],
      ["Showroom", "Locker"],
    ]);
  });

  it("a sold item cannot move (409 item_not_in_stock) and nothing is written", async () => {
    const item = await newItem();
    await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "sold", reason: "Sold over the counter" } });
    const res = await itemTransfer(item.id, SHOWROOM, DISPLAY);
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toBe("item_not_in_stock");
    expect((await getItem(item.id)).locationId).toBe(SHOWROOM);
    expect(await count("SELECT COUNT(*) AS n FROM stock_transfers WHERE inventory_item_id = ?1", item.id)).toBe(0);
  });

  it("a reserved item cannot move either, and the message names its status", async () => {
    const item = await newItem();
    await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "reserved", reason: "Held for a customer" } });
    const res = await itemTransfer(item.id, SHOWROOM, DISPLAY);
    expect(res.status).toBe(409);
    expect(((await json<{ message: string }>(res)).message)).toMatch(/reserved/);
  });

  it("a voided item cannot move (409 item_not_in_stock) and nothing is written", async () => {
    const item = await newItem();
    await call(`/api/inventory/items/${item.id}/void`, { method: "POST", body: { reason: "Entered twice" } });
    const res = await itemTransfer(item.id, SHOWROOM, DISPLAY);
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toBe("item_not_in_stock");
    expect(await count("SELECT COUNT(*) AS n FROM stock_transfers WHERE inventory_item_id = ?1", item.id)).toBe(0);
  });

  it("a transfer from the wrong place is 409 stale and writes nothing", async () => {
    const item = await newItem({ locationId: LOCKER });
    const res = await itemTransfer(item.id, SHOWROOM, DISPLAY);
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toBe("stale");
    expect((await getItem(item.id)).locationId).toBe(LOCKER);
    expect(await count("SELECT COUNT(*) AS n FROM stock_transfers WHERE inventory_item_id = ?1", item.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'stock_transfer' AND entity_id = ?1", item.id)).toBe(0);
  });

  it("the same place on both sides is refused (400), and an item transfer takes no quantity other than 1", async () => {
    const item = await newItem();
    expect((await itemTransfer(item.id, SHOWROOM, SHOWROOM)).status).toBe(400);
    expect((await itemTransfer(item.id, SHOWROOM, DISPLAY, { quantity: 2 })).status).toBe(400);
    expect((await getItem(item.id)).locationId).toBe(SHOWROOM);
  });
});

describe("spec 021b B1, B2, B4: bulk balances per place", () => {
  it("movements at Showroom and Display, a transfer of 3, the total is unchanged and each place is right", async () => {
    const id = await newBulk("Tilli Places", 0);
    expect((await bulkMove(id, { kind: "received", quantity: 10 })).status).toBe(201);
    expect((await bulkMove(id, { kind: "received", quantity: 4, locationId: DISPLAY })).status).toBe(201);
    expect((await bulkDetail(id)).item.quantity).toBe(14);
    expect(await bulkAt(id, SHOWROOM)).toBe(10);
    expect(await bulkAt(id, DISPLAY)).toBe(4);

    const moved = await bulkTransfer(id, 3, SHOWROOM, DISPLAY, { reason: "Tray to display" });
    expect(moved.status).toBe(201);
    expect((await json<StockTransferSaveResponse>(moved)).transfer).toMatchObject({ kind: "bulk", quantity: 3, bulkItemName: "Tilli Places" });

    const detail = await bulkDetail(id);
    expect(detail.item.quantity).toBe(14);
    expect(await bulkAt(id, SHOWROOM)).toBe(7);
    expect(await bulkAt(id, DISPLAY)).toBe(7);
    const view = await one<{ total: number }>(
      "SELECT SUM(quantity) AS total FROM bulk_item_location_quantities WHERE bulk_item_id = ?1",
      id,
    );
    expect(view!.total).toBe(14);
    const total = await one<{ quantity: number }>("SELECT quantity FROM bulk_item_quantities WHERE bulk_item_id = ?1", id);
    expect(total!.quantity).toBe(14);
    // Each place lists the bulk item with its own number.
    const showroomStock = await json<LocationStockResponse>(await call(`/api/inventory/locations/${SHOWROOM}/stock`));
    expect(showroomStock.bulk.find((b) => b.bulkItemId === id)?.quantity).toBe(7);
    const displayStock = await json<LocationStockResponse>(await call(`/api/inventory/locations/${DISPLAY}/stock`));
    expect(displayStock.bulk.find((b) => b.bulkItemId === id)?.quantity).toBe(7);
  });

  it("a sale at Display takes from Display only", async () => {
    const id = await newBulk("Tilli Sale Place", 0);
    await bulkMove(id, { kind: "received", quantity: 5 });
    await bulkMove(id, { kind: "received", quantity: 2, locationId: DISPLAY });
    expect((await bulkMove(id, { kind: "sold", quantity: 2, locationId: DISPLAY })).status).toBe(201);
    expect(await bulkAt(id, DISPLAY)).toBe(0);
    expect(await bulkAt(id, SHOWROOM)).toBe(5);
    expect((await bulkDetail(id)).item.quantity).toBe(5);
  });

  it("the history row carries its place", async () => {
    const id = await newBulk("Tilli History Place", 0);
    await bulkMove(id, { kind: "received", quantity: 2, locationId: DISPLAY });
    const res = await call(`/api/inventory/bulk/${id}/history`);
    const rows = (await json<{ items: { locationId: string }[] }>(res)).items;
    expect(rows.map((r) => r.locationId)).toEqual([DISPLAY]);
  });
});

describe("spec 021b B3, B4: no place goes below zero", () => {
  it("a bulk transfer of more than the balance is refused by the API (409), and nothing is written", async () => {
    const id = await newBulk("Tilli Short Transfer", 2);
    const before = await count("SELECT COUNT(*) AS n FROM stock_transfers");
    const res = await bulkTransfer(id, 3, SHOWROOM, DISPLAY);
    expect(res.status).toBe(409);
    const body = await json<{ error: string; message: string }>(res);
    expect(body.error).toBe("insufficient_quantity");
    expect(body.message).toMatch(/Only 2 pcs/);
    expect(await count("SELECT COUNT(*) AS n FROM stock_transfers")).toBe(before);
    expect(await bulkAt(id, SHOWROOM)).toBe(2);
  });

  it("the database refuses a bulk transfer above the from balance, whatever the API says", async () => {
    const id = await newBulk("Tilli Trigger Transfer", 2);
    const row = { id: newId(), kind: "bulk", quantity: 5 };
    await expect(
      t.db
        .prepare(
          `INSERT INTO stock_transfers (id, created_at, created_by, updated_at, updated_by, kind, inventory_item_id, bulk_item_id, quantity, from_location_id, to_location_id, at, actor)
           VALUES (?1, 'x', 'test', 'x', 'test', 'bulk', NULL, ?2, ?3, ?4, ?5, 'x', 'test')`,
        )
        .bind(row.id, id, row.quantity, SHOWROOM, DISPLAY)
        .run(),
    ).rejects.toThrow(/quantity_below_zero/);
    expect(await bulkAt(id, SHOWROOM)).toBe(2);
  });

  it("a sale at a place with no stock is refused (409), and the database refuses it too", async () => {
    const id = await newBulk("Tilli Empty Locker", 5);
    const res = await bulkMove(id, { kind: "sold", quantity: 1, locationId: LOCKER });
    expect(res.status).toBe(409);
    const body = await json<{ error: string; message: string }>(res);
    expect(body.error).toBe("insufficient_quantity");
    expect(body.message).toMatch(/Only 0 pcs of Tilli Empty Locker are in stock at Locker/);
    await expect(
      t.db
        .prepare(
          `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by, location_id)
           VALUES (?1, ?2, 'sold', -1, 'x', 'test', NULL, 'x', 'test', ?3)`,
        )
        .bind(newId(), id, LOCKER)
        .run(),
    ).rejects.toThrow(/quantity_below_zero/);
    expect(await bulkAt(id, SHOWROOM)).toBe(5);
  });

  it("a bulk sale on an invoice takes from Showroom only, so stock held at Display alone is refused (spec 021 path)", async () => {
    const id = await newBulk("Tilli Invoice Place", 0);
    await bulkMove(id, { kind: "received", quantity: 4, locationId: DISPLAY });
    const res = await call("/api/invoices", {
      method: "POST",
      body: {
        invoiceDate: "2026-11-02",
        customerName: "Place Test Buyer",
        taxMode: "intra",
        lines: [
          {
            description: "Tilli",
            purity: "silver",
            hsn: "7113",
            grossWeightMg: 9_800,
            netWeightMg: 9_800,
            polishMg: 0,
            goldRatePaisePerKg: 28_572_000,
            labourRatePaisePerKg: 0,
            bulkItemId: id,
            bulkQuantity: 2,
          },
        ],
      },
    });
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toBe("insufficient_quantity");
    expect(await bulkAt(id, DISPLAY)).toBe(4);
    expect(await count("SELECT COUNT(*) AS n FROM invoices WHERE customer_name = 'Place Test Buyer'")).toBe(0);
  });
});

describe("spec 021b L1, L2, L4, L5: adding, renaming and making places inactive", () => {
  it("a place can be added and renamed; names are unique in any case", async () => {
    const place = await newPlace("Testing centre 2");
    expect(place).toMatchObject({ name: "Testing centre 2", active: true, isDefault: false });
    const dup = await call("/api/inventory/locations", { method: "POST", body: { name: "testing CENTRE 2" } });
    expect(dup.status).toBe(409);
    expect((await json<{ error: string }>(dup)).error).toBe("duplicate_name");
    const renamed = await call(`/api/inventory/locations/${place.id}`, { method: "PATCH", body: { name: "Testing centre two" } });
    expect(renamed.status).toBe(200);
    expect((await json<StockLocationSaveResponse>(renamed)).location.name).toBe("Testing centre two");
    const clash = await call(`/api/inventory/locations/${place.id}`, { method: "PATCH", body: { name: "display" } });
    expect(clash.status).toBe(409);
  });

  it("the same id with the same name returns the first place; another name under that id is 409", async () => {
    const id = newId();
    expect((await call("/api/inventory/locations", { method: "POST", body: { id, name: `Replay ${id.slice(0, 6)}` } })).status).toBe(201);
    expect((await call("/api/inventory/locations", { method: "POST", body: { id, name: `Replay ${id.slice(0, 6)}` } })).status).toBe(200);
    expect((await call("/api/inventory/locations", { method: "POST", body: { id, name: "Other name" } })).status).toBe(409);
  });

  it("an inactive place takes no new item, no bulk movement and no transfer (409 location_inactive)", async () => {
    const place = await newPlace("Closed corner");
    const off = await call(`/api/inventory/locations/${place.id}`, { method: "PATCH", body: { active: false } });
    expect(off.status).toBe(200);
    const item = await call("/api/inventory/items", {
      method: "POST",
      body: { typeId: await ringType(), metal: "gold", purity: "22K916", grossWeightMg: 5000, netWeightMg: 4000, hsn: "7113", locationId: place.id },
    });
    expect(item.status).toBe(409);
    expect((await json<{ error: string }>(item)).error).toBe("location_inactive");
    const bulkId = await newBulk("Tilli Closed", 3);
    expect((await bulkMove(bulkId, { kind: "received", quantity: 1, locationId: place.id })).status).toBe(409);
    const moved = await itemTransfer((await newItem()).id, SHOWROOM, place.id);
    expect(moved.status).toBe(409);
    expect((await json<{ error: string }>(moved)).error).toBe("location_inactive");
    expect((await bulkTransfer(bulkId, 1, SHOWROOM, place.id)).status).toBe(409);
  });

  it("a place that still holds stock cannot be made inactive (409 location_has_stock); after the stock moves out it can", async () => {
    const place = await newPlace("Stocked corner");
    const bulkId = await newBulk("Tilli Stocked Corner", 0);
    await bulkMove(bulkId, { kind: "received", quantity: 2, locationId: place.id });
    const blocked = await call(`/api/inventory/locations/${place.id}`, { method: "PATCH", body: { active: false } });
    expect(blocked.status).toBe(409);
    expect((await json<{ error: string }>(blocked)).error).toBe("location_has_stock");
    expect((await bulkTransfer(bulkId, 2, place.id, SHOWROOM)).status).toBe(201);
    const later = await call(`/api/inventory/locations/${place.id}`, { method: "PATCH", body: { active: false } });
    expect(later.status).toBe(200);
  });

  it("a place with an item at it cannot be made inactive either", async () => {
    const place = await newPlace("Item corner");
    await newItem({ locationId: place.id });
    const blocked = await call(`/api/inventory/locations/${place.id}`, { method: "PATCH", body: { active: false } });
    expect((await json<{ error: string }>(blocked)).error).toBe("location_has_stock");
  });
});

describe("spec 021b T3 to T5: transfers are kept and can be retried", () => {
  it("the same transfer id with the same content returns the first transfer; other content is 409 id_conflict", async () => {
    const item = await newItem();
    const id = newId();
    const first = await itemTransfer(item.id, SHOWROOM, LOCKER, { id });
    expect(first.status).toBe(201);
    const retry = await itemTransfer(item.id, SHOWROOM, LOCKER, { id });
    expect(retry.status).toBe(200);
    expect((await json<StockTransferSaveResponse>(retry)).transfer.id).toBe(id);
    expect(await count("SELECT COUNT(*) AS n FROM stock_transfers WHERE id = ?1", id)).toBe(1);
    const other = await itemTransfer(item.id, LOCKER, DISPLAY, { id });
    expect(other.status).toBe(409);
    expect((await json<{ error: string }>(other)).error).toBe("id_conflict");
  });

  it("a bulk transfer retried after a timeout moves the quantity once", async () => {
    const bulkId = await newBulk("Tilli Retry", 6);
    const id = newId();
    expect((await bulkTransfer(bulkId, 2, SHOWROOM, DISPLAY, { id })).status).toBe(201);
    expect((await bulkTransfer(bulkId, 2, SHOWROOM, DISPLAY, { id })).status).toBe(200);
    expect(await bulkAt(bulkId, SHOWROOM)).toBe(4);
    expect(await bulkAt(bulkId, DISPLAY)).toBe(2);
  });

  it("the transfer list filters by place and pages 20 at a time, newest first", async () => {
    const bulkId = await newBulk("Tilli Paging", 0);
    await bulkMove(bulkId, { kind: "received", quantity: 30 });
    for (let i = 0; i < 25; i++) expect((await bulkTransfer(bulkId, 1, SHOWROOM, DISPLAY)).status).toBe(201);
    const first = await json<StockTransferListResponse>(await call(`/api/inventory/transfers?bulkItemId=${bulkId}`));
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBe("20");
    const second = await json<StockTransferListResponse>(await call(`/api/inventory/transfers?bulkItemId=${bulkId}&cursor=20`));
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const byPlace = await json<StockTransferListResponse>(await call(`/api/inventory/transfers?locationId=${DISPLAY}&bulkItemId=${bulkId}`));
    expect(byPlace.items).toHaveLength(20);
  });

  it("a transfer may carry a reason, and it may be left out", async () => {
    const item = await newItem();
    const none = await itemTransfer(item.id, SHOWROOM, DISPLAY);
    expect((await json<StockTransferSaveResponse>(none)).transfer.reason).toBeNull();
    const long = "x".repeat(301);
    const tooLong = await itemTransfer((await newItem()).id, SHOWROOM, DISPLAY, { reason: long });
    expect(tooLong.status).toBe(400);
  });
});

describe("spec 021b P1 to P3: who can read and who can move", () => {
  it("staff and viewer can read the places, a place's stock and the transfers; they cannot add, rename, transfer or move (403)", async () => {
    for (const who of ["staff1", "viewer1"]) {
      expect((await call("/api/inventory/locations", { as: who })).status).toBe(200);
      expect((await call(`/api/inventory/locations/${DISPLAY}/stock`, { as: who })).status).toBe(200);
      expect((await call("/api/inventory/transfers", { as: who })).status).toBe(200);
      expect((await call("/api/inventory/locations", { method: "POST", body: { name: `Denied ${who}` }, as: who })).status).toBe(403);
      expect((await call(`/api/inventory/locations/${DISPLAY}`, { method: "PATCH", body: { name: "No" }, as: who })).status).toBe(403);
      const item = await newItem();
      expect((await transfer({ kind: "item", inventoryItemId: item.id, fromLocationId: SHOWROOM, toLocationId: DISPLAY }, who)).status).toBe(403);
      expect((await getItem(item.id)).locationId).toBe(SHOWROOM);
      const bulkId = await newBulk(`Tilli Denied ${who}`, 3);
      expect((await transfer({ kind: "bulk", bulkItemId: bulkId, quantity: 1, fromLocationId: SHOWROOM, toLocationId: DISPLAY }, who)).status).toBe(403);
      expect(await bulkAt(bulkId, SHOWROOM)).toBe(3);
    }
  });

  it("manager can make a transfer and add a place", async () => {
    const item = await newItem();
    expect((await itemTransfer(item.id, SHOWROOM, DISPLAY, { as: "manager1" })).status).toBe(201);
    expect((await call("/api/inventory/locations", { method: "POST", body: { name: "Manager place" }, as: "manager1" })).status).toBe(201);
  });
});

describe("spec 021b: the transfer and place tables refuse change and removal", () => {
  it("stock_transfers refuses UPDATE and DELETE", async () => {
    const item = await newItem();
    const res = await itemTransfer(item.id, SHOWROOM, DISPLAY);
    const id = (await json<StockTransferSaveResponse>(res)).transfer.id;
    await expect(t.db.prepare("UPDATE stock_transfers SET reason = 'x' WHERE id = ?1").bind(id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM stock_transfers WHERE id = ?1").bind(id).run()).rejects.toThrow(/append-only/);
  });

  it("stock_locations refuses DELETE, and a second place with a name already used in any case", async () => {
    await expect(t.db.prepare("DELETE FROM stock_locations WHERE id = ?1").bind(LOCKER).run()).rejects.toThrow(/never deleted/);
    await expect(
      t.db
        .prepare("INSERT INTO stock_locations (id, created_at, created_by, updated_at, updated_by, name, active) VALUES (?1, 'x', 'test', 'x', 'test', 'LOCKER', 1)")
        .bind(newId())
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("a transfer row must be an item with quantity 1, or a bulk item (the table rules)", async () => {
    const item = await newItem();
    await expect(
      t.db
        .prepare(
          `INSERT INTO stock_transfers (id, created_at, created_by, updated_at, updated_by, kind, inventory_item_id, bulk_item_id, quantity, from_location_id, to_location_id, at, actor)
           VALUES (?1, 'x', 'test', 'x', 'test', 'item', ?2, NULL, 2, ?3, ?4, 'x', 'test')`,
        )
        .bind(newId(), item.id, SHOWROOM, DISPLAY)
        .run(),
    ).rejects.toThrow(/CHECK/);
  });
});
