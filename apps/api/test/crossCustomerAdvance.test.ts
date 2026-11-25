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
const asBody = async <T>(res: Response) => (await res.json()) as T;
const useAdvance = (invoiceId: string, allocations: { paymentId: string; amountPaise: number }[], extra: Record<string, unknown> = {}, as = "owner") =>
  call(`/api/invoices/${invoiceId}/advance-allocations`, { method: "POST", body: { allocations, ...extra }, as });
type Ledger = { outstandingPaise: number; advanceHeldPaise: number; entries: { type: string; description: string; outstandingAfterPaise: number; advanceAfterPaise: number }[] };
const ledger = async (id: string) => asBody<Ledger>(await call(`/api/customers/${id}/ledger`));
type Settlement = { balanceDuePaise: number; autoNote: string[]; lines: { fromCustomer: string | null; amountPaise: number; allocationId: string }[] };

/** Feedback point 9: the advance of another customer used on this invoice. */
describe("another customer's advance on an invoice", () => {
  it("is refused unless asked for on purpose, and refused for a person who may not (only the owner)", async () => {
    const lender = await customer("Lender One");
    const borrower = await customer("Borrower One");
    const adv = (await saved(await pay({ customerId: lender, purpose: "advance", amountPaise: 1_000_000 }))).payment;
    const inv = await invoice(borrower, "2026-11-01", 10_000);
    const plain = await useAdvance(inv.id, [{ paymentId: adv.id, amountPaise: inv.payablePaise }]);
    expect(plain.status).toBe(400);
    expect((await asBody<{ error: string }>(plain)).error).toBe("customer_mismatch");
    const staff = await useAdvance(inv.id, [{ paymentId: adv.id, amountPaise: inv.payablePaise }], { allowOtherCustomer: true }, "staff1");
    expect(staff.status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM payment_allocations WHERE payment_id = ?1", adv.id)).toBe(0);
  });

  it("the owner can: the invoice is paid, the lender's advance goes down, and each customer's ledger tells the truth", async () => {
    const lender = await customer("Lender Two");
    const borrower = await customer("Borrower Two");
    const adv = (await saved(await pay({ customerId: lender, purpose: "advance", amountPaise: 1_000_000 }))).payment;
    const inv = await invoice(borrower, "2026-11-01", 10_000);
    const res = await useAdvance(inv.id, [{ paymentId: adv.id, amountPaise: inv.payablePaise }], { allowOtherCustomer: true });
    expect(res.status).toBe(200);
    const st = await asBody<Settlement>(res);
    expect(st.balanceDuePaise).toBe(0);
    expect(st.lines).toHaveLength(1);
    expect(st.lines[0]!.fromCustomer).toBe("Lender Two");
    expect(st.autoNote.join(" ")).toContain("of Lender Two used on this invoice");
    // lender: owes nothing (not a negative amount), advance reduced by exactly the invoice
    const l = await ledger(lender);
    expect(l.outstandingPaise).toBe(0);
    expect(l.advanceHeldPaise).toBe(1_000_000 - inv.payablePaise);
    expect(l.entries.some((e) => e.type === "Advance given to another customer")).toBe(true);
    expect(l.entries.at(-1)).toMatchObject({ outstandingAfterPaise: 0, advanceAfterPaise: 1_000_000 - inv.payablePaise });
    // borrower: owes nothing now, holds no advance
    const b = await ledger(borrower);
    expect(b.outstandingPaise).toBe(0);
    expect(b.advanceHeldPaise).toBe(0);
    expect(b.entries.some((e) => e.type === "Advance of another customer applied")).toBe(true);
    expect(b.entries.at(-1)).toMatchObject({ outstandingAfterPaise: 0, advanceAfterPaise: 0 });
    // the money is counted once: the lender's payment shows what was used
    const p = await asBody<PaymentResponse>(await call(`/api/payments/${adv.id}`));
    expect(p.remainingPaise).toBe(1_000_000 - inv.payablePaise);
  });

  it("the customer totals, the outstanding list and the dashboard figures agree with the ledgers", async () => {
    const lender = await customer("Lender Three");
    const borrower = await customer("Borrower Three");
    const adv = (await saved(await pay({ customerId: lender, purpose: "advance", amountPaise: 500_000 }))).payment;
    const inv = await invoice(borrower, "2026-11-01", 10_000);
    const part = Math.floor(inv.payablePaise / 2);
    expect((await useAdvance(inv.id, [{ paymentId: adv.id, amountPaise: part }], { allowOtherCustomer: true })).status).toBe(200);
    const l = await ledger(lender);
    const b = await ledger(borrower);
    expect(l.outstandingPaise).toBe(0);
    expect(l.advanceHeldPaise).toBe(500_000 - part);
    expect(b.outstandingPaise).toBe(inv.payablePaise - part);
    const out = await asBody<{ items: { customerId: string; outstandingPaise: number; advanceHeldPaise: number }[] }>(await call("/api/ledger/outstanding?q=Three"));
    expect(out.items.find((x) => x.customerId === borrower)?.outstandingPaise).toBe(inv.payablePaise - part);
    expect(out.items.find((x) => x.customerId === lender)?.outstandingPaise ?? 0).toBe(0);
  });

  it("reversing the line gives the money back to the lender and the debt back to the borrower", async () => {
    const lender = await customer("Lender Four");
    const borrower = await customer("Borrower Four");
    const adv = (await saved(await pay({ customerId: lender, purpose: "advance", amountPaise: 400_000 }))).payment;
    const inv = await invoice(borrower, "2026-11-01", 10_000);
    const st = await asBody<Settlement>(await useAdvance(inv.id, [{ paymentId: adv.id, amountPaise: inv.payablePaise }], { allowOtherCustomer: true }));
    const rev = await call(`/api/allocations/${st.lines[0]!.allocationId}/reverse`, { method: "POST", body: { reason: "wrong customer" } });
    expect(rev.status).toBe(200);
    expect((await ledger(lender)).advanceHeldPaise).toBe(400_000);
    expect((await ledger(lender)).outstandingPaise).toBe(0);
    expect((await ledger(borrower)).outstandingPaise).toBe(inv.payablePaise);
  });

  it("voiding the lender's advance after it was used gives the invoice back its debt", async () => {
    const lender = await customer("Lender Five");
    const borrower = await customer("Borrower Five");
    const adv = (await saved(await pay({ customerId: lender, purpose: "advance", amountPaise: 400_000 }))).payment;
    const inv = await invoice(borrower, "2026-11-01", 10_000);
    await useAdvance(inv.id, [{ paymentId: adv.id, amountPaise: inv.payablePaise }], { allowOtherCustomer: true });
    expect((await call(`/api/payments/${adv.id}/void`, { method: "POST", body: { reason: "bounced elsewhere" } })).status).toBe(200);
    expect((await ledger(borrower)).outstandingPaise).toBe(inv.payablePaise);
    expect((await ledger(lender)).advanceHeldPaise).toBe(0);
  });

  it("an invoice with no saved customer cannot take another customer's advance, and one advance is never used for more than it holds", async () => {
    const lender = await customer("Lender Six");
    const adv = (await saved(await pay({ customerId: lender, purpose: "advance", amountPaise: 100_000 }))).payment;
    const walkIn = await call("/api/invoices", {
      method: "POST",
      body: { invoiceDate: "2026-11-01", customerName: "Walk In", taxMode: "intra", lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: 10_000, netWeightMg: 10_000, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }] },
    });
    const w = await asBody<{ id: string }>(walkIn);
    const r = await useAdvance(w.id, [{ paymentId: adv.id, amountPaise: 1_000 }], { allowOtherCustomer: true });
    expect(r.status).toBe(400);
    expect((await asBody<{ error: string }>(r)).error).toBe("customer_required");
    const borrower = await customer("Borrower Six");
    const inv = await invoice(borrower, "2026-11-01", 10_000);
    const tooMuch = await useAdvance(inv.id, [{ paymentId: adv.id, amountPaise: 100_001 }], { allowOtherCustomer: true });
    expect(tooMuch.status).toBe(409);
  });

  it("an ordinary use of the customer's own advance works as before and shows no 'from' name", async () => {
    const c = await customer("Own Advance");
    const adv = (await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 400_000 }))).payment;
    const inv = await invoice(c, "2026-11-01", 10_000);
    const st = await asBody<Settlement>(await useAdvance(inv.id, [{ paymentId: adv.id, amountPaise: inv.payablePaise }]));
    expect(st.balanceDuePaise).toBe(0);
    expect(st.lines[0]!.fromCustomer).toBeNull();
    expect((await ledger(c)).outstandingPaise).toBe(0);
    expect((await ledger(c)).advanceHeldPaise).toBe(400_000 - inv.payablePaise);
  });

  it("the data checks (spec 052) stay clean", async () => {
    const body = await asBody<{ checks: { title: string; problems: unknown[] }[] }>(await call("/api/integrity"));
    expect(body.checks.filter((k) => k.problems.length > 0).map((k) => k.title)).toEqual([]);
  });
});
