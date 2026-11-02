import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS, type CashClosingDayResponse, type CashClosingListResponse, type CashClosingSaveResponse, type CashNoteSaveResponse, type PaymentSaveResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

// Spec 032: daily cash closing. One test per rule. The tests share one database and run in order.
// Money is in paise: 1,000.00 rupees = 100,000 paise.
let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-02T10:00:00.000Z"); // India: 2 Nov 2026, 15:30
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
const one = async <T>(sql: string, ...args: unknown[]) => t.db.prepare(sql).bind(...args).first<T>();
const count = async (sql: string, ...args: unknown[]) => (await one<{ n: number }>(sql, ...args))!.n;

async function person(username: string, role: string) {
  await t.db
    .prepare(
      `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name, must_change_password, disabled_at)
       VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', ?2, ?3, ?4, ?5, 0, NULL)`,
    )
    .bind(`u-${username}`, username, await hashPassword(PASSWORD, 1000), role, `Person ${username}`)
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  if (res.status === 200) cookies[username] = res.headers.get("set-cookie")!.split(";")[0]!;
}

beforeAll(async () => {
  t = await createTestDb();
  await person("owner", "owner");
  await person("manager1", "manager");
  await person("staff1", "staff");
  await person("viewer1", "viewer");
});
afterAll(() => t.dispose());

const day = async (date: string, as = "owner") => (await (await call(`/api/cash-closing?date=${date}`, { as })).json()) as CashClosingDayResponse;
const close = (body: Record<string, unknown>, as = "owner") => call("/api/cash-closing", { method: "POST", body, as });

let custN = 0;
async function customer() {
  const res = await call("/api/customers", { method: "POST", body: { name: `Cash Customer ${++custN}` } });
  return ((await res.json()) as { customer: { id: string } }).customer.id;
}
/** A payment on account (purpose advance) in `mode`, dated `date`. Returns the payment id. */
async function receive(date: string, mode: string, amountPaise: number, customerId: string) {
  const res = await call("/api/payments", {
    method: "POST",
    body: { date, mode, reference: mode === "cash" ? undefined : `REF-${mode}-${++custN}`, customerId, purpose: "advance", amountPaise },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as PaymentSaveResponse).payment.id;
}

describe("the expected cash of a day (spec 032 C3 to C5)", () => {
  // 1 Nov 2026: a cash bill (2,500.00), a cash advance (100.00), a cash refund (20.00), a cash credit payout (200.00),
  // and UPI, card and bank transfer money that must not count.
  it("counts cash receipts, cash refunds and cash credit payouts, and nothing in other modes", async () => {
    const c = await customer();
    const bill = (await (
      await call("/api/invoices", {
        method: "POST",
        body: {
          invoiceDate: "2026-10-01",
          customerId: c,
          customerName: "Cash Bill",
          taxMode: "intra",
          lines: [{ description: "Silver chain", purity: "silver", hsn: "7113", grossWeightMg: 9800, netWeightMg: 9800, polishMg: 0, goldRatePaisePerKg: 28_572_000, labourRatePaisePerKg: 0, gstRateBps: 300 }],
        },
      })
    ).json()) as { id: string };
    const atSale = await call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "cash", customerId: c, invoiceId: bill.id, purpose: "at_sale", amountPaise: 250_000 } });
    expect(atSale.status).toBe(201);
    const advance = await receive("2026-11-01", "cash", 10_000, c);
    await receive("2026-11-01", "upi", 5_000, c);
    await receive("2026-11-01", "card", 3_000, c);
    await receive("2026-11-01", "bank_transfer", 4_000, c);
    expect((await call(`/api/payments/${advance}/refunds`, { method: "POST", body: { amountPaise: 2_000, mode: "cash", date: "2026-11-01" } })).status).toBe(201);
    const cn = (await (await call("/api/credit-notes", { method: "POST", body: { invoiceId: bill.id, cnDate: "2026-11-01", kind: "credit", lines: [{ invoiceLineNo: 1, taxablePaise: 100_000 }], reason: "Returned in good condition" } })).json()) as { id: string };
    expect((await call(`/api/credit-notes/${cn.id}/payouts`, { method: "POST", body: { amountPaise: 20_000, mode: "cash", paidDate: "2026-11-01" } })).status).toBe(201);

    const d = await day("2026-11-01");
    expect(d.opening).toEqual({ paise: 0, source: "typed", fromDate: null });
    expect(d.totals).toMatchObject({ receiptsPaise: 260_000, receiptsCount: 2, refundsPaise: 2_000, refundsCount: 1, creditPayoutsPaise: 20_000, creditPayoutsCount: 1, oldGoldPayoutsPaise: 0, netPaise: 238_000 });
    expect(d.movements.map((m) => m.kind).sort()).toEqual(["credit_payout", "receipt", "receipt", "refund"]);
    expect(d.movements.every((m) => m.date === "2026-11-01")).toBe(true);
    expect(d.closing).toBeNull();
    expect(d.expectedPaise).toBeNull(); // the first closing types its opening cash first
  });

  it("a day with only UPI, card and bank transfer money has no cash movement (C5)", async () => {
    const c = await customer();
    for (const mode of ["upi", "card", "bank_transfer"]) await receive("2026-11-02", mode, 3_000, c);
    const d = await day("2026-11-02");
    expect(d.totals.netPaise).toBe(0);
    expect(d.movements).toEqual([]);
  });

  it("a voided cash receipt does not count", async () => {
    const c = await customer();
    const id = await receive("2026-11-02", "cash", 7_000, c);
    expect((await day("2026-11-02")).totals.netPaise).toBe(7_000);
    expect((await call(`/api/payments/${id}/void`, { method: "POST", body: { reason: "Entered twice" } })).status).toBe(200);
    expect((await day("2026-11-02")).totals.netPaise).toBe(0);
  });

  it("a reversed cash refund does not count", async () => {
    const c = await customer();
    const id = await receive("2026-11-02", "cash", 4_000, c);
    expect((await call(`/api/payments/${id}/refunds`, { method: "POST", body: { amountPaise: 1_000, mode: "cash", date: "2026-11-02" } })).status).toBe(201);
    const refundId = (await one<{ id: string }>("SELECT id FROM payment_refunds WHERE payment_id = ?1", id))!.id;
    expect((await day("2026-11-02")).totals.refundsPaise).toBe(1_000);
    expect((await call(`/api/refunds/${refundId}/reverse`, { method: "POST", body: { reason: "Undo" } })).status).toBe(200);
    expect((await day("2026-11-02")).totals.refundsPaise).toBe(0);
  });
});

describe("closing a day (spec 032 C6 to C9)", () => {
  it("the first closing types the opening cash; the difference is counted minus expected; a difference needs a reason", async () => {
    // Expected for 1 Nov: opening 2,000.00 (typed) + net 2,380.00 = 4,380.00 (paise: 200,000 + 238,000 = 438,000).
    // The drawer holds 4,350.00 (435,000 paise): the difference is -3,000 paise and needs a reason.
    expect((await close({ date: "2026-11-01", openingPaise: 200_000, countedPaise: 435_000 })).status).toBe(400);
    const missing = await close({ date: "2026-11-01", openingPaise: 200_000, countedPaise: 435_000 });
    expect(await missing.json()).toMatchObject({ error: "validation", issues: [{ field: "reason" }] });
    const res = await close({ date: "2026-11-01", openingPaise: 200_000, countedPaise: 435_000, reason: "Short, counted twice" });
    expect(res.status).toBe(201);
    const { closing } = (await res.json()) as CashClosingSaveResponse;
    expect(closing).toMatchObject({ date: "2026-11-01", openingPaise: 200_000, expectedPaise: 438_000, countedPaise: 435_000, differencePaise: -3_000, reason: "Short, counted twice" });
    expect(closing.totals.netPaise).toBe(238_000);
    expect(closing.closedBy).toBe("Person owner");
  });

  it("a day that agrees needs no reason; the next day opens with the last count (C8)", async () => {
    // 2 Nov opens with 1 Nov's count (4,350.00). Today's only cash movement is the 40.00 receipt (the voided and reversed rows net to zero).
    const d = await day("2026-11-02");
    expect(d.opening).toEqual({ paise: 435_000, source: "carried", fromDate: "2026-11-01" });
    expect(d.totals.netPaise).toBe(4_000);
    expect(d.expectedPaise).toBe(439_000);
    expect(d.canClose).toBe(true);
    const res = await close({ date: "2026-11-02", countedPaise: 439_000 });
    expect(res.status).toBe(201);
    expect(((await res.json()) as CashClosingSaveResponse).closing).toMatchObject({ openingPaise: 435_000, expectedPaise: 439_000, differencePaise: 0 });
  });

  it("one closing per date: a second close is refused and writes nothing (C6)", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM cash_closings WHERE business_date = '2026-11-02'");
    const again = await close({ date: "2026-11-02", countedPaise: 439_000 });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "already_closed" });
    expect(await count("SELECT COUNT(*) AS n FROM cash_closings WHERE business_date = '2026-11-02'")).toBe(before);
  });

  it("the counted amount is a whole, non-negative number of paise", async () => {
    expect((await close({ date: "2026-11-05", countedPaise: -1 })).status).toBe(400);
    expect((await close({ date: "2026-11-05", countedPaise: 1.5 })).status).toBe(400);
    expect((await close({ date: "2026-11-05" })).status).toBe(400);
  });

  it("a day that has not ended cannot be closed (no future dates)", async () => {
    const res = await close({ date: "2026-11-03", countedPaise: 0 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "date_in_future" });
    expect((await day("2026-11-03")).canClose).toBe(false);
  });

  it("only the first closing takes an opening; later closings carry the last count (C8)", async () => {
    nowMs = Date.parse("2026-11-05T10:00:00.000Z");
    const res = await close({ date: "2026-11-05", openingPaise: 1_000, countedPaise: 439_000 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues: { field: string }[] }).issues[0]!.field).toBe("openingPaise");
  });

  it("the same id and figures is a safe retry that returns the first close", async () => {
    const id = "00000000-0000-4000-8000-000000000032";
    const first = await close({ id, date: "2026-11-05", countedPaise: 439_000 });
    expect(first.status).toBe(201);
    const retry = await close({ id, date: "2026-11-05", countedPaise: 439_000 });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as CashClosingSaveResponse).closing.id).toBe(id);
    expect(await count("SELECT COUNT(*) AS n FROM cash_closings WHERE business_date = '2026-11-05'")).toBe(1);
  });
});

describe("a closed day is not editable (spec 032 C10, C11)", () => {
  it("there is no route that changes a closing, and the table refuses an update or a delete", async () => {
    expect((await call("/api/cash-closing?date=2026-11-02", { method: "PUT", body: { countedPaise: 1 } })).status).toBe(404);
    expect((await call("/api/cash-closing/2026-11-02", { method: "PATCH", body: { countedPaise: 1 } })).status).toBe(404);
    await expect(t.db.prepare("UPDATE cash_closings SET counted_paise = 1 WHERE business_date = '2026-11-02'").run()).rejects.toThrow();
    await expect(t.db.prepare("DELETE FROM cash_closings WHERE business_date = '2026-11-02'").run()).rejects.toThrow();
    expect(await one<{ counted_paise: number }>("SELECT counted_paise FROM cash_closings WHERE business_date = '2026-11-02'")).toEqual({ counted_paise: 439_000 });
  });

  it("a cash entry dated on a closed day after the close does not change the saved closing; the day shows the change", async () => {
    const c = await customer();
    await receive("2026-11-01", "cash", 1_000, c); // after the 1 Nov closing
    const d = await day("2026-11-01");
    expect(d.closing).toMatchObject({ expectedPaise: 438_000, countedPaise: 435_000 });
    expect(d.currentExpectedPaise).toBe(439_000); // the saved expected stays 438,000; today's figure includes the new 1,000
  });

  it("a correction is a dated note on the closed day; a note on an open day is refused (C11)", async () => {
    const open = await call("/api/cash-closing/2026-10-30/notes", { method: "POST", body: { note: "Wrong day" } });
    expect(open.status).toBe(409);
    expect(await open.json()).toMatchObject({ error: "day_not_closed" });
    const res = await call("/api/cash-closing/2026-11-01/notes", { method: "POST", body: { note: "A 1,000.00 cash receipt was dated 1 Nov after the count" } });
    expect(res.status).toBe(201);
    const note = (await res.json()) as CashNoteSaveResponse;
    expect(note.note).toMatchObject({ date: "2026-11-01", createdBy: "Person owner" });
    expect((await day("2026-11-01")).notes.map((n) => n.note)).toEqual(["A 1,000.00 cash receipt was dated 1 Nov after the count"]);
    expect((await call("/api/cash-closing/2026-11-01/notes", { method: "POST", body: { note: "   " } })).status).toBe(400);
  });

  it("the database refuses a correction for a day that is not closed", async () => {
    await expect(
      t.db.prepare("INSERT INTO cash_closing_notes (id, business_date, note, created_at, created_by, updated_at, updated_by) VALUES ('n-x', '2026-10-30', 'x', 'now', 'x', 'now', 'x')").run(),
    ).rejects.toThrow();
  });
});

describe("days close in order (spec 032 C12, C13)", () => {
  it("a day before the last closing cannot be closed", async () => {
    const res = await close({ date: "2026-10-31", countedPaise: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "date_before_last_closing", lastClosedDate: "2026-11-05" });
  });

  it("a day with cash activity that is not closed blocks the later day until it is closed", async () => {
    nowMs = Date.parse("2026-11-07T10:00:00.000Z"); // India: 7 Nov
    const c = await customer();
    await receive("2026-11-06", "cash", 6_000, c); // activity on 6 Nov, not closed yet
    const later = await day("2026-11-07");
    expect(later.blockedByDate).toBe("2026-11-06");
    expect(later.canClose).toBe(false);
    expect(later.expectedPaise).toBeNull(); // not shown while 6 Nov is open
    const res = await close({ date: "2026-11-07", countedPaise: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "earlier_day_open", blockedByDate: "2026-11-06" });

    // 6 Nov opens with the 5 Nov count (4,390.00 paise: 439,000) and closes with its 60.00 of cash.
    const six = await day("2026-11-06");
    expect(six.opening).toEqual({ paise: 439_000, source: "carried", fromDate: "2026-11-05" });
    expect((await close({ date: "2026-11-06", countedPaise: six.expectedPaise! })).status).toBe(201);
    const after = await day("2026-11-07");
    expect(after.blockedByDate).toBeNull();
    expect(after.opening).toEqual({ paise: six.expectedPaise!, source: "carried", fromDate: "2026-11-06" });
    expect((await close({ date: "2026-11-07", countedPaise: after.expectedPaise! })).status).toBe(201);
  });
});

describe("the list and who can close (spec 032 C14, C15)", () => {
  it("the list shows the closings newest first with their correction notes", async () => {
    const body = (await (await call("/api/cash-closing/list", { as: "staff1" })).json()) as CashClosingListResponse;
    expect(body.items.map((r) => r.date)).toEqual(["2026-11-07", "2026-11-06", "2026-11-05", "2026-11-02", "2026-11-01"]);
    expect(body.items.find((r) => r.date === "2026-11-01")!.noteCount).toBe(1);
    expect(body.nextCursor).toBeNull();
  });

  it("owner and manager can close; staff and view-only cannot, but staff and view-only can read (C15)", async () => {
    nowMs = Date.parse("2026-11-09T10:00:00.000Z");
    const staffClose = await close({ date: "2026-11-08", countedPaise: 0 }, "staff1");
    expect(staffClose.status).toBe(403);
    expect(await staffClose.json()).toMatchObject({ error: "forbidden", permission: "cash.close" });
    expect((await close({ date: "2026-11-08", countedPaise: 0 }, "viewer1")).status).toBe(403);
    expect((await call("/api/cash-closing?date=2026-11-08", { as: "staff1" })).status).toBe(200);
    expect((await call("/api/cash-closing/list", { as: "viewer1" })).status).toBe(200);
    const eight = await day("2026-11-08", "manager1");
    expect((await close({ date: "2026-11-08", countedPaise: eight.expectedPaise! }, "manager1")).status).toBe(201);
  });

  it("the default roles: owner and manager hold cash.close; manager and view-only do not hold audit.view (migration 0022)", async () => {
    const rows = (await t.db.prepare("SELECT name, permissions_json FROM roles").all<{ name: string; permissions_json: string }>()).results;
    const perms = Object.fromEntries(rows.map((r) => [r.name, JSON.parse(r.permissions_json) as string[]]));
    expect(perms.owner).toContain("cash.close");
    expect(perms.owner).toContain("audit.view");
    expect(perms.manager).toContain("cash.close");
    expect(perms.manager).not.toContain("audit.view");
    expect(perms.viewer).not.toContain("audit.view");
    expect(perms.staff).not.toContain("cash.close");
    expect(DEFAULT_ROLES.find((r) => r.name === "manager")!.permissions).toContain("cash.close");
    expect(PERMISSIONS).toContain("cash.close");
  });

  it("a future day cannot be closed, and the day screen says so", async () => {
    const d = await day("2026-11-12");
    expect(d.canClose).toBe(false);
  });
});
