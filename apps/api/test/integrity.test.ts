import { afterEach, describe, expect, it } from "vitest";
import type { IntegrityResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 052: each check passes on clean data made through the API, and fails on broken data written directly. */

const app = createApp({ now: () => new Date("2026-11-02T10:00:00.000Z") });
const PASSWORD = "a long test password";

type World = Awaited<ReturnType<typeof createTestDb>> & { cookies: Record<string, string> };
let current: World | null = null;
afterEach(async () => {
  await current?.dispose();
  current = null;
});

async function person(w: World, username: string, role: string) {
  await w.db
    .prepare(`INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name)
              VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', ?2, ?3, ?4, ?2)`)
    .bind(`u-${username}`, username, await hashPassword(PASSWORD, 1000), role)
    .run();
  const res = await call(w, "/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  w.cookies[username] = res.headers.get("set-cookie")!.split(";")[0]!;
}

type Opts = { method?: string; body?: unknown; as?: string | null };
function call(w: World, path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  const who = o.as === undefined ? "owner" : o.as;
  if (who && w.cookies[who]) headers.Cookie = w.cookies[who]!;
  if (method !== "GET") headers.Origin = "http://localhost";
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body) }, { DB: w.db });
}
const one = async <T>(w: World, sql: string, ...args: unknown[]) => w.db.prepare(sql).bind(...args).first<T>();
const run = (w: World, sql: string, ...args: unknown[]) => w.db.prepare(sql).bind(...args).run();

/** Test only: the triggers on a table are dropped so that broken rows can be written. Used for the broken-data cases. */
async function unlock(w: World, table: string) {
  const triggers = (await w.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?1").bind(table).all<{ name: string }>()).results;
  for (const t of triggers) await w.db.prepare(`DROP TRIGGER IF EXISTS ${t.name}`).run();
}

async function makeWorld(): Promise<World> {
  const base = await createTestDb();
  const w: World = { ...base, cookies: {} };
  current = w;
  await person(w, "owner", "owner");
  await person(w, "staff1", "staff");
  await person(w, "manager1", "manager");
  return w;
}

async function customer(w: World, name: string) {
  const res = await call(w, "/api/customers", { method: "POST", body: { name, mobile: "9800000003" } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}

/** A silver bill: 9.800 g at the spec 012b rate (payable ₹2,884.00). */
async function silverBill(w: World, customerId: string, invoiceDate: string, netMg = 9800) {
  const res = await call(w, "/api/invoices", {
    method: "POST",
    body: {
      invoiceDate,
      customerId,
      customerName: "Integrity Bill",
      taxMode: "intra",
      lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }],
    },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; invoiceNo: string; payablePaise: number };
}

async function payment(w: World, body: Record<string, unknown>) {
  const res = await call(w, "/api/payments", { method: "POST", body: { date: "2026-11-02", mode: "upi", reference: "TXN-INT", ...body } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { payment: { id: string } }).payment.id;
}

/** Clean data made only through the API: bills, an advance, a payment against a bill, a refund and its reversal, a
 * voided advance, a voided bill, a combined-price line, an opening balance and a customer with no activity. */
async function cleanWorld(): Promise<{ w: World; ids: Record<string, string> }> {
  const w = await makeWorld();
  const a = await customer(w, "Integrity Asha");
  const b = await customer(w, "Integrity Bhim");
  await customer(w, "Integrity Quiet");
  const inv1 = await silverBill(w, a, "2026-11-02");
  const inv2 = await silverBill(w, b, "2026-11-02", 4900);
  const inv3 = await silverBill(w, b, "2026-11-02", 2000);
  const combined = await call(w, "/api/invoices", {
    method: "POST",
    body: {
      invoiceDate: "2026-11-02",
      customerId: a,
      customerName: "Integrity Asha",
      taxMode: "intra",
      lines: [{ description: "Combined silver", purity: "silver", hsn: "7113", grossWeightMg: 3000, netWeightMg: 3000, polishMg: 0, goldRatePaisePerKg: 0, labourRatePaisePerKg: 0, gstRateBps: 300, pricingMode: "combined", totalAmountPaise: 150_000 }],
    },
  });
  expect(combined.status).toBe(201);
  const advance = await payment(w, { customerId: a, purpose: "advance", amountPaise: 300_000 });
  const against = await payment(w, { customerId: a, purpose: "against_invoices", amountPaise: 100_000, allocation: [{ invoiceId: inv1.id, amountPaise: 100_000 }] });
  const refunded = await payment(w, { customerId: b, purpose: "advance", amountPaise: 50_000 });
  const refund = await call(w, `/api/payments/${refunded}/refunds`, { method: "POST", body: { amountPaise: 10_000, mode: "cash", date: "2026-11-02" } });
  expect(refund.status).toBe(201);
  const refundId = (await one<{ id: string }>(w, "SELECT id FROM payment_refunds WHERE payment_id = ?1", refunded))!.id;
  expect((await call(w, `/api/refunds/${refundId}/reverse`, { method: "POST", body: { reason: "wrong amount" } })).status).toBe(200);
  const voidedPay = await payment(w, { customerId: b, purpose: "advance", amountPaise: 20_000 });
  expect((await call(w, `/api/payments/${voidedPay}/void`, { method: "POST", body: { reason: "duplicate entry" } })).status).toBe(200);
  expect((await call(w, `/api/invoices/${inv3.id}/void`, { method: "POST", body: { reason: "wrong customer" } })).status).toBe(200);
  const ob = await call(w, "/api/opening-balances", { method: "POST", body: { customerId: b, amountPaise: 250_000, asOfDate: "2026-03-31", reference: "OLD-INT-1" } });
  expect(ob.status).toBe(201);
  // A sale whose rate is fixed later (spec 019c): it has no stored calculation yet, and the checks skip it.
  const pending = await call(w, "/api/invoices/pending", {
    method: "POST",
    body: { invoiceDate: "2026-11-02", customerId: a, customerName: "Integrity Asha", taxMode: "intra", lines: [{ description: "Silver chain", purity: "silver", hsn: "7113", grossWeightMg: 9_800, netWeightMg: 9_800, polishBps: 0, labourRatePaisePerKg: 0 }] },
  });
  expect(pending.status).toBe(201);
  // An old gold receipt that moves its money into the advance: the payment carries source_ogp_id (spec 018).
  const og = await call(w, "/api/old-gold", { method: "POST", body: { date: "2026-11-02", customerId: a, treatment: "advance", rows: [{ description: "Old Gold", grossMg: 25_000, lessMg: 2_020, karat: "22K", purityBps: 7_526, rateKgPaise: 1_480_000_000 }] } });
  expect(og.status).toBe(201);
  return { w, ids: { inv1: inv1.id, inv2: inv2.id, inv3: inv3.id, a, b, advance, against, refunded, voidedPay } };
}

async function checks(w: World): Promise<IntegrityResponse> {
  const res = await call(w, "/api/integrity");
  expect(res.status).toBe(200);
  return (await res.json()) as IntegrityResponse;
}
const check = (r: IntegrityResponse, id: string) => r.checks.find((c) => c.id === id)!;

describe("clean data passes every check", () => {
  it("all ten checks are ok, and a second run gives the same answer (with a pending sale and an old gold receipt)", async () => {
    const { w } = await cleanWorld();
    const first = await checks(w);
    expect(first.checks.map((c) => c.id)).toEqual(["invoice_totals", "invoice_lines", "invoice_balance", "payment_balance", "links_exist", "number_series", "customer_numbers", "ledger_totals", "voided_links", "audit_rows"]);
    for (const c of first.checks) expect({ id: c.id, problems: c.problems }).toEqual({ id: c.id, problems: [] });
    expect(first.ok).toBe(true);
    expect(first.passed).toBe(10);
    const second = await checks(w);
    expect(second.checks).toEqual(first.checks);
  });

  it("reads only: the row counts of the business tables do not change", async () => {
    const { w } = await cleanWorld();
    const counts = async () => ({
      payments: (await one<{ n: number }>(w, "SELECT COUNT(*) AS n FROM payments"))!.n,
      invoices: (await one<{ n: number }>(w, "SELECT COUNT(*) AS n FROM invoices"))!.n,
      allocations: (await one<{ n: number }>(w, "SELECT COUNT(*) AS n FROM payment_allocations"))!.n,
      audit: (await one<{ n: number }>(w, "SELECT COUNT(*) AS n FROM audit_log"))!.n,
      numbers: (await one<{ n: number }>(w, "SELECT COALESCE(SUM(last_no), 0) AS n FROM number_series"))!.n,
    });
    const before = await counts();
    await checks(w);
    expect(await counts()).toEqual(before);
  });

  it("the route needs integrity.view: owner allowed, manager and staff refused, no login refused", async () => {
    const { w } = await cleanWorld();
    expect((await call(w, "/api/integrity", { as: "manager1" })).status).toBe(403);
    expect((await call(w, "/api/integrity", { as: "staff1" })).status).toBe(403);
    expect((await call(w, "/api/integrity", { as: null })).status).toBe(401);
  });
});

describe("each check fails on broken data", () => {
  it("I5 invoice_totals: a stored payable that differs from the calculation", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "invoices");
    await run(w, "UPDATE invoices SET payable_paise = payable_paise + 100 WHERE id = ?1", ids.inv2);
    const c = check(await checks(w), "invoice_totals");
    expect(c.status).toBe("fail");
    expect(c.problems.map((p) => p.recordId)).toContain(ids.inv2);
  });

  it("I6 invoice_lines: a line amount that is not gold + labour + stone", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "invoice_lines");
    await run(w, "UPDATE invoice_lines SET amount_paise = amount_paise + 100 WHERE invoice_id = ?1", ids.inv1);
    const c = check(await checks(w), "invoice_lines");
    expect(c.status).toBe("fail");
    expect(c.problems.map((p) => p.recordId)).toContain(ids.inv1);
  });

  it("I7 invoice_balance: allocations above the payable", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "payment_allocations");
    await unlock(w, "payments");
    await run(w, "INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at, created_by) VALUES ('bad-alloc-1', ?1, ?2, 500000000, '2026-11-02T00:00:00.000Z', 'test')", ids.advance, ids.inv2);
    const r = await checks(w);
    expect(check(r, "invoice_balance").problems.map((p) => p.recordId)).toContain(ids.inv2);
  });

  it("I8 payment_balance: a payment whose allocations exceed its amount", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "payment_allocations");
    await run(w, "INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at, created_by) VALUES ('bad-alloc-2', ?1, ?2, 400000, '2026-11-02T00:00:00.000Z', 'test')", ids.voidedPay, ids.inv2);
    const c = check(await checks(w), "payment_balance");
    expect(c.status).toBe("fail");
    expect(c.problems.map((p) => p.recordId)).toContain(ids.voidedPay);
  });

  it("I9 links_exist: an allocation that points to an invoice that does not exist", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "payment_allocations");
    await run(w, "INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_paise, created_at, created_by) VALUES ('bad-alloc-3', ?1, 'no-such-invoice', 1000, '2026-11-02T00:00:00.000Z', 'test')", ids.advance);
    const c = check(await checks(w), "links_exist");
    expect(c.status).toBe("fail");
    expect(c.problems.map((p) => p.recordId)).toContain("bad-alloc-3");
  });

  it("I10 number_series: a duplicate invoice number in one year, and a counter below the highest serial", async () => {
    const { w, ids } = await cleanWorld();
    const first = await one<{ invoice_no: string; fy: string }>(w, "SELECT invoice_no, fy FROM invoices WHERE id = ?1", ids.inv1);
    await unlock(w, "invoices");
    await w.db.prepare("DROP INDEX IF EXISTS invoices_fy_invoice_no_unique").run();
    await run(w, "UPDATE invoices SET invoice_no = ?1 WHERE id = ?2", first!.invoice_no, ids.inv2);
    const dup = check(await checks(w), "number_series");
    expect(dup.status).toBe("fail");
    expect(dup.problems.map((p) => p.recordId)).toContain(ids.inv2);

    const w2 = await cleanWorld();
    await unlock(w2.w, "number_series");
    await run(w2.w, "UPDATE number_series SET last_no = 0 WHERE series = 'INV'");
    const behind = check(await checks(w2.w), "number_series");
    expect(behind.status).toBe("fail");
    expect(behind.problems.some((p) => p.detail.includes("counter"))).toBe(true);
  });

  it("I11 customer_numbers: a customer number with the wrong format", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "customers");
    await run(w, "UPDATE customers SET customer_no = 'C-12' WHERE id = ?1", ids.a);
    const c = check(await checks(w), "customer_numbers");
    expect(c.status).toBe("fail");
    expect(c.problems.map((p) => p.recordId)).toContain(ids.a);
  });

  it("I12 ledger_totals: a pending-rate invoice with a stored payable the ledger does not count", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "invoices");
    await run(w, "UPDATE invoices SET rate_status = 'pending' WHERE id = ?1", ids.inv1);
    const c = check(await checks(w), "ledger_totals");
    expect(c.status).toBe("fail");
    expect(c.problems.length).toBeGreaterThan(0);
  });

  it("I13 voided_links: a voided invoice that still holds a live allocation", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "invoices");
    await run(w, "UPDATE invoices SET voided_at = '2026-11-02T00:00:00.000Z', voided_by = 'test', void_reason = 'test' WHERE id = ?1", ids.inv1);
    const c = check(await checks(w), "voided_links");
    expect(c.status).toBe("fail");
    expect(c.problems.map((p) => p.recordId)).toContain(ids.inv1);
  });

  it("I14 audit_rows: a payment with no payment_create audit row", async () => {
    const { w, ids } = await cleanWorld();
    await unlock(w, "audit_log");
    await run(w, "DELETE FROM audit_log WHERE entity = 'payment' AND entity_id = ?1 AND action = 'payment_create'", ids.advance);
    const c = check(await checks(w), "audit_rows");
    expect(c.status).toBe("fail");
    expect(c.problems.map((p) => p.recordId)).toContain(ids.advance);
  });
});
