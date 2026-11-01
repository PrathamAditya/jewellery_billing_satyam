import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type SettlementResponse } from "@jewellery/shared";
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
  await person("viewer1", "viewer");
});
afterAll(() => t.dispose());

let n = 0;
async function customer() {
  const res = await call("/api/customers", { method: "POST", body: { name: `Settle Person ${++n}` } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}
/** The owner's sample invoice: 12.020 g gross, 10% polish, 22K916 at ₹15,150/g, 3% GST. Payable ₹2,06,323.00. */
async function sampleInvoice(c: string, date = "2026-02-03") {
  const res = await call("/api/invoices", {
    method: "POST",
    body: { invoiceDate: date, customerId: c, customerName: "Settle Person", taxMode: "intra", lines: [{ description: "Ring", purity: "22K916", hsn: "7113", grossWeightMg: 12_020, netWeightMg: 12_020, polishMg: 1_202, goldRatePaisePerKg: 1_515_000_000, labourRatePaisePerKg: 0, gstRateBps: 300 }] },
  });
  return (await res.json()) as { id: string; invoiceNo: string; payablePaise: number };
}
const pay = (body: Record<string, unknown>) => call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "upi", reference: "TXN", ...body } });
const settle = async (id: string) => (await (await call(`/api/invoices/${id}/settlement`)).json()) as SettlementResponse;

describe("the owner's settlement page (spec 017 section 6A)", () => {
  it("₹14,500 advance by UPI and ₹25,000 from an old gold advance, used on the invoice: received ₹17,000.00, balance due ₹1,89,323.00", async () => {
    const c = await customer();
    const inv = await sampleInvoice(c);
    expect(inv.payablePaise).toBe(20_632_300);
    const adv = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 1_450_000 })).json()) as { payment: { id: string; receiptNo: string } };
    const og = (await (await call("/api/old-gold", { method: "POST", body: { date: "2026-11-01", customerId: c, treatment: "advance", rows: [{ description: "Old Gold", grossMg: 25_000, lessMg: 2_020, karat: "22K", purityBps: 7_526, rateKgPaise: 1_480_000_000 }] } })).json()) as { payment: { id: string; receiptNo: string }; receiptNo: string };
    expect(og.payment.receiptNo).toMatch(/^PAY-/);
    expect((await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 1_450_000 }] } })).status).toBe(200);
    const after = await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: og.payment.id, amountPaise: 250_000 }] } });
    expect(after.status).toBe(200);
    const s = (await after.json()) as SettlementResponse;
    expect(s.receivedPaise).toBe(1_700_000);
    expect(s.balanceDuePaise).toBe(18_932_300);
    expect(s.lines.map((l) => [l.reference, l.type, l.mode, l.amountPaise])).toEqual([
      [adv.payment.receiptNo, "Advance", "UPI", 1_450_000],
      [og.payment.receiptNo, "Old gold", "Old Gold", 250_000],
    ]);
    expect(s.advanceReference).toBe(`${adv.payment.receiptNo}, ${og.payment.receiptNo}`);
    expect(s.autoNote).toContain(`Advance ${adv.payment.receiptNo} used: ₹14,500.00. Remaining in ${adv.payment.receiptNo}: ₹0.00.`);
    expect(s.autoNote.some((x) => x.includes(`Old gold ${og.receiptNo} adjusted through ${og.payment.receiptNo}: ₹2,500.00. Remaining in ${og.payment.receiptNo}: ₹2,53,462.00.`))).toBe(true);
  });
});

describe("using advances (R7)", () => {
  it("an advance is used in part and its remaining stays; using more than the advance holds, or more than is owed, is refused", async () => {
    const c = await customer();
    const inv = await sampleInvoice(c);
    const adv = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 500_000 })).json()) as { payment: { id: string } };
    const over = await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 500_001 }] } });
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ error: "exceeds_remaining" });
    const part = await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 300_000 }] } });
    expect(part.status).toBe(200);
    const left = (await one<{ n: number }>("SELECT amount_paise - (SELECT COALESCE(SUM(amount_paise),0) FROM payment_allocations WHERE payment_id = ?1 AND reversed_at IS NULL) AS n FROM payments WHERE id = ?1", adv.payment.id))!.n;
    expect(left).toBe(200_000);
    const big = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 30_000_000 })).json()) as { payment: { id: string } };
    const tooMuchOwed = await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 1 }, { paymentId: big.payment.id, amountPaise: 20_632_300 }] } });
    expect(tooMuchOwed.status).toBe(409);
    expect(await tooMuchOwed.json()).toMatchObject({ error: "exceeds_due" });
  });

  it("an advance of another customer, a voided advance and at-sale money are refused", async () => {
    const c = await customer();
    const other = await customer();
    const inv = await sampleInvoice(c);
    const foreign = (await (await pay({ customerId: other, purpose: "advance", amountPaise: 1000 })).json()) as { payment: { id: string } };
    expect((await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: foreign.payment.id, amountPaise: 100 }] } })).status).toBe(400);
    const mine = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 1000 })).json()) as { payment: { id: string } };
    await call(`/api/payments/${mine.payment.id}/void`, { method: "POST", body: { reason: "x" } });
    expect((await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: mine.payment.id, amountPaise: 100 }] } })).status).toBe(409);
    const atSale = (await (await pay({ customerId: c, invoiceId: inv.id, purpose: "at_sale", amountPaise: 1000 })).json()) as { payment: { id: string } };
    expect((await call(`/api/invoices/${(await sampleInvoice(c, "2026-02-04")).id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: atSale.payment.id, amountPaise: 1 }] } })).status).toBe(400);
  });

  it("a voided invoice cannot be paid from advances", async () => {
    const c = await customer();
    const inv = await sampleInvoice(c);
    await call(`/api/invoices/${inv.id}/void`, { method: "POST", body: { reason: "x" } });
    const adv = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 100 })).json()) as { payment: { id: string } };
    expect((await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 100 }] } })).status).toBe(409);
  });

  it("a payment cannot be listed twice in one request; an empty request is refused", async () => {
    const c = await customer();
    const inv = await sampleInvoice(c);
    const adv = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 1000 })).json()) as { payment: { id: string } };
    expect((await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 100 }, { paymentId: adv.payment.id, amountPaise: 100 }] } })).status).toBe(400);
    expect((await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [] } })).status).toBe(400);
  });
});

describe("reversing and remarks (R6, R8)", () => {
  it("reversing a line on the settlement returns the money to the advance and reopens the balance", async () => {
    const c = await customer();
    const inv = await sampleInvoice(c);
    const adv = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 500_000 })).json()) as { payment: { id: string } };
    await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 500_000 }] } });
    const s = await settle(inv.id);
    expect(s.lines).toHaveLength(1);
    const rev = await call(`/api/allocations/${s.lines[0]!.allocationId}/reverse`, { method: "POST", body: { reason: "wrong bill" } });
    expect(rev.status).toBe(200);
    const after = await settle(inv.id);
    expect(after.lines).toHaveLength(0);
    expect(after.balanceDuePaise).toBe(inv.payablePaise);
  });

  it("remarks are free text, edits keep a revision, and adding or reversing money leaves them alone", async () => {
    const c = await customer();
    const inv = await sampleInvoice(c);
    expect((await call(`/api/invoices/${inv.id}/settlement`, { method: "PUT", body: { remarks: "Customer will pay the rest on 15 Dec" } })).status).toBe(200);
    expect((await call(`/api/invoices/${inv.id}/settlement`, { method: "PUT", body: { remarks: "Revised: 20 Dec" } })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM record_revisions WHERE entity = 'settlement' AND entity_id = ?1", inv.id)).toBe(1);
    await pay({ customerId: c, invoiceId: inv.id, purpose: "at_sale", amountPaise: 1000 });
    expect((await settle(inv.id)).remarks).toBe("Revised: 20 Dec");
    expect((await call(`/api/invoices/${inv.id}/settlement`, { method: "PUT", body: { remarks: "x".repeat(1001) } })).status).toBe(400);
  });

  it("the settlement read writes nothing", async () => {
    const c = await customer();
    const inv = await sampleInvoice(c);
    const before = await count("SELECT COUNT(*) AS n FROM audit_log");
    await settle(inv.id);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log")).toBe(before);
  });

  it("permissions: staff can apply advances but not change remarks; viewers only read", async () => {
    const c = await customer();
    const inv = await sampleInvoice(c);
    expect((await call(`/api/invoices/${inv.id}/settlement`, { method: "PUT", body: { remarks: "x" }, as: "staff1" })).status).toBe(403);
    expect((await call(`/api/invoices/${inv.id}/settlement`, { as: "viewer1" })).status).toBe(200);
    expect((await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", as: "viewer1", body: { allocations: [{ paymentId: newId(), amountPaise: 1 }] } })).status).toBe(403);
  });
});

async function count(sql: string, ...args: unknown[]) {
  return (await one<{ n: number }>(sql, ...args))!.n;
}
