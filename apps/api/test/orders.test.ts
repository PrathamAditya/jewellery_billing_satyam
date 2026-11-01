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
  const res = await call("/api/customers", { method: "POST", body: { name: `Order Person ${++n}` } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}
const order = (customerId: string, body: Record<string, unknown> = {}, as = "owner") => call("/api/orders", { method: "POST", body: { customerId, description: "Bridal set", ...body }, as });
const advance = (customerId: string, amountPaise: number, extra: Record<string, unknown> = {}, as = "owner") =>
  call("/api/payments", { method: "POST", body: { date: "2026-11-01", customerId, mode: "upi", reference: "UPI-1", purpose: "advance", amountPaise, ...extra }, as });
const payments = async (res: Response) => (await res.json()) as { payment: { id: string; receiptNo: string | null; remainingPaise: number } };

describe("orders (R1)", () => {
  it("numbers orders ORD-0001 and ORD-0002 per financial year, and an order can exist without an advance", async () => {
    const c = await customer();
    const a = await order(c);
    expect(a.status).toBe(201);
    const first = (await a.json()) as { orderNo: string; status: string; advances: unknown[] };
    expect(first).toMatchObject({ orderNo: expect.stringMatching(/^ORD-\d{4}$/), status: "open" });
    expect(first.advances).toEqual([]);
    const second = (await (await order(c)).json()) as { orderNo: string };
    expect(Number(second.orderNo.slice(4))).toBe(Number(first.orderNo.slice(4)) + 1);
  });

  it("the same id twice gives one order; a different customer for the same id is refused", async () => {
    const c = await customer();
    const id = newId();
    expect((await order(c, { id })).status).toBe(201);
    expect((await order(c, { id })).status).toBe(200);
    expect((await order(await customer(), { id })).status).toBe(409);
  });

  it("an unknown or voided customer is refused", async () => {
    expect((await order(newId())).status).toBe(400);
    const c = await customer();
    await call(`/api/customers/${c}/void`, { method: "POST", body: { reason: "test" } });
    expect((await order(c)).status).toBe(409);
  });
});

describe("advances on an order (R2, R3)", () => {
  it("two advances on one order get PAY- receipts, and the order shows each with its remaining", async () => {
    const c = await customer();
    const o = (await (await order(c)).json()) as { id: string };
    const a1 = await payments(await advance(c, 1_000_000, { orderId: o.id }));
    const a2 = await payments(await advance(c, 500_000, { orderId: o.id }));
    expect(a1.payment.receiptNo).toMatch(/^PAY-\d{4}$/);
    expect(a2.payment.receiptNo).not.toBe(a1.payment.receiptNo);
    const view = (await (await call(`/api/orders/${o.id}`)).json()) as { remainingPaise: number; advances: { receiptNo: string }[] };
    expect(view.advances).toHaveLength(2);
    expect(view.remainingPaise).toBe(1_500_000);
  });

  it("an opening advance from an old booklet has no receipt number, keeps its old reference, and counts as advance held", async () => {
    const c = await customer();
    const res = await advance(c, 250_000, { purpose: "opening_advance", date: "2025-06-10", oldReference: "BOOK-0412", reference: undefined, mode: "cash" });
    const body = await payments(res);
    expect(res.status).toBe(201);
    expect(body.payment.receiptNo).toBeNull();
    const row = (await one<{ kind: string; reference: string }>("SELECT kind, reference FROM payments WHERE id = ?1", body.payment.id))!;
    expect(row).toMatchObject({ kind: "opening_advance", reference: "BOOK-0412" });
    const list = (await (await call(`/api/customers/${c}/advances`)).json()) as { items: { kind: string; remainingPaise: number }[] };
    expect(list.items).toEqual([expect.objectContaining({ kind: "opening_advance", remainingPaise: 250_000 })]);
  });

  it("a closed or cancelled order refuses new advances", async () => {
    const c = await customer();
    const o = (await (await order(c)).json()) as { id: string };
    expect((await call(`/api/orders/${o.id}/close`, { method: "POST" })).status).toBe(200);
    expect((await advance(c, 1000, { orderId: o.id })).status).toBe(409);
    expect((await call(`/api/orders/${o.id}/close`, { method: "POST" })).status).toBe(409);
  });

  it("an advance on another customer's order is refused", async () => {
    const c = await customer();
    const o = (await (await order(await customer())).json()) as { id: string };
    expect((await advance(c, 1000, { orderId: o.id })).status).toBe(400);
  });
});

describe("refunds (R8)", () => {
  it("a refund reduces what the advance holds; a refund over what is left is 400; reversing it restores the amount", async () => {
    const c = await customer();
    const p = await payments(await advance(c, 400_000));
    const over = await call(`/api/payments/${p.payment.id}/refunds`, { method: "POST", body: { amountPaise: 400_001, mode: "upi", date: "2026-11-01" } });
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ error: "exceeds_remaining" });
    const refund = await call(`/api/payments/${p.payment.id}/refunds`, { method: "POST", body: { amountPaise: 150_000, mode: "upi", reference: "R-1", date: "2026-11-01" } });
    expect(refund.status).toBe(201);
    expect((await refund.json()) as { remainingPaise: number }).toMatchObject({ remainingPaise: 250_000 });
    const refundId = (await one<{ id: string }>("SELECT id FROM payment_refunds WHERE payment_id = ?1", p.payment.id))!.id;
    expect((await call(`/api/refunds/${refundId}/reverse`, { method: "POST", body: { reason: "wrong amount" } })).status).toBe(200);
    expect(((await (await call(`/api/payments/${p.payment.id}`)).json()) as { remainingPaise: number }).remainingPaise).toBe(400_000);
    expect((await call(`/api/refunds/${refundId}/reverse`, { method: "POST", body: { reason: "again" } })).status).toBe(409);
  });

  it("a payment with a live refund cannot be voided; once the refund is reversed it can", async () => {
    const c = await customer();
    const p = await payments(await advance(c, 100_000));
    await call(`/api/payments/${p.payment.id}/refunds`, { method: "POST", body: { amountPaise: 1_000, mode: "cash", date: "2026-11-01" } });
    const refusedVoid = await call(`/api/payments/${p.payment.id}/void`, { method: "POST", body: { reason: "x" } });
    expect(refusedVoid.status).toBe(409);
    expect(await refusedVoid.json()).toMatchObject({ error: "has_refunds" });
    const refundId = (await one<{ id: string }>("SELECT id FROM payment_refunds WHERE payment_id = ?1", p.payment.id))!.id;
    await call(`/api/refunds/${refundId}/reverse`, { method: "POST", body: { reason: "undo" } });
    expect((await call(`/api/payments/${p.payment.id}/void`, { method: "POST", body: { reason: "x" } })).status).toBe(200);
  });

  it("the database refuses a refund over the remaining money, even if the API check were skipped", async () => {
    const c = await customer();
    const p = await payments(await advance(c, 5_000));
    await expect(
      t.db.prepare("INSERT INTO payment_refunds (id, payment_id, amount_paise, mode, refund_date, created_at, created_by, updated_at, updated_by) VALUES (?1, ?2, 5001, 'cash', '2026-11-01', 'x', 'x', 'x', 'x')").bind(newId(), p.payment.id).run(),
    ).rejects.toThrow(/exceeds_payment/);
  });
});

describe("cancelling an order (R7)", () => {
  it("transfer keeps the remaining advance as the customer's advance and marks the order cancelled", async () => {
    const c = await customer();
    const o = (await (await order(c)).json()) as { id: string };
    await advance(c, 300_000, { orderId: o.id });
    const res = await call(`/api/orders/${o.id}/cancel`, { method: "POST", body: { resolution: "transfer" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "cancelled", cancelResolution: "transfer", remainingPaise: 300_000 });
    const list = (await (await call(`/api/customers/${c}/advances`)).json()) as { items: { remainingPaise: number; orderNo: string | null }[] };
    expect(list.items[0]).toMatchObject({ remainingPaise: 300_000, orderNo: expect.stringMatching(/^ORD-/) });
    expect((await call(`/api/orders/${o.id}/cancel`, { method: "POST", body: { resolution: "transfer" } })).status).toBe(409);
  });

  it("refund with a partial amount refunds the oldest advance first and leaves the rest as advance; history lists it all", async () => {
    const c = await customer();
    const o = (await (await order(c)).json()) as { id: string };
    const first = await payments(await advance(c, 400_000, { orderId: o.id, date: "2026-10-01" }));
    await payments(await advance(c, 200_000, { orderId: o.id, date: "2026-10-05" }));
    const res = await call(`/api/orders/${o.id}/cancel`, { method: "POST", body: { resolution: "refund", refundAmountPaise: 500_000, refundMode: "bank_transfer", refundReference: "NEFT-9", refundDate: "2026-11-01" } });
    expect(res.status).toBe(200);
    const view = (await res.json()) as { status: string; remainingPaise: number; refunds: { amountPaise: number; paymentId: string }[]; history: { action: string }[] };
    expect(view.status).toBe("cancelled");
    expect(view.refunds.map((r) => r.amountPaise)).toEqual([400_000, 100_000]);
    expect(view.refunds[0]!.paymentId).toBe(first.payment.id);
    expect(view.remainingPaise).toBe(100_000);
    expect(view.history.map((h) => h.action)).toEqual(expect.arrayContaining(["order create", "order refund", "order cancel"]));
  });

  it("a refund larger than what is left is 400, and refund needs a mode", async () => {
    const c = await customer();
    const o = (await (await order(c)).json()) as { id: string };
    await advance(c, 10_000, { orderId: o.id });
    expect((await call(`/api/orders/${o.id}/cancel`, { method: "POST", body: { resolution: "refund", refundAmountPaise: 10_001, refundMode: "cash" } })).status).toBe(400);
    expect((await call(`/api/orders/${o.id}/cancel`, { method: "POST", body: { resolution: "refund" } })).status).toBe(400);
  });

  it("closing keeps the advances where they are", async () => {
    const c = await customer();
    const o = (await (await order(c)).json()) as { id: string };
    await advance(c, 77_000, { orderId: o.id });
    const closed = (await (await call(`/api/orders/${o.id}/close`, { method: "POST" })).json()) as { status: string; remainingPaise: number };
    expect(closed).toMatchObject({ status: "closed", remainingPaise: 77_000 });
  });
});

describe("permissions (R7, spec 016 section 6)", () => {
  it("staff can open and fund orders but cannot cancel or refund", async () => {
    const c = await customer();
    const created = await order(c, {}, "staff1");
    expect(created.status).toBe(201);
    const o = (await created.json()) as { id: string };
    expect((await call(`/api/orders/${o.id}/cancel`, { method: "POST", as: "staff1", body: { resolution: "transfer" } })).status).toBe(403);
    const p = await payments(await advance(c, 9_000, {}, "staff1"));
    expect((await call(`/api/payments/${p.payment.id}/refunds`, { method: "POST", as: "staff1", body: { amountPaise: 1, mode: "cash", date: "2026-11-01" } })).status).toBe(403);
  });

  it("DELETE on orders and refunds fails", async () => {
    await expect(t.db.prepare("DELETE FROM orders").run()).rejects.toThrow(/never deleted/);
    await expect(t.db.prepare("DELETE FROM payment_refunds").run()).rejects.toThrow(/never deleted/);
  });
});
