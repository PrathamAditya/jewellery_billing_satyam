import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InvoiceResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 012c F: discounts and stones are saved, read back, and an earlier revision stays readable. */

let t: Awaited<ReturnType<typeof createTestDb>>;
const app = createApp({ now: () => new Date("2026-11-01T10:00:00.000Z") });
let cookie = "";
const userId = "owner-user-discounts";

beforeAll(async () => {
  t = await createTestDb();
  await t.db
    .prepare(
      `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role)
       VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', 'owner', ?2, 'owner')`,
    )
    .bind(userId, await hashPassword("a long test password", 1000))
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

const line = (over: Record<string, unknown> = {}) => ({
  description: "Gold Chain",
  purity: "22K916",
  hsn: "7113",
  grossWeightMg: 10_000,
  netWeightMg: 10_000,
  polishBps: 0,
  goldRatePaisePerKg: 600_000_000,
  labourRatePaisePerKg: 50_000_000,
  ...over,
});
/** Spec 012c example A: two lines, gold 1%, labour fixed 300, total fixed 1,000. */
const exampleA = (over: Record<string, unknown> = {}) => ({
  invoiceDate: "2026-02-03",
  customerName: "Asha Verma",
  taxMode: "intra",
  lines: [line(), line({ netWeightMg: 5_000, grossWeightMg: 5_000, labourRatePaisePerKg: 40_000_000 })],
  discounts: { gold: { kind: "percent", value: 100 }, labour: { kind: "fixed", value: 30_000 }, total: { kind: "fixed", value: 100_000 } },
  ...over,
});

describe("discounts and stones (spec 012c)", () => {
  it("example A is saved with its figures and reads back the same", async () => {
    const res = await call("/api/invoices", { method: "POST", body: exampleA() });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as InvoiceResponse;
    expect(saved.payablePaise).toBe(9_764_400);
    expect(saved.discountPaise).toBe(220_000);
    expect(saved.discounts).toEqual({ gold: { kind: "percent", value: 100 }, labour: { kind: "fixed", value: 30_000 }, total: { kind: "fixed", value: 100_000 } });
    expect(saved.lines.map((l) => l.taxablePaise)).toEqual([6_351_571, 3_128_429]);
    expect(saved.lines.map((l) => l.discountPaise)).toEqual([148_429, 71_571]);
    expect(saved.lines.every((l) => l.pricingMode === "weight")).toBe(true);

    const read = (await (await call(`/api/invoices/${saved.id}`)).json()) as InvoiceResponse;
    expect(read.payablePaise).toBe(9_764_400);
    expect(read.discountPaise).toBe(220_000);
    expect(read.lines.map((l) => l.taxablePaise)).toEqual([6_351_571, 3_128_429]);
  });

  it("a separate stone line and a combined line are saved with their own fields", async () => {
    const res = await call("/api/invoices", {
      method: "POST",
      body: {
        invoiceDate: "2026-02-03",
        customerName: "Stone Buyer",
        taxMode: "intra",
        lines: [
          line({ netWeightMg: 5_000, grossWeightMg: 5_300, labourRatePaisePerKg: 0, pricingMode: "separate", stoneWeightMg: 300, stoneAmountPaise: 1_250_000 }),
          line({ netWeightMg: 6_000, grossWeightMg: 6_000, pricingMode: "combined", totalAmountPaise: 5_000_000, goldRatePaisePerKg: 0, labourRatePaisePerKg: 0 }),
        ],
      },
    });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as InvoiceResponse;
    expect(saved.lines[0]).toMatchObject({ pricingMode: "separate", stoneWeightMg: 300, stoneAmountPaise: 1_250_000, amountPaise: 4_250_000 });
    expect(saved.lines[1]).toMatchObject({ pricingMode: "combined", totalAmountPaise: 5_000_000, amountPaise: 5_000_000, displayRatePaisePerGram: 833_333 });
    expect(saved.payablePaise).toBe(4_377_500 + 5_150_000);
  });

  it("a discount larger than the gold amount is refused with the target named, and nothing is saved", async () => {
    const before = await one<{ n: number }>("SELECT COUNT(*) AS n FROM invoices");
    const res = await call("/api/invoices", { method: "POST", body: exampleA({ discounts: { gold: { kind: "fixed", value: 99_999_999_999 } } }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: { field: string; code: string }[] };
    expect(body.errors).toEqual([expect.objectContaining({ field: "discounts.gold", code: "discount_exceeds_base" })]);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM invoices"))!.n).toBe(before!.n);
  });

  it("an edit that changes the discounts keeps revision 1 readable, with its own discounts", async () => {
    const created = (await (await call("/api/invoices", { method: "POST", body: exampleA({ customerName: "Revision Test" }) })).json()) as InvoiceResponse;
    const edited = await call(`/api/invoices/${created.id}`, {
      method: "PUT",
      body: exampleA({ customerName: "Revision Test", expectedRevision: 1, reason: "dropped the total discount", discounts: { gold: { kind: "percent", value: 100 }, labour: { kind: "fixed", value: 30_000 } } }),
    });
    expect(edited.status).toBe(200);
    const now = (await edited.json()) as InvoiceResponse;
    expect(now.revisionNo).toBe(2);
    expect(now.discountPaise).toBe(120_000);
    // Without the total discount: taxable 9,580,000, tax 3% of it (287,400), payable 9,867,400.
    expect(now.payablePaise).toBe(9_867_400);

    const earlier = (await (await call(`/api/invoices/${created.id}?revision=1`)).json()) as InvoiceResponse;
    expect(earlier.isEarlierVersion).toBe(true);
    expect(earlier.discountPaise).toBe(220_000);
    expect(earlier.discounts).toEqual({ gold: { kind: "percent", value: 100 }, labour: { kind: "fixed", value: 30_000 }, total: { kind: "fixed", value: 100_000 } });
  });

  it("re-saving the same discounts and stones changes nothing: no new revision", async () => {
    const created = (await (await call("/api/invoices", { method: "POST", body: exampleA({ customerName: "Same Content" }) })).json()) as InvoiceResponse;
    const again = await call(`/api/invoices/${created.id}`, { method: "PUT", body: exampleA({ customerName: "Same Content", expectedRevision: 1 }) });
    expect(again.status).toBe(200);
    expect(((await again.json()) as InvoiceResponse).revisionNo).toBe(1);
  });
});
