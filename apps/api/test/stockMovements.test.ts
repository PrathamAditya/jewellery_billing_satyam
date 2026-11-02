import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type InvoiceResponse, type InventoryItemSaveResponse, type InventoryHistoryResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 021 section 6: invoices take stock from items and bulk items, give it back on void, and count it once. */

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

// ---- builders ----
const ringType = async () => (await one<{ id: string }>("SELECT id FROM inventory_item_types WHERE name = 'Ring'"))!.id;

/** An individual item, in stock, from the inventory API (spec 020). */
async function newItem(over: Record<string, unknown> = {}) {
  const res = await call("/api/inventory/items", {
    method: "POST",
    body: { typeId: await ringType(), metal: "gold", purity: "22K916", grossWeightMg: 12_500, netWeightMg: 12_000, hsn: "7113", ...over },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as InventoryItemSaveResponse).item;
}

/** A bulk item with an opening quantity (spec 020b). */
async function newBulk(name: string, openingQuantity: number) {
  const res = await call("/api/inventory/bulk", { method: "POST", body: { name, unit: "pcs", openingQuantity } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { item: { id: string } }).item.id;
}

/** The client's silver line (the paper bill's figures), with optional stock links. */
const line = (over: Record<string, unknown> = {}) => ({
  description: "Silver Ornament",
  purity: "silver",
  hsn: "7113",
  grossWeightMg: 9_800,
  netWeightMg: 9_800,
  polishMg: 0,
  goldRatePaisePerKg: 28_572_000,
  labourRatePaisePerKg: 0,
  ...over,
});
const bill = (over: Record<string, unknown> = {}) => ({ invoiceDate: "2026-11-02", customerName: "Stock Test Buyer", taxMode: "intra", lines: [line()], ...over });
const post = (b: Record<string, unknown>, as = "owner") => call("/api/invoices", { method: "POST", body: b, as });
const put = (id: string, b: Record<string, unknown>) => call(`/api/invoices/${id}`, { method: "PUT", body: b });
const voidInv = (id: string, reason = "made by mistake") => call(`/api/invoices/${id}/void`, { method: "POST", body: { reason } });
const inv = async (res: Response) => (await res.json()) as InvoiceResponse;

const itemStatus = async (uNo: string) => (await one<{ status: string; voided_at: string | null }>("SELECT status, voided_at FROM inventory_items WHERE u_no = ?1", uNo))!;
const itemHistory = async (uNo: string) =>
  (await t.db.prepare("SELECT h.from_status, h.to_status, h.reason FROM inventory_item_history h JOIN inventory_items i ON i.id = h.item_id WHERE i.u_no = ?1 ORDER BY h.at, h.rowid").bind(uNo).all<{ from_status: string | null; to_status: string; reason: string }>()).results;
const bulkQty = async (bulkId: string) => (await one<{ quantity: number }>("SELECT quantity FROM bulk_item_quantities WHERE bulk_item_id = ?1", bulkId))!.quantity;
const bulkMoves = async (bulkId: string) =>
  (await t.db.prepare("SELECT kind, quantity_change, reason FROM bulk_item_movements WHERE bulk_item_id = ?1 ORDER BY at, rowid").bind(bulkId).all<{ kind: string; quantity_change: number; reason: string | null }>()).results;
const lastNo = async () => (await one<{ last_no: number }>("SELECT last_no FROM number_series WHERE series = 'INV' AND fy = '2026-27'"))?.last_no ?? 0;
const audits = async (id: string) =>
  (await t.db.prepare("SELECT action, detail_json, actor FROM audit_log WHERE entity_id = ?1 ORDER BY at, id").bind(id).all<{ action: string; detail_json: string | null; actor: string }>()).results;

describe("save reduces an individual item (S5, S6)", () => {
  it("an item goes in_stock to sold with one history row naming the invoice, and the line shows its U No.", async () => {
    const item = await newItem();
    const res = await post(bill({ lines: [line({ stockUNo: item.uNo.toLowerCase() })] }));
    expect(res.status).toBe(201);
    const saved = await inv(res);
    expect(saved.lines[0]!.stockUNo).toBe(item.uNo);
    expect(await itemStatus(item.uNo)).toEqual({ status: "sold", voided_at: null });
    const h = await itemHistory(item.uNo);
    expect(h.at(-1)).toEqual({ from_status: "in_stock", to_status: "sold", reason: `Sold on invoice ${saved.invoiceNo}` });
    const a = await audits(saved.id);
    expect(a.map((x) => x.action)).toContain("invoice_create");
    expect(JSON.parse(a[0]!.detail_json!).stockItems).toEqual([item.uNo]);
  });

  it("a second invoice for the same item is refused with the line named; no number used, nothing stored", async () => {
    const item = await newItem();
    expect((await post(bill({ lines: [line({ stockUNo: item.uNo })] }))).status).toBe(201);
    const before = { n: await lastNo(), invoices: await count("SELECT COUNT(*) AS n FROM invoices"), hist: (await itemHistory(item.uNo)).length };
    const id = newId();
    const res = await post(bill({ id, lines: [line({ stockUNo: item.uNo })] }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; lineNo: number };
    expect(body.error).toBe("item_not_in_stock");
    expect(body.lineNo).toBe(1);
    expect(body.message).toContain(item.uNo);
    expect(await lastNo()).toBe(before.n);
    expect(await count("SELECT COUNT(*) AS n FROM invoices")).toBe(before.invoices);
    expect(await count("SELECT COUNT(*) AS n FROM invoices WHERE id = ?1", id)).toBe(0);
    expect((await itemHistory(item.uNo)).length).toBe(before.hist);
  });

  it.each([
    ["sold", "a sale"],
    ["reserved", "a reservation"],
    ["on_memo", "a memo"],
    ["returned", "a return"],
    ["written_off", "a write-off"],
  ])("an item that is %s cannot be sold (409)", async (status) => {
    const item = await newItem();
    const change = await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status, reason: "test" } });
    expect(change.status).toBe(200);
    const res = await post(bill({ lines: [line({ stockUNo: item.uNo })] }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("item_not_in_stock");
  });

  it("a voided item cannot be sold (its U No. is no longer live)", async () => {
    const item = await newItem();
    expect((await call(`/api/inventory/items/${item.id}/void`, { method: "POST", body: { reason: "entered twice" } })).status).toBe(200);
    const res = await post(bill({ lines: [line({ stockUNo: item.uNo })] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues: { field: string }[] }).issues[0]!.field).toBe("lines.1.stockUNo");
  });

  it("an unknown U No. is a 400 on its line, and a line cannot take the same item twice", async () => {
    const item = await newItem();
    const unknown = await post(bill({ lines: [line(), line({ stockUNo: "ZZZZ99" })] }));
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { issues: { field: string }[] }).issues[0]!.field).toBe("lines.2.stockUNo");
    const twice = await post(bill({ lines: [line({ stockUNo: item.uNo }), line({ stockUNo: item.uNo })] }));
    expect(twice.status).toBe(400);
    expect(((await twice.json()) as { issues: { field: string }[] }).issues[0]!.field).toBe("lines.2.stockUNo");
    expect(await itemStatus(item.uNo)).toEqual({ status: "in_stock", voided_at: null });
  });

  it("a line cannot link an item and a bulk item together, and a bulk quantity needs a bulk item", async () => {
    const item = await newItem();
    const bulkId = await newBulk(`Both ${Date.now()}`, 5);
    const both = await post(bill({ lines: [line({ stockUNo: item.uNo, bulkItemId: bulkId, bulkQuantity: 1 })] }));
    expect(both.status).toBe(400);
    const lone = await post(bill({ lines: [line({ bulkQuantity: 2 })] }));
    expect(lone.status).toBe(400);
    expect(((await lone.json()) as { issues: { field: string }[] }).issues[0]!.field).toBe("lines.1.bulkItemId");
    const zero = await post(bill({ lines: [line({ bulkItemId: bulkId, bulkQuantity: 0 })] }));
    expect(zero.status).toBe(400);
  });

  it("a failed save writes nothing (no lines, history, movement or audit row) and uses no number", async () => {
    const free = await newItem();
    const taken = await newItem();
    expect((await post(bill({ lines: [line({ stockUNo: taken.uNo })] }))).status).toBe(201);
    const bulkId = await newBulk(`Rollback ${Date.now()}`, 4);
    const before = { n: await lastNo(), hist: (await itemHistory(free.uNo)).length, moves: (await bulkMoves(bulkId)).length };
    const id = newId();
    const res = await post(bill({ id, lines: [line({ stockUNo: free.uNo }), line({ stockUNo: taken.uNo }), line({ bulkItemId: bulkId, bulkQuantity: 1 })] }));
    expect(res.status).toBe(409);
    expect(await itemStatus(free.uNo)).toEqual({ status: "in_stock", voided_at: null });
    expect((await itemHistory(free.uNo)).length).toBe(before.hist);
    expect((await bulkMoves(bulkId)).length).toBe(before.moves);
    expect(await count("SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?1", id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?1", id)).toBe(0);
    expect(await lastNo()).toBe(before.n);
  });

  it("the database refuses a line with a sold item from another invoice (trigger, S13)", async () => {
    const item = await newItem();
    const sold = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] })));
    const other = await inv(await post(bill({ lines: [line()] })));
    const err = await t.db
      .prepare(
        `INSERT INTO invoice_lines (id, invoice_id, revision_no, line_no, description, purity, hsn, gross_weight_mg, net_weight_mg, polish_mg, polish_bps,
           gold_rate_paise_per_kg, labour_rate_paise_per_kg, gst_rate_bps, chargeable_weight_mg, gold_amount_paise, labour_amount_paise, amount_paise,
           display_rate_paise_per_gram, inventory_item_id)
         VALUES (?1, ?2, 1, 2, 'x', 'silver', '7113', 1, 1, 0, 0, 1, 0, 300, 1, 0, 0, 0, 0, ?3)`,
      )
      .bind(newId(), other.id, (await one<{ id: string }>("SELECT id FROM inventory_items WHERE u_no = ?1", item.uNo))!.id)
      .run()
      .then(() => null, (e: Error) => e.message);
    expect(err).toMatch(/item_not_in_stock/);
    expect(sold.id).not.toBe(other.id);
  });
});

describe("bulk sales (S7, S10)", () => {
  it("a bulk sale takes the quantity out with one sold movement naming the invoice", async () => {
    const bulkId = await newBulk(`Tilli ${Date.now()}`, 10);
    const saved = await inv(await post(bill({ lines: [line({ bulkItemId: bulkId, bulkQuantity: 3 })] })));
    expect(saved.lines[0]!.bulkQuantity).toBe(3);
    expect(saved.lines[0]!.bulkItemName).toMatch(/^Tilli/);
    expect(await bulkQty(bulkId)).toBe(7);
    const moves = await bulkMoves(bulkId);
    expect(moves.at(-1)).toEqual({ kind: "sold", quantity_change: -3, reason: `Invoice ${saved.invoiceNo}` });
  });

  it("more than is in stock is refused with the line and the quantity, and nothing is written", async () => {
    const bulkId = await newBulk(`Short ${Date.now()}`, 4);
    const before = (await bulkMoves(bulkId)).length;
    const res = await post(bill({ lines: [line({ bulkItemId: bulkId, bulkQuantity: 5 })] }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; lineNo: number };
    expect(body.error).toBe("insufficient_quantity");
    expect(body.lineNo).toBe(1);
    expect(body.message).toContain("Only 4");
    expect(await bulkQty(bulkId)).toBe(4);
    expect((await bulkMoves(bulkId)).length).toBe(before);
  });

  it("two lines with the same bulk item add up against the stock", async () => {
    const bulkId = await newBulk(`Pair ${Date.now()}`, 5);
    const res = await post(bill({ lines: [line({ bulkItemId: bulkId, bulkQuantity: 3 }), line({ bulkItemId: bulkId, bulkQuantity: 3 })] }));
    expect(res.status).toBe(409);
    expect(await bulkQty(bulkId)).toBe(5);
  });
});

describe("void gives stock back (S11, Q163)", () => {
  it("a void gives an item back to in_stock with a history row, and a bulk line back with an adjusted movement", async () => {
    const item = await newItem();
    const bulkId = await newBulk(`Voidable ${Date.now()}`, 10);
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo }), line({ bulkItemId: bulkId, bulkQuantity: 4 })] })));
    expect(await itemStatus(item.uNo)).toEqual({ status: "sold", voided_at: null });
    expect(await bulkQty(bulkId)).toBe(6);
    const res = await voidInv(saved.id, "entered in error");
    expect(res.status).toBe(200);
    expect(await itemStatus(item.uNo)).toEqual({ status: "in_stock", voided_at: null });
    expect((await itemHistory(item.uNo)).at(-1)).toEqual({ from_status: "sold", to_status: "in_stock", reason: `Invoice ${saved.invoiceNo} voided` });
    expect(await bulkQty(bulkId)).toBe(10);
    expect((await bulkMoves(bulkId)).at(-1)).toEqual({ kind: "adjusted", quantity_change: 4, reason: `Invoice ${saved.invoiceNo} voided` });
    const a = (await audits(saved.id)).find((x) => x.action === "invoice_void")!;
    expect(JSON.parse(a.detail_json!).stock.released).toEqual([item.uNo]);
  });

  it("an item the owner moved on (returned) is left as it is by a void, and the void still works", async () => {
    const item = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] })));
    expect((await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "returned", reason: "customer returned it" } })).status).toBe(200);
    expect((await voidInv(saved.id)).status).toBe(200);
    expect(await itemStatus(item.uNo)).toEqual({ status: "returned", voided_at: null });
  });
});

describe("edit applies only the difference (S8 to S10, Q164)", () => {
  it("keeping an item and changing its weight writes no stock row (no double count)", async () => {
    const item = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] })));
    const hist = (await itemHistory(item.uNo)).length;
    const res = await put(saved.id, { ...bill({ lines: [line({ stockUNo: item.uNo, netWeightMg: 9_000, grossWeightMg: 9_000 })] }), expectedRevision: 1 });
    expect(res.status).toBe(200);
    expect(await itemStatus(item.uNo)).toEqual({ status: "sold", voided_at: null });
    expect((await itemHistory(item.uNo)).length).toBe(hist);
  });

  it("an item added by an edit is sold once; a removed line returns its item once, with the revision in the reason", async () => {
    const first = await newItem();
    const second = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: first.uNo })] })));
    const added = await put(saved.id, { ...bill({ lines: [line({ stockUNo: first.uNo }), line({ stockUNo: second.uNo })] }), expectedRevision: 1 });
    expect(added.status).toBe(200);
    expect(await itemStatus(second.uNo)).toEqual({ status: "sold", voided_at: null });
    expect((await itemHistory(first.uNo)).length).toBe(2);
    // Remove the first item from line 1 (keep the second): the first comes back once.
    const removed = await put(saved.id, { ...bill({ lines: [line({ stockUNo: second.uNo })] }), expectedRevision: 2 });
    expect(removed.status).toBe(200);
    expect(await itemStatus(first.uNo)).toEqual({ status: "in_stock", voided_at: null });
    const h = (await itemHistory(first.uNo)).at(-1)!;
    expect(h.to_status).toBe("in_stock");
    expect(h.reason).toContain(`Invoice ${saved.invoiceNo} changed to revision 3`);
    expect((await itemHistory(first.uNo)).length).toBe(3);
    // Editing again without the item changes nothing for it.
    expect((await put(saved.id, { ...bill({ lines: [line({ stockUNo: second.uNo, netWeightMg: 9_500, grossWeightMg: 9_500 })] }), expectedRevision: 3 })).status).toBe(200);
    expect((await itemHistory(first.uNo)).length).toBe(3);
  });

  it("an edit that keeps an item no longer sold on the invoice is refused (409) and writes nothing", async () => {
    const item = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] })));
    await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "returned", reason: "returned by customer" } });
    const hist = (await itemHistory(item.uNo)).length;
    const res = await put(saved.id, { ...bill({ lines: [line({ stockUNo: item.uNo, netWeightMg: 9_000, grossWeightMg: 9_000 })] }), expectedRevision: 1 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("item_not_in_stock");
    expect((await itemHistory(item.uNo)).length).toBe(hist);
    expect((await inv(await call(`/api/invoices/${saved.id}`))).revisionNo).toBe(1);
  });

  it("a removed item that is no longer sold on the invoice is left alone and the edit is not refused", async () => {
    const item = await newItem();
    const keep = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo }), line({ stockUNo: keep.uNo })] })));
    await call(`/api/inventory/items/${item.id}/status`, { method: "POST", body: { status: "returned", reason: "returned by customer" } });
    const res = await put(saved.id, { ...bill({ lines: [line({ stockUNo: keep.uNo })] }), expectedRevision: 1 });
    expect(res.status).toBe(200);
    expect(await itemStatus(item.uNo)).toEqual({ status: "returned", voided_at: null });
  });

  it("a bulk edit moves only the change: 3 to 5 takes two more; 5 to 3 gives two back; another bulk item moves the quantity", async () => {
    const bulkA = await newBulk(`EditA ${Date.now()}`, 10);
    const bulkB = await newBulk(`EditB ${Date.now()}`, 10);
    const saved = await inv(await post(bill({ lines: [line({ bulkItemId: bulkA, bulkQuantity: 3 })] })));
    expect(await bulkQty(bulkA)).toBe(7);
    expect((await put(saved.id, { ...bill({ lines: [line({ bulkItemId: bulkA, bulkQuantity: 5 })] }), expectedRevision: 1 })).status).toBe(200);
    expect(await bulkQty(bulkA)).toBe(5);
    expect((await put(saved.id, { ...bill({ lines: [line({ bulkItemId: bulkA, bulkQuantity: 3 })] }), expectedRevision: 2 })).status).toBe(200);
    expect(await bulkQty(bulkA)).toBe(7);
    expect((await put(saved.id, { ...bill({ lines: [line({ bulkItemId: bulkB, bulkQuantity: 4 })] }), expectedRevision: 3 })).status).toBe(200);
    expect(await bulkQty(bulkA)).toBe(10);
    expect(await bulkQty(bulkB)).toBe(6);
    const moves = await bulkMoves(bulkA);
    expect(moves.at(-1)!.reason).toContain(`Invoice ${saved.invoiceNo} changed to revision 4`);
  });

  it("a bulk edit that needs more than is in stock is refused and writes nothing", async () => {
    const bulkId = await newBulk(`EditShort ${Date.now()}`, 4);
    const saved = await inv(await post(bill({ lines: [line({ bulkItemId: bulkId, bulkQuantity: 2 })] })));
    const moves = (await bulkMoves(bulkId)).length;
    const res = await put(saved.id, { ...bill({ lines: [line({ bulkItemId: bulkId, bulkQuantity: 9 })] }), expectedRevision: 1 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("insufficient_quantity");
    expect((await bulkMoves(bulkId)).length).toBe(moves);
    expect(await bulkQty(bulkId)).toBe(2);
  });

  it("an edit that changes no stock link writes no stock movement and no revision", async () => {
    const item = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] })));
    const hist = (await itemHistory(item.uNo)).length;
    const res = await put(saved.id, { ...bill({ lines: [line({ stockUNo: item.uNo, description: "Silver Chain" })] }), expectedRevision: 1 });
    expect(res.status).toBe(200);
    expect((await itemHistory(item.uNo)).length).toBe(hist);
    expect(((await res.json()) as InvoiceResponse).revisionNo).toBe(2);
    const a = (await audits(saved.id)).find((x) => x.action === "invoice_update")!;
    expect(JSON.parse(a.detail_json!).stock).toEqual({ taken: [], released: [], bulk: [] });
  });
});

describe("totals, reprints and history are not changed by stock", () => {
  it("the same bill with and without a stock link has the same payable amount", async () => {
    const item = await newItem();
    const plain = await inv(await post(bill({ lines: [line()] })));
    const linked = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] })));
    expect(linked.payablePaise).toBe(plain.payablePaise);
    expect(linked.payablePaise).toBe(288_400);
  });

  it("reading an invoice writes nothing to stock", async () => {
    const item = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] })));
    const hist = (await itemHistory(item.uNo)).length;
    expect((await call(`/api/invoices/${saved.id}`)).status).toBe(200);
    expect((await call(`/api/invoices/${saved.id}/history`)).status).toBe(200);
    expect((await itemHistory(item.uNo)).length).toBe(hist);
  });
});

describe("permissions (S16)", () => {
  it("staff with invoices.create can save with a link; a viewer cannot save at all", async () => {
    const item = await newItem();
    const ok = await post(bill({ lines: [line({ stockUNo: item.uNo })] }), "staff1");
    expect(ok.status).toBe(201);
    expect(await itemStatus(item.uNo)).toEqual({ status: "sold", voided_at: null });
    const item2 = await newItem();
    expect((await post(bill({ lines: [line({ stockUNo: item2.uNo })] }), "viewer1")).status).toBe(403);
    expect(await itemStatus(item2.uNo)).toEqual({ status: "in_stock", voided_at: null });
  });

  it("staff cannot void, so the stock stays sold for them", async () => {
    const item = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] }), "staff1"));
    expect((await call(`/api/invoices/${saved.id}/void`, { method: "POST", body: { reason: "x" }, as: "staff1" })).status).toBe(403);
    expect(await itemStatus(item.uNo)).toEqual({ status: "sold", voided_at: null });
  });
});

describe("history and the history view", () => {
  it("the item history stays oldest first and is readable through the inventory API", async () => {
    const item = await newItem();
    const saved = await inv(await post(bill({ lines: [line({ stockUNo: item.uNo })] })));
    await voidInv(saved.id);
    const res = await call(`/api/inventory/items/${item.id}/history`);
    const body = (await res.json()) as InventoryHistoryResponse;
    expect(body.items.map((h) => h.toStatus)).toEqual(["in_stock", "sold", "in_stock"]);
  });
});
