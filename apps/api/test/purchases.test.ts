import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type BulkItemDetailResponse, type BulkItemSaveResponse, type InventoryItemSaveResponse, type PurchaseDetail, type PurchaseListResponse, type RawStockResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 022 section 6: purchases of three types, numbering, stock created and reversed, permissions, append-only tables. */

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
const errorBody = async (res: Response) => (await res.json()) as { error: string; message?: string; issues?: { field: string; message: string }[] };

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
const ringLine = async (over: Record<string, unknown> = {}) => ({
  kind: "item",
  typeId: await ringType(),
  metal: "gold",
  purity: "22K916",
  pieces: 1,
  grossWeightMg: 12_500,
  netWeightMg: 12_000,
  hsn: "7113",
  ...over,
});
const bill = async (over: Record<string, unknown> = {}) => ({
  purchaseType: "finished",
  purchaseDate: "2026-11-02",
  supplierName: "Wholesale Traders",
  supplierBillNo: "WT-101",
  lines: [await ringLine()],
  ...over,
});
const buy = (body: Record<string, unknown>, as = "owner") => call("/api/inventory/purchases", { method: "POST", body, as });
const detail = async (id: string) => json<{ purchase: PurchaseDetail }>(await call(`/api/inventory/purchases/${id}`));
const voidPurchase = (id: string, reason = "bill cancelled", as = "owner") => call(`/api/inventory/purchases/${id}/void`, { method: "POST", body: { reason }, as });
const rawStock = async () => json<RawStockResponse>(await call("/api/inventory/purchases/raw-stock"));
const rawBalance = async (metal: string, purity: string, locationId: string) =>
  (await one<{ w: number }>("SELECT COALESCE(SUM(weight_mg), 0) AS w FROM raw_metal_movements WHERE metal = ?1 AND purity = ?2 AND location_id = ?3", metal, purity, locationId))!.w;
const newBulk = async (name: string, openingQuantity = 0) => {
  const res = await call("/api/inventory/bulk", { method: "POST", body: { name, unit: "pcs", openingQuantity } });
  expect(res.status).toBe(201);
  return (await json<BulkItemSaveResponse>(res)).item.id;
};
const bulkDetail = async (id: string) => json<BulkItemDetailResponse>(await call(`/api/inventory/bulk/${id}`));
const bulkAt = async (id: string, locationId: string) => (await one<{ quantity: number }>("SELECT quantity FROM bulk_item_location_quantities WHERE bulk_item_id = ?1 AND location_id = ?2", id, locationId))!.quantity;
const itemByUNo = async (uNo: string) => (await one<{ status: string; voided_at: string | null }>("SELECT status, voided_at FROM inventory_items WHERE u_no = ?1", uNo))!;
const lastNo = async (fy: string) => (await one<{ last_no: number }>("SELECT last_no FROM number_series WHERE series = 'PUR' AND fy = ?1", fy))?.last_no ?? 0;
const purchaseVoided = async (id: string) => (await one<{ voided_at: string | null }>("SELECT voided_at FROM purchases WHERE id = ?1", id))!.voided_at;
const voidAudits = async (id: string) => count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'purchase_void' AND entity_id = ?1", id);
const newSale = (over: Record<string, unknown> = {}) => ({
  invoiceDate: "2026-11-02",
  customerName: "Purchase Test Buyer",
  taxMode: "intra",
  lines: [
    {
      description: "Gold Ornament",
      purity: "22K916",
      hsn: "7113",
      grossWeightMg: 12_500,
      netWeightMg: 12_000,
      polishMg: 0,
      goldRatePaisePerKg: 28_572_000,
      labourRatePaisePerKg: 0,
      ...(over.line as Record<string, unknown>),
    },
  ],
  ...(over.header as Record<string, unknown>),
});

// ---- numbering (PU10) ----
describe("numbering: PUR-0001 per financial year (PU10, Q170)", () => {
  it("the first purchase of a year is PUR-0001, the next is PUR-0002", async () => {
    const a = await buy(await bill());
    expect(a.status).toBe(201);
    expect((await json<{ purchase: PurchaseDetail }>(a)).purchase.purchaseNo).toBe("PUR-0001");
    const b = await buy(await bill({ supplierName: "Second Wholesaler" }));
    expect((await json<{ purchase: PurchaseDetail }>(b)).purchase.purchaseNo).toBe("PUR-0002");
    expect(await lastNo("2026-27")).toBe(2);
  });

  it("a purchase dated in the next financial year starts again at PUR-0001, and the older year goes on", async () => {
    const next = await buy(await bill({ purchaseDate: "2027-04-01" }));
    const nextBody = await json<{ purchase: PurchaseDetail }>(next);
    expect(nextBody.purchase.purchaseNo).toBe("PUR-0001");
    expect(nextBody.purchase.fy).toBe("2027-28");
    const nextDay = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ purchaseDate: "2027-04-02" })));
    expect(nextDay.purchase.purchaseNo).toBe("PUR-0002");
    const older = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ purchaseDate: "2027-03-31" })));
    expect(older.purchase.purchaseNo).toBe("PUR-0003");
    expect(older.purchase.fy).toBe("2026-27");
  });

  it("a refused save uses no number: the next purchase takes the next number", async () => {
    const before = await lastNo("2026-27");
    const res = await buy(await bill({ lines: [await ringLine(), { kind: "bulk", bulkItemId: newId(), quantity: 2 }] }));
    expect(res.status).toBe(400);
    expect(await lastNo("2026-27")).toBe(before);
    const ok = await json<{ purchase: PurchaseDetail }>(await buy(await bill()));
    expect(ok.purchase.purchaseNo).toBe(`PUR-${String(before + 1).padStart(4, "0")}`);
  });
});

// ---- finished purchase creates items (PU11) ----
describe("a finished purchase creates items (PU5, PU11)", () => {
  it("a ring line creates an item with an automatic U No., in stock, with the history 'Purchased on' and one audit row", async () => {
    const res = await buy(await bill({ lines: [await ringLine({ amountPaise: 1_500_000 })] }));
    expect(res.status).toBe(201);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(res);
    const line = purchase.lines[0]!;
    expect(line.kind).toBe("item");
    expect(line.item!.uNo).toMatch(/^RING\d{2}$/);
    expect(line.item!.status).toBe("in_stock");
    expect(line.amountPaise).toBe(1_500_000);
    expect(await itemByUNo(line.item!.uNo)).toEqual({ status: "in_stock", voided_at: null });
    const history = await t.db
      .prepare("SELECT h.from_status, h.to_status, h.reason FROM inventory_item_history h JOIN inventory_items i ON i.id = h.item_id WHERE i.u_no = ?1")
      .bind(line.item!.uNo)
      .all<{ from_status: string | null; to_status: string; reason: string }>();
    expect(history.results).toEqual([{ from_status: null, to_status: "in_stock", reason: `Purchased on ${purchase.purchaseNo}` }]);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'purchase_create' AND entity_id = ?1", purchase.id)).toBe(1);
  });

  it("two ring lines in one purchase get consecutive serials", async () => {
    const res = await buy(await bill({ lines: [await ringLine(), await ringLine({ pieces: 2 })] }));
    const { purchase } = await json<{ purchase: PurchaseDetail }>(res);
    const [a, b] = purchase.lines.map((l) => l.item!.uNo);
    expect(a).toMatch(/^RING\d{2}$/);
    expect(Number(b!.slice(4))).toBe(Number(a!.slice(4)) + 1);
  });

  it("a typed U No. is used when it fits the type and is free; a wrong code or a live duplicate is refused", async () => {
    const ok = await buy(await bill({ lines: [await ringLine({ uNo: "ring50" })] }));
    expect(ok.status).toBe(201);
    expect((await json<{ purchase: PurchaseDetail }>(ok)).purchase.lines[0]!.item!.uNo).toBe("RING50");
    const wrong = await buy(await bill({ lines: [await ringLine({ uNo: "CHAI01" })] }));
    expect(wrong.status).toBe(400);
    expect((await errorBody(wrong)).issues).toEqual([{ field: "lines.1.uNo", message: "The U No. of a Ring starts with RING" }]);
    const taken = await buy(await bill({ lines: [await ringLine({ uNo: "RING50" })] }));
    expect(taken.status).toBe(409);
    expect((await errorBody(taken)).error).toBe("u_no_taken");
    const twice = await buy(await bill({ lines: [await ringLine({ uNo: "RING61" }), await ringLine({ uNo: "RING61" })] }));
    expect(twice.status).toBe(400);
  });

  it("the item carries the weights, purity and place of the purchase", async () => {
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ locationId: DISPLAY, lines: [await ringLine({ pieces: 2, grossWeightMg: 9_000, netWeightMg: 8_500 })] })));
    const uNo = purchase.lines[0]!.item!.uNo;
    const row = await one<{ pieces: number; gross_weight_mg: number; net_weight_mg: number; location_id: string; purity: string; metal: string }>(
      "SELECT pieces, gross_weight_mg, net_weight_mg, location_id, purity, metal FROM inventory_items WHERE u_no = ?1",
      uNo,
    );
    expect(row).toEqual({ pieces: 2, gross_weight_mg: 9_000, net_weight_mg: 8_500, location_id: DISPLAY, purity: "22K916", metal: "gold" });
    expect(purchase.locationName).toBe("Display");
  });

  it("net above gross and silver metal with a gold purity are refused (400)", async () => {
    const heavy = await buy(await bill({ lines: [await ringLine({ netWeightMg: 13_000 })] }));
    expect(heavy.status).toBe(400);
    const mixed = await buy(await bill({ lines: [await ringLine({ metal: "silver" })] }));
    expect(mixed.status).toBe(400);
  });
});

// ---- bulk and raw purchases (PU12, PU13) ----
describe("bulk and raw purchases add stock by place (PU12, PU13)", () => {
  it("a bulk purchase increases the quantity at its place and not at the others", async () => {
    const bulkId = await newBulk("Tilli Purchase Test", 0);
    const res = await buy(await bill({ purchaseType: "finished", lines: [{ kind: "bulk", bulkItemId: bulkId, quantity: 10, amountPaise: 50_000 }] }));
    expect(res.status).toBe(201);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(res);
    expect(purchase.lines[0]!.bulk).toMatchObject({ id: bulkId, quantity: 10, balanceAtPlace: 10 });
    expect(await bulkAt(bulkId, SHOWROOM)).toBe(10);
    expect(await bulkAt(bulkId, DISPLAY)).toBe(0);
    const detailRes = await bulkDetail(bulkId);
    expect(detailRes.item.quantity).toBe(10);
    const moves = await t.db.prepare("SELECT kind, quantity_change, reason FROM bulk_item_movements WHERE bulk_item_id = ?1").bind(bulkId).all<{ kind: string; quantity_change: number; reason: string }>();
    expect(moves.results).toEqual([{ kind: "received", quantity_change: 10, reason: `Purchase ${purchase.purchaseNo}` }]);
  });

  it("a raw silver purchase increases raw stock by metal and purity, shown on the raw stock list", async () => {
    const res = await buy(await bill({ purchaseType: "raw_metal", supplierName: "Bullion Dealer", lines: [{ kind: "raw_metal", metal: "silver", purity: "silver", weightMg: 500_000 }] }));
    expect(res.status).toBe(201);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(res);
    expect(purchase.lines[0]).toMatchObject({ kind: "raw_metal", metal: "silver", purity: "silver", weightMg: 500_000, item: null });
    expect(await rawBalance("silver", "silver", SHOWROOM)).toBeGreaterThanOrEqual(500_000);
    const stock = await rawStock();
    expect(stock.items.some((r) => r.metal === "silver" && r.purity === "silver" && r.locationId === SHOWROOM && r.weightMg > 0)).toBe(true);
  });

  it("a raw gold purchase is held apart from silver, and the reason names the purchase", async () => {
    const before = await rawBalance("gold", "22K916", LOCKER);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ purchaseType: "raw_metal", locationId: LOCKER, lines: [{ kind: "raw_metal", metal: "gold", purity: "22K916", weightMg: 80_000 }] })));
    expect(await rawBalance("gold", "22K916", LOCKER)).toBe(before + 80_000);
    const reason = await one<{ reason: string }>("SELECT reason FROM raw_metal_movements WHERE purchase_id = ?1", purchase.id);
    expect(reason!.reason).toBe(`Purchase ${purchase.purchaseNo}`);
  });
});

// ---- karigar-made purchases (PU8, PU14, Q173) ----
describe("a karigar-made purchase reduces raw stock and never below zero (PU14, PU23)", () => {
  it("the metal used comes out of raw stock at the place, and the pieces become items", async () => {
    await buy(await bill({ purchaseType: "raw_metal", locationId: LOCKER, lines: [{ kind: "raw_metal", metal: "silver", purity: "silver", weightMg: 300_000 }] }));
    const before = await rawBalance("silver", "silver", LOCKER);
    const res = await buy(
      await bill({
        purchaseType: "karigar_made",
        supplierName: "Karigar Ram",
        karigarName: "Ram Lal",
        locationId: LOCKER,
        lines: [await ringLine({ metal: "silver", purity: "silver" }), { kind: "metal_used", metal: "silver", purity: "silver", weightMg: 200_000 }],
      }),
    );
    expect(res.status).toBe(201);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(res);
    expect(purchase.karigarName).toBe("Ram Lal");
    expect(purchase.lines.map((l) => l.kind)).toEqual(["item", "metal_used"]);
    expect(purchase.lines[0]!.item!.uNo).toMatch(/^RING\d{2}$/);
    expect(await rawBalance("silver", "silver", LOCKER)).toBe(before - 200_000);
    const used = await one<{ weight_mg: number; reason: string }>("SELECT weight_mg, reason FROM raw_metal_movements WHERE purchase_id = ?1 AND weight_mg < 0", purchase.id);
    expect(used).toEqual({ weight_mg: -200_000, reason: `Used for karigar purchase ${purchase.purchaseNo}` });
  });

  it("metal used above the balance is refused with the balance named; nothing is written and no number is used", async () => {
    const balance = await rawBalance("silver", "silver", LOCKER);
    const items = await count("SELECT COUNT(*) AS n FROM inventory_items");
    const numbers = await lastNo("2026-27");
    const res = await buy(
      await bill({
        purchaseType: "karigar_made",
        karigarName: "Ram Lal",
        locationId: LOCKER,
        lines: [await ringLine({ metal: "silver", purity: "silver" }), { kind: "metal_used", metal: "silver", purity: "silver", weightMg: balance + 1 }],
      }),
    );
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.error).toBe("raw_stock_short");
    expect(body.message).toContain("Locker");
    expect(await rawBalance("silver", "silver", LOCKER)).toBe(balance);
    expect(await count("SELECT COUNT(*) AS n FROM inventory_items")).toBe(items);
    expect(await lastNo("2026-27")).toBe(numbers);
  });

  it("the database refuses a raw movement that takes the balance below zero (raw_stock_below_zero)", async () => {
    const balance = await rawBalance("silver", "silver", LOCKER);
    await expect(
      t.db
        .prepare(`INSERT INTO raw_metal_movements (id, created_at, created_by, metal, purity, weight_mg, location_id, at, actor, reason)
                  VALUES (?1, '2026-11-02T00:00:00.000Z', 'test', 'silver', 'silver', ?2, ?3, '2026-11-02T00:00:00.000Z', 'test', 'direct')`)
        .bind(newId(), -(balance + 1), LOCKER)
        .run(),
    ).rejects.toThrow(/raw_stock_below_zero/);
  });
});

// ---- void (PU16 to PU18, Q174) ----
describe("void a purchase while it is untouched (PU16, PU17)", () => {
  it("a finished purchase with items and a bulk quantity is voided: items voided, bulk and raw stock back, the purchase marked", async () => {
    const bulkId = await newBulk("Void Test Tilli", 0);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(
      await buy(await bill({ lines: [await ringLine(), { kind: "bulk", bulkItemId: bulkId, quantity: 4 }] })),
    );
    const uNo = purchase.lines[0]!.item!.uNo;
    expect(await bulkAt(bulkId, SHOWROOM)).toBe(4);
    const res = await voidPurchase(purchase.id, "wrong entry");
    expect(res.status).toBe(200);
    const body = await json<{ purchase: PurchaseDetail }>(res);
    expect(body.purchase.voided).toBe(true);
    expect(body.purchase.voidReason).toBe("wrong entry");
    expect(await itemByUNo(uNo)).toMatchObject({ status: "in_stock" });
    expect((await itemByUNo(uNo)).voided_at).not.toBeNull();
    expect(await bulkAt(bulkId, SHOWROOM)).toBe(0);
    const reasons = await t.db.prepare("SELECT reason FROM bulk_item_movements WHERE bulk_item_id = ?1 ORDER BY rowid").bind(bulkId).all<{ reason: string }>();
    expect(reasons.results.map((r) => r.reason)).toEqual([`Purchase ${purchase.purchaseNo}`, `Purchase ${purchase.purchaseNo} voided`]);
    expect(await voidAudits(purchase.id)).toBe(1);
    const again = await voidPurchase(purchase.id);
    expect(again.status).toBe(409);
    expect((await errorBody(again)).error).toBe("already_voided");
  });

  it("a karigar purchase void puts the metal used back into raw stock", async () => {
    const before = await rawBalance("silver", "silver", LOCKER);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(
      await buy(
        await bill({
          purchaseType: "karigar_made",
          karigarName: "Ram Lal",
          locationId: LOCKER,
          lines: [await ringLine({ metal: "silver", purity: "silver" }), { kind: "metal_used", metal: "silver", purity: "silver", weightMg: 1_000 }],
        }),
      ),
    );
    expect(await rawBalance("silver", "silver", LOCKER)).toBe(before - 1_000);
    expect((await voidPurchase(purchase.id)).status).toBe(200);
    expect(await rawBalance("silver", "silver", LOCKER)).toBe(before);
  });

  it("a void is refused once an item is sold on an invoice, and writes nothing", async () => {
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ lines: [await ringLine()] })));
    const uNo = purchase.lines[0]!.item!.uNo;
    const sale = await call("/api/invoices", { method: "POST", body: newSale({ line: { stockUNo: uNo } }) });
    expect(sale.status).toBe(201);
    const res = await voidPurchase(purchase.id);
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.error).toBe("purchase_in_use");
    expect(body.message).toContain(uNo);
    expect(await purchaseVoided(purchase.id)).toBeNull();
    expect(await itemByUNo(uNo)).toEqual({ status: "sold", voided_at: null });
    expect(await voidAudits(purchase.id)).toBe(0);
  });

  it("a void is refused once a bulk quantity is sold, and writes nothing", async () => {
    const bulkId = await newBulk("Sold Tilli", 0);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ lines: [{ kind: "bulk", bulkItemId: bulkId, quantity: 5 }] })));
    const sale = await call("/api/invoices", { method: "POST", body: newSale({ line: { bulkItemId: bulkId, bulkQuantity: 3 } }) });
    expect(sale.status).toBe(201);
    expect(await bulkAt(bulkId, SHOWROOM)).toBe(2);
    const res = await voidPurchase(purchase.id);
    expect(res.status).toBe(409);
    expect((await errorBody(res)).error).toBe("purchase_in_use");
    expect(await bulkAt(bulkId, SHOWROOM)).toBe(2);
    expect(await purchaseVoided(purchase.id)).toBeNull();
  });

  it("a void is refused once a bulk quantity was moved out of the place, even when the balance still covers it", async () => {
    const bulkId = await newBulk("Moved Tilli", 0);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ lines: [{ kind: "bulk", bulkItemId: bulkId, quantity: 10 }] })));
    await call(`/api/inventory/bulk/${bulkId}/movements`, { method: "POST", body: { kind: "received", quantity: 10 } });
    const transfer = await call("/api/inventory/transfers", {
      method: "POST",
      body: { kind: "bulk", bulkItemId: bulkId, quantity: 4, fromLocationId: SHOWROOM, toLocationId: DISPLAY },
    });
    expect(transfer.status).toBe(201);
    expect(await bulkAt(bulkId, SHOWROOM)).toBe(16);
    const res = await voidPurchase(purchase.id);
    expect(res.status).toBe(409);
    expect((await errorBody(res)).message).toContain("moved out");
    expect(await bulkAt(bulkId, SHOWROOM)).toBe(16);
    expect(await purchaseVoided(purchase.id)).toBeNull();
  });

  it("a void is refused once raw metal it added has been used by a karigar purchase, and writes nothing", async () => {
    const place = LOCKER;
    const { purchase } = await json<{ purchase: PurchaseDetail }>(
      await buy(await bill({ purchaseType: "raw_metal", locationId: place, lines: [{ kind: "raw_metal", metal: "gold", purity: "18K750", weightMg: 300_000 }] })),
    );
    const karigar = await buy(
      await bill({
        purchaseType: "karigar_made",
        karigarName: "Karigar Two",
        locationId: place,
        lines: [await ringLine({ metal: "gold", purity: "18K750" }), { kind: "metal_used", metal: "gold", purity: "18K750", weightMg: 100_000 }],
      }),
    );
    expect(karigar.status).toBe(201);
    const before = await rawBalance("gold", "18K750", place);
    const res = await voidPurchase(purchase.id);
    expect(res.status).toBe(409);
    expect((await errorBody(res)).error).toBe("purchase_in_use");
    expect(await rawBalance("gold", "18K750", place)).toBe(before);
    expect(await purchaseVoided(purchase.id)).toBeNull();
    expect(await voidAudits(purchase.id)).toBe(0);
  });
});

// ---- replay (PU15) ----
describe("replay by client id (PU15)", () => {
  it("the same id and content returns the first purchase with no second item; different content is 409", async () => {
    const id = newId();
    const body = await bill({ id, lines: [await ringLine()] });
    const first = await buy(body);
    expect(first.status).toBe(201);
    const firstBody = await json<{ purchase: PurchaseDetail }>(first);
    const items = await count("SELECT COUNT(*) AS n FROM inventory_items");
    const numbers = await lastNo("2026-27");
    const again = await buy(body);
    expect(again.status).toBe(200);
    expect((await json<{ purchase: PurchaseDetail }>(again)).purchase.purchaseNo).toBe(firstBody.purchase.purchaseNo);
    expect(await count("SELECT COUNT(*) AS n FROM inventory_items")).toBe(items);
    expect(await lastNo("2026-27")).toBe(numbers);
    const other = await buy(await bill({ id, supplierName: "Someone Else", lines: [await ringLine()] }));
    expect(other.status).toBe(409);
    expect((await errorBody(other)).error).toBe("id_conflict");
  });
});

// ---- validation (PU2, PU3, PU5) ----
describe("validation", () => {
  it("the supplier name is required", async () => {
    const res = await buy(await bill({ supplierName: "   " }));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).issues?.[0]?.field).toBe("supplierName");
  });

  it("a karigar name is required for a karigar purchase and refused for the others", async () => {
    const missing = await buy(await bill({ purchaseType: "karigar_made", lines: [await ringLine()] }));
    expect(missing.status).toBe(400);
    expect((await errorBody(missing)).issues?.some((i) => i.field === "karigarName")).toBe(true);
    const extra = await buy(await bill({ karigarName: "Not Needed" }));
    expect(extra.status).toBe(400);
  });

  it("a line of a kind the type does not allow is 400 on that line", async () => {
    const res = await buy(await bill({ lines: [await ringLine(), { kind: "metal_used", metal: "gold", purity: "22K916", weightMg: 100 }] }));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).issues).toEqual([{ field: "lines.2.kind", message: "This kind of line does not belong to this type of purchase" }]);
  });

  it("a purchase needs at least one line, and a negative amount is refused", async () => {
    expect((await buy(await bill({ lines: [] }))).status).toBe(400);
    expect((await buy(await bill({ lines: [await ringLine({ amountPaise: -5 })] }))).status).toBe(400);
  });

  it("an impossible date is refused; an inactive place is 409 location_inactive", async () => {
    const date = await buy(await bill({ purchaseDate: "2026-02-30" }));
    expect(date.status).toBe(400);
    const place = await call("/api/inventory/locations", { method: "POST", body: { name: "Purchase Temp Place" } });
    const placeId = (await json<{ location: { id: string } }>(place)).location.id;
    await call(`/api/inventory/locations/${placeId}`, { method: "PATCH", body: { active: false } });
    const res = await buy(await bill({ locationId: placeId }));
    expect(res.status).toBe(409);
    expect((await errorBody(res)).error).toBe("location_inactive");
  });

  it("a bulk line for an unknown bulk item is 400 on that line", async () => {
    const res = await buy(await bill({ lines: [{ kind: "bulk", bulkItemId: newId(), quantity: 1 }] }));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).issues?.[0]?.field).toBe("lines.1.bulkItemId");
  });
});

// ---- reading (PU19, PU20) ----
describe("list, search and read", () => {
  it("the list is newest first, filters by type and supplier, and hides voided purchases unless asked", async () => {
    const supplier = `Searchable Supplier ${Date.now()}`;
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ supplierName: supplier, purchaseDate: "2026-11-20" })));
    const found = await json<PurchaseListResponse>(await call(`/api/inventory/purchases?q=${encodeURIComponent(supplier.slice(0, 20))}`));
    expect(found.items.map((i) => i.id)).toEqual([purchase.id]);
    expect(found.items[0]!.lineCount).toBe(1);
    const byType = await json<PurchaseListResponse>(await call("/api/inventory/purchases?type=raw_metal"));
    expect(byType.items.every((i) => i.purchaseType === "raw_metal")).toBe(true);
    await voidPurchase(purchase.id);
    const hidden = await json<PurchaseListResponse>(await call(`/api/inventory/purchases?q=${encodeURIComponent(supplier.slice(0, 20))}`));
    expect(hidden.items).toEqual([]);
    const shown = await json<PurchaseListResponse>(await call(`/api/inventory/purchases?q=${encodeURIComponent(supplier.slice(0, 20))}&includeVoided=1`));
    expect(shown.items[0]!.voided).toBe(true);
  });

  it("the detail shows the item made and its status, and a sold item shows as sold", async () => {
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ lines: [await ringLine()] })));
    const uNo = purchase.lines[0]!.item!.uNo;
    await call("/api/invoices", { method: "POST", body: newSale({ line: { stockUNo: uNo } }) });
    const after = await detail(purchase.id);
    expect(after.purchase.lines[0]!.item).toMatchObject({ uNo, status: "sold", statusLabel: "Sold" });
  });

  it("the raw stock lists only balances that are not zero", async () => {
    const stock = await rawStock();
    expect(stock.items.every((r) => r.weightMg !== 0)).toBe(true);
  });

  it("an unknown purchase is 404", async () => {
    expect((await call(`/api/inventory/purchases/${newId()}`)).status).toBe(404);
  });
});

// ---- permissions (PU19, PU20) ----
describe("permissions", () => {
  it("staff and viewer can read the purchases and the raw stock, and cannot create or void (403)", async () => {
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ lines: [await ringLine()] })));
    for (const as of ["staff1", "viewer1"]) {
      expect((await call("/api/inventory/purchases", { as })).status).toBe(200);
      expect((await call(`/api/inventory/purchases/${purchase.id}`, { as })).status).toBe(200);
      expect((await call("/api/inventory/purchases/raw-stock", { as })).status).toBe(200);
      expect((await buy(await bill(), as)).status).toBe(403);
      expect((await voidPurchase(purchase.id, "no", as)).status).toBe(403);
    }
  });

  it("the manager can create and void", async () => {
    const res = await buy(await bill({ lines: [await ringLine()] }), "manager1");
    expect(res.status).toBe(201);
    const { purchase } = await json<{ purchase: PurchaseDetail }>(res);
    expect((await voidPurchase(purchase.id, "manager voids", "manager1")).status).toBe(200);
  });

  it("the role rows carry the new permissions (owner, manager both; staff and viewer view)", async () => {
    const rows = await t.db.prepare("SELECT name, permissions_json FROM roles").all<{ name: string; permissions_json: string }>();
    const perms = Object.fromEntries(rows.results.map((r) => [r.name, JSON.parse(r.permissions_json) as string[]]));
    expect(perms.owner).toEqual(expect.arrayContaining(["purchases.view", "purchases.edit"]));
    expect(perms.manager).toEqual(expect.arrayContaining(["purchases.view", "purchases.edit"]));
    expect(perms.staff).toContain("purchases.view");
    expect(perms.staff).not.toContain("purchases.edit");
    expect(perms.viewer).toContain("purchases.view");
    expect(perms.viewer).not.toContain("purchases.edit");
  });
});

// ---- append-only tables (PU21, PU22) ----
describe("the purchase tables refuse UPDATE and DELETE (PU21, PU22, PU23)", () => {
  it("purchase lines and raw movements refuse UPDATE and DELETE", async () => {
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ lines: [await ringLine()] })));
    await expect(t.db.prepare("UPDATE purchase_lines SET amount_paise = 1 WHERE purchase_id = ?1").bind(purchase.id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM purchase_lines WHERE purchase_id = ?1").bind(purchase.id).run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("UPDATE raw_metal_movements SET reason = 'x' WHERE purchase_id IS NOT NULL").run()).rejects.toThrow(/append-only/);
    await expect(t.db.prepare("DELETE FROM raw_metal_movements WHERE purchase_id IS NOT NULL").run()).rejects.toThrow(/append-only/);
  });

  it("a purchase refuses DELETE, and any change except its void columns", async () => {
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ lines: [await ringLine()] })));
    await expect(t.db.prepare("DELETE FROM purchases WHERE id = ?1").bind(purchase.id).run()).rejects.toThrow(/never deleted/);
    await expect(t.db.prepare("UPDATE purchases SET supplier_name = 'Changed' WHERE id = ?1").bind(purchase.id).run()).rejects.toThrow(/change only once/);
    expect((await voidPurchase(purchase.id)).status).toBe(200);
    await expect(
      t.db.prepare("UPDATE purchases SET void_reason = 'again' WHERE id = ?1").bind(purchase.id).run(),
    ).rejects.toThrow(/change only once/);
  });

  it("a line whose kind does not fit the purchase type is refused (invalid_purchase_line)", async () => {
    const { purchase } = await json<{ purchase: PurchaseDetail }>(
      await buy(await bill({ purchaseType: "raw_metal", lines: [{ kind: "raw_metal", metal: "silver", purity: "silver", weightMg: 100 }] })),
    );
    const bulkId = await newBulk("Trigger Kind Tilli");
    await expect(
      t.db
        .prepare(`INSERT INTO purchase_lines (id, created_at, created_by, updated_at, updated_by, purchase_id, line_no, line_kind, bulk_item_id, quantity)
                  VALUES (?1, 'x', 'x', 'x', 'x', ?2, 9, 'bulk', ?3, 1)`)
        .bind(newId(), purchase.id, bulkId)
        .run(),
    ).rejects.toThrow(/invalid_purchase_line/);
    await expect(
      t.db
        .prepare(`INSERT INTO purchase_lines (id, created_at, created_by, updated_at, updated_by, purchase_id, line_no, line_kind, metal, purity, weight_mg)
                  VALUES (?1, 'x', 'x', 'x', 'x', ?2, 9, 'raw_metal', 'gold', '22K916', 5)`)
        .bind(newId(), purchase.id)
        .run(),
    ).resolves.toBeDefined();
  });
});

// ---- the item that a purchase makes is a normal item (PU24) ----
describe("items from a purchase", () => {
  it("the item page API shows the purchase history and the item can be sold by an invoice", async () => {
    const { purchase } = await json<{ purchase: PurchaseDetail }>(await buy(await bill({ lines: [await ringLine()] })));
    const uNo = purchase.lines[0]!.item!.uNo;
    const itemId = purchase.lines[0]!.item!.id;
    const item = await json<InventoryItemSaveResponse>(await call(`/api/inventory/items/${itemId}`));
    expect(item.item.uNo).toBe(uNo);
    const history = await json<{ items: { reason: string }[] }>(await call(`/api/inventory/items/${itemId}/history`));
    expect(history.items[0]!.reason).toBe(`Purchased on ${purchase.purchaseNo}`);
    const sale = await call("/api/invoices", { method: "POST", body: newSale({ line: { stockUNo: uNo } }) });
    expect(sale.status).toBe(201);
  });
});
