import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { changePasswordRequestSchema } from "@jewellery/shared";
import { createApp } from "../src/index";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { ownerUpsertSql } from "../src/auth/owner";
import { sha256Hex } from "../src/auth/session";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-01T10:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const app = createApp({ now: () => new Date(nowMs) });

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  nowMs = Date.parse("2026-11-01T10:00:00.000Z");
  await t.db.prepare("DELETE FROM sessions").run();
  await t.db.prepare("DELETE FROM login_attempts").run();
});

const PASSWORD = "correct horse battery";
let userCounter = 0;

/** A user per test (users cannot be deleted). Low iteration count keeps the suite fast; the format is the same. */
async function makeUser(opts: { disabled?: boolean } = {}) {
  const username = `owner${++userCounter}`;
  const id = `user-${userCounter}`;
  await t.db
    .prepare(
      `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, disabled_at)
       VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', ?2, ?3, 'owner', ?4)`,
    )
    .bind(id, username, await hashPassword(PASSWORD, 1000), opts.disabled ? "2026-11-01T00:00:00.000Z" : null)
    .run();
  return { id, username };
}

type Opts = { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string };
function call(path: string, o: Opts = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.ip) headers["CF-Connecting-IP"] = o.ip;
  const origin = o.origin === undefined ? "http://localhost" : o.origin;
  if (origin && method !== "GET") headers.Origin = origin;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }, { DB: t.db });
}

const login = (username: string, password: string, ip = "1.1.1.1") =>
  call("/api/auth/login", { method: "POST", body: { username, password }, ip });

function cookieOf(res: Response): string {
  const header = res.headers.get("set-cookie")!;
  return header.split(";")[0]!;
}

async function loggedIn(ip?: string) {
  const u = await makeUser();
  const res = await login(u.username, PASSWORD, ip);
  expect(res.status).toBe(200);
  return { ...u, cookie: cookieOf(res), res };
}

const one = async <T>(sql: string, ...args: unknown[]) => t.db.prepare(sql).bind(...args).first<T>();
const auditActions = async (entityId: string) =>
  (await t.db.prepare("SELECT action FROM audit_log WHERE entity_id = ?1 ORDER BY at, id").bind(entityId).all<{ action: string }>()).results.map((r) => r.action);

describe("passwords (R1)", () => {
  it("hash then verify: right passes, wrong fails, format is self-describing, hashes differ", async () => {
    const a = await hashPassword("a long enough password");
    const b = await hashPassword("a long enough password");
    expect(a).toMatch(/^pbkdf2\$sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("a long enough password", a)).toBe(true);
    expect(await verifyPassword("a long enough passwore", a)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("uses the iteration count stored in the hash", async () => {
    const h = await hashPassword("some password!", 2000);
    expect(h.split("$")[2]).toBe("2000");
    expect(await verifyPassword("some password!", h)).toBe(true);
  });
});

describe("login (R4, R5, R11)", () => {
  it("success: 200, cookie attributes, body has id/username/role and no hash", async () => {
    const u = await makeUser();
    const res = await login(u.username, PASSWORD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: u.id, username: u.username, role: "owner" });
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Domain");
  });

  it("username is case-insensitive and trimmed", async () => {
    const u = await makeUser();
    expect((await login(`  ${u.username.toUpperCase()} `, PASSWORD)).status).toBe(200);
  });

  it("wrong password and unknown username give identical 401 responses", async () => {
    const u = await makeUser();
    const wrong = await login(u.username, "not the password");
    const unknown = await login("nobody-here", "not the password");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(await (await login(u.username, "x")).json()).toMatchObject({ message: "Invalid username or password" });
  });

  it("rejects a malformed body with 400", async () => {
    expect((await call("/api/auth/login", { method: "POST", body: { username: "x" } })).status).toBe(400);
    const res = await app.request(
      "/api/auth/login",
      { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: "not json" },
      { DB: t.db },
    );
    expect(res.status).toBe(400);
  });

  it("the database holds only the token hash, never the cookie value", async () => {
    const { cookie } = await loggedIn();
    const token = cookie.split("=")[1]!;
    const rows = (await t.db.prepare("SELECT * FROM sessions").all<Record<string, string>>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("a disabled user cannot log in, and an existing session stops working", async () => {
    const u = await makeUser();
    const ok = await login(u.username, PASSWORD);
    const cookie = cookieOf(ok);
    expect((await call("/api/auth/me", { cookie })).status).toBe(200);
    await t.db.prepare("UPDATE users SET disabled_at = '2026-11-01T11:00:00.000Z' WHERE id = ?1").bind(u.id).run();
    expect((await call("/api/auth/me", { cookie })).status).toBe(401);
    const again = await login(u.username, PASSWORD);
    expect(again.status).toBe(401);
    expect(await again.json()).toMatchObject({ message: "Invalid username or password" });
  });
});

describe("access control (R8, R9)", () => {
  it("/api/auth/me: 401 without a cookie, 200 with one", async () => {
    const { cookie, username } = await loggedIn();
    const none = await call("/api/auth/me");
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: "unauthorized" });
    const res = await call("/api/auth/me", { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username });
  });

  it("a made-up cookie is 401", async () => {
    expect((await call("/api/auth/me", { cookie: "__Host-session=abc" })).status).toBe(401);
  });

  it("/api/health is public; /api/nope is 401 without a session and JSON 404 with one", async () => {
    expect((await call("/api/health")).status).toBe(200);
    const anon = await call("/api/nope");
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: "unauthorized" });
    const { cookie } = await loggedIn();
    const authed = await call("/api/nope", { cookie });
    expect(authed.status).toBe(404);
    expect(await authed.json()).toEqual({ error: "not_found" });
  });

  it("only GET /api/health is public: other methods and logout need a session", async () => {
    expect((await call("/api/health", { method: "POST" })).status).toBe(401);
    expect((await call("/api/auth/logout", { method: "POST" })).status).toBe(401);
    expect((await call("/api/auth/change-password", { method: "POST", body: {} })).status).toBe(401);
  });
});

describe("logout (R7)", () => {
  it("clears the cookie, removes the session row, and the old cookie then gets 401", async () => {
    const { cookie } = await loggedIn();
    const res = await call("/api/auth/logout", { method: "POST", cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM sessions"))!.n).toBe(0);
    expect((await call("/api/auth/me", { cookie })).status).toBe(401);
  });
});

describe("session lifetime (R6)", () => {
  it("idle 31 days: 401 and the row is removed", async () => {
    const { cookie } = await loggedIn();
    nowMs += 31 * DAY;
    expect((await call("/api/auth/me", { cookie })).status).toBe(401);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM sessions"))!.n).toBe(0);
  });

  it("idle 2 days: still valid, last_seen is refreshed, expiry moves out, cookie is re-sent", async () => {
    const { cookie } = await loggedIn();
    nowMs += 2 * DAY;
    const res = await call("/api/auth/me", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=2592000");
    const row = (await one<{ last_seen_at: string; expires_at: string }>("SELECT last_seen_at, expires_at FROM sessions"))!;
    expect(row.last_seen_at).toBe(new Date(nowMs).toISOString());
    expect(row.expires_at).toBe(new Date(nowMs + 30 * DAY).toISOString());
  });

  it("idle 12 hours: valid and not refreshed", async () => {
    const { cookie } = await loggedIn();
    const before = (await one<{ last_seen_at: string }>("SELECT last_seen_at FROM sessions"))!.last_seen_at;
    nowMs += 12 * HOUR;
    const res = await call("/api/auth/me", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await one<{ last_seen_at: string }>("SELECT last_seen_at FROM sessions"))!.last_seen_at).toBe(before);
  });

  it("a session kept in use every 2 days never expires", async () => {
    const { cookie } = await loggedIn();
    for (let i = 0; i < 20; i++) {
      nowMs += 2 * DAY;
      expect((await call("/api/auth/me", { cookie })).status).toBe(200);
    }
  });

  it("two devices can be logged in at once", async () => {
    const u = await makeUser();
    const a = cookieOf(await login(u.username, PASSWORD));
    const b = cookieOf(await login(u.username, PASSWORD));
    expect(a).not.toBe(b);
    expect((await call("/api/auth/me", { cookie: a })).status).toBe(200);
    expect((await call("/api/auth/me", { cookie: b })).status).toBe(200);
  });
});

describe("origin check (R10)", () => {
  it("POST with a foreign or missing Origin is 403, with the matching Origin it works", async () => {
    const { cookie } = await loggedIn();
    expect((await call("/api/auth/logout", { method: "POST", cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/api/auth/logout", { method: "POST", cookie, origin: null })).status).toBe(403);
    expect((await call("/api/auth/logout", { method: "POST", cookie, origin: "not a url" })).status).toBe(403);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM sessions"))!.n).toBe(1);
    expect((await call("/api/auth/logout", { method: "POST", cookie, origin: "http://localhost" })).status).toBe(200);
  });

  it("applies to login too", async () => {
    const u = await makeUser();
    const res = await call("/api/auth/login", { method: "POST", body: { username: u.username, password: PASSWORD }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("rate limit (R12)", () => {
  it("5 failures from one IP, then the 6th attempt with the right password is 429; works again after 16 minutes", async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) expect((await login(u.username, "wrong password", "9.9.9.9")).status).toBe(401);
    const blocked = await login(u.username, PASSWORD, "9.9.9.9");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_attempts" });
    expect(blocked.headers.get("set-cookie")).toBeNull();
    // another IP is not affected
    expect((await login(u.username, PASSWORD, "8.8.8.8")).status).toBe(200);
    nowMs += 16 * MIN;
    expect((await login(u.username, PASSWORD, "9.9.9.9")).status).toBe(200);
  });

  it("blocked attempts do not extend the block", async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) await login(u.username, "wrong password", "7.7.7.7");
    nowMs += 10 * MIN;
    expect((await login(u.username, PASSWORD, "7.7.7.7")).status).toBe(429);
    nowMs += 6 * MIN; // 16 minutes after the failures
    expect((await login(u.username, PASSWORD, "7.7.7.7")).status).toBe(200);
  });

  it("30 failures across IPs give 429 for a new IP, until the window passes", async () => {
    const u = await makeUser();
    for (let i = 0; i < 30; i++) expect((await login(u.username, "wrong password", `10.0.0.${i}`)).status).toBe(401);
    expect((await login(u.username, PASSWORD, "10.0.1.1")).status).toBe(429);
    nowMs += 16 * MIN;
    expect((await login(u.username, PASSWORD, "10.0.1.1")).status).toBe(200);
  });

  it("failed-login rows older than a day are cleaned up on login", async () => {
    const u = await makeUser();
    await t.db
      .prepare("INSERT INTO login_attempts (id, at, ip) VALUES ('old', ?1, '5.5.5.5')")
      .bind(new Date(nowMs - 25 * HOUR).toISOString())
      .run();
    await login(u.username, PASSWORD);
    expect(await one("SELECT id FROM login_attempts WHERE id = 'old'")).toBeNull();
  });
});

describe("change password (R13)", () => {
  const NEW_PASSWORD = "a brand new passphrase";
  const change = (cookie: string, currentPassword: string, newPassword: string) =>
    call("/api/auth/change-password", { method: "POST", cookie, body: { currentPassword, newPassword } });

  it("wrong current password is 403, a 9-character new password is 400", async () => {
    const { cookie } = await loggedIn();
    expect((await change(cookie, "wrong current", NEW_PASSWORD)).status).toBe(403);
    expect((await change(cookie, PASSWORD, "123456789")).status).toBe(400);
    expect(changePasswordRequestSchema.safeParse({ currentPassword: "x", newPassword: "1234567890" }).success).toBe(true);
  });

  it("success keeps the current session, deletes the others, and swaps the password", async () => {
    const u = await makeUser();
    const here = cookieOf(await login(u.username, PASSWORD));
    const other = cookieOf(await login(u.username, PASSWORD));
    const res = await change(here, PASSWORD, NEW_PASSWORD);
    expect(res.status).toBe(200);
    expect((await call("/api/auth/me", { cookie: here })).status).toBe(200);
    expect((await call("/api/auth/me", { cookie: other })).status).toBe(401);
    expect((await login(u.username, PASSWORD)).status).toBe(401);
    expect((await login(u.username, NEW_PASSWORD)).status).toBe(200);
  });

  it("the new hash is stored in the R1 format and updated_by is the user", async () => {
    const u = await makeUser();
    const cookie = cookieOf(await login(u.username, PASSWORD));
    await change(cookie, PASSWORD, NEW_PASSWORD);
    const row = (await one<{ password_hash: string; updated_by: string }>("SELECT password_hash, updated_by FROM users WHERE id = ?1", u.id))!;
    expect(row.password_hash).toMatch(/^pbkdf2\$sha256\$100000\$/);
    expect(row.updated_by).toBe(u.id);
  });
});

describe("audit (R14)", () => {
  it("login success, failure, logout and password change each write an audit row, with no password or token", async () => {
    const u = await makeUser();
    await login(u.username, "wrong password");
    const cookie = cookieOf(await login(u.username, PASSWORD));
    const token = cookie.split("=")[1]!;
    await call("/api/auth/change-password", { method: "POST", cookie, body: { currentPassword: PASSWORD, newPassword: "another good password" } });
    await call("/api/auth/logout", { method: "POST", cookie });
    expect(await auditActions(u.id)).toEqual(["login_failure", "login_success", "password_change", "logout"]);
    const all = JSON.stringify((await t.db.prepare("SELECT * FROM audit_log").all()).results);
    for (const secret of [PASSWORD, "wrong password", "another good password", token]) expect(all).not.toContain(secret);
  });

  it("an unknown username is audited without storing what was typed", async () => {
    await login("typed-by-mistake-secret", "wrong password", "4.4.4.4");
    const rows = (await t.db.prepare("SELECT detail_json FROM audit_log WHERE entity_id = 'unknown'").all<{ detail_json: string }>()).results;
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("typed-by-mistake-secret");
  });
});

describe("users table", () => {
  it("rejects DELETE (no hard deletes)", async () => {
    const u = await makeUser();
    await expect(t.db.prepare("DELETE FROM users WHERE id = ?1").bind(u.id).run()).rejects.toThrow(/never deleted/);
  });
});

describe("owner:set SQL (R3)", () => {
  async function run(passwordHash: string, id: string, auditId: string) {
    const sql = ownerUpsertSql({ id, passwordHash, now: "2026-11-01T09:00:00.000Z", auditId });
    const statements = sql.split(";\n").map((x) => x.replace(/\n/g, " ").trim()).filter(Boolean);
    await t.db.batch(statements.map((x) => t.db.prepare(x)));
  }

  it("creates the owner, then a second run replaces only the hash, ends sessions and is audited", async () => {
    await run(await hashPassword("first password!", 1000), "owner-id-1", "audit-owner-1");
    const created = (await one<{ id: string; role: string }>("SELECT id, role FROM users WHERE username = 'owner'"))!;
    expect(created).toEqual({ id: "owner-id-1", role: "owner" });
    expect((await login("owner", "first password!")).status).toBe(200);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM sessions"))!.n).toBe(1);

    await run(await hashPassword("second password!", 1000), "owner-id-2", "audit-owner-2");
    expect((await one<{ id: string }>("SELECT id FROM users WHERE username = 'owner'"))!.id).toBe("owner-id-1");
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM sessions"))!.n).toBe(0);
    expect((await login("owner", "first password!")).status).toBe(401);
    expect((await login("owner", "second password!")).status).toBe(200);
    expect((await auditActions("owner-id-1")).filter((a) => a === "owner_password_set")).toHaveLength(2);
  });
});
