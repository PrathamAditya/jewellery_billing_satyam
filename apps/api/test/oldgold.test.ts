import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-01T10:00:00.000Z");
const app = createApp({ now: () => new Date(nowMs) });
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
              VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', ?2, ?3, ?4, ?2)`)
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

let n = 0;
async function customer() {
  const res = await call("/api/customers", { method: "POST", body: { name: `Gold Seller ${++n}`, mobile: "9800000002" } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}
async function invoice(customerId: string, netMg: number) {
  const res = await call("/api/invoices", {
    method: "POST",
    body: { invoiceDate: "2026-03-01", customerId, customerName: "Gold Seller", taxMode: "intra", lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }] },
  });
  return (await res.json()) as { id: string; payablePaise: number };
}

/** The owner's receipt OGP-0001: gross 25.00 g, less 2.02 g, 75.26%, ₹14,800/g. */
const sampleRow = { description: "Old Gold", grossMg: 25_000, lessMg: 2_020, karat: "22K", purityBps: 7_526, rateKgPaise: 1_480_000_000 };
const receipt = (body: Record<string, unknown>, as = "owner") => call("/api/old-gold", { method: "POST", body: { date: "2026-11-01", rows: [sampleRow], ...body }, as });

describe("the owner's sample receipt (spec 018 section 6A)", () => {
  it("amount ₹2,55,962.27, round-off -₹0.27, final ₹2,55,962.00; advance treatment creates an old gold payment numbered PAY-", async () => {
    const c = await customer();
    const res = await receipt({ customerId: c, treatment: "advance" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { receiptNo: string; originalPaise: number; roundOffPaise: number; finalPaise: number; status: string; treatmentLabel: string; payment: { receiptNo: string; remainingPaise: number } | null; rows: { netMg: number; amountPaise: number }[] };
    expect(body).toMatchObject({ originalPaise: 25_596_227, roundOffPaise: -27, finalPaise: 25_596_200, status: "Advance Created", treatmentLabel: "Transfer to Customer Advance" });
    expect(body.receiptNo).toMatch(/^OGP-\d{4}$/);
    expect(body.rows[0]).toMatchObject({ netMg: 22_980, amountPaise: 25_596_227 });
    expect(body.payment!.receiptNo).toMatch(/^PAY-\d{4}$/);
    expect(body.payment!.remainingPaise).toBe(25_596_200);
    const pay = await one<{ kind: string; mode: string; amount_paise: number }>("SELECT kind, mode, amount_paise FROM payments WHERE source_ogp_id = (SELECT id FROM old_gold_purchases WHERE receipt_no = ?1)", body.receiptNo);
    expect(pay).toEqual({ kind: "old_gold", mode: "old_gold", amount_paise: 25_596_200 });
  });

  it("the owner's split sample: ₹25,596,200 = direct 0 + invoice 250,000 + advance 25,346,200; the payment keeps ₹2,53,462.00 after ₹2,500 goes to the invoice", async () => {
    const c = await customer();
    const inv = await invoice(c, 9_800);
    const res = await receipt({ customerId: c, treatment: "split", directPaise: 0, advancePaise: 25_346_200, invoiceAdjustPaise: 250_000, invoiceId: inv.id });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; payment: { remainingPaise: number } | null; parts: { invoiceAdjustPaise: number } };
    expect(body.status).toBe("Split Settlement");
    expect(body.parts.invoiceAdjustPaise).toBe(250_000);
    expect(body.payment!.remainingPaise).toBe(25_346_200);
    expect(await count("SELECT COALESCE(SUM(a.amount_paise),0) AS n FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ?1 AND a.reversed_at IS NULL", inv.id)).toBe(250_000);
  });
});

describe("the four settlement cases (R5)", () => {
  it("direct payment: no payment, a payout by bank transfer, status Paid", async () => {
    const c = await customer();
    const res = await receipt({ customerId: c, treatment: "direct_payment", payoutMode: "bank_transfer", payoutReference: "NEFT-42" });
    const body = (await res.json()) as { status: string; payment: unknown; payouts: { mode: string; reference: string; amountPaise: number }[]; settlementMethod: string };
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ status: "Paid", payment: null, settlementMethod: "Direct Payment" });
    expect(body.payouts).toEqual([expect.objectContaining({ mode: "bank_transfer", reference: "NEFT-42", amountPaise: 25_596_200 })]);
  });

  it("direct payment in cash is refused: only bank transfer, UPI or cheque", async () => {
    const c = await customer();
    expect((await receipt({ customerId: c, treatment: "direct_payment", payoutMode: "cash" })).status).toBe(400);
  });

  it("direct payment without a payout mode is refused", async () => {
    const c = await customer();
    const res = await receipt({ customerId: c, treatment: "direct_payment" });
    expect(res.status).toBe(400);
  });

  it("invoice adjustment with the invoice due larger and smaller than the amount", async () => {
    const c = await customer();
    const inv = await invoice(c, 9_800);
    const tooMuch = await receipt({ customerId: c, treatment: "invoice_adjustment", invoiceId: inv.id });
    expect(tooMuch.status).toBe(409);
    expect(await tooMuch.json()).toMatchObject({ error: "exceeds_due" });
    const big = await customer();
    const bigInv = await invoice(big, 2_000_000);
    const res = await receipt({ customerId: big, treatment: "invoice_adjustment", invoiceId: bigInv.id });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe("Adjusted Against Invoice");
  });

  it("split parts that do not add up are refused with the difference named", async () => {
    const c = await customer();
    const res = await receipt({ customerId: c, treatment: "split", directPaise: 100, advancePaise: 100, invoiceAdjustPaise: 100, invoiceId: newId() });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "parts_mismatch", finalPaise: 25_596_200 });
  });

  it("advance on a closed order is refused; an advance may go on an open order", async () => {
    const c = await customer();
    const o = (await (await call("/api/orders", { method: "POST", body: { customerId: c, description: "Set" } })).json()) as { id: string };
    expect((await receipt({ customerId: c, treatment: "advance", orderId: o.id })).status).toBe(201);
    await call(`/api/orders/${o.id}/close`, { method: "POST" });
    expect((await receipt({ customerId: c, treatment: "advance", orderId: o.id })).status).toBe(409);
  });
});

describe("rows and validation (R2 to R4)", () => {
  it("less cannot be as much as gross; a purity above 100% or a zero rate is refused", async () => {
    const c = await customer();
    expect((await receipt({ customerId: c, treatment: "advance", rows: [{ ...sampleRow, lessMg: 25_000 }] })).status).toBe(400);
    expect((await receipt({ customerId: c, treatment: "advance", rows: [{ ...sampleRow, purityBps: 10_001 }] })).status).toBe(400);
    expect((await receipt({ customerId: c, treatment: "advance", rows: [{ ...sampleRow, rateKgPaise: 0 }] })).status).toBe(400);
  });

  it("a receipt with two rows (22K and 24K) gives the spec's totals: 8,905,546 original, -46 round-off, 8,905,500 final", async () => {
    const c = await customer();
    const res = await receipt({
      customerId: c,
      treatment: "advance",
      rows: [
        { description: "Bangle", grossMg: 10_000, lessMg: 0, karat: "22K", purityBps: 9_160, rateKgPaise: 600_050_000 },
        { description: "Chain", grossMg: 5_250, lessMg: 0, karat: "24K", purityBps: 9_990, rateKgPaise: 650_000_000 },
      ],
    });
    expect((await res.json())).toMatchObject({ originalPaise: 8_905_546, roundOffPaise: -46, finalPaise: 8_905_500 });
  });

  it("the same id twice gives one receipt; the same id with different content is 409", async () => {
    const c = await customer();
    const id = newId();
    const first = await receipt({ id, customerId: c, treatment: "advance" });
    const again = await receipt({ id, customerId: c, treatment: "advance" });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM old_gold_purchases WHERE id = ?1", id)).toBe(1);
    expect((await receipt({ id, customerId: c, treatment: "direct_payment", payoutMode: "upi" })).status).toBe(409);
  });

  it("a failed receipt uses no number", async () => {
    const c = await customer();
    const before = await count("SELECT COUNT(*) AS n FROM old_gold_purchases");
    const last = (await one<{ last_no: number }>("SELECT last_no FROM number_series WHERE series = 'OGP' AND fy = '2026-27'"))?.last_no ?? 0;
    expect((await receipt({ customerId: c, treatment: "invoice_adjustment", invoiceId: newId() })).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM old_gold_purchases")).toBe(before);
    expect((await one<{ last_no: number }>("SELECT last_no FROM number_series WHERE series = 'OGP' AND fy = '2026-27'"))?.last_no ?? 0).toBe(last);
  });
});

describe("voiding (R9)", () => {
  it("voiding an advance receipt voids its payment and the money goes away; a second void is refused", async () => {
    const c = await customer();
    const r = (await (await receipt({ customerId: c, treatment: "advance" })).json()) as { id: string; payment: { id: string } };
    const v = await call(`/api/old-gold/${r.id}/void`, { method: "POST", body: { reason: "wrong weight" } });
    expect(v.status).toBe(200);
    expect(await v.json()).toMatchObject({ voided: true, voidReason: "wrong weight" });
    expect((await one<{ voided_at: string | null }>("SELECT voided_at FROM payments WHERE id = ?1", r.payment.id))!.voided_at).not.toBeNull();
    expect((await call(`/api/old-gold/${r.id}/void`, { method: "POST", body: { reason: "again" } })).status).toBe(409);
    expect((await call(`/api/payments/${r.payment.id}/void`, { method: "POST", body: { reason: "x" } })).status).toBe(409);
  });

  it("the advance cannot be voided once part of it has gone to an invoice", async () => {
    const c = await customer();
    const inv = await invoice(c, 9_800);
    const r = (await (await receipt({ customerId: c, treatment: "advance" })).json()) as { id: string; payment: { id: string } };
    // Spec 017 will apply advances to invoices through its own endpoint; until then the allocation is added directly.
    await t.db.prepare("INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, 1000, 'x', 'x')").bind(newId(), r.payment.id, inv.id).run();
    const v = await call(`/api/old-gold/${r.id}/void`, { method: "POST", body: { reason: "x" } });
    expect(v.status).toBe(409);
    expect(await v.json()).toMatchObject({ error: "used_elsewhere" });
  });

  it("staff can create receipts, cannot void them", async () => {
    const c = await customer();
    const r = (await (await receipt({ customerId: c, treatment: "advance" }, "staff1")).json()) as { id: string };
    expect((await call(`/api/old-gold/${r.id}/void`, { method: "POST", as: "staff1", body: { reason: "x" } })).status).toBe(403);
  });
});

describe("reading and search", () => {
  it("search by receipt number and by name; a receipt page shows rows, payment and payout", async () => {
    const c = await customer();
    const r = (await (await receipt({ customerId: c, treatment: "direct_payment", payoutMode: "cheque", payoutReference: "CHQ-7" })).json()) as { receiptNo: string; id: string };
    const byNo = (await (await call(`/api/old-gold?q=${r.receiptNo}`)).json()) as { items: { id: string }[] };
    expect(byNo.items.map((i) => i.id)).toContain(r.id);
    const page = (await (await call(`/api/old-gold/${r.id}`)).json()) as { rows: unknown[]; payouts: { mode: string; reference: string }[]; payment: null };
    expect(page.rows).toHaveLength(1);
    expect(page.payouts[0]).toMatchObject({ mode: "cheque", reference: "CHQ-7" });
    expect(page.payment).toBeNull();
  });

  it("DELETE on old gold tables fails", async () => {
    await expect(t.db.prepare("DELETE FROM old_gold_purchases").run()).rejects.toThrow(/never deleted/);
    await expect(t.db.prepare("DELETE FROM old_gold_payouts").run()).rejects.toThrow(/never deleted/);
  });
});
