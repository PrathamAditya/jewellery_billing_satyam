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

const BUSINESS = { legalName: "Test Showroom", addressLines: ["Shop 9 Test Road"], city: "Nadaun", pincode: "177033", gstin: "02BBCPS7125N1ZH", phones: ["+91 98765-43210"], email: "test@example.com" };

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
