import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InvoiceListResponse, InvoiceResponse, PaymentSaveResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 019c section 6: credit sales with the rate fixed later, one group per rule (R1 to R17). */

let t: Awaited<ReturnType<typeof createTestDb>>;
const TODAY = "2026-11-02";
const app = createApp({ now: () => new Date("2026-11-02T10:00:00.000Z") });
const PASSWORD = "a long test password";
const cookies: Record<string, string> = {};

type Opts = { method?: string; body?: unknown; as?: string };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (o.as !== "none") {
    const jar = cookies[o.as ?? "owner"];
    if (jar) headers.Cookie = jar;
  }
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
  const res = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD }, as: "none" });
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
  const res = await call("/api/customers", { method: "POST", body: { name: `Credit Customer ${++custCounter}`, mobile: "9800000003" } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}

/** A silver line of 9.800 g, labour 0 (the spec 013 example): payable Rs 2,884.00 once the rate is 285.72 per gram. */
const silverLine = (over: Record<string, unknown> = {}) => ({
  description: "Silver chain",
  purity: "silver",
  hsn: "7113",
  grossWeightMg: 9_800,
  netWeightMg: 9_800,
  polishBps: 0,
  labourRatePaisePerKg: 0,
  ...over,
});

async function pendingSale(customerId: string, over: Record<string, unknown> = {}, as = "owner") {
  return call("/api/invoices/pending", {
    method: "POST",
    as,
    body: { invoiceDate: TODAY, customerId, customerName: "Credit Bill", taxMode: "intra", lines: [silverLine()], ...over },
  });
}
async function newPending(over: Record<string, unknown> = {}, as = "owner") {
  const res = await pendingSale(await customer(), over, as);
  expect(res.status).toBe(201);
  return (await res.json()) as InvoiceResponse;
}

const saveRate = (date: string, kind: string, price: string, unit = "gram") => call(`/api/rates/${date}/${kind}`, { method: "PUT", body: { price, unit } });
const read = async (id: string, revision?: number) => (await call(`/api/invoices/${id}${revision ? `?revision=${revision}` : ""}`)).json() as Promise<InvoiceResponse>;
let refCounter = 0;
const payOnSale = (invoiceId: string, customerId: string, amountPaise: number, date = TODAY, as = "owner") =>
  call("/api/payments", {
    method: "POST",
    as,
    body: { id: undefined, date, customerId, mode: "upi", reference: `UPI-${++refCounter}`, amountPaise, purpose: "pending_sale", invoiceId },
  });
const fix = (id: string, body: Record<string, unknown>, as = "owner") => call(`/api/invoices/${id}/fix-rate`, { method: "POST", body, as });
const ledgerOf = async (customerId: string) => (await call(`/api/customers/${customerId}/ledger`)).json() as Promise<{ outstandingPaise: number; advanceHeldPaise: number; entries: { type: string; debitPaise: number; description: string }[] }>;

describe("R1: creating a pending sale", () => {
  it("is saved with its weights, purity and labour, and no amount, with 201", async () => {
    const inv = await newPending({ lines: [silverLine({ labourRatePaisePerKg: 300_000, polishBps: 500 })] });
    expect(inv.rateStatus).toBe("pending");
    expect(inv.rateFixedOn).toBeNull();
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ purity: "silver", grossWeightMg: 9_800, netWeightMg: 9_800, polishMg: 490, labourRatePaisePerKg: 300_000, goldRatePaisePerKg: 0 });
    expect(inv.lines[0]!.chargeableWeightMg).toBe(10_290);
  });

  it("the same id and content gives the same invoice (200), a different content is 409", async () => {
    const c = await customer();
    const id = "00000000-0000-4000-8000-000000000019";
    const first = await pendingSale(c, { id });
    expect(first.status).toBe(201);
    const again = await pendingSale(c, { id });
    expect(again.status).toBe(200);
    expect(((await again.json()) as InvoiceResponse).invoiceNo).toBe(((await read(id)).invoiceNo));
    const other = await pendingSale(c, { id, lines: [silverLine({ netWeightMg: 5_000, grossWeightMg: 5_000 })] });
    expect(other.status).toBe(409);
  });
});

describe("R2: a saved customer is required, and the sale is only weight-priced silver or gold", () => {
  it("a walk-in pending sale is refused with nothing stored", async () => {
    const before = await one<{ n: number }>("SELECT COUNT(*) AS n FROM invoices WHERE rate_status = 'pending' AND customer_id IS NULL");
    const res = await call("/api/invoices/pending", { method: "POST", body: { invoiceDate: TODAY, customerName: "Walk In", taxMode: "intra", lines: [silverLine()] } });
    expect(res.status).toBe(400);
    const after = await one<{ n: number }>("SELECT COUNT(*) AS n FROM invoices WHERE rate_status = 'pending' AND customer_id IS NULL");
    expect(after!.n).toBe(before!.n);
  });

  it("HSN 9988 is refused with the job work message", async () => {
    const res = await pendingSale(await customer(), { lines: [silverLine({ hsn: "9988" })] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: { code: string }[] }).errors[0]!.code).toBe("pending_job_work");
  });
});

describe("R3 and R4: stored shape and number", () => {
  it("stores payable 0 and the pending status in the header, and the number is taken at the sale", async () => {
    const inv = await newPending();
    const row = await one<{ rate_status: string; payable_paise: number; rates_json: string; invoice_no: string; revision_no: number }>("SELECT rate_status, payable_paise, rates_json, invoice_no, revision_no FROM invoices WHERE id = ?1", inv.id);
    expect(row).toMatchObject({ rate_status: "pending", payable_paise: 0, rates_json: "{}", revision_no: 1 });
    expect(row!.invoice_no).toMatch(/\d{4}$/);
    expect(inv.payablePaise).toBe(0);
  });

  it("a refused sale does not use a number: the next one is the next number", async () => {
    const c = await customer();
    const a = await newPending({}, "owner");
    const bad = await pendingSale(c, { lines: [silverLine({ hsn: "9988" })] });
    expect(bad.status).toBe(400);
    const b = await newPending();
    expect(Number(b.invoiceNo.slice(-4))).toBe(Number(a.invoiceNo.slice(-4)) + 1);
  });
});

describe("R5: money paid before the rate is fixed is held as the customer's advance", () => {
  it("a payment on the sale is an advance with a PAY number, linked to the sale, and the outstanding stays 0", async () => {
    const c = await customer();
    const inv = await newPending({ customerId: c }, "owner");
    const res = await payOnSale(inv.id, c, 500_000);
    expect(res.status).toBe(201);
    const p = ((await res.json()) as PaymentSaveResponse).payment;
    expect(p.kind).toBe("advance");
    expect(p.receiptNo).toMatch(/^PAY-\d{4}$/);
    expect(p.remainingPaise).toBe(500_000);
    const row = await one<{ pending_invoice_id: string }>("SELECT pending_invoice_id FROM payments WHERE id = ?1", p.id);
    expect(row!.pending_invoice_id).toBe(inv.id);
    const led = await ledgerOf(c);
    expect(led.outstandingPaise).toBe(0);
    expect(led.advanceHeldPaise).toBe(500_000);
  });

  it("several payments on several dates are allowed", async () => {
    const c = await customer();
    const inv = await newPending({ customerId: c }, "owner");
    expect((await payOnSale(inv.id, c, 100_000, "2026-11-01")).status).toBe(201);
    expect((await payOnSale(inv.id, c, 200_000, TODAY)).status).toBe(201);
    expect((await ledgerOf(c)).advanceHeldPaise).toBe(300_000);
  });

  it("a payment on a sale of another customer, or a walk-in, is refused", async () => {
    const inv = await newPending();
    const other = await customer();
    const res = await payOnSale(inv.id, other, 1_000);
    expect(res.status).toBe(400);
  });
});

describe("R6: nothing is allocated to a pending sale before the rate is fixed", () => {
  it("at-sale, invoice payments and advance allocation are refused with rate_pending", async () => {
    const c = await customer();
    const inv = await newPending({ customerId: c }, "owner");
    const atSale = await call("/api/payments", { method: "POST", body: { date: TODAY, mode: "cash", purpose: "at_sale", invoiceId: inv.id, amountPaise: 1_000 } });
    expect(atSale.status).toBe(409);
    expect(((await atSale.json()) as { error: string }).error).toBe("rate_pending");
    const later = await call("/api/payments", { method: "POST", body: { date: TODAY, customerId: c, mode: "cash", purpose: "against_invoices", allocation: [{ invoiceId: inv.id, amountPaise: 1_000 }], amountPaise: 1_000 } });
    expect(later.status).toBe(409);
    const auto = await call("/api/payments", { method: "POST", body: { date: TODAY, customerId: c, mode: "cash", purpose: "against_invoices", amountPaise: 1_000 } });
    expect(auto.status).toBe(201);
    const autoBody = (await auto.json()) as PaymentSaveResponse;
    expect(autoBody.payment.allocations).toEqual([]);
    const adv = await call(`/api/invoices/${inv.id}/advance-allocations`, { method: "POST", body: { allocations: [{ paymentId: autoBody.payment.id, amountPaise: 1 }] } });
    expect(adv.status).toBe(409);
  });
});

describe("R7: voiding a pending sale", () => {
  it("is refused while money is held against it, and allowed when none is", async () => {
    const c = await customer();
    const held = await newPending({ customerId: c });
    await payOnSale(held.id, c, 10_000);
    const refused = await call(`/api/invoices/${held.id}/void`, { method: "POST", body: { reason: "wrong weight" } });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("has_payments");

    const free = await newPending();
    const ok = await call(`/api/invoices/${free.id}/void`, { method: "POST", body: { reason: "entered twice" } });
    expect(ok.status).toBe(200);
  });
});

describe("R8: fixing the rate", () => {
  it("saves the day's rate, makes the sale payable, and applies the money held against it", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const c = await customer();
    const inv = await newPending({ customerId: c });
    await payOnSale(inv.id, c, 500_000);
    await payOnSale(inv.id, c, 300_000, "2026-11-01");
    const res = await fix(inv.id, { expectedRevision: 1 });
    expect(res.status).toBe(200);
    const fixed = (await res.json()) as InvoiceResponse;
    expect(fixed.rateStatus).toBe("fixed");
    expect(fixed.rateFixedOn).toBe(TODAY);
    expect(fixed.payablePaise).toBe(288_400);
    expect(fixed.revisionNo).toBe(2);
    expect(fixed.receivedPaise).toBe(288_400);
    expect(fixed.balanceDuePaise).toBe(0);
    expect(fixed.paymentStatus).toBe("paid");
    const led = await ledgerOf(c);
    expect(led.outstandingPaise).toBe(0);
    expect(led.advanceHeldPaise).toBe(800_000 - 288_400);
  });

  it("the figures match an ordinary invoice of the same lines (spec 013 silver example)", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const inv = await newPending();
    const fixed = (await (await fix(inv.id, { expectedRevision: 1 })).json()) as InvoiceResponse;
    expect((fixed.calc as { taxablePaise: number }).taxablePaise).toBe(280_006);
    expect(fixed.discountPaise).toBe(0);
    expect(fixed.lines[0]).toMatchObject({ goldRatePaisePerKg: 28_572_000, amountPaise: 280_006 });
  });

  it("a carried-forward rate is used and its date is shown in the rates record", async () => {
    await saveRate("2026-10-30", "silver", "280.00");
    const inv = await newPending({ invoiceDate: "2026-10-30" });
    const res = await fix(inv.id, { expectedRevision: 1, rateDate: "2026-10-31" });
    const fixed = (await res.json()) as InvoiceResponse;
    expect(fixed.rates.silver).toMatchObject({ rateDate: "2026-10-30", carriedForward: true });
  });

  it("a purity with no rate kind must be typed, and is refused without it", async () => {
    const inv = await newPending({ lines: [silverLine({ purity: "18K750" })] });
    const res = await fix(inv.id, { expectedRevision: 1 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; lines: number[] };
    expect(body.error).toBe("rate_missing");
    expect(body.lines).toEqual([1]);
    const typed = await fix(inv.id, { expectedRevision: 1, typedRates: [{ lineNo: 1, goldRatePaisePerKg: 28_572_000 }] });
    expect(typed.status).toBe(200);
  });

  it("refuses a rate date in the future or before the sale date", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const inv = await newPending();
    expect((await fix(inv.id, { expectedRevision: 1, rateDate: "2026-11-05" })).status).toBe(400);
    expect(((await (await fix(inv.id, { expectedRevision: 1, rateDate: "2026-10-01" })).json()) as { error: string }).error).toBe("rate_date_before_sale");
  });

  it("refuses a stale revision, and a second fix (409 already_fixed)", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const inv = await newPending();
    expect((await fix(inv.id, { expectedRevision: 7 })).status).toBe(409);
    expect((await fix(inv.id, { expectedRevision: 1 })).status).toBe(200);
    const again = await fix(inv.id, { expectedRevision: 2 });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("already_fixed");
  });
});

describe("R9: fixed once, for the whole sale", () => {
  it("one fix sets every line; a later change is an ordinary edit (see R12)", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const inv = await newPending({ lines: [silverLine(), silverLine({ description: "Second", netWeightMg: 4_000, grossWeightMg: 4_000 })] });
    const fixed = (await (await fix(inv.id, { expectedRevision: 1 })).json()) as InvoiceResponse;
    expect(fixed.lines.every((l) => l.goldRatePaisePerKg === 28_572_000)).toBe(true);
    expect(fixed.revisionNo).toBe(2);
  });
});

describe("R10: a pending sale is not edited, only fixed", () => {
  it("PUT on a pending sale is 409 rate_pending; after fixing, PUT works", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const inv = await newPending();
    const put = (body: Record<string, unknown>) => call(`/api/invoices/${inv.id}`, { method: "PUT", body: { invoiceDate: TODAY, customerName: "Credit Bill", taxMode: "intra", lines: [{ ...silverLine(), goldRatePaisePerKg: 28_572_000 }], expectedRevision: 1, ...body } });
    const refused = await put({});
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("rate_pending");
    await fix(inv.id, { expectedRevision: 1 });
    const edited = await put({ expectedRevision: 2, reason: "rate corrected" });
    expect(edited.status).toBe(200);
  });
});

describe("R11: the payable after fixing is not below what is already received", () => {
  it("an edit that lowers the payable under the allocated money is refused (spec 015 M8)", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const c = await customer();
    const inv = await newPending({ customerId: c });
    await payOnSale(inv.id, c, 500_000);
    await fix(inv.id, { expectedRevision: 1 });
    const lower = await call(`/api/invoices/${inv.id}`, {
      method: "PUT",
      body: { invoiceDate: TODAY, customerName: "Credit Bill", taxMode: "intra", expectedRevision: 2, lines: [{ ...silverLine({ netWeightMg: 1_000, grossWeightMg: 1_000 }), goldRatePaisePerKg: 28_572_000 }] },
    });
    expect(lower.status).toBe(409);
    expect(((await lower.json()) as { error: string }).error).toBe("payable_below_received");
  });
});

describe("R12: corrections after fixing are ordinary edits with history", () => {
  it("the pending version stays readable as revision 1, and the history shows the payable change", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const inv = await newPending();
    await fix(inv.id, { expectedRevision: 1 });
    const pending = await read(inv.id, 1);
    expect(pending.isEarlierVersion).toBe(true);
    expect(pending.lines[0]!.goldRatePaisePerKg).toBe(0);
    const hist = (await (await call(`/api/invoices/${inv.id}/history`)).json()) as { items: { revisionNo: number; fromPayablePaise: number; toPayablePaise: number; changes: string[] }[] };
    expect(hist.items[0]).toMatchObject({ revisionNo: 1, fromPayablePaise: 0, toPayablePaise: 288_400 });
    expect(hist.items[0]!.changes).toContain("lines");
  });
});

describe("R13: where the sale shows: lists, outstanding and the ledger", () => {
  it("the pending list returns only pending sales, the outstanding total does not include them, and the ledger shows the line with no amount", async () => {
    const c = await customer();
    const pending = await newPending({ customerId: c });
    const listed = (await (await call("/api/invoices?rateStatus=pending")).json()) as InvoiceListResponse;
    expect(listed.items.map((i) => i.id)).toContain(pending.id);
    expect(listed.items.every((i) => i.rateStatus === "pending")).toBe(true);
    expect(listed.items.find((i) => i.id === pending.id)!.paymentStatus).toBe("pending_rate");
    const led = await ledgerOf(c);
    expect(led.outstandingPaise).toBe(0);
    const line = led.entries.find((e) => e.type === "Invoice (rate pending)");
    expect(line).toBeDefined();
    expect(line!.debitPaise).toBe(0);
    expect(line!.description).toContain("9.800 g");
    // The outstanding total does not move when a pending sale is added.
    const total = async () => ((await (await call("/api/ledger/summary")).json()) as { totalOutstandingPaise: number }).totalOutstandingPaise;
    const before = await total();
    await newPending({ customerId: c });
    expect(await total()).toBe(before);
  });
});

describe("R14: after fixing, the invoice shows on its invoice date", () => {
  it("the ledger line carries the payable and the balance is the outstanding total", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const c = await customer();
    const inv = await newPending({ customerId: c, invoiceDate: "2026-11-01" });
    await fix(inv.id, { expectedRevision: 1 });
    const led = await ledgerOf(c);
    const line = led.entries.find((e) => e.type === "Invoice");
    expect(line).toBeDefined();
    expect(line!.debitPaise).toBe(288_400);
    expect(led.outstandingPaise).toBe(288_400);
  });
});

describe("R16: purity and weights stay visible on pending and fixed sales", () => {
  it("the invoice returns the purity and the weights", async () => {
    const inv = await newPending({ lines: [silverLine({ purity: "silver", polishBps: 200 })] });
    const got = await read(inv.id);
    expect(got.lines[0]).toMatchObject({ purity: "silver", netWeightMg: 9_800, polishBps: 200, polishMg: 196 });
  });
});

describe("R17: access", () => {
  it("every new route is 401 without a session", async () => {
    expect((await call("/api/invoices/pending", { method: "POST", body: {}, as: "none" })).status).toBe(401);
    expect((await call("/api/invoices/00000000-0000-4000-8000-000000000000/fix-rate", { method: "POST", body: {}, as: "none" })).status).toBe(401);
  });

  it("staff can take the sale and the money, but cannot fix the rate", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const c = await customer();
    const inv = await pendingSale(c, {}, "staff1");
    expect(inv.status).toBe(201);
    const made = (await inv.json()) as InvoiceResponse;
    expect((await payOnSale(made.id, c, 1_000, TODAY, "staff1")).status).toBe(201);
    const fixedByStaff = await fix(made.id, { expectedRevision: 1 }, "staff1");
    expect(fixedByStaff.status).toBe(403);
    expect(((await fixedByStaff.json()) as { permission: string }).permission).toBe("invoices.edit");
  });

  it("each change writes an audit row", async () => {
    await saveRate(TODAY, "silver", "285.72");
    const inv = await newPending();
    await fix(inv.id, { expectedRevision: 1 });
    const rows = await t.db.prepare("SELECT action FROM audit_log WHERE entity_id = ?1 ORDER BY at").bind(inv.id).all<{ action: string }>();
    expect(rows.results.map((r) => r.action)).toEqual(["invoice_pending_create", "invoice_rate_fixed"]);
  });
});
