import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  BulkItemDetailResponse,
  InventoryHistoryResponse,
  InventoryItemSaveResponse,
  ReconciliationCloseResponse,
  ReconciliationDetailResponse,
  ReconciliationLine,
  ReconciliationReportResponse,
  StockLocationListResponse,
} from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { stockProblem } from "../src/invoices/stock";
import { createTestDb } from "./helpers";

/** Spec 025 section 6: monthly stock reconciliation. Each test uses its own month and place so the counts stay separate. */

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
const KARIGAR = "loc-karigar";
const TESTING = "loc-testing";
const REFINING = "loc-refining";
const MISSING = "loc-missing";

// ---- builders ----
const ringType = async () => (await one<{ id: string }>("SELECT id FROM inventory_item_types WHERE name = 'Ring'"))!.id;

async function newItem(over: Record<string, unknown> = {}) {
  const res = await call("/api/inventory/items", {
    method: "POST",
    body: { typeId: await ringType(), metal: "gold", purity: "22K916", grossWeightMg: 12_500, netWeightMg: 12_000, hsn: "7113", ...over },
  });
  expect(res.status).toBe(201);
  return (await json<InventoryItemSaveResponse>(res)).item;
}
const getItem = async (id: string) => (await json<InventoryItemSaveResponse>(await call(`/api/inventory/items/${id}`))).item;

async function newBulk(name: string, openingQuantity: number, locationId = SHOWROOM) {
  const res = await call("/api/inventory/bulk", { method: "POST", body: { name, unit: "pcs", openingQuantity, locationId } });
  expect(res.status).toBe(201);
  return (await json<{ item: { id: string } }>(res)).item.id;
}
const bulkQuantity = async (id: string) => (await json<BulkItemDetailResponse>(await call(`/api/inventory/bulk/${id}`))).item.quantity;
const bulkAt = async (id: string, location: string) =>
  (await json<BulkItemDetailResponse>(await call(`/api/inventory/bulk/${id}`))).byLocation.find((b) => b.locationId === location)?.quantity ?? 0;
async function bulkMove(id: string, body: Record<string, unknown>) {
  const res = await call(`/api/inventory/bulk/${id}/movements`, { method: "POST", body: { kind: "received", quantity: 1, locationId: SHOWROOM, ...body } });
  expect(res.status).toBe(201);
}

async function openCount(month: string, locationId: string | null, as = "owner") {
  return call("/api/inventory/reconciliations", { method: "POST", as, body: { month, locationId } });
}
async function openOk(month: string, locationId: string | null) {
  const res = await openCount(month, locationId);
  expect(res.status).toBe(201);
  return json<ReconciliationDetailResponse>(res);
}
const detailOf = async (id: string) => json<ReconciliationDetailResponse>(await call(`/api/inventory/reconciliations/${id}`));
const lineFor = (d: ReconciliationDetailResponse, pred: (l: ReconciliationLine) => boolean) => d.lines.find(pred)!;
async function save(id: string, lines: unknown[], as = "owner") {
  return call(`/api/inventory/reconciliations/${id}/counts`, { method: "PUT", as, body: { lines } });
}
/**
 * Every line of a count must be counted before it closes (spec 025 R9). Lines the test does not care about count as the
 * system has them: an item found, a bulk item at its opening figure. `overrides` sets a line's count by line id.
 */
function countAll(d: ReconciliationDetailResponse, overrides: Record<string, unknown> = {}, notes: Record<string, string> = {}) {
  return d.lines.map((l) => ({
    id: l.id,
    counted: l.id in overrides ? overrides[l.id] : l.lineKind === "item" ? "found" : l.systemAtOpening,
    note: notes[l.id] ?? null,
  }));
}
async function close(id: string, as = "owner") {
  return call(`/api/inventory/reconciliations/${id}/close`, { method: "POST", as });
}

describe("spec 025 R1, R3: one open count per month and place", () => {
  it("a second open for the same month and place is refused; other months and places are allowed", async () => {
    const first = await openOk("2026-03", SHOWROOM);
    expect(first.reconciliation.status).toBe("open");
    const again = await openCount("2026-03", SHOWROOM);
    expect(again.status).toBe(409);
    expect((await json<{ error: string; reconciliationId: string }>(again))).toMatchObject({ error: "already_open", reconciliationId: first.reconciliation.id });
    expect((await openCount("2026-03", DISPLAY)).status).toBe(201);
    expect((await openCount("2026-04", SHOWROOM)).status).toBe(201);
    expect((await openCount("2026-03", null)).status).toBe(201);
    expect((await openCount("2026-03", null)).status).toBe(409);
  });

  it("an inactive place cannot be counted, and the hidden Missing place is never a choice", async () => {
    const inactive = await call("/api/inventory/locations", { method: "POST", body: { name: "Old counter 025" } });
    const placeId = (await json<{ location: { id: string } }>(inactive)).location.id;
    await call(`/api/inventory/locations/${placeId}`, { method: "PATCH", body: { active: false } });
    expect((await openCount("2026-03", placeId)).status).toBe(409);
    expect((await openCount("2026-03", MISSING)).status).toBe(400);
  });

  it("the open count opens with the stock at the place, one line per item and one per bulk item", async () => {
    const ring = await newItem({ locationId: LOCKER });
    const bulk = await newBulk("Tilli 025 open", 4, LOCKER);
    const d = await openOk("2026-05", LOCKER);
    expect(lineFor(d, (l) => l.inventoryItemId === ring.id).systemAtOpening).toBe(1);
    expect(lineFor(d, (l) => l.bulkItemId === bulk).systemAtOpening).toBe(4);
    expect(d.lines.every((l) => l.locationId === LOCKER)).toBe(true);
  });
});

describe("spec 025 R5, R10: the differences of a bulk count", () => {
  it("a plus and a minus count write the right adjustments and the balance equals the count", async () => {
    const plus = await newBulk("Tilli 025 plus", 10, LOCKER);
    const minus = await newBulk("Tilli 025 minus", 10, LOCKER);
    const d = await openOk("2026-06", LOCKER);
    const linePlus = lineFor(d, (l) => l.bulkItemId === plus);
    const lineMinus = lineFor(d, (l) => l.bulkItemId === minus);
    expect((await save(d.reconciliation.id, countAll(d, { [linePlus.id]: 13, [lineMinus.id]: 7 }))).status).toBe(200);
    const before = await detailOf(d.reconciliation.id);
    expect(lineFor(before, (l) => l.bulkItemId === plus).difference).toBe(3);
    expect(lineFor(before, (l) => l.bulkItemId === minus).difference).toBe(-3);

    const res = await close(d.reconciliation.id);
    expect(res.status).toBe(200);
    expect((await json<ReconciliationCloseResponse>(res)).adjustments).toBeGreaterThanOrEqual(2);
    expect(await bulkQuantity(plus)).toBe(13);
    expect(await bulkQuantity(minus)).toBe(7);
    const movement = await one<{ kind: string; quantity_change: number; reason: string }>(
      "SELECT kind, quantity_change, reason FROM bulk_item_movements WHERE bulk_item_id = ?1 AND kind = 'adjusted'",
      minus,
    );
    expect(movement).toMatchObject({ kind: "adjusted", quantity_change: -3 });
    expect(movement!.reason).toMatch(/^Reconciliation 2026-06/);
  });

  it("a count that is not a whole number or is negative is refused, and nothing is saved", async () => {
    const bulk = await newBulk("Tilli 025 neg", 2, LOCKER);
    const d = await openOk("2026-07", LOCKER);
    const line = lineFor(d, (l) => l.bulkItemId === bulk);
    expect((await save(d.reconciliation.id, [{ id: line.id, counted: -1 }])).status).toBe(400);
    expect((await save(d.reconciliation.id, [{ id: line.id, counted: 1.5 }])).status).toBe(400);
    expect((await detailOf(d.reconciliation.id)).lines.find((l) => l.id === line.id)!.counted).toBeNull();
  });
});

describe("spec 025 R9, R10, R12: pieces that are not found, and found pieces", () => {
  it("a piece not found moves to Missing with the reason, its status does not change, and it is hidden from the place list", async () => {
    const ring = await newItem({ locationId: KARIGAR });
    const d = await openOk("2026-08", KARIGAR);
    const line = lineFor(d, (l) => l.inventoryItemId === ring.id);
    expect((await save(d.reconciliation.id, countAll(d, { [line.id]: "not_found" }, { [line.id]: "not in the tray" }))).status).toBe(200);
    expect(lineFor(await detailOf(d.reconciliation.id), (l) => l.inventoryItemId === ring.id).difference).toBe(-1);
    expect((await close(d.reconciliation.id)).status).toBe(200);

    const after = await getItem(ring.id);
    expect(after.locationId).toBe(MISSING);
    expect(after.status).toBe("in_stock");
    const transfer = await one<{ reason: string; to_location_id: string }>("SELECT reason, to_location_id FROM stock_transfers WHERE inventory_item_id = ?1", ring.id);
    expect(transfer).toMatchObject({ to_location_id: MISSING });
    expect(transfer!.reason).toMatch(/^Reconciliation 2026-08: not found at count/);
    const places = (await json<StockLocationListResponse>(await call("/api/inventory/locations"))).items.map((l) => l.id);
    expect(places).not.toContain(MISSING);
    expect(places).toContain(KARIGAR);
  });

  it("a found piece that the system shows as sold goes back to stock with a status history row", async () => {
    const ring = await newItem({ locationId: REFINING });
    const sold = await call(`/api/inventory/items/${ring.id}/status`, { method: "POST", body: { status: "sold", reason: "Sold to a test customer" } });
    expect(sold.status).toBe(200);
    const d = await openOk("2026-09", REFINING);
    expect(d.lines.find((l) => l.inventoryItemId === ring.id)).toBeUndefined();
    const added = await call(`/api/inventory/reconciliations/${d.reconciliation.id}/lines`, { method: "POST", body: { inventoryItemId: ring.id } });
    expect(added.status).toBe(201);
    const extra = lineFor(await json<ReconciliationDetailResponse>(added), (l) => l.inventoryItemId === ring.id);
    expect(extra.addedLater).toBe(true);
    expect((await call(`/api/inventory/reconciliations/${d.reconciliation.id}/lines`, { method: "POST", body: { inventoryItemId: ring.id } })).status).toBe(409);
    expect((await save(d.reconciliation.id, countAll(await detailOf(d.reconciliation.id)))).status).toBe(200);
    expect((await close(d.reconciliation.id)).status).toBe(200);

    const after = await getItem(ring.id);
    expect(after.status).toBe("in_stock");
    expect(after.locationId).toBe(REFINING);
    const history = await json<InventoryHistoryResponse>(await call(`/api/inventory/items/${ring.id}/history`));
    expect(history.items.at(-1)).toMatchObject({ fromStatus: "sold", toStatus: "in_stock", reason: "Reconciliation 2026-09: found at count" });
  });

  it("a written-off piece found at a count is refused and nothing is written", async () => {
    const ring = await newItem({ locationId: REFINING });
    await call(`/api/inventory/items/${ring.id}/status`, { method: "POST", body: { status: "written_off", reason: "Melted down" } });
    const d = await openOk("2026-10", REFINING);
    const added = await call(`/api/inventory/reconciliations/${d.reconciliation.id}/lines`, { method: "POST", body: { inventoryItemId: ring.id } });
    expect(added.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM stock_reconciliation_lines WHERE reconciliation_id = ?1", d.reconciliation.id)).toBe(d.lines.length);
  });

  it("a Missing piece cannot go on an invoice, and the Missing place cannot be renamed or made inactive", async () => {
    const ring = await newItem({ locationId: MISSING });
    const problem = await stockProblem(t.db, [{ itemId: ring.id, uNo: null, bulkItemId: null, bulkQuantity: 0 }], [], null);
    expect(problem).toMatchObject({ error: "item_not_in_stock" });
    expect(problem!.message).toMatch(/not found at the last stock count/);
    const off = await call(`/api/inventory/locations/${MISSING}`, { method: "PATCH", body: { active: false } });
    expect(off.status).toBe(409);
    expect(await json<{ error: string }>(off)).toMatchObject({ error: "system_locked" });
    const renamed = await call(`/api/inventory/locations/${MISSING}`, { method: "PATCH", body: { name: "Lost" } });
    expect(renamed.status).toBe(409);
    await expect(t.db.prepare("UPDATE stock_locations SET active = 0 WHERE id = ?1").bind(MISSING).run()).rejects.toThrow(/system_locked/);
  });
});

describe("spec 025 R8, R9, R11, R15: closing is final", () => {
  it("lines not counted block the close, and nothing is written", async () => {
    const bulk = await newBulk("Tilli 025 uncounted", 6, TESTING);
    const d = await openOk("2026-11", TESTING);
    const res = await close(d.reconciliation.id);
    expect(res.status).toBe(409);
    expect(await json<{ error: string }>(res)).toMatchObject({ error: "lines_not_counted" });
    expect(await bulkQuantity(bulk)).toBe(6);
  });

  it("closing twice is refused, and a closed count rejects a save and a new line", async () => {
    const bulk = await newBulk("Tilli 025 twice", 5, TESTING);
    const d = await openOk("2026-12", TESTING);
    const line = lineFor(d, (l) => l.bulkItemId === bulk);
    await save(d.reconciliation.id, countAll(d, { [line.id]: 5 }));
    expect((await close(d.reconciliation.id)).status).toBe(200);
    const second = await close(d.reconciliation.id);
    expect(second.status).toBe(409);
    expect(await json<{ error: string }>(second)).toMatchObject({ error: "already_closed" });
    const saved = await save(d.reconciliation.id, [{ id: line.id, counted: 9 }]);
    expect(saved.status).toBe(409);
    expect(await json<{ error: string }>(saved)).toMatchObject({ error: "reconciliation_closed" });
    const extra = await call(`/api/inventory/reconciliations/${d.reconciliation.id}/lines`, { method: "POST", body: { inventoryItemId: (await newItem({ locationId: TESTING })).id } });
    expect(extra.status).toBe(409);
    expect(await bulkQuantity(bulk)).toBe(5);
  });

  it("a closed count cannot be changed in the database, and its rows cannot be deleted", async () => {
    const d = await openOk("2027-01", DISPLAY);
    await save(d.reconciliation.id, countAll(d));
    expect((await close(d.reconciliation.id, "owner")).status).toBe(200);
    await expect(t.db.prepare("UPDATE stock_reconciliations SET month = '2027-02' WHERE id = ?1").bind(d.reconciliation.id).run()).rejects.toThrow(/reconciliation_closed/);
    await expect(t.db.prepare("DELETE FROM stock_reconciliations WHERE id = ?1").bind(d.reconciliation.id).run()).rejects.toThrow(/closed, never deleted/);
    await expect(t.db.prepare("DELETE FROM stock_reconciliation_lines WHERE reconciliation_id = ?1").bind(d.reconciliation.id).run()).rejects.toThrow(/never deleted/);
    await expect(
      t.db.prepare("UPDATE stock_reconciliation_lines SET counted_quantity = 99 WHERE reconciliation_id = ?1").bind(d.reconciliation.id).run(),
    ).rejects.toThrow(/reconciliation_closed/);
  });
});

describe("spec 025 R4, R5: the system figure is the opening figure plus the movements since", () => {
  it("a sale during the count is reflected, so the difference is 0 and no adjustment is written", async () => {
    const bulk = await newBulk("Tilli 025 sale", 10, DISPLAY);
    const d = await openOk("2026-02", DISPLAY);
    const line = lineFor(d, (l) => l.bulkItemId === bulk);
    expect(line.systemAtOpening).toBe(10);
    await bulkMove(bulk, { kind: "sold", quantity: 3, locationId: DISPLAY });
    const during = lineFor(await detailOf(d.reconciliation.id), (l) => l.bulkItemId === bulk);
    expect(during).toMatchObject({ systemAtOpening: 10, movedSinceOpening: -3, expected: 7 });
    await save(d.reconciliation.id, countAll(d, { [line.id]: 7 }));
    expect(lineFor(await detailOf(d.reconciliation.id), (l) => l.bulkItemId === bulk).difference).toBe(0);
    const res = await close(d.reconciliation.id);
    expect((await json<ReconciliationCloseResponse>(res)).adjustments).toBe(0);
    expect(await bulkAt(bulk, DISPLAY)).toBe(7);
  });

  it("a close cannot take a bulk quantity below zero: a sale that empties the place and a count of 0 writes nothing", async () => {
    const bulk = await newBulk("Tilli 025 empty", 5, TESTING);
    const d = await openOk("2026-04", TESTING);
    const line = lineFor(d, (l) => l.bulkItemId === bulk);
    await bulkMove(bulk, { kind: "sold", quantity: 5, locationId: TESTING });
    await save(d.reconciliation.id, countAll(d, { [line.id]: 0 }));
    expect((await close(d.reconciliation.id)).status).toBe(200);
    expect(await bulkAt(bulk, TESTING)).toBe(0);
    await expect(
      t.db.prepare("INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by, location_id) VALUES ('x-neg-025', ?1, 'adjusted', -1, '2026-04-01T00:00:00Z', 'test', 'test', '2026-04-01T00:00:00Z', 'test', ?2)")
        .bind(bulk, TESTING)
        .run(),
    ).rejects.toThrow(/quantity_below_zero/);
  });

  it("the report shows the figures and the number of adjustments the close will write", async () => {
    const plus = await newBulk("Tilli 025 report", 2, KARIGAR);
    const d = await openOk("2026-06", KARIGAR);
    const line = lineFor(d, (l) => l.bulkItemId === plus);
    await save(d.reconciliation.id, countAll(d, { [line.id]: 4 }, { [line.id]: "one tray extra" }));
    const report = await json<ReconciliationReportResponse>(await call(`/api/inventory/reconciliations/${d.reconciliation.id}/report`));
    expect(report.summary).toMatchObject({ adjustments: 1, bulkUp: 1 });
    expect(report.differences[0]).toMatchObject({ bulkName: "Tilli 025 report", difference: 2, note: "one tray extra" });
  });
});

describe("spec 025 R13, R14: permissions", () => {
  it("staff and viewer can read and cannot open, count or close; owner and manager can open", async () => {
    expect((await call("/api/inventory/reconciliations", { as: "staff1" })).status).toBe(200);
    expect((await call("/api/inventory/reconciliations", { as: "viewer1" })).status).toBe(200);
    expect((await openCount("2027-03", LOCKER, "staff1")).status).toBe(403);
    expect((await openCount("2027-03", LOCKER, "viewer1")).status).toBe(403);
    expect((await openCount("2027-03", LOCKER, "manager1")).status).toBe(201);
    const d = await openOk("2027-04", LOCKER);
    expect((await save(d.reconciliation.id, [{ id: d.lines[0]!.id, counted: null }], "staff1")).status).toBe(403);
    expect((await close(d.reconciliation.id, "viewer1")).status).toBe(403);
  });

  it("every reconciliation route is in the permission map", async () => {
    const { PERMISSION_MAP } = await import("../src/auth/permissionMap");
    expect(PERMISSION_MAP.filter((r) => r.path.startsWith("/api/inventory/reconciliations")).length).toBe(7);
    const rows = await t.db.prepare("SELECT name, permissions_json FROM roles").all<{ name: string; permissions_json: string }>();
    const perms = Object.fromEntries(rows.results.map((r) => [r.name, JSON.parse(r.permissions_json) as string[]]));
    expect(perms.owner).toEqual(expect.arrayContaining(["reconciliation.view", "reconciliation.edit"]));
    expect(perms.manager).toEqual(expect.arrayContaining(["reconciliation.view", "reconciliation.edit"]));
    expect(perms.staff).toContain("reconciliation.view");
    expect(perms.staff).not.toContain("reconciliation.edit");
    expect(perms.viewer).toContain("reconciliation.view");
  });
});
