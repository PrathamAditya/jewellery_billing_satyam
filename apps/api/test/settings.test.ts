import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessSettingsSchema, settingsSchemas, cleanMobile } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-01T10:00:00.000Z");
const app = createApp({ now: () => new Date(nowMs) });
let cookie = "";

beforeAll(async () => {
  t = await createTestDb();
  await t.db
    .prepare(
      `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role)
       VALUES ('owner-user-1', '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', 'owner', ?1, 'owner')`,
    )
    .bind(await hashPassword("a long test password", 1000))
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username: "owner", password: "a long test password" }, auth: false });
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
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

const BUSINESS = { legalName: "Test Showroom", addressLines: ["Shop 9 Test Road"], city: "Nadaun", pincode: "177033", gstin: "22AAAAA0000A1Z5", phones: ["+91 98765-43210"], email: "test@example.com" };

describe("schemas (spec 003 R2, R4)", () => {
  it("GSTIN, IFSC, phone and PAN rules", () => {
    expect(businessSettingsSchema.safeParse({ ...BUSINESS, gstin: "22AAAAA0000A1Z5" }).success).toBe(true);
    expect(businessSettingsSchema.safeParse({ ...BUSINESS, gstin: "22AAAAA0000A1Z" }).success).toBe(false);
    expect(businessSettingsSchema.parse({ ...BUSINESS, gstin: "" }).gstin).toBe("");
    expect(businessSettingsSchema.parse({ ...BUSINESS }).phones).toEqual(["9876543210"]);
    expect(settingsSchemas.bank.parse({ ifsc: "sbin0001234" }).ifsc).toBe("SBIN0001234");
    expect(settingsSchemas.bank.safeParse({ ifsc: "SBIN1001234" }).success).toBe(false);
    expect(cleanMobile("+91 98765-43210")).toBe("9876543210");
  });

  it("logo above 300 KB is refused by the logo schema limit", () => {
    expect(settingsSchemas.logo.safeParse({ mime: "image/png", dataUrl: "x".repeat(410_001) }).success).toBe(false);
    expect(settingsSchemas.logo.safeParse(null).success).toBe(true);
  });
});

describe("saving settings (R1)", () => {
  it("a change stores the old value as a revision and writes an audit row with the key only", async () => {
    const first = await call("/api/settings/business", { method: "PUT", body: BUSINESS });
    expect(first.status).toBe(200);
    const revsBefore = await count("SELECT COUNT(*) AS n FROM record_revisions WHERE entity = 'settings'");
    const second = await call("/api/settings/business", { method: "PUT", body: { ...BUSINESS, legalName: "Renamed Showroom" } });
    expect(second.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM record_revisions WHERE entity = 'settings'")).toBe(revsBefore + 1);
    const audit = (await t.db.prepare("SELECT detail_json FROM audit_log WHERE action = 'settings_update' ORDER BY at DESC LIMIT 1").first<{ detail_json: string }>())!;
    expect(audit.detail_json).toBe('{"key":"business"}');
    expect(audit.detail_json).not.toContain("GSTIN");
  });

  it("an invalid value is a 400 with a field message", async () => {
    const res = await call("/api/settings/business", { method: "PUT", body: { ...BUSINESS, gstin: "BAD" } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("GSTIN");
  });

  it("an unknown key is 404 and the read needs a login", async () => {
    expect((await call("/api/settings/nope", { method: "PUT", body: {} })).status).toBe(404);
    expect((await call("/api/settings/snapshot", { auth: false })).status).toBe(401);
  });
});

describe("header snapshot (R5)", () => {
  const bill = {
    invoiceDate: "2026-02-03",
    customerName: "Asha Verma",
    taxMode: "intra",
    lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: 9800, netWeightMg: 9800, polishMg: 0, goldRatePaisePerKg: 28572000, labourRatePaisePerKg: 0, gstRateBps: 300 }],
  };

  it("an invoice keeps the business name it was issued with, after the name changes", async () => {
    await call("/api/settings/business", { method: "PUT", body: { ...BUSINESS, legalName: "Name At Issue" } });
    const created = (await (await call("/api/invoices", { method: "POST", body: bill })).json()) as { id: string; invoiceNo: string };
    await call("/api/settings/business", { method: "PUT", body: { ...BUSINESS, legalName: "Name Later" } });
    const row = (await one<{ header_json: string; fy: string; serial: number }>("SELECT header_json, fy, serial FROM invoices WHERE id = ?1", created.id))!;
    expect(JSON.parse(row.header_json).business.legalName).toBe("Name At Issue");
    expect(row).toMatchObject({ fy: "2025-26", serial: 1 });
    expect(created.invoiceNo).toBe("INV-0001");
  });
});

describe("next number (R9)", () => {
  it("raising the next number works, lowering or equal is refused, and an audit row is written", async () => {
    const ok = await call("/api/settings/next-number", { method: "POST", body: { series: "INV", fy: "2030-31", nextNumber: 2762 } });
    expect(ok.status).toBe(200);
    expect((await one<{ last_no: number }>("SELECT last_no FROM number_series WHERE series = 'INV' AND fy = '2030-31'"))!.last_no).toBe(2761);
    const lower = await call("/api/settings/next-number", { method: "POST", body: { series: "INV", fy: "2030-31", nextNumber: 100 } });
    expect(lower.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'number_set_next'")).toBeGreaterThanOrEqual(1);
  });
});

/** A silver invoice on a past date (dates after 1 Nov 2026 are refused). Each test uses its own financial years. */
const silverBill = (invoiceDate: string, customerName = "Asha Verma") => ({
  invoiceDate,
  customerName,
  taxMode: "intra",
  lines: [{ description: "Silver", purity: "silver", hsn: "7113", grossWeightMg: 9800, netWeightMg: 9800, polishMg: 0, goldRatePaisePerKg: 28572000, labourRatePaisePerKg: 0, gstRateBps: 300 }],
});
const DEFAULT_PREFIXES = { INV: "INV", PAY: "PAY", OGP: "OGP", ORD: "ORD", CN: "CN" };
const putNumbering = (n: { prefixes: Record<string, string>; padDigits: number; fyInNumber: boolean }) => call("/api/settings/numbering", { method: "PUT", body: n });
const invoiceNoOf = async (invoiceDate: string) => ((await (await call("/api/invoices", { method: "POST", body: silverBill(invoiceDate) })).json()) as { invoiceNo: string }).invoiceNo;

describe("printed number formats follow the settings (R6, R10)", () => {
  it("prefix, digits and the financial year follow the settings, and saved numbers do not change", async () => {
    const prefixes = { ...DEFAULT_PREFIXES, INV: "BB", PAY: "RCP" };
    expect((await putNumbering({ prefixes, padDigits: 4, fyInNumber: false })).status).toBe(200);
    const first = (await (await call("/api/invoices", { method: "POST", body: silverBill("2023-06-01") })).json()) as { id: string; invoiceNo: string };
    expect(first.invoiceNo).toBe("BB-0001");

    expect((await putNumbering({ prefixes, padDigits: 6, fyInNumber: false })).status).toBe(200);
    expect(await invoiceNoOf("2023-06-02")).toBe("BB-000002");

    expect((await putNumbering({ prefixes, padDigits: 6, fyInNumber: true })).status).toBe(200);
    expect(await invoiceNoOf("2023-06-03")).toBe("BB-2023-24-000003");

    // The first invoice keeps the number it was saved with.
    expect((await one<{ invoice_no: string }>("SELECT invoice_no FROM invoices WHERE id = ?1", first.id))!.invoice_no).toBe("BB-0001");

    // A new financial year starts again at 1 (the number repeats each year, unique per year).
    expect((await putNumbering({ prefixes, padDigits: 4, fyInNumber: false })).status).toBe(200);
    expect(await invoiceNoOf("2024-04-01")).toBe("BB-0001");
  });

  it("payment receipts use the receipt prefix from the settings", async () => {
    const cust = (await (await call("/api/customers", { method: "POST", body: { name: "Format Customer", mobile: "9800000002" } })).json()) as { customer: { id: string } };
    const res = await call("/api/payments", { method: "POST", body: { date: "2026-11-01", mode: "upi", reference: "FMT1", customerId: cust.customer.id, purpose: "advance", amountPaise: 100_000 } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { payment: { receiptNo: string } };
    expect(body.payment.receiptNo).toBe("RCP-0001");
  });
});

describe("set next number (R9, section 5)", () => {
  it("setting the value it already has changes nothing, raising works, and a value that is not higher is refused", async () => {
    expect((await putNumbering({ prefixes: DEFAULT_PREFIXES, padDigits: 4, fyInNumber: false })).status).toBe(200);
    const audits = () => count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'number_set_next'");
    const before = await audits();
    const set = (nextNumber: number, series = "INV", fy = "2022-23") => call("/api/settings/next-number", { method: "POST", body: { series, fy, nextNumber } });

    expect((await set(5)).status).toBe(200);
    expect(await audits()).toBe(before + 1);
    expect((await set(5)).status).toBe(200); // already the next number: no change, no audit row
    expect(await audits()).toBe(before + 1);

    expect(await invoiceNoOf("2022-06-01")).toBe("INV-0005");
    expect((await set(2762)).status).toBe(200);
    expect(await invoiceNoOf("2022-06-02")).toBe("INV-2762");
    expect((await set(2762)).status).toBe(409); // 2762 is already used
    expect((await set(100)).status).toBe(409);
    expect(await audits()).toBe(before + 2);
    const last = (await one<{ detail_json: string }>("SELECT detail_json FROM audit_log WHERE action = 'number_set_next' ORDER BY at DESC LIMIT 1"))!;
    expect(JSON.parse(last.detail_json)).toMatchObject({ series: "INV", fy: "2022-23", old: 5, next: 2762 });
  });

  it("only invoice, payment, old gold and order series are accepted, and the year must look like 2026-27", async () => {
    expect((await call("/api/settings/next-number", { method: "POST", body: { series: "C", fy: "2022-23", nextNumber: 9 } })).status).toBe(400);
    expect((await call("/api/settings/next-number", { method: "POST", body: { series: "INV", fy: "2022", nextNumber: 9 } })).status).toBe(400);
  });
});

describe("header snapshot proven through the API (R5)", () => {
  it("an old invoice shows the name it was issued with, a new one the new name, and an edit keeps it", async () => {
    await call("/api/settings/business", { method: "PUT", body: { ...BUSINESS, legalName: "Snap Before" } });
    const a = (await (await call("/api/invoices", { method: "POST", body: silverBill("2023-07-01") })).json()) as { id: string };
    await call("/api/settings/business", { method: "PUT", body: { ...BUSINESS, legalName: "Snap After" } });
    const b = (await (await call("/api/invoices", { method: "POST", body: silverBill("2023-07-02") })).json()) as { id: string };
    const legalNameOf = async (id: string) => ((await (await call(`/api/invoices/${id}`)).json()) as { header: { business: { legalName: string } } }).header.business.legalName;
    expect(await legalNameOf(a.id)).toBe("Snap Before");
    expect(await legalNameOf(b.id)).toBe("Snap After");

    const edit = await call(`/api/invoices/${a.id}`, { method: "PUT", body: { ...silverBill("2023-07-01", "Edited Customer"), expectedRevision: 1 } });
    expect(edit.status).toBe(200);
    expect(await legalNameOf(a.id)).toBe("Snap Before");
  });
});

describe("order numbers follow the settings and the order keeps the full header (R5, R6)", () => {
  it("an order uses the order prefix and digits from the settings, and stores the full header", async () => {
    expect((await putNumbering({ prefixes: { ...DEFAULT_PREFIXES, ORD: "OD" }, padDigits: 3, fyInNumber: false })).status).toBe(200);
    const cust = (await (await call("/api/customers", { method: "POST", body: { name: "Order Format Customer", mobile: "9800000003" } })).json()) as { customer: { id: string } };
    const res = await call("/api/orders", { method: "POST", body: { customerId: cust.customer.id, description: "Ring" } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; orderNo: string };
    expect(body.orderNo).toMatch(/^OD-\d{3}$/);
    const row = (await one<{ header_json: string }>("SELECT header_json FROM orders WHERE id = ?1", body.id))!;
    expect(JSON.parse(row.header_json).texts.copyLabels).toEqual(["SHOP COPY", "CUSTOMER COPY"]);
    await putNumbering({ prefixes: DEFAULT_PREFIXES, padDigits: 4, fyInNumber: false });
  });
});
