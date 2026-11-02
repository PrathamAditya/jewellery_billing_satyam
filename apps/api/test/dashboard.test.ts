import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DashboardResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

// Spec 030: the dashboard. The clock is 11:30 on 2 Nov 2026 in India, so "today" is 2026-11-02.
const TODAY = "2026-11-02";
let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-02T06:00:00.000Z");
const app = createApp({ now: () => new Date(nowMs) });
const PASSWORD = "a long test password";
const cookies: Record<string, string> = {};

type Opts = { method?: string; body?: unknown; as?: string };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  const who = o.as ?? "owner";
  if (cookies[who]) headers.Cookie = cookies[who]!;
  if (method !== "GET") headers.Origin = "http://localhost";
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body) }, { DB: t.db });
}

/** A user with a role (the seeded roles, or a role row this file inserts) and their login cookie. */
async function person(username: string, role: string) {
  await t.db
    .prepare(`INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name)
              VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', ?2, ?3, ?4, ?2)`)
    .bind(`u-${username}`, username, await hashPassword(PASSWORD, 1000), role)
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  cookies[username] = res.headers.get("set-cookie")!.split(";")[0]!;
}

async function role(name: string, permissions: string[]) {
  await t.db
    .prepare(`INSERT INTO roles (name, label, permissions_json, system, created_at, created_by, updated_at, updated_by)
              VALUES (?1, ?1, ?2, 0, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test')`)
    .bind(name, JSON.stringify(permissions))
    .run();
}

beforeAll(async () => {
  t = await createTestDb();
  await person("owner", "owner");
  await person("staff1", "staff");
  await person("viewer1", "viewer");
  await role("sales_only", ["invoices.view", "dashboard.view"]);
  await role("no_dashboard", ["invoices.view", "payments.view"]);
  await person("sales", "sales_only");
  await person("nodash", "no_dashboard");
});
afterAll(() => t.dispose());

const silver = (netMg: number) => ({ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 });
async function customer(name: string) {
  const res = await call("/api/customers", { method: "POST", body: { name } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}
async function invoice(customerId: string, invoiceDate: string, netMg = 1_000_000) {
  const res = await call("/api/invoices", { method: "POST", body: { invoiceDate, customerId, customerName: "Dash", taxMode: "intra", lines: [silver(netMg)] } });
  return (await res.json()) as { id: string; invoiceNo: string; payablePaise: number };
}
const pay = (body: Record<string, unknown>, as = "owner") => call("/api/payments", { method: "POST", body: { date: TODAY, reference: "REF", ...body }, as });
const dashboard = async (as = "owner") => (await call("/api/dashboard", { as })).json() as Promise<DashboardResponse>;

// The known data, built once. Every amount is in paise.
const S: Record<string, number | string> = {};
beforeAll(async () => {
  const c1 = await customer("Dash One");
  const c2 = await customer("Dash Two");
  const todaySale = await invoice(c1, TODAY); // P1, counted
  const voidedSale = await invoice(c2, TODAY); // voided: never counted
  await call(`/api/invoices/${voidedSale.id}/void`, { method: "POST", body: { reason: "Entered twice" } });
  const oct = await invoice(c1, "2026-10-15"); // P3, last financial year's months are not used here
  const prevFy = await invoice(c2, "2026-02-10"); // P4, previous financial year
  // Pending-rate sale: no amount, not a sale yet.
  const pending = await call("/api/invoices/pending", { method: "POST", body: { invoiceDate: TODAY, customerId: c1, customerName: "Dash One", taxMode: "intra", lines: [{ description: "Pending", purity: "silver", hsn: "7113", grossWeightMg: 500_000, netWeightMg: 500_000, polishMg: 0, labourRatePaisePerKg: 0, gstRateBps: 300 }] } });
  expect(pending.status).toBe(201);
  // Payments: at sale (cash), advance (UPI), a voided advance and a cheque.
  const atSale = (await (await pay({ customerId: c1, invoiceId: todaySale.id, purpose: "at_sale", mode: "cash", amountPaise: 100_000 })).json()) as { payment: { id: string } };
  expect(atSale.payment).toBeTruthy();
  await pay({ customerId: c1, purpose: "advance", mode: "upi", amountPaise: 500_000 });
  const voidedAdv = (await (await pay({ customerId: c2, purpose: "advance", mode: "upi", amountPaise: 70_000 })).json()) as { payment: { id: string } };
  await call(`/api/payments/${voidedAdv.payment.id}/void`, { method: "POST", body: { reason: "Wrong customer" } });
  const cheque = await pay({ customerId: c2, purpose: "advance", mode: "cheque", reference: "CHQ-1", amountPaise: 250_000 });
  expect(cheque.status).toBe(201);
  S.c1 = c1;
  S.p1 = todaySale.payablePaise;
  S.p3 = oct.payablePaise;
  S.p4 = prevFy.payablePaise;
  S.voidedSaleNo = voidedSale.invoiceNo;
});

describe("the dashboard tiles (spec 030 R1 to R3)", () => {
  it("today's sales: the invoices dated today, not voided, at their stored payable; a pending-rate sale is not a sale", async () => {
    const d = await dashboard();
    expect(d.asOf).toBe(TODAY);
    expect(d.sales).toEqual({ todayPaise: S.p1, todayCount: 1, pendingRateCount: 1 });
  });

  it("payments received today: all modes, the voided payment left out", async () => {
    const d = await dashboard();
    expect(d.money!.receivedTodayPaise).toBe(100_000 + 500_000 + 250_000);
    expect(d.money!.receivedTodayByMode.find((r) => r.mode === "cash")!.paise).toBe(100_000);
    expect(d.money!.receivedTodayByMode.find((r) => r.mode === "upi")!.paise).toBe(500_000);
    expect(d.money!.receivedTodayByMode.find((r) => r.mode === "cheque")!.paise).toBe(250_000);
  });

  it("outstanding is the ledger summary figure: sales less settled money, voided invoice and pending sale left out", async () => {
    const d = await dashboard();
    const summary = (await (await call("/api/ledger/summary")).json()) as { totalOutstandingPaise: number; customersWithOutstanding: number };
    const expected = (S.p1 as number) - 100_000 + (S.p3 as number) + (S.p4 as number);
    expect(d.money!.outstandingPaise).toBe(expected);
    expect(summary.totalOutstandingPaise).toBe(expected);
    expect(d.money!.customersWithOutstanding).toBe(2);
    expect(summary.customersWithOutstanding).toBe(2);
  });

  it("advances held are the remaining money of live payments", async () => {
    const d = await dashboard();
    expect(d.money!.advancesHeldPaise).toBe(500_000 + 250_000);
  });

  it("advances taken today count only advance payments dated today, voided ones excluded", async () => {
    const d = await dashboard();
    expect(d.money!.advancesTakenTodayPaise).toBe(500_000 + 250_000);
  });

  it("a cheque still with the bank is counted as pending, with its total", async () => {
    const d = await dashboard();
    expect(d.money!.pendingChequeCount).toBe(1);
    expect(d.money!.pendingChequePaise).toBe(250_000);
  });

  it("the monthly summary: current financial year first, sales and receipts by month, voided and pending left out", async () => {
    const d = await dashboard();
    expect(d.monthly.map((f) => f.fy)).toEqual(["2026-27", "2025-26"]);
    const cur = d.monthly[0]!.months;
    expect(cur).toHaveLength(12);
    expect(cur[0]).toEqual({ month: "2026-04", salesPaise: 0, receiptsPaise: 0 });
    expect(cur.find((m) => m.month === "2026-10")!.salesPaise).toBe(S.p3);
    expect(cur.find((m) => m.month === "2026-11")).toEqual({ month: "2026-11", salesPaise: S.p1, receiptsPaise: 850_000 });
    const prev = d.monthly[1]!.months;
    expect(prev[0]!.month).toBe("2025-04");
    expect(prev.find((m) => m.month === "2026-02")!.salesPaise).toBe(S.p4);
    expect(prev[11]!.month).toBe("2026-03");
  });
});

describe("voided and pending items never count (spec 030 R2)", () => {
  it("the voided invoice is not in today's sales, and its voided payment is not in receipts", async () => {
    const d = await dashboard();
    expect(d.sales!.todayCount).toBe(1);
    expect(d.money!.receivedTodayPaise).toBe(850_000);
  });

  it("a pending-rate sale adds nothing to outstanding or sales, only to its own count", async () => {
    const d = await dashboard();
    expect(d.sales!.pendingRateCount).toBe(1);
    expect(d.sales!.todayPaise).toBe(S.p1);
  });
});

describe("who sees which tiles (spec 030 permissions)", () => {
  it("the default roles get the dashboard permission (migration 0022): owner, manager, staff, viewer", async () => {
    for (const who of ["owner", "staff1", "viewer1"]) expect((await call("/api/dashboard", { as: who })).status).toBe(200);
  });

  it("a role with invoices.view and dashboard.view sees the sales tiles only", async () => {
    const d = await dashboard("sales");
    expect(d.sales).not.toBeNull();
    expect(d.money).toBeNull();
    expect(d.monthly[0]!.months[0]!.receiptsPaise).toBeNull();
    expect(d.monthly[0]!.months[11]!.salesPaise).not.toBeNull();
  });

  it("without dashboard.view the route is refused, even with the sales and payments permissions", async () => {
    expect((await call("/api/dashboard", { as: "nodash" })).status).toBe(403);
  });

  it("the dashboard is read-only: nothing is written by reading it", async () => {
    const before = await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    await dashboard();
    await dashboard("sales");
    const after = await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});
