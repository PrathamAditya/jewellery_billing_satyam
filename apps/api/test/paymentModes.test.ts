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

/** Feedback point 3: one receipt, several payment modes (cash and UPI). */
describe("one receipt with several modes", () => {
  it("cash 5,000 + UPI 9,500 as an advance is ONE receipt of 14,500 with two lines", async () => {
    const c = await customer();
    const before = await count("SELECT COALESCE(MAX(last_no), 0) AS n FROM number_series WHERE series = 'PAY'");
    const res = await pay({
      customerId: c,
      purpose: "advance",
      mode: "cash",
      reference: null,
      amountPaise: 500_000,
      extraModes: [{ mode: "upi", reference: "UPI-777", amountPaise: 950_000 }],
    });
    expect(res.status).toBe(201);
    const { payment: p, warnings } = await saved(res);
    expect(warnings).toEqual([]);
    expect(p.amountPaise).toBe(1_450_000);
    expect(p.remainingPaise).toBe(1_450_000);
    expect(p.receiptNo).toMatch(/^PAY-\d{4}$/);
    expect(p.modeLines.map((m) => [m.mode, m.amountPaise, m.reference])).toEqual([["cash", 500_000, null], ["upi", 950_000, "UPI-777"]]);
    expect(p.advanceSummary).toMatchObject({ previousRemainingPaise: 0, thisRemainingPaise: 1_450_000, totalAvailablePaise: 1_450_000 });
    // exactly one number was used, and two rows carry it
    const after = await count("SELECT MAX(last_no) AS n FROM number_series WHERE series = 'PAY'");
    expect(after).toBe(before + 1);
    expect(await count("SELECT COUNT(*) AS n FROM payments WHERE receipt_no = ?1", p.receiptNo)).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM payments WHERE lead_payment_id = ?1", p.id)).toBe(1);
  });

  it("opening the receipt by the id of its second mode gives the same whole receipt", async () => {
    const c = await customer();
    const p = (await saved(await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 300_000, extraModes: [{ mode: "upi", amountPaise: 200_000 }] }))).payment;
    const second = p.modeLines[1]!.id;
    expect(second).not.toBe(p.id);
    const again = await asBody<PaymentResponse>(await call(`/api/payments/${second}`));
    expect(again.id).toBe(p.id);
    expect(again.amountPaise).toBe(500_000);
    expect(again.modeLines).toHaveLength(2);
  });

  it("the list shows the receipt once, with both modes and the total, and the mode filter finds it by either mode", async () => {
    const c = await customer("Two Mode Lister");
    const p = (await saved(await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 123_000, extraModes: [{ mode: "upi", amountPaise: 77_000 }] }))).payment;
    const list = await asBody<PaymentListResponse>(await call(`/api/payments?customerId=${c}`));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: p.id, receiptNo: p.receiptNo, amountPaise: 200_000, remainingPaise: 200_000, modes: ["cash", "upi"], voided: false });
    for (const m of ["cash", "upi"]) expect((await asBody<PaymentListResponse>(await call(`/api/payments?customerId=${c}&mode=${m}`))).items).toHaveLength(1);
    expect((await asBody<PaymentListResponse>(await call(`/api/payments?customerId=${c}&mode=card`))).items).toHaveLength(0);
  });

  it("paying an invoice with two modes: the first mode pays first, nothing is over-allocated, the invoice is paid, and the rest stays as advance", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-11-01", 10_000); // about 2,943
    const due = inv.payablePaise;
    const cash = 100_000; // 1,000
    const upi = due - cash + 111_100; // pays the rest, plus 1,111 extra that stays as advance
    const p = (await saved(await pay({ customerId: c, purpose: "against_invoices", mode: "cash", amountPaise: cash, extraModes: [{ mode: "upi", amountPaise: upi }] }))).payment;
    expect(p.amountPaise).toBe(cash + upi);
    expect(p.remainingPaise).toBe(111_100);
    // the two rows' allocations add up to exactly the invoice
    expect(await count("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment_allocations WHERE invoice_id = ?1 AND reversed_at IS NULL", inv.id)).toBe(due);
    expect(await count("SELECT COUNT(*) AS n FROM payment_allocations WHERE invoice_id = ?1", inv.id)).toBe(2);
    const row1 = await one<{ n: number }>("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment_allocations WHERE payment_id = ?1", p.modeLines[0]!.id);
    expect(row1!.n).toBe(cash);
    expect(p.modeLines[0]!.remainingPaise).toBe(0);
    expect(p.modeLines[1]!.remainingPaise).toBe(111_100);
    const inv2 = await asBody<{ balanceDuePaise: number; paymentStatus: string }>(await call(`/api/invoices/${inv.id}`));
    expect(inv2.balanceDuePaise).toBe(0);
    expect(inv2.paymentStatus).toBe("paid");
    // the settlement lists a line per mode, with that mode's name
    const st = await asBody<{ lines: { mode: string; amountPaise: number; receiptNo: string | null }[] }>(await call(`/api/invoices/${inv.id}/settlement`));
    expect(st.lines.map((l) => [l.mode, l.amountPaise])).toEqual([["Cash", cash], ["UPI", due - cash]]);
    expect(new Set(st.lines.map((l) => l.receiptNo))).toEqual(new Set([p.receiptNo]));
  });

  it("a payment is not counted twice: the customer's advance after two modes is the total once", async () => {
    const c = await customer();
    await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 400_000, extraModes: [{ mode: "upi", amountPaise: 100_000 }] });
    const next = (await saved(await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 1_000 }))).payment;
    expect(next.advanceSummary).toMatchObject({ previousRemainingPaise: 500_000, totalAvailablePaise: 501_000 });
  });

  it("a payment taken at the time of sale can also have two modes (no receipt number)", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-11-01", 10_000);
    const half = Math.floor(inv.payablePaise / 2);
    const p = (await saved(await pay({ customerId: c, purpose: "at_sale", invoiceId: inv.id, mode: "cash", amountPaise: half, extraModes: [{ mode: "card", amountPaise: inv.payablePaise - half }] }))).payment;
    expect(p.receiptNo).toBeNull();
    expect(p.modeLines).toHaveLength(2);
    expect((await asBody<{ balanceDuePaise: number }>(await call(`/api/invoices/${inv.id}`))).balanceDuePaise).toBe(0);
  });

  it("a retry with the same id gives the same receipt and adds nothing; the same id with other modes is a conflict", async () => {
    const c = await customer();
    const id = newId();
    const body = { id, customerId: c, purpose: "advance", mode: "cash", amountPaise: 10_000, extraModes: [{ mode: "upi", amountPaise: 20_000, reference: "R1" }] };
    const a = await saved(await pay(body));
    const rows = await count("SELECT COUNT(*) AS n FROM payments");
    const again = await pay(body);
    expect(again.status).toBe(200);
    expect((await asBody<PaymentSaveResponse>(again)).payment.receiptNo).toBe(a.payment.receiptNo);
    expect(await count("SELECT COUNT(*) AS n FROM payments")).toBe(rows);
    expect((await pay({ ...body, extraModes: [{ mode: "upi", amountPaise: 30_000, reference: "R1" }] })).status).toBe(409);
  });

  it("voiding the receipt voids every mode and gives the invoice its money back", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-11-01", 10_000);
    const p = (await saved(await pay({ customerId: c, purpose: "against_invoices", mode: "cash", amountPaise: 50_000, extraModes: [{ mode: "upi", amountPaise: inv.payablePaise - 50_000 }] }))).payment;
    const res = await call(`/api/payments/${p.id}/void`, { method: "POST", body: { reason: "typed twice" } });
    expect(res.status).toBe(200);
    const v = await asBody<PaymentResponse>(res);
    expect(v.voided).toBe(true);
    expect(v.remainingPaise).toBe(0);
    expect(v.modeLines.every((m) => m.voided)).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM payments WHERE (id = ?1 OR lead_payment_id = ?1) AND voided_at IS NULL", p.id)).toBe(0);
    expect((await asBody<{ balanceDuePaise: number }>(await call(`/api/invoices/${inv.id}`))).balanceDuePaise).toBe(inv.payablePaise);
    expect((await call(`/api/payments/${p.id}/void`, { method: "POST", body: { reason: "again" } })).status).toBe(409);
  });

  it("the cash limit is checked on the cash of the whole receipt (two cash lines add up)", async () => {
    const c = await customer();
    const limit = (await asBody<{ limits: { cashWarningPaise: number } }>(await call("/api/settings"))).limits.cashWarningPaise;
    const half = Math.ceil(limit / 2);
    const r = await saved(await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: half, extraModes: [{ mode: "cash", amountPaise: half }, { mode: "upi", amountPaise: 1_000 }] }));
    expect(r.warnings).toEqual([{ code: "cash_limit", limitPaise: limit }]);
    const small = await saved(await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 1_000, extraModes: [{ mode: "upi", amountPaise: limit }] }));
    expect(small.warnings).toEqual([]);
  });

  it("a cheque as one mode keeps its own cheque record; bouncing it voids only that mode and the cash stays", async () => {
    const c = await customer();
    const inv = await invoice(c, "2026-11-01", 10_000);
    const p = (await saved(await pay({
      customerId: c, purpose: "against_invoices", mode: "cash", reference: null, amountPaise: 100_000,
      extraModes: [{ mode: "cheque", reference: "CHQ-9001", amountPaise: inv.payablePaise - 100_000, chequeBank: "State Bank", chequeDate: "2026-11-05", chequeDrawer: "A Verma" }],
    }))).payment;
    const chq = p.modeLines[1]!;
    expect(chq.cheque).toMatchObject({ bank: "State Bank", status: "received", drawer: "A Verma" });
    expect(p.modeLines[0]!.cheque).toBeNull();
    const res = await call(`/api/payments/${chq.id}/cheque`, { method: "POST", body: { status: "bounced", reason: "no funds" } });
    expect(res.status).toBe(200);
    const after = await asBody<PaymentResponse>(res);
    expect(after.voided).toBe(false); // the cash mode is still good
    expect(after.modeLines.map((m) => m.voided)).toEqual([false, true]);
    expect(after.remainingPaise).toBe(0);
    expect((await asBody<{ balanceDuePaise: number }>(await call(`/api/invoices/${inv.id}`))).balanceDuePaise).toBe(inv.payablePaise - 100_000);
  });

  it("refuses more than 6 modes, a zero-rupee mode, and a mode that is not allowed", async () => {
    const c = await customer();
    const more = Array.from({ length: 6 }, () => ({ mode: "cash", amountPaise: 100 }));
    expect((await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 100, extraModes: more })).status).toBe(400);
    expect((await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 100, extraModes: [{ mode: "upi", amountPaise: 0 }] })).status).toBe(400);
    expect((await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 100, extraModes: [{ mode: "old_gold", amountPaise: 100 }] })).status).toBe(400);
    expect((await pay({ customerId: c, purpose: "advance", mode: "cash", amountPaise: 100, extraModes: Array.from({ length: 5 }, () => ({ mode: "upi", amountPaise: 100 })) })).status).toBe(201);
  });

  it("the data checks (spec 052) stay clean after several-mode receipts", async () => {
    const res = await call("/api/integrity");
    expect(res.status).toBe(200);
    const body = await asBody<{ checks: { id: string; title: string; problems: unknown[] }[] }>(res);
    const dirty = body.checks.filter((k) => k.problems.length > 0).map((k) => `${k.title}: ${JSON.stringify(k.problems).slice(0, 200)}`);
    expect(dirty).toEqual([]);
  });

  it("an ordinary single-mode receipt is unchanged: one row, one mode line, no lead", async () => {
    const c = await customer();
    const p = (await saved(await pay({ customerId: c, purpose: "advance", amountPaise: 12_000 }))).payment;
    expect(p.modeLines).toHaveLength(1);
    expect(p.modeLines[0]).toMatchObject({ id: p.id, mode: "upi", amountPaise: 12_000 });
    expect(await count("SELECT COUNT(*) AS n FROM payments WHERE lead_payment_id IS NOT NULL AND lead_payment_id = ?1", p.id)).toBe(0);
  });
});
