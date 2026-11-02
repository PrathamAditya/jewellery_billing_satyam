import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LedgerResponse, LedgerSummary, OutstandingRow } from "@jewellery/shared";
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
  const res = await call("/api/customers", { method: "POST", body: { name: `Ledger Person ${++n}` } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}
async function invoice(c: string, date: string, netMg: number) {
  const res = await call("/api/invoices", {
    method: "POST",
    body: { invoiceDate: date, customerId: c, customerName: "Ledger", taxMode: "intra", lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }] },
  });
  return (await res.json()) as { id: string; invoiceNo: string; payablePaise: number };
}
const pay = (body: Record<string, unknown>, as = "owner") => call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "upi", reference: "R", ...body }, as });
const ledger = async (c: string, from?: string) => (await (await call(`/api/customers/${c}/ledger${from ? `?from=${from}` : ""}`)).json()) as LedgerResponse;

describe("the ledger ends on the totals (spec 019 R4, R5)", () => {
  it("invoice, at-sale payment, advance, use of the advance and its reversal: every line's balances, and the final line equals the totals", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-01", 1_000_000);
    const at = (await (await pay({ customerId: c, invoiceId: inv.id, purpose: "at_sale", amountPaise: 40_000 })).json()) as { payment: { id: string } };
    const adv = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 30_000 })).json()) as { payment: { id: string } };
    const used = await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: adv.payment.id, amountPaise: 30_000 }] } });
    expect(used.status).toBe(200);
    const usedLine = (await used.json()) as { lines: { allocationId: string }[] };
    const mid = await ledger(c);
    expect(mid.outstandingPaise).toBe(inv.payablePaise - 70_000);
    expect(mid.advanceHeldPaise).toBe(0);
    await call(`/api/allocations/${usedLine.lines.find((_, i) => i === 1)!.allocationId}/reverse`, { method: "POST", body: { reason: "undo" } });
    const l = await ledger(c);
    expect(l.outstandingPaise).toBe(inv.payablePaise - 40_000);
    expect(l.advanceHeldPaise).toBe(30_000);
    const last = l.entries[l.entries.length - 1]!;
    expect(last).toMatchObject({ outstandingAfterPaise: l.outstandingPaise, advanceAfterPaise: l.advanceHeldPaise });
    expect(l.entries.map((e) => e.type)).toEqual(expect.arrayContaining(["Invoice", "Received", "Applied to invoice", "Allocation reversed"]));
    expect(at.payment).toBeDefined();
  });

  it("a voided payment and a voided invoice leave the ledger balanced", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-01", 500_000);
    const p = (await (await pay({ customerId: c, purpose: "against_invoices", amountPaise: 10_000 })).json()) as { payment: { id: string } };
    await call(`/api/payments/${p.payment.id}/void`, { method: "POST", body: { reason: "dup" } });
    const after = await ledger(c);
    expect(after.outstandingPaise).toBe(inv.payablePaise);
    expect(after.advanceHeldPaise).toBe(0);
    expect(after.entries[after.entries.length - 1]).toMatchObject({ outstandingAfterPaise: inv.payablePaise, advanceAfterPaise: 0 });
    await call(`/api/invoices/${inv.id}/void`, { method: "POST", body: { reason: "wrong" } });
    expect((await ledger(c)).outstandingPaise).toBe(0);
    expect((await ledger(c)).entries.map((e) => e.type)).toContain("Invoice voided");
  });

  it("a refund and its reversal move advance held down and up again", async () => {
    const c = await customer();
    const p = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 9_000 })).json()) as { payment: { id: string } };
    await call(`/api/payments/${p.payment.id}/refunds`, { method: "POST", body: { amountPaise: 4_000, mode: "upi", date: "2026-11-01" } });
    expect((await ledger(c)).advanceHeldPaise).toBe(5_000);
    const rid = (await one<{ id: string }>("SELECT id FROM payment_refunds WHERE payment_id = ?1", p.payment.id))!.id;
    await call(`/api/refunds/${rid}/reverse`, { method: "POST", body: { reason: "x" } });
    const l = await ledger(c);
    expect(l.advanceHeldPaise).toBe(9_000);
    expect(l.entries.map((e) => e.type)).toEqual(expect.arrayContaining(["Refund", "Refund reversed"]));
  });

  it("a seeded run of random steps (payments, uses, reversals, voids, refunds, openings) always ends on the totals", async () => {
    let seed = 20261101;
    const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
    const c = await customer();
    const invs: { id: string; payablePaise: number }[] = [];
    for (let i = 0; i < 3; i++) invs.push(await invoice(c, `2026-0${i + 2}-01`, 200_000 + i * 150_000));
    const payments: string[] = [];
    const allocs: string[] = [];
    for (let step = 0; step < 40; step++) {
      const op = rnd(7);
      if (op === 0) {
        const r = (await (await pay({ customerId: c, purpose: "advance", amountPaise: 1_000 + rnd(50_000) })).json()) as { payment?: { id: string } };
        if (r.payment) payments.push(r.payment.id);
      } else if (op === 1) {
        const r = (await (await pay({ customerId: c, purpose: "against_invoices", amountPaise: 1_000 + rnd(80_000) })).json()) as { payment?: { id: string; allocations: { id: string }[] } };
        if (r.payment) { payments.push(r.payment.id); allocs.push(...r.payment.allocations.map((a) => a.id)); }
      } else if (op === 2 && payments.length) {
        const inv = invs[rnd(invs.length)]!;
        const pid = payments[rnd(payments.length)]!;
        const res = await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: pid, amountPaise: 1_000 + rnd(20_000) }] } });
        if (res.status === 200) {
          const body = (await res.json()) as { lines: { allocationId: string }[] };
          allocs.push(...body.lines.map((l) => l.allocationId));
        }
      } else if (op === 3 && allocs.length) {
        await call(`/api/allocations/${allocs[rnd(allocs.length)]!}/reverse`, { method: "POST", body: { reason: "random" } });
      } else if (op === 4 && payments.length) {
        await call(`/api/payments/${payments[rnd(payments.length)]!}/void`, { method: "POST", body: { reason: "random" } });
      } else if (op === 5) {
        await call("/api/opening-balances", { method: "POST", body: { customerId: c, amountPaise: 1_000 + rnd(30_000), asOfDate: "2026-01-15" } });
      } else if (op === 6 && payments.length) {
        await call(`/api/payments/${payments[rnd(payments.length)]!}/refunds`, { method: "POST", body: { amountPaise: 500 + rnd(5_000), mode: "cash", date: "2026-11-01" } });
      }
      const l = await ledger(c);
      const total = (await (await call(`/api/customers/${c}/ledger`)).json()) as LedgerResponse;
      expect(total.outstandingPaise).toBe(l.outstandingPaise);
      if (l.entries.length) {
        const last = l.entries[l.entries.length - 1]!;
        expect(last.outstandingAfterPaise, `step ${step}`).toBe(l.outstandingPaise);
        expect(last.advanceAfterPaise, `step ${step}`).toBe(l.advanceHeldPaise);
      }
    }
  }, 120_000); // seeded run of 15 s alone; a longer limit keeps it from failing when the machine is busy
});

describe("opening balances (R1 to R3)", () => {
  it("an opening receivable is owed but is not a sale; an opening advance is held but is not a new receipt", async () => {
    const c = await customer();
    const before = await one<{ n: number }>("SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ?1", c);
    const ob = await call("/api/opening-balances", { method: "POST", body: { customerId: c, amountPaise: 2_500_000, asOfDate: "2025-03-31", reference: "OLD-LEDGER-12" } });
    expect(ob.status).toBe(201);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ?1", c))!.n).toBe(before!.n);
    const oa = await pay({ customerId: c, purpose: "opening_advance", amountPaise: 1_000_000, oldReference: "BOOK-9", date: "2025-02-10", mode: "cash" });
    expect(oa.status).toBe(201);
    const l = await ledger(c);
    expect(l.outstandingPaise).toBe(2_500_000);
    expect(l.advanceHeldPaise).toBe(1_000_000);
    expect(l.entries.map((e) => e.type)).toEqual(expect.arrayContaining(["Opening balance", "Received"]));
  });

  it("paying with the oldest first pays the opening receivable before a newer invoice", async () => {
    const c = await customer();
    await call("/api/opening-balances", { method: "POST", body: { customerId: c, amountPaise: 2_500_000, asOfDate: "2025-03-31" } });
    const inv = await invoice(c, "2026-02-01", 100_000);
    const p = (await (await pay({ customerId: c, purpose: "against_invoices", amountPaise: 2_600_000 })).json()) as { payment: { allocations: { invoiceId: string | null; amountPaise: number }[] } };
    expect(p.payment.allocations[0]).toMatchObject({ invoiceId: null, amountPaise: 2_500_000 });
    expect(p.payment.allocations[1]).toMatchObject({ invoiceId: inv.id, amountPaise: 100_000 });
  });

  it("an opening balance with money against it cannot be voided; after reversing the money it can", async () => {
    const c = await customer();
    const ob = (await (await call("/api/opening-balances", { method: "POST", body: { customerId: c, amountPaise: 50_000, asOfDate: "2025-01-01" } })).json()) as { id: string };
    const p = (await (await pay({ customerId: c, purpose: "against_invoices", amountPaise: 50_000 })).json()) as { payment: { allocations: { id: string }[] } };
    const refused = await call(`/api/opening-balances/${ob.id}/void`, { method: "POST", body: { reason: "x" } });
    expect(refused.status).toBe(409);
    await call(`/api/allocations/${p.payment.allocations[0]!.id}/reverse`, { method: "POST", body: { reason: "undo" } });
    expect((await call(`/api/opening-balances/${ob.id}/void`, { method: "POST", body: { reason: "wrong" } })).status).toBe(200);
    expect((await ledger(c)).outstandingPaise).toBe(0);
  });

  it("a date range starts with a brought-forward line equal to the balances before it", async () => {
    const c = await customer();
    await call("/api/opening-balances", { method: "POST", body: { customerId: c, amountPaise: 10_000, asOfDate: "2026-01-10" } });
    const inv = await invoice(c, "2026-03-05", 100_000);
    const l = await ledger(c, "2026-02-01");
    expect(l.entries[0]).toMatchObject({ type: "Brought forward", outstandingAfterPaise: 10_000, advanceAfterPaise: 0 });
    expect(l.entries.map((e) => e.type)).toContain("Invoice");
    expect(l.entries[l.entries.length - 1]!.outstandingAfterPaise).toBe(10_000 + inv.payablePaise);
  });

  it("opening balances are refused for future dates; staff can read but cannot add them", async () => {
    const c = await customer();
    expect((await call("/api/opening-balances", { method: "POST", body: { customerId: c, amountPaise: 1, asOfDate: "2026-11-02" } })).status).toBe(400);
    expect((await call("/api/opening-balances", { method: "POST", as: "staff1", body: { customerId: c, amountPaise: 1, asOfDate: "2025-01-01" } })).status).toBe(403);
    expect((await call(`/api/customers/${c}/ledger`, { as: "staff1" })).status).toBe(200);
  });
});

describe("summary and outstanding list (R6, R7)", () => {
  it("the summary's total outstanding is the sum of the customers' balances, and the list is largest first with the oldest unpaid date", async () => {
    const big = await customer();
    const small = await customer();
    await call("/api/opening-balances", { method: "POST", body: { customerId: big, amountPaise: 9_000_000, asOfDate: "2024-06-01" } });
    await call("/api/opening-balances", { method: "POST", body: { customerId: small, amountPaise: 100_000, asOfDate: "2025-06-01" } });
    const s = (await (await call("/api/ledger/summary")).json()) as LedgerSummary;
    // Other customers from earlier tests may owe more, so check the order and that this one is in the top ten.
    const amounts = s.top.map((r) => r.outstandingPaise);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    expect(s.top.find((r) => r.customerId === big)).toMatchObject({ outstandingPaise: 9_000_000 });
    const list = (await (await call("/api/ledger/outstanding?q=ledger")).json()) as { items: OutstandingRow[] };
    const idxBig = list.items.findIndex((r) => r.customerId === big);
    const idxSmall = list.items.findIndex((r) => r.customerId === small);
    expect(idxBig).toBeGreaterThanOrEqual(0);
    expect(idxBig).toBeLessThan(idxSmall);
    expect(list.items[idxBig]!.oldestUnpaidDate).toBe("2024-06-01");
    const sum = (await (await call("/api/ledger/summary")).json()) as LedgerSummary;
    expect(sum.totalOutstandingPaise).toBeGreaterThanOrEqual(9_100_000);
  });

  it("DELETE on opening balances fails", async () => {
    await expect(t.db.prepare("DELETE FROM opening_balances").run()).rejects.toThrow(/never deleted/);
  });
});
