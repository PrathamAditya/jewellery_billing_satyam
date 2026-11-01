import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type PaymentListResponse, type PaymentResponse, type PaymentSaveResponse } from "@jewellery/shared";
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
  await person("viewer1", "viewer");
});
afterAll(() => t.dispose());

let custCounter = 0;
async function customer(name = `Customer ${++custCounter}`) {
  const res = await call("/api/customers", { method: "POST", body: { name, mobile: "9800000001" } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}

/** A silver bill whose payable is roughly `netMg` times 285.72 per gram, 3% GST. */
async function invoice(customerId: string, invoiceDate: string, netMg: number) {
  const res = await call("/api/invoices", {
    method: "POST",
    body: {
      invoiceDate,
      customerId,
      customerName: "Bill Customer",
      taxMode: "intra",
      lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }],
    },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; invoiceNo: string; payablePaise: number };
}

const pay = (body: Record<string, unknown>, as = "owner") => call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "upi", reference: "TXN1", ...body }, as });
const saved = async (res: Response) => (await res.json()) as PaymentSaveResponse;

describe("access (spec 004 mapping)", () => {
  it("staff can take payments; viewers cannot; only the owner can void or reverse", async () => {
    const c = await customer();
    expect((await pay({ customerId: c, purpose: "advance", amountPaise: 10000 }, "staff1")).status).toBe(201);
    expect((await pay({ customerId: c, purpose: "advance", amountPaise: 10000 }, "viewer1")).status).toBe(403);
    const p = (await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 10000 }))).payment;
    expect((await call(`/api/payments/${p.id}/void`, { method: "POST", as: "staff1", body: { reason: "no" } })).status).toBe(403);
  });
});

describe("advances and numbering (R2, R6)", () => {
  it("an advance is numbered PAY-, keeps the whole amount as remaining, and summarises the customer's advances", async () => {
    const c = await customer();
    const first = await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 1_450_000 }));
    expect(first.warnings).toEqual([]);
    expect(first.payment).toMatchObject({ kind: "advance", remainingPaise: 1_450_000, voided: false, customerId: c });
    expect(first.payment.receiptNo).toMatch(/^PAY-\d{4}$/);
    expect(first.payment.advanceSummary).toMatchObject({ previousRemainingPaise: 0, thisRemainingPaise: 1_450_000, totalAvailablePaise: 1_450_000 });
    const second = await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 500_000 }));
    expect(Number(second.payment.receiptNo!.slice(4))).toBe(Number(first.payment.receiptNo!.slice(4)) + 1);
    expect(second.payment.advanceSummary).toMatchObject({ previousRemainingPaise: 1_450_000, totalAvailablePaise: 1_950_000 });
  });

  it("an advance needs a customer; a future date and zero amount are refused", async () => {
    expect((await pay({ purpose: "advance", amountPaise: 100 })).status).toBe(400);
    const c = await customer();
    expect((await pay({ customerId: c, purpose: "advance", amountPaise: 0 })).status).toBe(400);
    expect((await pay({ customerId: c, purpose: "advance", amountPaise: 100, date: "2026-11-02" })).status).toBe(400);
  });

  it("20 advances at once get 20 distinct receipt numbers", async () => {
    const c = await customer();
    const results = await Promise.all(Array.from({ length: 20 }, () => pay({ customerId: c, purpose: "advance", amountPaise: 1000 })));
    const nums = (await Promise.all(results.map(saved))).map((s) => Number(s.payment.receiptNo!.slice(4))).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(20);
    expect(nums[19]! - nums[0]!).toBe(19);
  });

  it("the same id twice gives one payment and the same receipt number (safe retry)", async () => {
    const c = await customer();
    const id = newId();
    const a = await saved(await pay({ id, customerId: c, purpose: "advance", amountPaise: 7000 }));
    const b = await pay({ id, customerId: c, purpose: "advance", amountPaise: 7000 });
    expect(b.status).toBe(200);
    expect((await b.json() as PaymentSaveResponse).payment.receiptNo).toBe(a.payment.receiptNo);
    expect(await count("SELECT COUNT(*) AS n FROM payments WHERE id = ?1", id)).toBe(1);
    expect((await pay({ id, customerId: c, purpose: "advance", amountPaise: 8000 })).status).toBe(409);
  });
});

describe("paying invoices (R2, R3, M3, M4)", () => {
  it("an at-sale payment has no receipt number and moves the invoice to part paid, then paid", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-03-01", 9_800);
    const part = await saved(await pay({ customerId: c, invoiceId: inv.id, purpose: "at_sale", amountPaise: 100_000 }));
    expect(part.payment).toMatchObject({ kind: "at_sale", receiptNo: null, remainingPaise: 0 });
    const after = (await (await call(`/api/invoices/${inv.id}`)).json()) as { receivedPaise: number; balanceDuePaise: number; paymentStatus: string };
    expect(after).toMatchObject({ receivedPaise: 100_000, balanceDuePaise: inv.payablePaise - 100_000, paymentStatus: "part_paid" });
    await saved(await pay({ customerId: c, invoiceId: inv.id, purpose: "at_sale", amountPaise: inv.payablePaise - 100_000 }));
    expect(((await (await call(`/api/invoices/${inv.id}`)).json()) as { paymentStatus: string }).paymentStatus).toBe("paid");
  });

  it("an at-sale payment above the balance due is refused with the amount due", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-03-02", 9_800);
    const res = await pay({ customerId: c, invoiceId: inv.id, purpose: "at_sale", amountPaise: inv.payablePaise + 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "exceeds_due", dueAmountPaise: inv.payablePaise });
  });

  it("FIFO: oldest invoice first, then the next, and the rest stays as advance", async () => {
    const c = await customer();
    const a = await invoice(c, "2026-02-01", 9_800);
    const b = await invoice(c, "2026-02-05", 9_800);
    const d = await invoice(c, "2026-02-09", 9_800);
    const res = await saved(await pay({ customerId: c, purpose: "against_invoices", amountPaise: a.payablePaise + 5_000 }));
    expect(res.payment.kind).toBe("invoice_payment");
    const byNo = Object.fromEntries(res.payment.allocations.map((x) => [x.invoiceNo, x.amountPaise]));
    expect(byNo[a.invoiceNo]).toBe(a.payablePaise);
    expect(byNo[b.invoiceNo]).toBe(5_000);
    expect(byNo[d.invoiceNo]).toBeUndefined();
    expect(res.payment.remainingPaise).toBe(0);
  });

  it("FIFO with money left over keeps it as the customer's advance", async () => {
    const c = await customer();
    const a = await invoice(c, "2026-02-01", 9_800);
    const res = await saved(await pay({ customerId: c, purpose: "against_invoices", amountPaise: a.payablePaise + 40_000 }));
    expect(res.payment.allocations).toHaveLength(1);
    expect(res.payment.remainingPaise).toBe(40_000);
    expect(res.payment.advanceSummary).toMatchObject({ thisRemainingPaise: 40_000 });
  });

  it("manual allocation goes where the owner says; over-allocation is refused", async () => {
    const c = await customer();
    const a = await invoice(c, "2026-02-01", 9_800);
    const b = await invoice(c, "2026-02-05", 9_800);
    const ok = await saved(await pay({ customerId: c, purpose: "against_invoices", amountPaise: 100_000, allocation: [{ invoiceId: b.id, amountPaise: 60_000 }] }));
    expect(ok.payment.allocations.map((x) => [x.invoiceNo, x.amountPaise])).toEqual([[b.invoiceNo, 60_000]]);
    expect(ok.payment.remainingPaise).toBe(40_000);
    const over = await pay({ customerId: c, purpose: "against_invoices", amountPaise: a.payablePaise * 2, allocation: [{ invoiceId: a.id, amountPaise: a.payablePaise + 1 }] });
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ error: "exceeds_due" });
    const sumOver = await pay({ customerId: c, purpose: "against_invoices", amountPaise: 1_000, allocation: [{ invoiceId: a.id, amountPaise: 2_000 }] });
    expect(sumOver.status).toBe(400);
    const otherCust = await customer();
    const foreign = await pay({ customerId: otherCust, purpose: "against_invoices", amountPaise: 1_000, allocation: [{ invoiceId: a.id, amountPaise: 1_000 }] });
    expect(foreign.status).toBe(400);
  });

  it("the database refuses an allocation beyond what an invoice owes, even if the API check were skipped", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-01", 9_800);
    const pid = (await saved(await pay({ customerId: c, purpose: "advance", amountPaise: inv.payablePaise * 2 }))).payment.id;
    await expect(
      t.db.prepare("INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, ?4, 'x', 'x')").bind(newId(), pid, inv.id, inv.payablePaise + 1).run(),
    ).rejects.toThrow(/exceeds_due/);
  });

  it("two payments at the same moment cannot both take the same money (one of them is refused)", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-01", 9_800);
    const results = await Promise.all([
      pay({ customerId: c, purpose: "against_invoices", amountPaise: inv.payablePaise, allocation: [{ invoiceId: inv.id, amountPaise: inv.payablePaise }] }),
      pay({ customerId: c, purpose: "against_invoices", amountPaise: inv.payablePaise, allocation: [{ invoiceId: inv.id, amountPaise: inv.payablePaise }] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await count("SELECT COALESCE(SUM(a.amount_paise),0) AS n FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = ?1 AND a.reversed_at IS NULL", inv.id)).toBe(inv.payablePaise);
  });
});

describe("reversing and voiding (R7, R8, M3, M7)", () => {
  it("reversing one allocation gives the money back to the payment and re-opens the invoice", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-01", 9_800);
    const p = (await saved(await pay({ customerId: c, purpose: "against_invoices", amountPaise: inv.payablePaise, allocation: [{ invoiceId: inv.id, amountPaise: inv.payablePaise }] }))).payment;
    const allocId = p.allocations[0]!.id;
    const res = await call(`/api/allocations/${allocId}/reverse`, { method: "POST", body: { reason: "typed to the wrong bill" } });
    expect(res.status).toBe(200);
    const back = (await res.json()) as PaymentResponse;
    expect(back.remainingPaise).toBe(inv.payablePaise);
    expect(back.allocations[0]).toMatchObject({ reversed: true });
    expect(((await (await call(`/api/invoices/${inv.id}`)).json()) as { paymentStatus: string }).paymentStatus).toBe("unpaid");
    expect((await call(`/api/allocations/${allocId}/reverse`, { method: "POST", body: { reason: "again" } })).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'allocation_reverse' AND entity_id = ?1", p.id)).toBe(1);
  });

  it("voiding a payment reverses its allocations; the number is never reused; voiding twice is refused", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-01", 9_800);
    const p = (await saved(await pay({ customerId: c, purpose: "against_invoices", amountPaise: inv.payablePaise, allocation: [{ invoiceId: inv.id, amountPaise: inv.payablePaise }] }))).payment;
    const voided = await call(`/api/payments/${p.id}/void`, { method: "POST", body: { reason: "duplicate entry" } });
    expect(voided.status).toBe(200);
    expect(await voided.json()).toMatchObject({ voided: true, voidReason: "duplicate entry", remainingPaise: 0 });
    expect(((await (await call(`/api/invoices/${inv.id}`)).json()) as { balanceDuePaise: number }).balanceDuePaise).toBe(inv.payablePaise);
    expect((await call(`/api/payments/${p.id}/void`, { method: "POST", body: { reason: "again" } })).status).toBe(409);
    const next = (await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 100 }))).payment;
    expect(next.receiptNo).not.toBe(p.receiptNo);
  });

  it("an old gold payment is voided with its receipt, not on its own", async () => {
    const c = await customer();
    const id = newId();
    await t.db.prepare("INSERT INTO payments (id, created_at, created_by, updated_at, updated_by, kind, receipt_no, fy, serial, receipt_date, customer_id, payer_name, mode, amount_paise, input_json) VALUES (?1,'x','x','x','x','old_gold','PAY-9999','2026-27',9999,'2026-11-01',?2,'X','old_gold',1000,'{}')").bind(id, c).run();
    expect((await call(`/api/payments/${id}/void`, { method: "POST", body: { reason: "x" } })).status).toBe(409);
  });

  it("an invoice with live payments cannot be voided; an edit below the amount received is refused", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-01", 9_800);
    await saved(await pay({ customerId: c, invoiceId: inv.id, purpose: "at_sale", amountPaise: 50_000 }));
    const voidAttempt = await call(`/api/invoices/${inv.id}/void`, { method: "POST", body: { reason: "x" } });
    expect(voidAttempt.status).toBe(409);
    expect(await voidAttempt.json()).toMatchObject({ error: "has_payments" });
    const edit = await call(`/api/invoices/${inv.id}`, {
      method: "PUT",
      body: { invoiceDate: "2026-02-01", customerName: "Bill Customer", taxMode: "intra", expectedRevision: 1, lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: 1000, netWeightMg: 1000, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }] },
    });
    expect(edit.status).toBe(409);
    expect(await edit.json()).toMatchObject({ error: "payable_below_received" });
  });
});

describe("cash limit (R5)", () => {
  it("a cash payment at or above the limit is saved with a warning; below it is not; UPI never warns", async () => {
    const c = await customer();
    const at = await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 20_000_000, mode: "cash" }));
    expect(at.warnings).toEqual([{ code: "cash_limit", limitPaise: 20_000_000 }]);
    const below = await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 19_999_999, mode: "cash" }));
    expect(below.warnings).toEqual([]);
    const upi = await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 30_000_000, mode: "upi" }));
    expect(upi.warnings).toEqual([]);
  });
});

describe("reading and search (R9, R10, R11)", () => {
  it("search by receipt number and customer name, filter by status, page through", async () => {
    const c = await customer("Searchable Person Zed");
    const p = (await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 5_000, reference: "UPI-REF-77" }))).payment;
    const byNo = (await (await call(`/api/payments?q=${p.receiptNo}`)).json()) as PaymentListResponse;
    expect(byNo.items.map((i) => i.id)).toContain(p.id);
    const byName = (await (await call("/api/payments?q=searchable%20person%20zed")).json()) as PaymentListResponse;
    expect(byName.items.map((i) => i.id)).toContain(p.id);
    const byRef = (await (await call("/api/payments?q=UPI-REF-77")).json()) as PaymentListResponse;
    expect(byRef.items.map((i) => i.id)).toContain(p.id);
    await call(`/api/payments/${p.id}/void`, { method: "POST", body: { reason: "x" } });
    expect(((await (await call("/api/payments?q=searchable%20person%20zed&status=active")).json()) as PaymentListResponse).items).toHaveLength(0);
    expect(((await (await call("/api/payments?q=searchable%20person%20zed&status=voided")).json()) as PaymentListResponse).items).toHaveLength(1);
  });

  it("a payment page lists allocations with invoice numbers and the remaining amount", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-01", 9_800);
    const p = (await saved(await pay({ customerId: c, purpose: "against_invoices", amountPaise: inv.payablePaise + 100, allocation: [{ invoiceId: inv.id, amountPaise: inv.payablePaise }] }))).payment;
    const page = (await (await call(`/api/payments/${p.id}`)).json()) as PaymentResponse;
    expect(page.allocations).toEqual([expect.objectContaining({ invoiceNo: inv.invoiceNo, amountPaise: inv.payablePaise, reversed: false })]);
    expect(page.remainingPaise).toBe(100);
  });

  it("remarks can be changed with a revision and an audit row; nothing else can", async () => {
    const c = await customer();
    const p = (await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 5_000 }))).payment;
    const res = await call(`/api/payments/${p.id}`, { method: "PATCH", body: { remarks: "Paid for the wedding order" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ remarks: "Paid for the wedding order", amountPaise: 5_000 });
    expect(await count("SELECT COUNT(*) AS n FROM record_revisions WHERE entity = 'payment' AND entity_id = ?1", p.id)).toBe(1);
  });

  it("DELETE on payments and allocations fails", async () => {
    await expect(t.db.prepare("DELETE FROM payments").run()).rejects.toThrow(/voided, never deleted/);
    await expect(t.db.prepare("DELETE FROM payment_allocations").run()).rejects.toThrow(/never deleted/);
  });
});

describe("validation of what a payment is for", () => {
  it("a payment for another customer's invoice, a voided invoice and a missing mode are refused", async () => {
    const c = await customer();
    const other = await customer();
    const inv = await invoice(other, "2026-02-01", 9_800);
    const res = await pay({ customerId: c, invoiceId: inv.id, purpose: "at_sale", amountPaise: 100 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "customer_mismatch" });
    const bad = await call("/api/payments", { method: "POST", body: { date: "2026-11-01", customerId: c, purpose: "advance", amountPaise: 100 } });
    expect(bad.status).toBe(400);
  });
});
