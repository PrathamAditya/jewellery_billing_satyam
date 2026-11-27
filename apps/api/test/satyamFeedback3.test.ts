import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ItemSuggestion, OldGoldResponse, PaymentSaveResponse, SettlementResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
const app = createApp({ now: () => new Date("2026-11-01T10:00:00.000Z") });
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

async function person(username: string, role: string) {
  await t.db
    .prepare(
      `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name)
       VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', ?2, ?3, ?4, ?2)`,
    )
    .bind(`u-${username}`, username, await hashPassword(PASSWORD, 1000), role)
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  cookies[username] = res.headers.get("set-cookie")!.split(";")[0]!;
}

beforeAll(async () => {
  t = await createTestDb();
  await person("owner", "owner");
  await person("staff1", "staff");
});
afterAll(() => t.dispose());

let seq = 0;
async function makeCustomer(name = `Cust ${++seq}`) {
  const r = await call("/api/customers", { method: "POST", body: { name, mobile: "9800000001" } });
  return ((await r.json()) as { customer: { id: string } }).customer.id;
}

async function makeInvoice(customerId: string | null, customerName: string, netMg = 9800, description = "Silver Ornament") {
  const r = await call("/api/invoices", {
    method: "POST",
    body: {
      invoiceDate: "2026-11-01",
      customerId,
      customerName,
      taxMode: "intra",
      lines: [{ description, purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishBps: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0 }],
    },
  });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; invoiceNo: string; payablePaise: number };
}

describe("feedback round 3", () => {
  it("item-suggestions combines in-stock items, saved item types (e.g. Ring), and previous invoice lines", async () => {
    const c = await makeCustomer();
    await makeInvoice(c, "Buyer A", 5000, "Royal Kada");
    const invItem = await call("/api/inventory/items", {
      method: "POST",
      body: { typeId: "type-ring", pieces: 1, metal: "gold", purity: "22K916", grossWeightMg: 5200, netWeightMg: 5000, hsn: "7113" },
    });
    expect(invItem.status).toBe(201);
    const uNo = ((await invItem.json()) as { item: { uNo: string } }).item.uNo;

    const rRes = await call("/api/invoices/item-suggestions?q=R");
    expect(rRes.status).toBe(200);
    const rBody = (await rRes.json()) as { items: ItemSuggestion[] };
    expect(rBody.items.some((x) => x.source === "item_type" && x.description === "Ring")).toBe(true);
    expect(rBody.items.some((x) => x.source === "stock_item" && x.stockUNo === uNo && x.netWeightMg === 5000)).toBe(true);
    expect(rBody.items.some((x) => x.source === "previous_line" && x.description === "Royal Kada")).toBe(true);
  });

  it("payment receipt includes combined invoiceBalanceDuePaise across one or more invoices, and null for pure advance", async () => {
    const c = await makeCustomer();
    const inv1 = await makeInvoice(c, "Multi Pay");
    const inv2 = await makeInvoice(c, "Multi Pay");
    expect(inv1.payablePaise).toBe(288_400);
    expect(inv2.payablePaise).toBe(288_400);

    // Pure advance: no invoice balance due
    const advRes = await call("/api/payments", { method: "POST", body: { date: "2026-11-01", customerId: c, mode: "upi", purpose: "advance", amountPaise: 50_000 } });
    expect(advRes.status).toBe(201);
    const adv = (await advRes.json()) as PaymentSaveResponse;
    expect(adv.payment.invoiceBalanceDuePaise).toBeNull();

    // Pay ₹4,000 across inv1 (₹2,884) and inv2 (₹1,116): remaining combined due = ₹1,768
    const payRes = await call("/api/payments", {
      method: "POST",
      body: { date: "2026-11-01", customerId: c, mode: "cash", purpose: "against_invoices", amountPaise: 400_000, allocation: "auto" },
    });
    expect(payRes.status).toBe(201);
    const pay = (await payRes.json()) as PaymentSaveResponse;
    expect(pay.payment.invoiceBalanceDuePaise).toBe(inv1.payablePaise + inv2.payablePaise - 400_000);
  });

  it("walk-in invoice (no customerId) supports Later payment (against_invoices) directly by invoiceId", async () => {
    const inv = await makeInvoice(null, "Walkin Buyer");
    const res = await call("/api/payments", {
      method: "POST",
      body: { date: "2026-11-01", mode: "upi", purpose: "against_invoices", invoiceId: inv.id, amountPaise: 100_000 },
    });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as PaymentSaveResponse;
    expect(saved.payment.kind).toBe("invoice_payment");
    expect(saved.payment.receiptNo).toMatch(/^PAY-\d{4}$/);
    expect(saved.payment.invoiceBalanceDuePaise).toBe(inv.payablePaise - 100_000);
  });

  it("old gold receipt carries invoiceNo and invoiceBalanceDuePaise when adjusted against an invoice", async () => {
    const c = await makeCustomer();
    const inv = await makeInvoice(c, "OG Seller", 50_000);
    const ogRes = await call("/api/old-gold", {
      method: "POST",
      body: {
        date: "2026-11-01",
        customerId: c,
        treatment: "invoice_adjustment",
        invoiceId: inv.id,
        invoiceAdjustPaise: 458_000,
        rows: [{ description: "Old Ring", grossMg: 1000, lessMg: 0, karat: "22K", purityBps: 9160, rateKgPaise: 500_000_000 }],
      },
    });
    expect(ogRes.status).toBe(201);
    const og = (await ogRes.json()) as OldGoldResponse;
    expect(og.invoiceNo).toBe(inv.invoiceNo);
    expect(og.invoiceBalanceDuePaise).toBe(inv.payablePaise - 458_000);
  });

  it("settlement returns kind on every line so UI and print can group into Advance, Old Gold, and Payment", async () => {
    const c = await makeCustomer();
    const inv = await makeInvoice(c, "Three Sections", 50_000);

    const adv = await (await call("/api/payments", { method: "POST", body: { date: "2026-11-01", customerId: c, mode: "upi", purpose: "advance", amountPaise: 100_000 } })).json() as PaymentSaveResponse;
    await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 100_000 }] } });
    await call("/api/old-gold", {
      method: "POST",
      body: {
        date: "2026-11-01",
        customerId: c,
        treatment: "invoice_adjustment",
        invoiceId: inv.id,
        invoiceAdjustPaise: 458_000,
        rows: [{ description: "Old Gold", grossMg: 1000, lessMg: 0, karat: "22K", purityBps: 9160, rateKgPaise: 500_000_000 }],
      },
    });
    await call("/api/payments", { method: "POST", body: { date: "2026-11-01", customerId: c, mode: "cash", purpose: "at_sale", invoiceId: inv.id, amountPaise: 50_000 } });

    const sRes = await call(`/api/invoices/${inv.id}/settlement`);
    expect(sRes.status).toBe(200);
    const s = (await sRes.json()) as SettlementResponse;
    expect(s.lines.map((l) => l.kind)).toEqual(["advance", "old_gold", "at_sale"]);
  });
});
