import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InvoiceResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

/** Spec 014 R1: printing is read-only. The only write a print makes is one audit row (invoice_print). */

let t: Awaited<ReturnType<typeof createTestDb>>;
const app = createApp({ now: () => new Date("2026-11-01T10:00:00.000Z") });
let cookie = "";
const userId = "owner-user-print";

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
const count = async (sql: string, ...args: unknown[]) => (await one<{ n: number }>(sql, ...args))!.n;

const bill = () => ({
  invoiceDate: "2026-02-03",
  customerName: "Asha Verma",
  taxMode: "intra",
  lines: [
    {
      description: "Silver Ornament",
      purity: "silver",
      hsn: "7113",
      grossWeightMg: 9_800,
      netWeightMg: 9_800,
      polishMg: 0,
      goldRatePaisePerKg: 28_572_000,
      labourRatePaisePerKg: 0,
    },
  ],
});

describe("printing (spec 014 R1)", () => {
  it("the print event needs a login", async () => {
    expect((await call("/api/invoices/x/print-event", { method: "POST", body: {}, auth: false })).status).toBe(401);
  });

  it("an unknown invoice is 404 and writes nothing", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'invoice_print'");
    expect((await call("/api/invoices/does-not-exist/print-event", { method: "POST", body: { copy: "SHOP COPY" } })).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'invoice_print'")).toBe(before);
  });

  it("each print writes one audit row and changes no business data", async () => {
    const created = (await (await call("/api/invoices", { method: "POST", body: bill() })).json()) as InvoiceResponse;
    const id = created.id;
    const stateBefore = await one<{ revision_no: number; updated_at: string; updated_by: string }>("SELECT revision_no, updated_at, updated_by FROM invoices WHERE id = ?1", id);
    const businessRowsBefore = {
      invoices: await count("SELECT COUNT(*) AS n FROM invoices"),
      revisions: await count("SELECT COUNT(*) AS n FROM record_revisions"),
      auditAll: await count("SELECT COUNT(*) AS n FROM audit_log"),
    };

    // Printed twice (shop copy, then customer copy), and once more on the same sheet: reprinting is allowed.
    for (const copy of ["SHOP COPY", "CUSTOMER COPY", "SHOP COPY"]) {
      const res = await call(`/api/invoices/${id}/print-event`, { method: "POST", body: { copy } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }

    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'invoice_print' AND entity_id = ?1", id)).toBe(3);
    const copies = (await t.db.prepare("SELECT detail_json FROM audit_log WHERE action = 'invoice_print' AND entity_id = ?1 ORDER BY at, id").bind(id).all<{ detail_json: string }>()).results;
    expect(copies.map((r) => JSON.parse(r.detail_json).copy)).toEqual(["SHOP COPY", "CUSTOMER COPY", "SHOP COPY"]);

    // Nothing else moved: the invoice row, the revisions and the other business tables are as they were.
    expect(await one("SELECT revision_no, updated_at, updated_by FROM invoices WHERE id = ?1", id)).toEqual(stateBefore);
    expect(await count("SELECT COUNT(*) AS n FROM invoices")).toBe(businessRowsBefore.invoices);
    expect(await count("SELECT COUNT(*) AS n FROM record_revisions")).toBe(businessRowsBefore.revisions);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log")).toBe(businessRowsBefore.auditAll + 3);
  });
});
