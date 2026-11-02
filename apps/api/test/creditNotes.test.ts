import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatMoney, type InvoiceResponse, type LedgerResponse, type PaymentSaveResponse, type SettlementResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/**
 * Spec 019d section 6: one test per rule. Fixtures: a silver bill of 9.800 g at ₹285.72/g with 3% GST,
 * taxable ₹2,800.06, payable ₹2,884.00 (288,400 paise). Returning ₹1,000.00 taxable gives ₹1,030.00.
 */

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
  await person("viewer1", "viewer");
});
afterAll(() => t.dispose());

const PAYABLE = 288_400;
const NOTE_100K = 103_000; // ₹1,000.00 taxable at 3%
let custN = 0;
async function customer(name = `Return Customer ${++custN}`) {
  const res = await call("/api/customers", { method: "POST", body: { name, mobile: "9800000003" } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}

type Inv = { id: string; invoiceNo: string; payablePaise: number; balanceDuePaise: number; receivedPaise: number; voided: boolean; calc: unknown };
async function invoice(customerId: string | null, o: { taxMode?: "intra" | "inter"; netMg?: number; date?: string; name?: string } = {}) {
  const netMg = o.netMg ?? 9_800;
  const res = await call("/api/invoices", {
    method: "POST",
    body: {
      invoiceDate: o.date ?? "2026-10-01",
      customerId,
      customerName: o.name ?? "Return Bill",
      taxMode: o.taxMode ?? "intra",
      lines: [{ description: "Silver chain", purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }],
    },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Inv;
}
const readInv = async (id: string) => (await (await call(`/api/invoices/${id}`)).json()) as Inv;

let refN = 0;
const pay = (body: Record<string, unknown>, as = "owner") => call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "upi", reference: `TXN-${++refN}`, ...body }, as });
const saved = async (res: Response) => (await res.json()) as PaymentSaveResponse;
const atSale = (inv: Inv, amountPaise: number, customerId: string | null = null) =>
  pay({ ...(customerId ? { customerId } : {}), invoiceId: inv.id, purpose: "at_sale", amountPaise });

type Line = { invoiceLineNo?: number; taxablePaise: number };
const note = (invoiceId: string, lines: Line[], extra: Record<string, unknown> = {}, as = "owner") =>
  call("/api/credit-notes", {
    method: "POST",
    body: { invoiceId, cnDate: "2026-11-01", kind: "credit", lines: lines.map((l) => ({ invoiceLineNo: 1, ...l })), reason: "Returned in good condition", ...extra },
    as,
  });
type Note = {
  id: string; cnNo: string; cnDate: string; kind: string; invoiceId: string; invoiceNo: string; customerId: string | null; amountPaise: number; heldPaise: number;
  voided: boolean; taxablePaise: number; taxPaise: number; roundOffPaise: number; lines: { invoiceLineNo: number; taxablePaise: number }[];
  applications: { id: string; invoiceId: string; amountPaise: number; reversed: boolean }[];
  payouts: { id: string; amountPaise: number; reversed: boolean; mode: string }[];
  replacementInvoiceId: string | null; ogpId: string | null;
};
const noteOf = async (id: string) => (await (await call(`/api/credit-notes/${id}`)).json()) as Note;
const created = async (res: Response) => (await res.json()) as Note;
const ledgerOf = async (customerId: string) => (await (await call(`/api/customers/${customerId}/ledger`)).json()) as LedgerResponse;
const settlementOf = async (id: string) => (await (await call(`/api/invoices/${id}/settlement`)).json()) as SettlementResponse;

/** A bill of ₹2,884.00 paid ₹2,500.00 at sale, with ₹384.00 due. A ₹1,030.00 credit then applies ₹384.00 and holds ₹646.00. */
async function paidBill(customerId: string | null, paid = 250_000) {
  const inv = await invoice(customerId);
  expect((await atSale(inv, paid, customerId)).status).toBe(201);
  return inv;
}

describe("R1 kinds and the bill", () => {
  it("an unknown kind or a missing replacement is refused before anything is stored", async () => {
    const c = await customer();
    const inv = await invoice(c);
    expect((await note(inv.id, [{ taxablePaise: 100_000 }], { kind: "refund" })).status).toBe(400);
    expect((await note(inv.id, [{ taxablePaise: 100_000 }], { kind: "exchange" })).status).toBe(400);
    expect((await note(inv.id, [{ taxablePaise: 100_000 }], { kind: "old_gold" })).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM credit_notes WHERE invoice_id = ?1", inv.id)).toBe(0);
  });

  it("a voided bill cannot be credited (409 invoice_voided)", async () => {
    const c = await customer();
    const inv = await invoice(c);
    expect((await call(`/api/invoices/${inv.id}/void`, { method: "POST", body: { reason: "Entered twice" } })).status).toBe(200);
    const res = await note(inv.id, [{ taxablePaise: 100_000 }]);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("invoice_voided");
  });
});

describe("R2 returned lines", () => {
  it("a line that is not on the bill is refused", async () => {
    const inv = await invoice(await customer());
    const res = await note(inv.id, [{ invoiceLineNo: 2, taxablePaise: 100_000 }]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("unknown_line");
  });

  it("more than the line still has is refused (the line value is 2,800.06)", async () => {
    const inv = await invoice(await customer());
    const res = await note(inv.id, [{ taxablePaise: 280_007 }]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("exceeds_line");
  });

  it("a second return of the same line is capped at what is left", async () => {
    const inv = await invoice(await customer());
    expect((await note(inv.id, [{ taxablePaise: 200_000 }])).status).toBe(201);
    const second = await note(inv.id, [{ taxablePaise: 80_007 }]);
    expect(second.status).toBe(400);
    expect(((await second.json()) as { message: string }).message).toContain("₹800.06");
    expect((await note(inv.id, [{ taxablePaise: 80_006 }])).status).toBe(201);
  });

  it("no lines, too many lines, a repeated line and a missing reason are refused", async () => {
    const inv = await invoice(await customer());
    expect((await note(inv.id, [])).status).toBe(400);
    expect((await note(inv.id, Array.from({ length: 51 }, () => ({ invoiceLineNo: 1, taxablePaise: 1 })))).status).toBe(400);
    expect((await note(inv.id, [{ taxablePaise: 1_000 }, { taxablePaise: 1_000 }])).status).toBe(400);
    expect((await note(inv.id, [{ taxablePaise: 1_000 }], { reason: "  " })).status).toBe(400);
  });
});

describe("R3 figures follow the bill's tax", () => {
  it("₹1,000.00 taxable at 3% intra: CGST and SGST 15.00 each, amount 1,030.00, no round-off", async () => {
    const inv = await invoice(await customer());
    const res = await note(inv.id, [{ taxablePaise: 100_000 }]);
    expect(res.status).toBe(201);
    const n = await created(res);
    expect(n).toMatchObject({ amountPaise: NOTE_100K, taxablePaise: 100_000, taxPaise: 3_000, roundOffPaise: 0, kind: "credit" });
    expect(n.cnNo).toMatch(/^CN-\d{4}$/);
  });

  it("the same return on an inter-state bill is IGST 30.00 in one line", async () => {
    const inv = await invoice(await customer(), { taxMode: "inter" });
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    expect(n.amountPaise).toBe(NOTE_100K);
    const stored = await one<{ calc_json: string }>("SELECT calc_json FROM credit_notes WHERE id = ?1", n.id);
    const calc = JSON.parse(stored!.calc_json) as { taxMode: string; groups: { igstPaise: number; cgstPaise: number }[] };
    expect(calc.taxMode).toBe("inter");
    expect(calc.groups[0]).toMatchObject({ igstPaise: 3_000, cgstPaise: 0 });
  });

  it("returning the whole line gives the bill's own payable (288,400) with round-off -6 paise", async () => {
    const inv = await invoice(await customer());
    const n = await created(await note(inv.id, [{ taxablePaise: 280_006 }]));
    expect(n).toMatchObject({ amountPaise: PAYABLE, roundOffPaise: -6 });
  });

  it("the stored figures are read back as saved, and a stored line cannot be changed (trigger)", async () => {
    const inv = await invoice(await customer());
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    await expect(t.db.prepare("UPDATE credit_note_lines SET taxable_paise = 1 WHERE credit_note_id = ?1").bind(n.id).run()).rejects.toThrow(/not changed/);
    await expect(t.db.prepare("UPDATE credit_notes SET amount_paise = 1 WHERE id = ?1").bind(n.id).run()).rejects.toThrow(/not changed/);
    const again = await noteOf(n.id);
    expect(again.amountPaise).toBe(NOTE_100K);
    expect(again.lines[0]!.taxablePaise).toBe(100_000);
  });
});

describe("R4 the bill's cap", () => {
  it("a credit note cannot be inserted above what the bill can still credit (trigger)", async () => {
    const inv = await invoice(await customer());
    await expect(
      t.db
        .prepare(
          `INSERT INTO credit_notes (id, created_at, created_by, updated_at, updated_by, cn_no, fy, serial, cn_date, kind, invoice_id, invoice_revision_no, customer_id, customer_name, tax_mode, reason, taxable_paise, tax_paise, total_before_round_off_paise, round_off_paise, amount_paise, calc_json)
           VALUES ('cap-1', 'x', 'x', 'x', 'x', 'CN-CAP-1', '2026-27', 9001, '2026-11-01', 'credit', ?1, 1, NULL, 'a', 'intra', 'r', 1, 0, 1, 0, 300000, '{}')`,
        )
        .bind(inv.id)
        .run(),
    ).rejects.toThrow(/exceeds_invoice/);
  });

  it("after a full return the bill cannot be credited again (the line is used up)", async () => {
    const inv = await invoice(await customer());
    expect((await note(inv.id, [{ taxablePaise: 280_006 }])).status).toBe(201);
    expect((await note(inv.id, [{ taxablePaise: 1 }])).status).toBe(400);
  });
});

describe("R5 numbering and safe retry", () => {
  it("numbers come from the CN series, one after another, and a refused save uses none", async () => {
    const inv = await invoice(await customer());
    const a = await created(await note(inv.id, [{ taxablePaise: 10_000 }]));
    expect((await note(inv.id, [{ invoiceLineNo: 9, taxablePaise: 10_000 }])).status).toBe(400);
    const b = await created(await note(inv.id, [{ taxablePaise: 10_000 }]));
    expect(Number(b.cnNo.slice(3)) - Number(a.cnNo.slice(3))).toBe(1);
  });

  it("the number follows the financial year of the credit note date", async () => {
    const inv = await invoice(await customer(), { date: "2026-03-01" });
    const n = await created(await note(inv.id, [{ taxablePaise: 10_000 }], { cnDate: "2026-03-15" }));
    const row = await one<{ fy: string }>("SELECT fy FROM credit_notes WHERE id = ?1", n.id);
    expect(row!.fy).toBe("2025-26");
  });

  it("the same id and content returns the saved note; different content is 409", async () => {
    const inv = await invoice(await customer());
    const id = "c0000000-0000-4000-8000-000000000001";
    const first = await note(inv.id, [{ taxablePaise: 100_000 }], { id });
    expect(first.status).toBe(201);
    const again = await note(inv.id, [{ taxablePaise: 100_000 }], { id });
    expect(again.status).toBe(200);
    expect(((await again.json()) as Note).cnNo).toBe((await noteOf(id)).cnNo);
    expect((await note(inv.id, [{ taxablePaise: 90_000 }], { id })).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM credit_notes WHERE id = ?1", id)).toBe(1);
  });
});

describe("R6 dates", () => {
  it("a future date and a date before the bill are refused", async () => {
    const inv = await invoice(await customer(), { date: "2026-10-10" });
    const future = await note(inv.id, [{ taxablePaise: 10_000 }], { cnDate: "2026-11-02" });
    expect(((await future.json()) as { error: string }).error).toBe("future_date");
    const early = await note(inv.id, [{ taxablePaise: 10_000 }], { cnDate: "2026-10-09" });
    expect(((await early.json()) as { error: string }).error).toBe("date_before_invoice");
  });
});

describe("R7 automatic first application", () => {
  it("applies up to the balance due and holds the rest", async () => {
    const c = await customer();
    const inv = await paidBill(c);
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    expect(n.heldPaise).toBe(NOTE_100K - 38_400);
    expect(n.applications).toHaveLength(1);
    expect(n.applications[0]).toMatchObject({ invoiceId: inv.id, amountPaise: 38_400, reversed: false });
    const after = await readInv(inv.id);
    expect(after.balanceDuePaise).toBe(0);
    expect(after.receivedPaise).toBe(PAYABLE);
  });

  it("a bill with room applies the whole credit and holds nothing", async () => {
    const inv = await invoice(await customer());
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    expect(n.heldPaise).toBe(0);
    expect((await readInv(inv.id)).balanceDuePaise).toBe(PAYABLE - NOTE_100K);
  });
});

describe("R8 exchange", () => {
  it("the credit first clears the old bill, the rest is adjusted against the new invoice of the same customer", async () => {
    const c = await customer();
    const old = await paidBill(c);
    const replacement = await invoice(c, { name: "Exchange Bill" });
    const res = await note(old.id, [{ taxablePaise: 100_000 }], { kind: "exchange", replacementInvoiceId: replacement.id });
    expect(res.status).toBe(201);
    const n = await created(res);
    expect(n.heldPaise).toBe(0);
    expect(n.applications.map((a) => [a.invoiceId, a.amountPaise])).toEqual([[old.id, 38_400], [replacement.id, NOTE_100K - 38_400]]);
    expect((await readInv(replacement.id)).balanceDuePaise).toBe(PAYABLE - (NOTE_100K - 38_400));
    expect((await readInv(old.id)).balanceDuePaise).toBe(0);
  });

  it("a replacement of another customer, the same bill, or a voided bill is refused", async () => {
    const c = await customer();
    const old = await paidBill(c);
    const stranger = await invoice(await customer());
    expect(((await (await note(old.id, [{ taxablePaise: 100_000 }], { kind: "exchange", replacementInvoiceId: stranger.id })).json()) as { error: string }).error).toBe("bad_replacement");
    expect(((await (await note(old.id, [{ taxablePaise: 100_000 }], { kind: "exchange", replacementInvoiceId: old.id })).json()) as { error: string }).error).toBe("bad_replacement");
    const voidedNew = await invoice(c);
    await call(`/api/invoices/${voidedNew.id}/void`, { method: "POST", body: { reason: "Wrong bill" } });
    expect(((await (await note(old.id, [{ taxablePaise: 100_000 }], { kind: "exchange", replacementInvoiceId: voidedNew.id })).json()) as { error: string }).error).toBe("bad_replacement");
  });
});

describe("R9 old gold adjustment", () => {
  /** A receipt of exactly ₹1,030.00: 1.000 g at 99.90%, rate chosen so the amount rounds to the rupee. */
  const goldRate = Math.round((NOTE_100K * 1e10) / (1_000 * 9_990));

  it("links an invoice-adjustment receipt of the same amount, creates no application, and a receipt links once", async () => {
    const c = await customer();
    const inv = await invoice(c);
    const og = await call("/api/old-gold", {
      method: "POST",
      body: { date: "2026-11-01", customerId: c, treatment: "invoice_adjustment", invoiceId: inv.id, rows: [{ description: "Old Gold", grossMg: 1_000, lessMg: 0, karat: "24K", purityBps: 9_990, rateKgPaise: goldRate }] },
    });
    expect(og.status).toBe(201);
    const ogp = (await og.json()) as { id: string; finalPaise: number };
    expect(ogp.finalPaise).toBe(NOTE_100K);
    const res = await note(inv.id, [{ taxablePaise: 100_000 }], { kind: "old_gold", ogpId: ogp.id });
    expect(res.status).toBe(201);
    const n = await created(res);
    expect(n.applications).toHaveLength(0);
    expect(n.heldPaise).toBe(0);
    expect(n.ogpId).toBe(ogp.id);
    expect((await note(inv.id, [{ taxablePaise: 100_000 }], { kind: "old_gold", ogpId: ogp.id })).status).toBe(409);
  });

  it("a receipt of another amount, or one not for this bill, is refused", async () => {
    const c = await customer();
    const inv = await invoice(c);
    const og = (await (await call("/api/old-gold", {
      method: "POST",
      body: { date: "2026-11-01", customerId: c, treatment: "invoice_adjustment", invoiceId: inv.id, rows: [{ description: "Old Gold", grossMg: 1_000, lessMg: 0, karat: "24K", purityBps: 9_990, rateKgPaise: goldRate }] },
    })).json()) as { id: string };
    const wrongAmount = await note(inv.id, [{ taxablePaise: 50_000 }], { kind: "old_gold", ogpId: og.id });
    expect(wrongAmount.status).toBe(400);
    expect(((await wrongAmount.json()) as { error: string }).error).toBe("old_gold_amount");
    const other = await invoice(c);
    const notThisBill = await note(other.id, [{ taxablePaise: 100_000 }], { kind: "old_gold", ogpId: og.id });
    expect(((await notThisBill.json()) as { error: string }).error).toBe("bad_old_gold");
  });
});

describe("R10 walk-in bills", () => {
  it("a walk-in bill credited in full is fine", async () => {
    const inv = await invoice(null, { name: "Walk In" });
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    expect(n.customerId).toBeNull();
    expect(n.heldPaise).toBe(0);
  });

  it("a walk-in credit that would be held (the bill was paid) is refused", async () => {
    const inv = await invoice(null, { name: "Walk In Paid" });
    expect((await atSale(inv, 250_000)).status).toBe(201);
    const res = await note(inv.id, [{ taxablePaise: 100_000 }]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("walk_in_credit");
  });
});

describe("R11 applying held credit", () => {
  it("applies to another bill of the same customer, never above held or above that bill's due", async () => {
    const c = await customer();
    const old = await paidBill(c);
    const n = await created(await note(old.id, [{ taxablePaise: 100_000 }]));
    expect(n.heldPaise).toBe(64_600);
    const next = await invoice(c, { name: "Next Bill" });
    expect((await call(`/api/credit-notes/${n.id}/apply`, { method: "POST", body: { invoiceId: next.id, amountPaise: 70_000 } })).status).toBe(400);
    const small = await paidBill(c, 250_000);
    expect((await call(`/api/credit-notes/${n.id}/apply`, { method: "POST", body: { invoiceId: small.id, amountPaise: 50_000 } })).status).toBe(409);
    const ok = await call(`/api/credit-notes/${n.id}/apply`, { method: "POST", body: { invoiceId: next.id, amountPaise: 64_600 } });
    expect(ok.status).toBe(201);
    expect((await noteOf(n.id)).heldPaise).toBe(0);
    expect((await readInv(next.id)).balanceDuePaise).toBe(PAYABLE - 64_600);
  });

  it("another customer's bill is refused, and a voided note cannot be applied", async () => {
    const c = await customer();
    const n = await created(await note((await paidBill(c)).id, [{ taxablePaise: 100_000 }]));
    const stranger = await invoice(await customer());
    expect(((await (await call(`/api/credit-notes/${n.id}/apply`, { method: "POST", body: { invoiceId: stranger.id, amountPaise: 1_000 } })).json()) as { error: string }).error).toBe("other_customer");
  });
});

describe("R12 payouts", () => {
  it("pays back at most the held credit, in a payout mode; reversal gives it back; a second reversal is 409", async () => {
    const c = await customer();
    const n = await created(await note((await paidBill(c)).id, [{ taxablePaise: 100_000 }]));
    expect(n.heldPaise).toBe(64_600);
    expect((await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: 70_000, mode: "cash", paidDate: "2026-11-01" } })).status).toBe(400);
    expect((await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: 1_000, mode: "card", paidDate: "2026-11-01" } })).status).toBe(400);
    const pay1 = await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: 20_000, mode: "cash", paidDate: "2026-11-01" } });
    expect(pay1.status).toBe(201);
    const after = (await pay1.json()) as Note;
    expect(after.heldPaise).toBe(44_600);
    const payoutId = after.payouts[0]!.id;
    expect((await call(`/api/credit-notes/payouts/${payoutId}/reverse`, { method: "POST", body: { reason: "Entered by mistake" } })).status).toBe(200);
    expect((await noteOf(n.id)).heldPaise).toBe(64_600);
    expect((await call(`/api/credit-notes/payouts/${payoutId}/reverse`, { method: "POST", body: { reason: "Again" } })).status).toBe(409);
  });

  it("a payout is not money received: the bill's balance does not move", async () => {
    const c = await customer();
    const old = await paidBill(c);
    const n = await created(await note(old.id, [{ taxablePaise: 100_000 }]));
    const before = (await readInv(old.id)).balanceDuePaise;
    await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: 10_000, mode: "upi", reference: "UPI-REF-1", paidDate: "2026-11-01" } });
    expect((await readInv(old.id)).balanceDuePaise).toBe(before);
  });

  it("a walk-in credit has no customer to pay back", async () => {
    const inv = await invoice(null, { name: "Walk In Payout" });
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    expect((await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: 1, mode: "cash", paidDate: "2026-11-01" } })).status).toBe(400);
  });
});

describe("R13 reversing an application", () => {
  it("gives the bill its due back and the note its credit back; a second reverse is 409", async () => {
    const inv = await invoice(await customer());
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    const appId = n.applications[0]!.id;
    expect((await readInv(inv.id)).balanceDuePaise).toBe(PAYABLE - NOTE_100K);
    expect((await call(`/api/credit-notes/applications/${appId}/reverse`, { method: "POST", body: { reason: "Wrong bill" } })).status).toBe(200);
    expect((await readInv(inv.id)).balanceDuePaise).toBe(PAYABLE);
    expect((await noteOf(n.id)).heldPaise).toBe(NOTE_100K);
    expect((await call(`/api/credit-notes/applications/${appId}/reverse`, { method: "POST", body: { reason: "Again" } })).status).toBe(409);
  });
});

describe("R14 void", () => {
  it("is refused while a payout is live; after the payout is reversed it reverses the applications, keeps the number, and cannot be repeated", async () => {
    const c = await customer();
    const old = await paidBill(c);
    const n = await created(await note(old.id, [{ taxablePaise: 100_000 }]));
    await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: 10_000, mode: "cash", paidDate: "2026-11-01" } });
    const refused = await call(`/api/credit-notes/${n.id}/void`, { method: "POST", body: { reason: "Customer changed mind" } });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("has_payouts");
    await call(`/api/credit-notes/payouts/${(await noteOf(n.id)).payouts[0]!.id}/reverse`, { method: "POST", body: { reason: "Undo" } });
    const voided = await call(`/api/credit-notes/${n.id}/void`, { method: "POST", body: { reason: "Customer changed mind" } });
    expect(voided.status).toBe(200);
    const v = (await voided.json()) as Note;
    expect(v).toMatchObject({ voided: true, cnNo: n.cnNo, heldPaise: 0 });
    expect(v.applications.every((a) => a.reversed)).toBe(true);
    expect((await readInv(old.id)).balanceDuePaise).toBe(38_400);
    expect((await call(`/api/credit-notes/${n.id}/void`, { method: "POST", body: { reason: "Again" } })).status).toBe(409);
    expect((await call(`/api/credit-notes/${n.id}/apply`, { method: "POST", body: { invoiceId: old.id, amountPaise: 1 } })).status).toBe(409);
  });

  it("an old gold receipt linked to a live note cannot be voided, and can be after the note is voided", async () => {
    const c = await customer();
    const inv = await invoice(c);
    const goldRate = Math.round((NOTE_100K * 1e10) / (1_000 * 9_990));
    const og = (await (await call("/api/old-gold", {
      method: "POST",
      body: { date: "2026-11-01", customerId: c, treatment: "invoice_adjustment", invoiceId: inv.id, rows: [{ description: "Old Gold", grossMg: 1_000, lessMg: 0, karat: "24K", purityBps: 9_990, rateKgPaise: goldRate }] },
    })).json()) as { id: string };
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }], { kind: "old_gold", ogpId: og.id }));
    const blocked = await call(`/api/old-gold/${og.id}/void`, { method: "POST", body: { reason: "Wrong receipt" } });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toBe("linked_to_credit_note");
    expect((await call(`/api/credit-notes/${n.id}/void`, { method: "POST", body: { reason: "Not needed" } })).status).toBe(200);
    expect((await call(`/api/old-gold/${og.id}/void`, { method: "POST", body: { reason: "Wrong receipt" } })).status).toBe(200);
  });
});

describe("R15 the bill's own changes", () => {
  it("a bill with a live credit note cannot be voided; an edit cannot go below the credit", async () => {
    const inv = await invoice(await customer());
    await note(inv.id, [{ taxablePaise: 100_000 }]);
    const voidRes = await call(`/api/invoices/${inv.id}/void`, { method: "POST", body: { reason: "Mistake" } });
    expect(voidRes.status).toBe(409);
    expect(((await voidRes.json()) as { error: string }).error).toBe("has_credit_notes");
    const edit = (netMg: number) =>
      call(`/api/invoices/${inv.id}`, {
        method: "PUT",
        body: {
          invoiceDate: "2026-10-01", customerName: "Return Bill", taxMode: "intra", expectedRevision: 1, reason: "Weight typed wrong",
          lines: [{ description: "Silver chain", purity: "silver", hsn: "7113", grossWeightMg: netMg, netWeightMg: netMg, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }],
        },
      });
    expect((await edit(1_000)).status).toBe(409);
    const up = await edit(19_600);
    expect(up.status).toBe(200);
    expect(((await up.json()) as InvoiceResponse).payablePaise).toBeGreaterThan(NOTE_100K);
  });
});

describe("R16 the bill's balance and the payment list", () => {
  it("the list and the bill show the reduced due, and a payment on account skips a fully credited bill", async () => {
    const c = await customer();
    const credited = await invoice(c);
    await note(credited.id, [{ taxablePaise: 280_006 }]);
    const open = await invoice(c, { name: "Open Bill" });
    const list = (await (await call(`/api/invoices?q=${encodeURIComponent(credited.invoiceNo)}`)).json()) as { items: { id: string; balanceDuePaise: number }[] };
    expect(list.items.find((i) => i.id === credited.id)!.balanceDuePaise).toBe(0);
    const res = await saved(await pay({ customerId: c, purpose: "against_invoices", amountPaise: 50_000 }));
    expect(res.payment.allocations.map((a) => a.invoiceNo)).toEqual([open.invoiceNo]);
  });

  it("the trigger refuses an allocation above what the bill still owes after credit", async () => {
    const c = await customer();
    const inv = await invoice(c);
    await note(inv.id, [{ taxablePaise: 100_000 }]);
    const res = await pay({ customerId: c, purpose: "against_invoices", allocation: [{ invoiceId: inv.id, amountPaise: PAYABLE - NOTE_100K + 1 }], amountPaise: PAYABLE - NOTE_100K + 1 });
    expect(res.status).toBe(409);
  });
});

describe("R17 settlement page", () => {
  it("shows the credit line, the balance due, and the sentence for the held credit", async () => {
    const c = await customer();
    const inv = await paidBill(c);
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    const s = await settlementOf(inv.id);
    expect(s.creditLines).toEqual([{ applicationId: n.applications[0]!.id, creditNoteId: n.id, creditNoteNo: n.cnNo, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), amountPaise: 38_400 }]);
    expect(s.receivedPaise).toBe(PAYABLE);
    expect(s.balanceDuePaise).toBe(0);
    expect(s.autoNote.at(-1)).toBe(`Credit note ${n.cnNo} applied: ${formatMoney(38_400)}. Credit still held in ${n.cnNo}: ${formatMoney(64_600)}.`);
  });
});

describe("R18 ledger", () => {
  it("the scenario: bill 2,884.00, paid 2,500.00, credit 1,030.00 (applied 384.00, held 646.00), payout 100.00", async () => {
    const c = await customer();
    const inv = await paidBill(c);
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: 10_000, mode: "cash", paidDate: "2026-11-01" } });
    const l = await ledgerOf(c);
    expect(l.outstandingPaise).toBe(0);
    expect(l.creditHeldPaise).toBe(54_600);
    expect(l.netPaise).toBe(-54_600);
    expect(l.entries.at(-1)).toMatchObject({ outstandingAfterPaise: 0, creditAfterPaise: 54_600 });
    expect(l.entries.map((e) => e.type)).toEqual(expect.arrayContaining(["Credit note", "Credit applied", "Credit paid out"]));
  });

  it("voiding the note brings the bill's due back and clears the held credit", async () => {
    const c = await customer();
    const inv = await paidBill(c);
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    await call(`/api/credit-notes/${n.id}/void`, { method: "POST", body: { reason: "Not returned after all" } });
    const l = await ledgerOf(c);
    expect(l.outstandingPaise).toBe(38_400);
    expect(l.creditHeldPaise).toBe(0);
    expect(l.entries.at(-1)).toMatchObject({ outstandingAfterPaise: 38_400, creditAfterPaise: 0 });
  });

  it("random sequences of returns, applications, payouts, reversals and voids always reconcile", async () => {
    let seed = 20261101;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 12; round++) {
      const c = await customer(`Random ${round}`);
      const bills = [await invoice(c, { name: "Random Bill" }), await invoice(c, { name: "Random Bill" })];
      const notes: string[] = [];
      for (let step = 0; step < 10; step++) {
        const op = rand(6);
        const bill = bills[rand(bills.length)]!;
        if (op === 0) await atSale(bill, 1_000 * (1 + rand(60)), c);
        if (op === 1) {
          const res = await note(bill.id, [{ taxablePaise: 1_000 * (1 + rand(40)) }]);
          if (res.status === 201) notes.push(((await res.json()) as Note).id);
        }
        if (op === 2 && notes.length) {
          const n = await noteOf(notes[rand(notes.length)]!);
          if (n.heldPaise > 0) await call(`/api/credit-notes/${n.id}/apply`, { method: "POST", body: { invoiceId: bill.id, amountPaise: Math.min(n.heldPaise, 100 * (1 + rand(3000))) } });
        }
        if (op === 3 && notes.length) {
          const n = await noteOf(notes[rand(notes.length)]!);
          if (n.heldPaise > 0) await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: Math.min(n.heldPaise, 100 * (1 + rand(50))), mode: "cash", paidDate: "2026-11-01" } });
        }
        if (op === 4 && notes.length) {
          const n = await noteOf(notes[rand(notes.length)]!);
          const live = n.applications.find((a) => !a.reversed);
          if (live) await call(`/api/credit-notes/applications/${live.id}/reverse`, { method: "POST", body: { reason: "Random" } });
        }
        if (op === 5 && notes.length) {
          const n = await noteOf(notes[rand(notes.length)]!);
          if (!n.voided) await call(`/api/credit-notes/${n.id}/void`, { method: "POST", body: { reason: "Random" } });
        }
      }
      const l = await ledgerOf(c);
      let due = 0;
      for (const b of bills) due += (await readInv(b.id)).balanceDuePaise;
      let held = 0;
      for (const id of notes) held += (await noteOf(id)).heldPaise;
      expect(l.outstandingPaise).toBe(due);
      expect(l.creditHeldPaise).toBe(held);
      if (l.entries.length) {
        expect(l.entries.at(-1)).toMatchObject({ outstandingAfterPaise: l.outstandingPaise, creditAfterPaise: l.creditHeldPaise });
      }
      for (const b of bills) {
        const i = await readInv(b.id);
        expect(i.balanceDuePaise).toBeGreaterThanOrEqual(0);
        expect(i.receivedPaise + i.balanceDuePaise).toBe(i.payablePaise);
      }
    }
  });
});

describe("R19 stock is deferred", () => {
  it("returned lines carry no inventory item and no stock movement is made", async () => {
    const inv = await invoice(await customer());
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    const row = await one<{ inventory_item_id: string | null }>("SELECT inventory_item_id FROM credit_note_lines WHERE credit_note_id = ?1", n.id);
    expect(row!.inventory_item_id).toBeNull();
  });
});

describe("R20 lists and reading", () => {
  it("search by number, customer name and bill number; filters; paging; reading writes nothing", async () => {
    const c = await customer("Searchable Shopper");
    const inv = await invoice(c, { name: "Searchable Bill" });
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    const byNo = (await (await call(`/api/credit-notes?q=${n.cnNo}`)).json()) as { items: { id: string }[] };
    expect(byNo.items.map((i) => i.id)).toEqual([n.id]);
    // The note keeps the name as billed (spec 013 R5), so the search reads that copy.
    const byName = (await (await call("/api/credit-notes?q=Searchable%20Bill")).json()) as { items: { id: string }[] };
    expect(byName.items.some((i) => i.id === n.id)).toBe(true);
    const byBill = (await (await call(`/api/credit-notes?q=${inv.invoiceNo}`)).json()) as { items: { id: string }[] };
    expect(byBill.items.some((i) => i.id === n.id)).toBe(true);
    const live = (await (await call(`/api/credit-notes?invoiceId=${inv.id}&status=live&kind=credit`)).json()) as { items: { id: string }[] };
    expect(live.items.map((i) => i.id)).toEqual([n.id]);
    const before = await count("SELECT COUNT(*) AS n FROM audit_log");
    await call(`/api/credit-notes/${n.id}`);
    await call("/api/credit-notes");
    expect(await count("SELECT COUNT(*) AS n FROM audit_log")).toBe(before);
  });

  it("paging returns each note once", async () => {
    const c = await customer("Paged Shopper");
    const inv = await invoice(c, { name: "Paged Bill" });
    for (let i = 0; i < 3; i++) await note(inv.id, [{ taxablePaise: 1_000 }]);
    const first = (await (await call(`/api/credit-notes?invoiceId=${inv.id}&limit=2`)).json()) as { items: { id: string }[]; nextCursor: string | null };
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeNull();
  });
});

describe("R21 permissions", () => {
  it("staff can apply credit but cannot create, pay out or void; a viewer reads only", async () => {
    const c = await customer();
    const n = await created(await note((await paidBill(c)).id, [{ taxablePaise: 100_000 }]));
    expect((await note((await invoice(c)).id, [{ taxablePaise: 1_000 }], {}, "staff1")).status).toBe(403);
    expect((await call(`/api/credit-notes/${n.id}/payouts`, { method: "POST", body: { amountPaise: 1, mode: "cash", paidDate: "2026-11-01" }, as: "staff1" })).status).toBe(403);
    expect((await call(`/api/credit-notes/${n.id}/void`, { method: "POST", body: { reason: "x" }, as: "staff1" })).status).toBe(403);
    expect((await call(`/api/credit-notes/${n.id}`, { as: "viewer1" })).status).toBe(200);
    expect((await note((await invoice(c)).id, [{ taxablePaise: 1_000 }], {}, "viewer1")).status).toBe(403);
    expect((await call("/api/credit-notes", { as: "viewer1" })).status).toBe(200);
    const next = await invoice(c, { name: "Staff Apply" });
    expect((await call(`/api/credit-notes/${n.id}/apply`, { method: "POST", body: { invoiceId: next.id, amountPaise: 1_000 }, as: "staff1" })).status).toBe(201);
  });

  it("a logged out request is refused", async () => {
    const res = await app.request("/api/credit-notes", {}, { DB: t.db });
    expect(res.status).toBe(401);
  });
});

describe("R22 audit", () => {
  it("each change writes one audit row with its action", async () => {
    const inv = await invoice(await customer());
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    await call(`/api/credit-notes/${n.id}/void`, { method: "POST", body: { reason: "Audit check" } });
    const actions = (await t.db.prepare("SELECT action FROM audit_log WHERE entity_id = ?1 ORDER BY at").bind(n.id).all<{ action: string }>()).results.map((r) => r.action);
    expect(actions).toEqual(["credit_note_create", "credit_note_void"]);
  });
});

describe("R23 nothing is deleted", () => {
  it("DELETE fails on every new table", async () => {
    const inv = await invoice(await customer());
    const n = await created(await note(inv.id, [{ taxablePaise: 100_000 }]));
    await expect(t.db.prepare("DELETE FROM credit_notes WHERE id = ?1").bind(n.id).run()).rejects.toThrow(/never deleted/);
    await expect(t.db.prepare("DELETE FROM credit_note_lines WHERE credit_note_id = ?1").bind(n.id).run()).rejects.toThrow(/never deleted/);
    await expect(t.db.prepare("DELETE FROM credit_applications WHERE credit_note_id = ?1").bind(n.id).run()).rejects.toThrow(/never deleted/);
  });
});
