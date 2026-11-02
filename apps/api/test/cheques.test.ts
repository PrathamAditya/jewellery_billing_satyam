import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type ChequePendingResponse, type InvoiceResponse, type PaymentListResponse, type PaymentResponse, type PaymentSaveResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 019b section 6: cheque statuses, the bounce, and what each move does to the money. */

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

let custCounter = 0;
async function customer() {
  const res = await call("/api/customers", { method: "POST", body: { name: `Cheque Customer ${++custCounter}`, mobile: "9800000002" } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}

/** A silver bill of 9.800 g: payable ₹2,884.00 (spec 012b example). */
async function invoice(customerId: string, invoiceDate: string) {
  const res = await call("/api/invoices", {
    method: "POST",
    body: {
      invoiceDate,
      customerId,
      customerName: "Cheque Bill",
      taxMode: "intra",
      lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: 9800, netWeightMg: 9800, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }],
    },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as InvoiceResponse;
}
const balanceOf = async (invoiceId: string) => ((await (await call(`/api/invoices/${invoiceId}`)).json()) as InvoiceResponse).balanceDuePaise;

let refCounter = 0;
const cheque = (body: Record<string, unknown>, as = "owner") =>
  call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "cheque", reference: `CHQ-${++refCounter}`, ...body }, as });
const saved = async (res: Response) => (await res.json()) as PaymentSaveResponse;
const move = (id: string, body: Record<string, unknown>, as = "owner") => call(`/api/payments/${id}/cheque`, { method: "POST", body, as });

describe("creating a cheque (C1, C8, C9)", () => {
  it("is saved as received, with its details and one history row", async () => {
    const c = await customer();
    const res = await cheque({ customerId: c, purpose: "advance", amountPaise: 50_000, chequeBank: "State Bank", chequeDate: "2026-11-05", chequeDrawer: "Asha Verma" });
    expect(res.status).toBe(201);
    const p = (await saved(res)).payment;
    expect(p.cheque).toMatchObject({ bank: "State Bank", date: "2026-11-05", drawer: "Asha Verma", status: "received" });
    expect(p.cheque!.events).toHaveLength(1);
    expect(p.cheque!.events[0]).toMatchObject({ status: "received" });
    expect(p.cheque!.events[0]!.by).toBeTruthy();
  });

  it("a cash payment has no cheque record, and a bad cheque date is refused", async () => {
    const c = await customer();
    const cash = (await saved(await call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "cash", customerId: c, purpose: "advance", amountPaise: 1000 } }))).payment;
    expect(cash.cheque).toBeNull();
    const bad = await cheque({ customerId: c, purpose: "advance", amountPaise: 1000, chequeDate: "2026-02-30" });
    expect(bad.status).toBe(400);
  });

  it("a second live cheque with the same number is saved with a warning, never blocked (C9)", async () => {
    const c = await customer();
    const number = `DUP-${Date.now()}`;
    await cheque({ customerId: c, purpose: "advance", amountPaise: 1000, reference: number });
    const again = await saved(await cheque({ customerId: c, purpose: "advance", amountPaise: 1000, reference: number }));
    expect(again.warnings).toEqual([{ code: "duplicate_cheque_number", reference: number }]);
  });

  it("the same id with different cheque details is a conflict (safe retry)", async () => {
    const c = await customer();
    const id = newId();
    const first = await cheque({ id, customerId: c, purpose: "advance", amountPaise: 1000, chequeBank: "Bank A", reference: "SAME-1" });
    expect(first.status).toBe(201);
    const retry = await cheque({ id, customerId: c, purpose: "advance", amountPaise: 1000, chequeBank: "Bank A", reference: "SAME-1" });
    expect(retry.status).toBe(200); // a replay returns the first result
    expect(((await retry.json()) as PaymentSaveResponse).payment.id).toBe(id);
    const other = await cheque({ id, customerId: c, purpose: "advance", amountPaise: 1000, chequeBank: "Bank B", reference: "SAME-1" });
    expect(other.status).toBe(409);
  });
});

describe("moving a cheque (C2, C3)", () => {
  it("received, deposited, cleared in order; every other move is refused with the reason", async () => {
    const c = await customer();
    const p = (await saved(await cheque({ customerId: c, purpose: "advance", amountPaise: 20_000 }))).payment;
    expect((await move(p.id, { status: "cleared" })).status).toBe(409); // cannot skip deposited
    expect((await move(p.id, { status: "deposited" })).status).toBe(200);
    const again = await move(p.id, { status: "deposited" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("invalid_cheque_move");
    const cleared = (await (await move(p.id, { status: "cleared" })).json()) as PaymentResponse;
    expect(cleared.cheque!.status).toBe("cleared");
    expect(cleared.cheque!.events.map((e) => e.status)).toEqual(["received", "deposited", "cleared"]);
  });

  it("deposit and clear leave the invoice balance exactly as it was (C3)", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-02-03");
    const before = await balanceOf(inv.id);
    const p = (await saved(await cheque({ customerId: c, invoiceId: inv.id, purpose: "against_invoices", amountPaise: 100_000 }))).payment;
    const afterReceive = await balanceOf(inv.id);
    expect(afterReceive).toBe(before - 100_000);
    await move(p.id, { status: "deposited" });
    await move(p.id, { status: "cleared" });
    expect(await balanceOf(inv.id)).toBe(afterReceive);
  });

  it("a non-cheque payment has no cheque status (C1)", async () => {
    const c = await customer();
    const upi = (await saved(await call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "upi", reference: "T1", customerId: c, purpose: "advance", amountPaise: 1000 } }))).payment;
    const res = await move(upi.id, { status: "deposited" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("not_a_cheque");
  });
});

describe("bounce (C4 to C7)", () => {
  it("bounce across two invoices: both balances go back up by the amount reversed, the payment is voided with the reason, the audit row is written", async () => {
    const c = await customer();
    const first = await invoice(c, "2026-02-03");
    const second = await invoice(c, "2026-02-04");
    const beforeTotal = (await balanceOf(first.id)) + (await balanceOf(second.id));
    const amount = 400_000; // more than the first bill (288400), so it spills into the second
    const p = (await saved(await cheque({ customerId: c, invoiceId: undefined, purpose: "against_invoices", allocation: "auto", amountPaise: amount, chequeBank: "HDFC" }))).payment;
    expect(p.allocations.filter((a) => !a.reversed).length).toBeGreaterThan(0);
    const afterReceive = (await balanceOf(first.id)) + (await balanceOf(second.id));
    expect(afterReceive).toBe(beforeTotal - amount);

    const res = await move(p.id, { status: "bounced", reason: "funds insufficient" });
    expect(res.status).toBe(200);
    const bounced = (await res.json()) as PaymentResponse;
    expect(bounced.cheque!.status).toBe("bounced");
    expect(bounced.voided).toBe(true);
    expect(bounced.voidReason).toBe("Cheque bounced: funds insufficient");
    expect(bounced.remainingPaise).toBe(0);
    expect(bounced.allocations.every((a) => a.reversed)).toBe(true);

    expect((await balanceOf(first.id)) + (await balanceOf(second.id))).toBe(beforeTotal);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'cheque_bounced' AND entity_id = ?1", p.id)).toBe(1);
  });

  it("bounce needs a reason; bounced is final, so no further move is allowed (C2)", async () => {
    const c = await customer();
    const p = (await saved(await cheque({ customerId: c, purpose: "advance", amountPaise: 5000 }))).payment;
    expect((await move(p.id, { status: "bounced" })).status).toBe(400);
    expect((await move(p.id, { status: "bounced", reason: "returned" })).status).toBe(200);
    expect((await move(p.id, { status: "bounced", reason: "again" })).status).toBe(409);
    expect((await move(p.id, { status: "cleared" })).status).toBe(409);
  });

  it("staff can deposit and clear but cannot bounce (C10)", async () => {
    const c = await customer();
    const p = (await saved(await cheque({ customerId: c, purpose: "advance", amountPaise: 5000 }))).payment;
    expect((await move(p.id, { status: "deposited" }, "staff1")).status).toBe(200);
    const denied = await move(p.id, { status: "bounced", reason: "x" }, "staff1");
    expect(denied.status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM cheque_events WHERE payment_id = ?1 AND status = 'bounced'", p.id)).toBe(0);
  });

  it("a bounce is refused while the payment has a live refund; after reversing the refund it works (C5)", async () => {
    const c = await customer();
    const p = (await saved(await cheque({ customerId: c, purpose: "advance", amountPaise: 30_000 }))).payment;
    const refund = await call(`/api/payments/${p.id}/refunds`, { method: "POST", body: { amountPaise: 10_000, mode: "upi", date: "2026-11-01" } });
    expect(refund.status).toBe(201);
    const blocked = await move(p.id, { status: "bounced", reason: "x" });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toBe("has_refunds");
    const refundId = (await one<{ id: string }>("SELECT id FROM payment_refunds WHERE payment_id = ?1", p.id))!.id;
    expect((await call(`/api/refunds/${refundId}/reverse`, { method: "POST", body: { reason: "wrong amount" } })).status).toBe(200);
    expect((await move(p.id, { status: "bounced", reason: "x" })).status).toBe(200);
  });

  it("a voided cheque cannot be deposited (the void already took its money)", async () => {
    const c = await customer();
    const p = (await saved(await cheque({ customerId: c, purpose: "advance", amountPaise: 4000 }))).payment;
    expect((await call(`/api/payments/${p.id}/void`, { method: "POST", body: { reason: "entered twice" } })).status).toBe(200);
    expect(((await (await move(p.id, { status: "deposited" })).json()) as { error: string }).error).toBe("voided");
  });
});

describe("reading cheques (C12)", () => {
  it("the pending total counts received and deposited cheques, and drops a cheque once it clears or bounces", async () => {
    const c = await customer();
    const before = (await (await call("/api/payments/cheques/pending")).json()) as ChequePendingResponse;
    const p = (await saved(await cheque({ customerId: c, purpose: "advance", amountPaise: 7_000 }))).payment;
    const mid = (await (await call("/api/payments/cheques/pending")).json()) as ChequePendingResponse;
    expect(mid).toEqual({ count: before.count + 1, totalPaise: before.totalPaise + 7_000 });
    await move(p.id, { status: "cleared" }); // received -> cleared is refused; deposit first
    await move(p.id, { status: "deposited" });
    await move(p.id, { status: "cleared" });
    const after = (await (await call("/api/payments/cheques/pending")).json()) as ChequePendingResponse;
    expect(after).toEqual(before);
  });

  it("the list filters by cheque status: pending excludes cleared, cleared shows it", async () => {
    const c = await customer();
    const p = (await saved(await cheque({ customerId: c, purpose: "advance", amountPaise: 9_000 }))).payment;
    await move(p.id, { status: "deposited" });
    const pending = (await (await call("/api/payments?chequeStatus=pending")).json()) as PaymentListResponse;
    expect(pending.items.some((i) => i.id === p.id && i.chequeStatus === "deposited")).toBe(true);
    await move(p.id, { status: "cleared" });
    const pendingAfter = (await (await call("/api/payments?chequeStatus=pending")).json()) as PaymentListResponse;
    expect(pendingAfter.items.some((i) => i.id === p.id)).toBe(false);
    const cleared = (await (await call("/api/payments?chequeStatus=cleared")).json()) as PaymentListResponse;
    expect(cleared.items.some((i) => i.id === p.id)).toBe(true);
    expect((await call("/api/payments?chequeStatus=nonsense")).status).toBe(400);
  });
});
