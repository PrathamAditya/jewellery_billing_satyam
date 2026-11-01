import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-01T10:00:00.000Z");
const app = createApp({ now: () => new Date(nowMs) });
let cookie = "";
let userId = "";

beforeAll(async () => {
  t = await createTestDb();
  userId = "owner-user-1";
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
async function login() {
  const res = await call("/api/auth/login", { method: "POST", body: { username: "owner", password: "a long test password" }, auth: false });
  cookie = res.headers.get("set-cookie")!.split(";")[0]!;
}
const create = (body: Record<string, unknown>) => call("/api/customers", { method: "POST", body });
const patch = (id: string, body: Record<string, unknown>) => call(`/api/customers/${id}`, { method: "PATCH", body });
const search = async (q: string, extra = "") => {
  const res = await call(`/api/customers?q=${encodeURIComponent(q)}${extra}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { items: { customerNo: string; name: string }[]; nextCursor: string | null };
};
const names = async (q: string, extra = "") => (await search(q, extra)).items.map((i) => i.name);
const one = async <T>(sql: string, ...args: unknown[]) => t.db.prepare(sql).bind(...args).first<T>();
const count = async (sql: string, ...args: unknown[]) => (await one<{ n: number }>(sql, ...args))!.n;
const audits = async (entityId: string) =>
  (await t.db.prepare("SELECT action, detail_json, actor FROM audit_log WHERE entity_id = ?1 ORDER BY at, id").bind(entityId).all<{ action: string; detail_json: string | null; actor: string }>()).results;

type Saved = { customer: { id: string; customerNo: string; name: string; mobile: string | null; pan: string | null; aadhaarMasked: string | null; address: string | null; voidedAt: string | null }; warnings: { code: string; customerIds: string[] }[] };

describe("access (R15)", () => {
  it("every customer route needs a login", async () => {
    for (const [method, path] of [["GET", "/api/customers"], ["POST", "/api/customers"], ["GET", "/api/customers/x"], ["PATCH", "/api/customers/x"], ["GET", "/api/customers/x/history"], ["POST", "/api/customers/x/void"], ["POST", "/api/customers/x/restore"], ["POST", "/api/customers/x/aadhaar/reveal"]] as const) {
      expect((await call(path, { method, body: {}, auth: false })).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("create (R1 to R4, R15)", () => {
  it("first customer gets C0001; created_by is the logged-in user", async () => {
    const res = await create({ name: "  ramesh   kumar ", mobile: "+91 98765-43210", pan: "abcde1234f", aadhaar: "1234 5678 9012", address: "12 Mall Road" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Saved;
    expect(body.customer).toMatchObject({ customerNo: "C0001", name: "ramesh kumar", mobile: "9876543210", pan: "ABCDE1234F", aadhaarMasked: "XXXX XXXX 9012" });
    expect(JSON.stringify(body)).not.toContain("123456789012");
    const row = (await one<{ created_by: string; updated_by: string; name_search: string; aadhaar: string }>("SELECT * FROM customers WHERE id = ?1", body.customer.id))!;
    expect(row).toMatchObject({ created_by: userId, updated_by: userId, name_search: "ramesh kumar", aadhaar: "123456789012" });
  });

  it("a walk-in customer needs only a name", async () => {
    const res = await create({ name: "Walk In" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Saved).customer).toMatchObject({ mobile: null, pan: null, aadhaarMasked: null });
  });

  it("bad input gives 400 with a message per field and saves nothing", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM customers");
    const res = await create({ name: "A", mobile: "98765", pan: "ABCDE12345" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { field: string; message: string }[] };
    expect(body.error).toBe("validation");
    expect(body.issues).toEqual(
      expect.arrayContaining([
        { field: "name", message: "Name must be 2 to 100 characters" },
        { field: "mobile", message: "Mobile must be 10 digits" },
        { field: "pan", message: "PAN must look like ABCDE1234F" },
      ]),
    );
    expect(await count("SELECT COUNT(*) AS n FROM customers")).toBe(before);
  });

  it("customer numbers count up and ignore the financial year (R2)", async () => {
    const second = ((await (await create({ name: "Second Person" })).json()) as Saved).customer.customerNo;
    expect(second).toBe("C0003"); // Ramesh C0001, Walk In C0002
    nowMs = Date.parse("2027-04-02T10:00:00.000Z"); // new financial year (the old session has expired by now)
    await login();
    const next = ((await (await create({ name: "After April" })).json()) as Saved).customer.customerNo;
    expect(next).toBe("C0004");
    nowMs = Date.parse("2026-11-01T10:00:00.000Z");
  });

  it("a failed create does not use up a number", async () => {
    const last = (await one<{ last_no: number }>("SELECT last_no FROM number_series WHERE series = 'C' AND fy = 'all'"))!.last_no;
    await create({ name: "Pan Owner", pan: "PQRST1234U" });
    const clash = await create({ name: "Pan Clash", pan: "PQRST1234U" });
    expect(clash.status).toBe(409);
    expect((await one<{ last_no: number }>("SELECT last_no FROM number_series WHERE series = 'C' AND fy = 'all'"))!.last_no).toBe(last + 1);
  });
});

describe("duplicates (R5, R6, R7)", () => {
  it("a shared mobile number is a warning, and both customers are saved", async () => {
    const a = (await (await create({ name: "Family One", mobile: "9000000001" })).json()) as Saved;
    expect(a.warnings).toEqual([]);
    const res = await create({ name: "Family Two", mobile: "+91 90000 00001" });
    expect(res.status).toBe(201);
    const b = (await res.json()) as Saved;
    expect(b.warnings).toEqual([{ code: "duplicate_mobile", customerIds: [a.customer.id] }]);
    expect(await count("SELECT COUNT(*) AS n FROM customers WHERE mobile = '9000000001'")).toBe(2);
  });

  it("the same PAN twice is 409 and names the first customer; lowercase is the same PAN", async () => {
    const first = (await (await create({ name: "Pan First", pan: "AAAAA1111A" })).json()) as Saved;
    const res = await create({ name: "Pan Second", pan: "aaaaa1111a" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "duplicate_pan", customerId: first.customer.id, customerNo: first.customer.customerNo, name: "Pan First" });
  });

  it("the same create sent twice with the same id gives one row (200 the second time)", async () => {
    const id = newId();
    const first = await create({ id, name: "Retry Person", mobile: "9111111111" });
    expect(first.status).toBe(201);
    const second = await create({ id, name: "Retry Person", mobile: "91111 11111" });
    expect(second.status).toBe(200);
    expect(((await second.json()) as Saved).customer.id).toBe(id);
    expect(await count("SELECT COUNT(*) AS n FROM customers WHERE id = ?1", id)).toBe(1);
  });

  it("the same id with different content is 409", async () => {
    const id = newId();
    await create({ id, name: "Original Name" });
    const res = await create({ id, name: "Different Name" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "id_conflict" });
    expect((await one<{ name: string }>("SELECT name FROM customers WHERE id = ?1", id))!.name).toBe("Original Name");
  });
});

describe("search (R8)", () => {
  beforeAll(async () => {
    await create({ name: "Kumar Sweets", mobile: "9812345678", pan: "KUMAR1234K" });
    await create({ name: "Sunita Kumari", mobile: "9876500001" });
    await create({ name: "Kum", mobile: "9876500002" });
    await create({ name: "Zorro 50%_off" });
  });

  it("finds by customer number, in any common spelling", async () => {
    expect(await names("C0002")).toEqual(["Walk In"]);
    expect(await names("c0002")).toEqual(["Walk In"]);
    expect(await names("c-2")).toEqual(["Walk In"]);
  });

  it("finds by any part of the name, case-insensitively; exact match first, then by name", async () => {
    expect(await names("KUM")).toEqual(["Kum", "Kumar Sweets", "ramesh kumar", "Sunita Kumari"]);
  });

  it("finds by the last digits of the mobile (3 or more) and by full mobile with +91", async () => {
    expect(await names("5678")).toEqual(["Kumar Sweets"]);
    expect(await names("98123 45678")).toEqual(["Kumar Sweets"]);
    expect(await names("+91 9812345678")).toEqual(["Kumar Sweets"]);
  });

  it("a 2-digit query does not search mobiles", async () => {
    expect(await names("98")).toEqual([]);
    expect(await names("987")).toEqual(expect.arrayContaining(["Sunita Kumari", "Kum"]));
  });

  it("finds by PAN, full or from the start", async () => {
    expect(await names("kumar1234k")).toEqual(["Kumar Sweets"]);
    expect(await names("KUMAR1")).toEqual(["Kumar Sweets"]);
  });

  it("treats % and _ as plain characters", async () => {
    expect(await names("50%_")).toEqual(["Zorro 50%_off"]);
    expect(await names("%")).toEqual(["Zorro 50%_off"]);
  });

  it("empty search lists everyone by name, and pages through with a cursor", async () => {
    const total = await count("SELECT COUNT(*) AS n FROM customers WHERE voided_at IS NULL");
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { items: { customerNo: string }[]; nextCursor: string | null } = await search("", cursor ? `&cursor=${cursor}` : "");
      expect(page.items.length).toBeLessThanOrEqual(20);
      seen.push(...page.items.map((i) => i.customerNo));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(seen.length).toBe(total);
    expect(new Set(seen).size).toBe(total);
    expect(pages).toBe(Math.ceil(total / 20));
  });

  it("nothing is returned with the full Aadhaar", async () => {
    const res = await call("/api/customers?q=ramesh");
    expect(await res.text()).not.toContain("123456789012");
  });
});

describe("edit and history (R10, R11, R14)", () => {
  let id = "";
  beforeAll(async () => {
    id = ((await (await create({ name: "Edit Me", mobile: "9222222222", address: "Old Address", aadhaar: "999988887777" })).json()) as Saved).customer.id;
  });

  it("editing the address: one revision holds the old address; the audit row lists only 'address'; id and number stay", async () => {
    const before = ((await (await call(`/api/customers/${id}`)).json()) as Saved["customer"]);
    const res = await patch(id, { address: "New Address", reason: "moved house" });
    expect(res.status).toBe(200);
    const after = ((await res.json()) as Saved).customer;
    expect(after).toMatchObject({ id, customerNo: before.customerNo, address: "New Address" });
    const revs = (await t.db.prepare("SELECT * FROM record_revisions WHERE entity = 'customer' AND entity_id = ?1").bind(id).all<{ snapshot_json: string; reason: string; created_by: string; revision_no: number }>()).results;
    expect(revs).toHaveLength(1);
    expect(JSON.parse(revs[0]!.snapshot_json)).toMatchObject({ address: "Old Address", name: "Edit Me" });
    expect(revs[0]).toMatchObject({ reason: "moved house", created_by: userId, revision_no: 1 });
    const update = (await audits(id)).find((a) => a.action === "customer_update")!;
    expect(JSON.parse(update.detail_json!)).toEqual({ changed: ["address"], reason: "moved house" });
    expect(update.actor).toBe(userId);
  });

  it("an edit with no real change writes no revision and no audit row", async () => {
    const revsBefore = await count("SELECT COUNT(*) AS n FROM record_revisions WHERE entity_id = ?1", id);
    const auditBefore = (await audits(id)).length;
    const res = await patch(id, { address: "  New Address ", mobile: "+91 92222 22222" });
    expect(res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM record_revisions WHERE entity_id = ?1", id)).toBe(revsBefore);
    expect((await audits(id)).length).toBe(auditBefore);
  });

  it("changing the Aadhaar never puts the number in the audit row or the history", async () => {
    await patch(id, { aadhaar: "111122223333" });
    const rows = await audits(id);
    const update = rows.filter((a) => a.action === "customer_update").map((a) => JSON.parse(a.detail_json!));
    expect(update.at(-1)).toEqual({ changed: ["aadhaar"] });
    expect(JSON.stringify(rows)).not.toMatch(/\d{12}/);
    const hist = await (await call(`/api/customers/${id}/history`)).text();
    expect(hist).not.toMatch(/\d{12}/);
    expect(hist).toContain("XXXX XXXX 7777");
    expect(hist).toContain("XXXX XXXX 3333");
  });

  it("history lists each revision newest first with date, who and the changed fields", async () => {
    await patch(id, { name: "Edit Me Again", city: "Amritsar" });
    const res = await call(`/api/customers/${id}/history`);
    const { items } = (await res.json()) as { items: { revisionNo: number; at: string; by: string; reason: string | null; changes: { field: string; from: string | null; to: string | null }[] }[] };
    expect(items.map((i) => i.revisionNo)).toEqual([3, 2, 1]);
    expect(items[0]).toMatchObject({ by: userId });
    expect(items[0]!.changes).toEqual(expect.arrayContaining([{ field: "name", from: "Edit Me", to: "Edit Me Again" }, { field: "city", from: null, to: "Amritsar" }]));
    expect(items[2]!.changes).toEqual([{ field: "address", from: "Old Address", to: "New Address" }]);
    expect(items[2]!.reason).toBe("moved house");
  });

  it("a renamed customer is found under the new name only", async () => {
    expect(await names("edit me again")).toEqual(["Edit Me Again"]);
    expect(await names("edit me ")).toEqual(["Edit Me Again"]);
  });

  it("a blank optional field clears it", async () => {
    await patch(id, { city: "" });
    expect(((await (await call(`/api/customers/${id}`)).json()) as { city: string | null }).city).toBeNull();
  });

  it("an edit that takes another customer's PAN is 409 and changes nothing", async () => {
    const res = await patch(id, { pan: "AAAAA1111A" });
    expect(res.status).toBe(409);
    expect((await one<{ pan: string | null }>("SELECT pan FROM customers WHERE id = ?1", id))!.pan).toBeNull();
  });

  it("an edit to a shared mobile warns", async () => {
    const res = await patch(id, { mobile: "9000000001" });
    expect(((await res.json()) as Saved).warnings[0]).toMatchObject({ code: "duplicate_mobile" });
  });

  it("bad edit input is 400; unknown id is 404", async () => {
    expect((await patch(id, { mobile: "123" })).status).toBe(400);
    expect((await patch(id, { name: "" })).status).toBe(400);
    expect((await patch("no-such-id", { city: "X" })).status).toBe(404);
  });
});

describe("Aadhaar reveal (R14)", () => {
  it("returns the full number and writes one audit row each time", async () => {
    const id = ((await (await create({ name: "Reveal Me", aadhaar: "5555 6666 7777" })).json()) as Saved).customer.id;
    const res = await call(`/api/customers/${id}/aadhaar/reveal`, { method: "POST" });
    expect(await res.json()).toEqual({ aadhaar: "555566667777" });
    await call(`/api/customers/${id}/aadhaar/reveal`, { method: "POST" });
    const rows = (await audits(id)).filter((a) => a.action === "aadhaar_reveal");
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("555566667777");
  });

  it("is 404 when there is no Aadhaar", async () => {
    const id = ((await (await create({ name: "No Aadhaar" })).json()) as Saved).customer.id;
    expect((await call(`/api/customers/${id}/aadhaar/reveal`, { method: "POST" })).status).toBe(404);
  });
});

describe("void and restore (R13)", () => {
  it("void needs a reason, hides from default search, shows with the switch, restore brings it back", async () => {
    const id = ((await (await create({ name: "Voidable Person", pan: "VOIDA1234V" })).json()) as Saved).customer.id;
    expect((await call(`/api/customers/${id}/void`, { method: "POST", body: {} })).status).toBe(400);
    const res = await call(`/api/customers/${id}/void`, { method: "POST", body: { reason: "duplicate entry" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ voidedAt: expect.any(String), voidReason: "duplicate entry" });
    expect(await names("voidable")).toEqual([]);
    expect(await names("voidable", "&includeVoided=1")).toEqual(["Voidable Person"]);
    expect((await call(`/api/customers/${id}/void`, { method: "POST", body: { reason: "again" } })).status).toBe(409);
    expect((await patch(id, { city: "X" })).status).toBe(409); // restore before editing

    const back = await call(`/api/customers/${id}/restore`, { method: "POST" });
    expect(back.status).toBe(200);
    expect(await names("voidable")).toEqual(["Voidable Person"]);
    expect((await call(`/api/customers/${id}/restore`, { method: "POST" })).status).toBe(409);
    expect((await audits(id)).map((a) => a.action)).toEqual(["customer_create", "customer_void", "customer_restore"]);
  });

  it("a voided customer's PAN can be reused; restoring the old one then fails with 409", async () => {
    const old = ((await (await create({ name: "Old Holder", pan: "REUSE1234R" })).json()) as Saved).customer.id;
    await call(`/api/customers/${old}/void`, { method: "POST", body: { reason: "left" } });
    const fresh = await create({ name: "New Holder", pan: "REUSE1234R" });
    expect(fresh.status).toBe(201);
    const restore = await call(`/api/customers/${old}/restore`, { method: "POST" });
    expect(restore.status).toBe(409);
    expect(await restore.json()).toMatchObject({ error: "duplicate_pan", name: "New Holder" });
    expect((await one<{ voided_at: string | null }>("SELECT voided_at FROM customers WHERE id = ?1", old))!.voided_at).not.toBeNull();
  });

  it("DELETE on customers fails (no hard deletes)", async () => {
    await expect(t.db.prepare("DELETE FROM customers").run()).rejects.toThrow(/never deleted/);
  });
});

describe("search speed with 20,000 customers (R9)", () => {
  it("returns in under 200 ms", async () => {
    await t.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000)
         INSERT INTO customers (id, created_at, created_by, updated_at, updated_by, customer_no, name, name_search, mobile, pan)
         SELECT 'bulk-' || i, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test',
                'B-' || i, 'Zzbulk Person ' || i, 'zzbulk person ' || i, printf('7%09d', i),
                CASE WHEN i % 100 = 0 THEN printf('ZZZZZ%04dZ', i / 100) END
         FROM n`,
      )
      .run();
    const timed = async (q: string) => {
      const start = performance.now();
      const res = await call(`/api/customers?q=${encodeURIComponent(q)}`);
      const ms = performance.now() - start;
      expect(res.status).toBe(200);
      return { ms, body: (await res.json()) as { items: unknown[] } };
    };
    for (const q of ["zzbulk person 19999", "7000019999", "ZZZZZ0199", "person 1"]) {
      const { ms, body } = await timed(q);
      expect(body.items.length).toBeGreaterThan(0);
      expect(ms, `query ${q}`).toBeLessThan(200);
    }
  });
});
