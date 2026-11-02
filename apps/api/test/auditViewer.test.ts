import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditListResponse, AuditOptionsResponse } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

// Spec 051: the audit history viewer. Read-only, owner only by default, filters and paging.
let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-02T10:00:00.000Z");
const app = createApp({ now: () => new Date(nowMs) });
const PASSWORD = "a long test password";
const cookies: Record<string, string> = {};

type Opts = { method?: string; body?: unknown; as?: string };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (o.as && cookies[o.as]) headers.Cookie = cookies[o.as]!;
  if (method !== "GET") headers.Origin = "http://localhost";
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: o.body === undefined || method === "GET" ? undefined : JSON.stringify(o.body) }, { DB: t.db });
}

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

/** Login rows written by the test's own logins carry the real clock, so assertions look only at the fixed rows (ids start with "a-"). */
const fixed = (items: AuditListResponse["items"]) => items.filter((r) => r.id.startsWith("a-"));

/** Writes an audit row with a fixed time, so the date filters can be tested exactly. */
async function row(at: string, actor: string, action: string, entity: string, entityId: string, detail: unknown = undefined) {
  await t.db
    .prepare("INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(`a-${at}-${action}-${entityId}`, at, actor, action, entity, entityId, detail === undefined ? null : JSON.stringify(detail))
    .run();
}

beforeAll(async () => {
  t = await createTestDb();
  await person("owner", "owner");
  await person("staff1", "staff");
  // Rows at known times. Times are UTC; India is UTC+5:30.
  await row("2026-10-01T04:00:00.000Z", "u-owner", "rate_create", "rate", "r-old", { date: "2026-10-01" });
  await row("2026-11-01T18:29:59.999Z", "u-owner", "invoice_create", "invoice", "inv-1", { invoiceNo: "INV-0001" }); // 1 Nov, 23:59 India
  await row("2026-11-01T18:30:00.000Z", "u-staff1", "payment_create", "payment", "pay-1"); // 2 Nov, 00:00 India
  await row("2026-11-02T05:00:00.000Z", "anonymous", "login_failure", "user", "u-owner", { ip: "203.0.113.9", reason: "bad_password" });
  await row("2026-11-02T06:00:00.000Z", "u-owner", "cash_closed", "cash_closing", "cc-1");
});
afterAll(() => t.dispose());

describe("list, newest first (spec 051 R1, R2)", () => {
  it("returns the rows newest first", async () => {
    const body = (await (await call("/api/audit", { as: "owner" })).json()) as AuditListResponse;
    expect(fixed(body.items).map((r) => r.action)).toEqual(["cash_closed", "login_failure", "payment_create", "invoice_create", "rate_create"]);
    expect(body.nextCursor).toBeNull();
  });

  it("gives who, what, where and the parsed detail; null detail when there is none", async () => {
    const body = (await (await call("/api/audit?action=invoice_create", { as: "owner" })).json()) as AuditListResponse;
    expect(fixed(body.items)).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ actor: "u-owner", actorName: "Person owner", action: "invoice_create", entity: "invoice", entityId: "inv-1", detail: { invoiceNo: "INV-0001" } });
    const bare = (await (await call("/api/audit?action=payment_create", { as: "owner" })).json()) as AuditListResponse;
    expect(bare.items[0]!.detail).toBeNull();
  });

  it("a failed login shows as not logged in", async () => {
    const body = (await (await call("/api/audit?action=login_failure", { as: "owner" })).json()) as AuditListResponse;
    expect(body.items[0]).toMatchObject({ actor: "anonymous", actorName: "Not logged in (failed login)", detail: { ip: "203.0.113.9" } });
  });

  it("pages of 20 with a cursor, no row twice", async () => {
    for (let i = 0; i < 40; i++) await row(`2026-11-03T07:${String(i).padStart(2, "0")}:00.000Z`, "u-owner", "bulk_test", "invoice", `bulk-${i}`);
    const first = (await (await call("/api/audit?action=bulk_test", { as: "owner" })).json()) as AuditListResponse;
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBe("20");
    const second = (await (await call(`/api/audit?action=bulk_test&cursor=${first.nextCursor}`, { as: "owner" })).json()) as AuditListResponse;
    expect(second.items).toHaveLength(20);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(40);
    // Newest first across pages: the first row of page two is older than the last of page one.
    expect(first.items.at(-1)!.at > second.items[0]!.at).toBe(true);
  });
});

describe("filters (spec 051 R3)", () => {
  it("date range uses India days: 1 Nov ends at 23:59 India time, 2 Nov starts at 00:00", async () => {
    const onlyNov1 = (await (await call("/api/audit?from=2026-11-01&to=2026-11-01", { as: "owner" })).json()) as AuditListResponse;
    expect(fixed(onlyNov1.items).map((r) => r.action)).toEqual(["invoice_create"]);
    const onlyNov2 = (await (await call("/api/audit?from=2026-11-02&to=2026-11-02", { as: "owner" })).json()) as AuditListResponse;
    expect(fixed(onlyNov2.items).map((r) => r.action)).toEqual(["cash_closed", "login_failure", "payment_create"]);
  });

  it("actor, entity and action filters, and they combine", async () => {
    const byActor = (await (await call("/api/audit?actor=u-staff1", { as: "owner" })).json()) as AuditListResponse;
    expect(fixed(byActor.items).map((r) => r.action)).toEqual(["payment_create"]);
    const byEntity = (await (await call("/api/audit?entity=invoice", { as: "owner" })).json()) as AuditListResponse;
    expect(fixed(byEntity.items).every((r) => r.entity === "invoice")).toBe(true);
    const both = (await (await call("/api/audit?entity=invoice&actor=u-staff1", { as: "owner" })).json()) as AuditListResponse;
    expect(both.items).toEqual([]);
  });

  it("the options list every entity, action and actor in the log", async () => {
    const o = (await (await call("/api/audit/options", { as: "owner" })).json()) as AuditOptionsResponse;
    expect(o.actions).toContain("cash_closed");
    expect(o.entities).toContain("invoice");
    expect(o.actors).toContainEqual({ id: "u-staff1", label: "Person staff1" });
    expect(o.actors).toContainEqual({ id: "anonymous", label: "Not logged in (failed login)" });
  });

  it("bad dates and a reversed range are refused", async () => {
    expect((await call("/api/audit?from=2026-13-01", { as: "owner" })).status).toBe(400);
    expect((await call("/api/audit?from=yesterday", { as: "owner" })).status).toBe(400);
    const reversed = await call("/api/audit?from=2026-11-05&to=2026-11-01", { as: "owner" });
    expect(reversed.status).toBe(400);
    expect(await reversed.json()).toMatchObject({ error: "invalid_range" });
  });
});

describe("owner only (spec 051 R4)", () => {
  it("the owner can read; a staff member cannot", async () => {
    expect((await call("/api/audit", { as: "owner" })).status).toBe(200);
    expect((await call("/api/audit/options", { as: "owner" })).status).toBe(200);
    const denied = await call("/api/audit", { as: "staff1" });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "forbidden", permission: "audit.view" });
    expect((await call("/api/audit/options", { as: "staff1" })).status).toBe(403);
  });
});

describe("read-only (spec 051 R5)", () => {
  it("there is no route that writes to the audit log", async () => {
    const before = (await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())!.n;
    for (const [method, path] of [["POST", "/api/audit"], ["PUT", "/api/audit/x"], ["PATCH", "/api/audit/x"], ["DELETE", "/api/audit/x"], ["POST", "/api/audit/options"]] as const) {
      const res = await call(path, { method, as: "owner", body: {} });
      expect([404, 405], `${method} ${path}`).toContain(res.status);
    }
    expect((await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())!.n).toBe(before);
  });

  it("the table refuses an edit and a delete even from the database side", async () => {
    await expect(t.db.prepare("UPDATE audit_log SET action = 'changed' WHERE id = 'a-2026-10-01T04:00:00.000Z-rate_create-r-old'").run()).rejects.toThrow();
    await expect(t.db.prepare("DELETE FROM audit_log WHERE id = 'a-2026-10-01T04:00:00.000Z-rate_create-r-old'").run()).rejects.toThrow();
  });

  it("rows written by other features show up here (a customer save)", async () => {
    const made = await call("/api/customers", { method: "POST", as: "owner", body: { name: "Audit Check Person" } });
    expect(made.status).toBe(201);
    const body = (await (await call("/api/audit?action=customer_create", { as: "owner" })).json()) as AuditListResponse;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toMatchObject({ entity: "customer", actorName: "Person owner" });
  });
});
