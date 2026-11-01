import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, type InvoiceHistoryEntry, type InvoiceListResponse, type InvoiceResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-01T10:00:00.000Z");
const app = createApp({ now: () => new Date(nowMs) });
let cookie = "";
const userId = "owner-user-1";

async function login() {
  const res = await call("/api/auth/login", { method: "POST", body: { username: "owner", password: "a long test password" }, auth: false });
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
}
beforeAll(async () => {
  t = await createTestDb();
  await t.db
    .prepare(
      `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role)
       VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', 'owner', ?2, 'owner')`,
    )
    .bind(userId, await hashPassword("a long test password", 1000))
    .run();
  await login();
});
afterAll(() => t.dispose());

type Opts = { method?: string; body?: unknown; auth?: boolean };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (o.auth !== false && cookie) headers.Cookie = cookie;
  if (method !== "GET") headers.Origin = "http://localhost";
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  const hasBody = o.body !== undefined && method !== "GET";
  return app.request(path, { method, headers, body: hasBody ? JSON.stringify(o.body) : undefined }, { DB: t.db });
}
const one = async <T>(sql: string, ...args: unknown[]) => t.db.prepare(sql).bind(...args).first<T>();
const count = async (sql: string, ...args: unknown[]) => (await one<{ n: number }>(sql, ...args))!.n;

/** The client's real bill (docs/client-invoice-reference.md): silver 9.800 g at 285.72 per gram, 3% GST. */
const silverLine = (over: Record<string, unknown> = {}) => ({
  description: "Silver Ornament",
  purity: "silver",
  hsn: "7113",
  grossWeightMg: 9_800,
  netWeightMg: 9_800,
  polishMg: 0,
  goldRatePaisePerKg: 28_572_000,
  labourRatePaisePerKg: 0,
  gstRateBps: 300,
  ...over,
});
const bill = (over: Record<string, unknown> = {}) => ({
  invoiceDate: "2026-02-03",
  customerName: "Asha Verma",
  taxMode: "intra",
  lines: [silverLine()],
  ...over,
});
const post = (b: Record<string, unknown>) => call("/api/invoices", { method: "POST", body: b });
const put = (id: string, b: Record<string, unknown>) => call(`/api/invoices/${id}`, { method: "PUT", body: b });
const inv = async (res: Response) => (await res.json()) as InvoiceResponse;
const lastNo = async (fy: string) => (await one<{ last_no: number }>("SELECT last_no FROM number_series WHERE series = 'INV' AND fy = ?1", fy))?.last_no ?? 0;
const audits = async (id: string) => (await t.db.prepare("SELECT action, detail_json, actor FROM audit_log WHERE entity_id = ?1 ORDER BY at, id").bind(id).all<{ action: string; detail_json: string | null; actor: string }>()).results;

describe("access (R16)", () => {
  it("every invoice route needs a login", async () => {
    for (const [method, path] of [["GET", "/api/invoices"], ["POST", "/api/invoices"], ["GET", "/api/invoices/x"], ["PUT", "/api/invoices/x"], ["GET", "/api/invoices/x/history"], ["POST", "/api/invoices/x/void"]] as const) {
      expect((await call(path, { method, body: {}, auth: false })).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("saving and numbering (R1 to R4)", () => {
  it("the client's real bill saves as INV/2025-26/0001 with the paper figures", async () => {
    const res = await post(bill());
    expect(res.status).toBe(201);
    const i = await inv(res);
    expect(i).toMatchObject({ invoiceNo: "INV/2025-26/0001", invoiceDate: "2026-02-03", payablePaise: 288_400, revisionNo: 1, customerName: "Asha Verma" });
    expect(i.calc).toMatchObject({ taxablePaise: 280_006, taxPaise: 8_400, totalBeforeRoundOffPaise: 288_406, roundOffPaise: -6, payablePaise: 288_400 });
    expect(i.lines[0]).toMatchObject({ lineNo: 1, chargeableWeightMg: 9_800, amountPaise: 280_006, displayRatePaisePerGram: 28_572 });
    expect((await one<{ created_by: string }>("SELECT created_by FROM invoices WHERE id = ?1", i.id))!.created_by).toBe(userId);
  });

  it("numbers follow the date's financial year: 0002, then a new year restarts, then 0002 again", async () => {
    expect((await inv(await post(bill({ invoiceDate: "2026-02-04" })))).invoiceNo).toBe("INV/2025-26/0002");
    expect((await inv(await post(bill({ invoiceDate: "2026-04-01" })))).invoiceNo).toBe("INV/2026-27/0001");
    const saveNow = nowMs;
    nowMs = Date.parse("2027-04-02T10:00:00.000Z");
    await login();
    try {
      expect((await inv(await post(bill({ invoiceDate: "2027-03-31" })))).invoiceNo).toBe("INV/2026-27/0002");
    } finally {
      nowMs = saveNow;
    }
  });

  it("totals sent by the screen are ignored: the stored totals are the engine's", async () => {
    const res = await post(bill({ payablePaise: 1, taxablePaise: 1, calc: { payablePaise: 1 } }));
    const i = await inv(res);
    expect(i.payablePaise).toBe(288_400);
    expect((await one<{ taxable_paise: number }>("SELECT taxable_paise FROM invoices WHERE id = ?1", i.id))!.taxable_paise).toBe(280_006);
  });

  it("an HSN 9988 line is accepted with the server-selected 5% GST", async () => {
    const before = await lastNo("2025-26");
    const count0 = await count("SELECT COUNT(*) AS n FROM invoices");
    const res = await post(bill({ lines: [silverLine(), silverLine({ hsn: "9988" })] }));
    expect(res.status).toBe(201);
    expect((await inv(res)).lines[1]).toMatchObject({ hsn: "9988", gstRateBps: 500 });
    expect(await count("SELECT COUNT(*) AS n FROM invoices")).toBe(count0 + 1);
    expect(await lastNo("2025-26")).toBe(before + 1);
  });

  it("date rules: future 400, back date fine, impossible date 400", async () => {
    expect(((await (await post(bill({ invoiceDate: "2026-11-02" }))).json()) as { error: string }).error).toBe("future_date");
    expect((await post(bill({ invoiceDate: "2026-11-01" }))).status).toBe(201);
    expect((await post(bill({ invoiceDate: "2019-06-01" }))).status).toBe(201);
    expect((await post(bill({ invoiceDate: "2026-02-30" }))).status).toBe(400);
  });

  it("0 lines and 51 lines are 400, 50 is fine; a bad line names itself", async () => {
    expect((await post(bill({ lines: [] }))).status).toBe(400);
    expect((await post(bill({ lines: Array.from({ length: 51 }, () => silverLine()) }))).status).toBe(400);
    expect((await post(bill({ invoiceDate: "2018-05-01", lines: Array.from({ length: 50 }, () => silverLine()) }))).status).toBe(201);
    const bad = await post(bill({ lines: [silverLine(), silverLine({ netWeightMg: "x" })] }));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).toContain("lines.2.netWeightMg");
  });

  it("a calculation error on a line (gross below net) is reported with its line number", async () => {
    const res = await post(bill({ lines: [silverLine({ grossWeightMg: 100 })] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "calculation", errors: [{ line: 1, code: "gross_below_net" }] });
  });

  it("20 saves at once give 20 unique numbers with no gap", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => post(bill({ invoiceDate: "2020-04-01" }))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const nums = (await Promise.all(results.map(inv))).map((i) => Number(i.invoiceNo.split("/")[2])).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe("customer copy (R5)", () => {
  async function makeCustomer(name: string, pan?: string) {
    const res = await call("/api/customers", { method: "POST", body: { name, mobile: "9812345678", pan } });
    return ((await res.json()) as { customer: { id: string } }).customer.id;
  }

  it("the invoice keeps its own copy; renaming the customer later changes nothing", async () => {
    const cid = await makeCustomer("Ramesh Kumar", "ABCDE1234F");
    const i = await inv(await post(bill({ customerId: cid, customerName: "Ramesh Kumar", customerMobile: "+91 98123-45678", customerPan: "abcde1234f", customerAddress: "12 Mall Road" })));
    expect(i).toMatchObject({ customerId: cid, customerName: "Ramesh Kumar", customerMobile: "9812345678", customerPan: "ABCDE1234F", customerAddress: "12 Mall Road" });
    await call(`/api/customers/${cid}`, { method: "PATCH", body: { name: "Ramesh Kumar Renamed" } });
    const again = await inv(await call(`/api/invoices/${i.id}`));
    expect(again.customerName).toBe("Ramesh Kumar");
  });

  it("unknown customer 400, voided customer 409, nothing stored", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM invoices");
    expect((await post(bill({ customerId: newId() }))).status).toBe(400);
    const cid = await makeCustomer("Voided Person");
    await call(`/api/customers/${cid}/void`, { method: "POST", body: { reason: "test" } });
    expect((await post(bill({ customerId: cid }))).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM invoices")).toBe(before);
  });

  it("a walk-in with only a name is saved; a 1-character name is 400; bad mobile and PAN are 400", async () => {
    const i = await inv(await post(bill({ customerName: "Walk In" })));
    expect(i).toMatchObject({ customerId: null, customerMobile: null, customerPan: null });
    expect((await post(bill({ customerName: "A" }))).status).toBe(400);
    expect((await post(bill({ customerMobile: "123" }))).status).toBe(400);
    expect((await post(bill({ customerPan: "BAD" }))).status).toBe(400);
  });
});

describe("frozen figures (R6, R7)", () => {
  it("a later rate change does not change a saved invoice, and the rate record is stored", async () => {
    await call("/api/rates/2026-02-03/silver", { method: "PUT", body: { price: "285.72", unit: "gram" } });
    const i = await inv(await post(bill({ invoiceDate: "2026-02-03" })));
    expect(i.rates.silver).toEqual({ pricePaisePerKg: 28_572_000, rateDate: "2026-02-03", carriedForward: false });
    expect(i.rates.gold_24k995).toBeNull();
    await call("/api/rates/2026-02-03/silver", { method: "PUT", body: { price: "300", unit: "gram", confirmLargeChange: true } });
    const again = await inv(await call(`/api/invoices/${i.id}`));
    expect(again.lines[0]!.goldRatePaisePerKg).toBe(28_572_000);
    expect(again.payablePaise).toBe(288_400);
    expect(again.rates.silver!.pricePaisePerKg).toBe(28_572_000);
  });

  it("reading returns what is stored, not a fresh calculation", async () => {
    const i = await inv(await post(bill()));
    await t.db.prepare("UPDATE invoices SET calc_json = ?2 WHERE id = ?1").bind(i.id, JSON.stringify({ marker: "stored" })).run();
    expect(((await inv(await call(`/api/invoices/${i.id}`))).calc as { marker: string }).marker).toBe("stored");
  });
});

describe("safe retry (R9)", () => {
  it("same id and content twice: one invoice, 200 the second time, same number; different content 409", async () => {
    const id = newId();
    const first = await post(bill({ id, invoiceDate: "2022-05-05" }));
    expect(first.status).toBe(201);
    const second = await post(bill({ id, invoiceDate: "2022-05-05" }));
    expect(second.status).toBe(200);
    expect((await inv(second)).invoiceNo).toBe((await inv(first)).invoiceNo);
    expect(await count("SELECT COUNT(*) AS n FROM invoices WHERE id = ?1", id)).toBe(1);
    expect(await lastNo("2022-23")).toBe(1);
    const clash = await post(bill({ id, invoiceDate: "2022-05-05", customerName: "Someone Else" }));
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: "id_conflict" });
  });
});

describe("editing (R10 to R12)", () => {
  async function fresh(over: Record<string, unknown> = {}) {
    return inv(await post(bill({ invoiceDate: "2021-06-01", ...over })));
  }
  const edit = (i: InvoiceResponse, over: Record<string, unknown> = {}, rev = i.revisionNo) =>
    put(i.id, { ...bill({ invoiceDate: i.invoiceDate }), expectedRevision: rev, ...over });

  it("an edit keeps id and number, stores the old version, recalculates, and old lines stay readable", async () => {
    const i = await fresh();
    const res = await edit(i, { lines: [silverLine({ grossWeightMg: 10_000, netWeightMg: 10_000, polishMg: 500 })], reason: "weight corrected" });
    expect(res.status).toBe(200);
    const e = await inv(res);
    expect(e).toMatchObject({ id: i.id, invoiceNo: i.invoiceNo, revisionNo: 2, payablePaise: 309_000 });
    expect(e.lines).toHaveLength(1);
    expect(e.lines[0]).toMatchObject({ amountPaise: 300_006, chargeableWeightMg: 10_500 });

    const snap = (await one<{ snapshot_json: string; reason: string; created_by: string }>("SELECT * FROM record_revisions WHERE entity = 'invoice' AND entity_id = ?1 AND revision_no = 1", i.id))!;
    expect(JSON.parse(snap.snapshot_json)).toMatchObject({ payable_paise: 288_400, revision_no: 1 });
    expect(snap).toMatchObject({ reason: "weight corrected", created_by: userId });

    const old = await inv(await call(`/api/invoices/${i.id}?revision=1`));
    expect(old).toMatchObject({ isEarlierVersion: true, revisionNo: 1, payablePaise: 288_400 });
    expect(old.lines[0]).toMatchObject({ amountPaise: 280_006 });
    expect((await inv(await call(`/api/invoices/${i.id}?revision=2`))).isEarlierVersion).toBe(false);
    expect((await call(`/api/invoices/${i.id}?revision=3`)).status).toBe(404);
    expect((await call(`/api/invoices/${i.id}?revision=0`)).status).toBe(404);
  });

  it("removing a line keeps it in the earlier revision", async () => {
    const i = await fresh({ lines: [silverLine(), silverLine({ description: "Second", netWeightMg: 5_000, grossWeightMg: 5_000 })] });
    const e = await inv(await edit(i, { lines: [silverLine()] }));
    expect(e.lines).toHaveLength(1);
    expect((await inv(await call(`/api/invoices/${i.id}?revision=1`))).lines).toHaveLength(2);
    expect(await count("SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?1", i.id)).toBe(3);
  });

  it("an edit that changes nothing writes no revision and no audit row", async () => {
    const i = await fresh();
    const auditBefore = (await audits(i.id)).length;
    const res = await edit(i, { customerName: "  Asha   Verma ", customerMobile: "" });
    expect(res.status).toBe(200);
    expect((await inv(res)).revisionNo).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM record_revisions WHERE entity_id = ?1", i.id)).toBe(0);
    expect((await audits(i.id)).length).toBe(auditBefore);
  });

  it("a missing or old revision is refused; two edits at once leave exactly one winner", async () => {
    const i = await fresh();
    expect((await put(i.id, bill({ invoiceDate: i.invoiceDate }))).status).toBe(400);
    const results = await Promise.all([edit(i, { customerName: "Winner One" }), edit(i, { customerName: "Winner Two" })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await count("SELECT revision_no AS n FROM invoices WHERE id = ?1", i.id)).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?1 AND revision_no = 2", i.id)).toBe(1);
    const late = await edit(i, { customerName: "Late" }, 1);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: "stale_revision" });
  });

  it("history lists revisions newest first with who, when, reason, payable change and the changed parts", async () => {
    const i = await fresh();
    await edit(i, { customerName: "Renamed Person", reason: "name fix" });
    const e2 = await inv(await call(`/api/invoices/${i.id}`));
    await edit(e2, { customerName: "Renamed Person", taxMode: "inter", lines: [silverLine({ polishMg: 500 })] });
    const { items } = (await (await call(`/api/invoices/${i.id}/history`)).json()) as { items: InvoiceHistoryEntry[] };
    expect(items.map((h) => h.revisionNo)).toEqual([2, 1]);
    expect(items[1]).toMatchObject({ by: userId, reason: "name fix", changes: ["customer"], fromPayablePaise: 288_400, toPayablePaise: 288_400 });
    expect(items[0]!.changes.sort()).toEqual(["lines", "taxMode"]);
    expect(items[0]!.toPayablePaise).toBeGreaterThan(items[0]!.fromPayablePaise);
  });

  it("the audit rows name the changed parts only, never the PAN", async () => {
    const i = await fresh({ customerPan: "ABCDE1234F" });
    await edit(i, { customerPan: "ABCDE1234F", customerName: "Pan Person" });
    const rows = await audits(i.id);
    expect(rows.map((r) => r.action)).toEqual(["invoice_create", "invoice_update"]);
    expect(JSON.parse(rows[1]!.detail_json!)).toMatchObject({ changed: ["customer"], fromRevision: 1, toRevision: 2 });
    expect(JSON.stringify(rows)).not.toContain("ABCDE1234F");
    expect(rows.every((r) => r.actor === userId)).toBe(true);
  });

  it("DELETE on invoices and invoice_lines fails", async () => {
    await expect(t.db.prepare("DELETE FROM invoices").run()).rejects.toThrow(/never deleted/);
    await expect(t.db.prepare("DELETE FROM invoice_lines").run()).rejects.toThrow(/never deleted/);
  });
});

describe("voiding (R13)", () => {
  it("needs a reason; stays visible with its number; number never reused; cannot be edited", async () => {
    const i = await inv(await post(bill({ invoiceDate: "2017-08-01" })));
    expect((await call(`/api/invoices/${i.id}/void`, { method: "POST", body: {} })).status).toBe(400);
    const v = await call(`/api/invoices/${i.id}/void`, { method: "POST", body: { reason: "made by mistake" } });
    expect(v.status).toBe(200);
    expect(await v.json()).toMatchObject({ voidedAt: expect.any(String), voidReason: "made by mistake", invoiceNo: i.invoiceNo });
    expect((await call(`/api/invoices/${i.id}/void`, { method: "POST", body: { reason: "again" } })).status).toBe(409);
    expect((await put(i.id, { ...bill({ invoiceDate: "2017-08-01" }), expectedRevision: 1 })).status).toBe(409);
    const next = await inv(await post(bill({ invoiceDate: "2017-08-01" })));
    expect(next.invoiceNo).toBe("INV/2017-18/0002");
    const found = (await (await call("/api/invoices?q=2017-18/0001")).json()) as InvoiceListResponse;
    expect(found.items).toHaveLength(1);
    expect(found.items[0]!.voidedAt).not.toBeNull();
    expect((await audits(i.id)).map((a) => a.action)).toEqual(["invoice_create", "invoice_void"]);
  });
});

describe("search (R15)", () => {
  beforeAll(async () => {
    for (const [name, mobile, date] of [["Kumar Jewels", "9812345678", "2024-06-10"], ["Sunita Kumari", "9876500001", "2024-06-11"], ["Zorro 50%_off", "", "2024-07-01"]] as const) {
      await post(bill({ invoiceDate: date, customerName: name, customerMobile: mobile || undefined }));
    }
  });
  const find = async (qs: string) => {
    const res = await call(`/api/invoices?${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()) as InvoiceListResponse;
  };

  it("finds by number (any part), by name in any case, and by 3+ digits of the mobile", async () => {
    expect((await find("q=2024-25/0001")).items.map((i) => i.customerName)).toEqual(["Kumar Jewels"]);
    expect((await find("q=0002")).items.some((i) => i.customerName === "Sunita Kumari")).toBe(true);
    expect((await find("q=KUMAR&from=2024-01-01&to=2024-12-31")).items.map((i) => i.customerName).sort()).toEqual(["Kumar Jewels", "Sunita Kumari"]);
    expect((await find("q=5678&from=2024-01-01&to=2024-12-31")).items.map((i) => i.customerName)).toEqual(["Kumar Jewels"]);
    expect((await find("q=%2B91%2098123%2045678&from=2024-01-01&to=2024-12-31")).items.map((i) => i.customerName)).toEqual(["Kumar Jewels"]);
  });

  it("a 2-digit query does not search mobiles; % and _ are plain characters", async () => {
    expect((await find("q=98")).items.filter((i) => i.customerMobile?.includes("98") && !i.invoiceNo.includes("98") && !i.customerName.toLowerCase().includes("98"))).toEqual([]);
    expect((await find("q=50%25_")).items.map((i) => i.customerName)).toEqual(["Zorro 50%_off"]);
  });

  it("filters by date range and status; newest invoice date first", async () => {
    const june = await find("from=2024-06-01&to=2024-06-30");
    expect(june.items.map((i) => i.invoiceDate)).toEqual(["2024-06-11", "2024-06-10"]);
    expect((await find("from=2024-06-01&to=2024-06-30&status=voided")).items).toEqual([]);
    expect((await find("status=voided")).items.every((i) => i.voidedAt)).toBe(true);
    expect((await call("/api/invoices?from=bad")).status).toBe(400);
  });

  it("pages through every invoice exactly once", async () => {
    const total = await count("SELECT COUNT(*) AS n FROM invoices");
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: InvoiceListResponse = await find(cursor ? `cursor=${cursor}` : "");
      expect(page.items.length).toBeLessThanOrEqual(20);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });

  it("search over 5,000 invoices returns in under 200 ms", async () => {
    await t.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
         INSERT INTO invoices (id, created_at, created_by, updated_at, updated_by, invoice_no, invoice_date, customer_name,
           customer_name_search, customer_mobile, tax_mode, reverse_charge, rates_json, input_json, taxable_paise, tax_paise,
           total_before_round_off_paise, round_off_paise, payable_paise, calc_json, revision_no)
         SELECT 'bulk-' || i, '2026-01-01T00:00:00.000Z', 'test', '2026-01-01T00:00:00.000Z', 'test', 'BULK/' || i,
                '2026-01-01', 'Zzbulk Customer ' || i, 'zzbulk customer ' || i, printf('7%09d', i), 'intra', 0, '{}', '{}',
                100, 0, 100, 0, 100, '{}', 1 FROM n`,
      )
      .run();
    for (const q of ["zzbulk customer 4999", "BULK/4999", "7000004999", "customer 1"]) {
      const start = performance.now();
      const res = await call(`/api/invoices?q=${encodeURIComponent(q)}`);
      const ms = performance.now() - start;
      expect(res.status).toBe(200);
      expect(((await res.json()) as InvoiceListResponse).items.length).toBeGreaterThan(0);
      expect(ms, `query ${q}`).toBeLessThan(200);
    }
  });
});
