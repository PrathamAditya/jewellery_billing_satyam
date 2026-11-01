import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS, type Permission } from "@jewellery/shared";
import { createApp } from "../src/index";
import { PERMISSION_MAP, ruleFor } from "../src/auth/permissionMap";
import { hashPassword } from "../src/auth/password";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let nowMs = Date.parse("2026-11-01T10:00:00.000Z");
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

/** A user with a role, inserted directly (no forced password change), and their login cookie. */
async function person(username: string, role: string, extra: { mustChange?: boolean; disabled?: boolean } = {}) {
  const id = `u-${username}`;
  await t.db
    .prepare(
      `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name, must_change_password, disabled_at)
       VALUES (?1, '2026-11-01T00:00:00.000Z', 'test', '2026-11-01T00:00:00.000Z', 'test', ?2, ?3, ?4, ?2, ?5, ?6)`,
    )
    .bind(id, username, await hashPassword(PASSWORD, 1000), role, extra.mustChange ? 1 : 0, extra.disabled ? "2026-11-01T00:00:00.000Z" : null)
    .run();
  const res = await call("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  if (res.status === 200) cookies[username] = res.headers.get("set-cookie")!.split(";")[0]!;
  return { id, username };
}

beforeAll(async () => {
  t = await createTestDb();
  await person("owner", "owner");
  await person("manager1", "manager");
  await person("staff1", "staff");
  await person("viewer1", "viewer");
});
afterAll(() => t.dispose());

describe("every route is in the permission table (R3)", () => {
  it("each registered /api route has a rule (or is the public health check)", () => {
    const missing = app.routes
      .filter((r) => r.method !== "ALL" && r.path.startsWith("/api/") && !r.path.includes("*"))
      .filter((r) => !ruleFor(r.method, r.path));
    expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it("every rule names a permission that exists", () => {
    const known = new Set<string>([...PERMISSIONS, "any", "public"]);
    expect(PERMISSION_MAP.filter((r) => !known.has(r.permission))).toEqual([]);
  });

  it("the default roles only use permissions that exist", () => {
    for (const r of DEFAULT_ROLES) expect(r.permissions.every((p) => (PERMISSIONS as readonly string[]).includes(p))).toBe(true);
  });
});

describe("default roles (R2) on real routes", () => {
  // [method, concrete path, permission needed]. A 403 means denied; anything else means the permission was accepted.
  const matrix: [string, string, Permission | "any"][] = [
    ["GET", "/api/customers", "customers.view"],
    ["POST", "/api/customers", "customers.create"],
    ["PATCH", "/api/customers/none", "customers.edit"],
    ["POST", "/api/customers/none/void", "customers.void"],
    ["GET", "/api/rates", "rates.view"],
    ["PUT", "/api/rates/2026-10-01/silver", "rates.edit"],
    ["GET", "/api/invoices", "invoices.view"],
    ["POST", "/api/invoices", "invoices.create"],
    ["PUT", "/api/invoices/none", "invoices.edit"],
    ["POST", "/api/invoices/none/void", "invoices.void"],
    ["GET", "/api/settings", "settings.view"],
    ["PUT", "/api/settings/business", "settings.manage"],
    ["GET", "/api/users", "users.manage"],
    ["GET", "/api/roles", "users.manage"],
  ];
  const allowed: Record<string, Set<string>> = {
    owner: new Set(PERMISSIONS),
    manager: new Set(DEFAULT_ROLES.find((r) => r.name === "manager")!.permissions),
    staff: new Set(DEFAULT_ROLES.find((r) => r.name === "staff")!.permissions),
    viewer: new Set(DEFAULT_ROLES.find((r) => r.name === "viewer")!.permissions),
  };
  for (const who of ["owner", "manager1", "staff1", "viewer1"]) {
    const role = who.replace(/1$/, "");
    it.each(matrix)(`${role}: %s %s`, async (method, path, permission) => {
      const res = await call(path, { method, as: who, body: {} });
      if (allowed[role]!.has(permission)) expect(res.status, `${role} should reach ${permission}`).not.toBe(403);
      else expect(res.status, `${role} should not reach ${permission}`).toBe(403);
    });
  }

  it("a 403 says which permission is missing and is never a silent failure", async () => {
    const res = await call("/api/users", { as: "staff1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden", permission: "users.manage" });
  });

  it("an unknown path still gets the JSON 404 for a logged-in person", async () => {
    const res = await call("/api/nope", { as: "staff1" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("temporary passwords (R5, R6)", () => {
  it("a new user with a temporary password can only read who they are and change the password", async () => {
    const owner = call("/api/users", { method: "POST", as: "owner", body: { username: "newperson", displayName: "New Person", role: "staff", temporaryPassword: "temporary-1234" } });
    expect((await owner).status).toBe(201);
    const login = await call("/api/auth/login", { method: "POST", body: { username: "newperson", password: "temporary-1234" } });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ username: "newperson", role: "staff", mustChangePassword: true });
    cookies.newperson = login.headers.get("set-cookie")!.split(";")[0]!;

    const blocked = await call("/api/customers", { as: "newperson" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: "password_change_required" });
    expect((await call("/api/auth/me", { as: "newperson" })).status).toBe(200);

    const changed = await call("/api/auth/change-password", { method: "POST", as: "newperson", body: { currentPassword: "temporary-1234", newPassword: "my own passphrase" } });
    expect(changed.status).toBe(200);
    expect(await (await call("/api/auth/me", { as: "newperson" })).json()).toMatchObject({ mustChangePassword: false });
    expect((await call("/api/customers", { as: "newperson" })).status).toBe(200);
  });

  it("validation: short temporary password, duplicate username, unknown role", async () => {
    const short = await call("/api/users", { method: "POST", as: "owner", body: { username: "shortpw", displayName: "Short Pw", role: "staff", temporaryPassword: "short" } });
    expect(short.status).toBe(400);
    const dup = await call("/api/users", { method: "POST", as: "owner", body: { username: "newperson", displayName: "Dup", role: "staff", temporaryPassword: "temporary-1234" } });
    expect(dup.status).toBe(409);
    const role = await call("/api/users", { method: "POST", as: "owner", body: { username: "norole", displayName: "No Role", role: "ghost", temporaryPassword: "temporary-1234" } });
    expect(role.status).toBe(400);
  });

  it("staff cannot create users (403)", async () => {
    expect((await call("/api/users", { method: "POST", as: "staff1", body: { username: "x1y", displayName: "Xy", role: "staff", temporaryPassword: "temporary-1234" } })).status).toBe(403);
  });
});

describe("disable, reset and sessions (R5)", () => {
  it("disabling a user logs them out at once; enabling lets them log in again", async () => {
    await person("leaver", "staff");
    expect((await call("/api/customers", { as: "leaver" })).status).toBe(200);
    const id = "u-leaver";
    expect((await call(`/api/users/${id}`, { method: "PATCH", as: "owner", body: { disabled: true } })).status).toBe(200);
    expect((await call("/api/customers", { as: "leaver" })).status).toBe(401);
    expect((await call(`/api/users/${id}`, { method: "PATCH", as: "owner", body: { disabled: false } })).status).toBe(200);
    expect((await call("/api/auth/login", { method: "POST", body: { username: "leaver", password: PASSWORD } })).status).toBe(200);
  });

  it("reset password ends that person's sessions and forces a change; end-sessions leaves others alone", async () => {
    await person("resetme", "staff");
    await person("bystander", "staff");
    const id = "u-resetme";
    expect((await call(`/api/users/${id}/reset-password`, { method: "POST", as: "owner", body: { temporaryPassword: "new-temp-9876" } })).status).toBe(200);
    expect((await call("/api/customers", { as: "resetme" })).status).toBe(401);
    expect((await call("/api/customers", { as: "bystander" })).status).toBe(200);
    expect((await call(`/api/users/u-bystander/end-sessions`, { method: "POST", as: "owner" })).status).toBe(200);
    expect((await call("/api/customers", { as: "bystander" })).status).toBe(401);
  });

  it("the last active owner cannot be disabled or changed to another role", async () => {
    const dis = await call("/api/users/u-owner", { method: "PATCH", as: "owner", body: { disabled: true } });
    expect(dis.status).toBe(409);
    expect(await dis.json()).toMatchObject({ error: "last_owner" });
    expect((await call("/api/users/u-owner", { method: "PATCH", as: "owner", body: { role: "manager" } })).status).toBe(409);
  });

  it("with two active owners the first can be disabled", async () => {
    await person("owner2", "owner");
    expect((await call("/api/users/u-owner2", { method: "PATCH", as: "owner", body: { role: "owner" } })).status).toBe(200);
    expect((await call("/api/users/u-owner", { method: "PATCH", as: "owner2", body: { disabled: true } })).status).toBe(200);
    expect((await call("/api/users/u-owner", { method: "PATCH", as: "owner2", body: { disabled: false } })).status).toBe(200);
    // Disabling logged the first owner out (R5). Log them back in for the tests that follow.
    const relogin = await call("/api/auth/login", { method: "POST", body: { username: "owner", password: PASSWORD } });
    expect(relogin.status).toBe(200);
    cookies.owner = relogin.headers.get("set-cookie")!.split(";")[0]!;
  });
});

describe("activity (R7)", () => {
  it("a staff member's create shows in their activity with the action and time, never the values", async () => {
    const created = await call("/api/customers", { method: "POST", as: "staff1", body: { name: "Secret Name Surname", mobile: "9000012345" } });
    expect(created.status).toBe(201);
    const res = await call("/api/users/u-staff1/activity", { as: "owner" });
    const body = (await res.json()) as { items: { action: string; entity: string; at: string }[] };
    expect(body.items.some((i) => i.action === "customer_create" && i.entity === "customer" && i.at)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Secret Name Surname");
    expect(JSON.stringify(body)).not.toContain("9000012345");
    expect((await call("/api/users/u-staff1/activity", { as: "staff1" })).status).toBe(403);
  });
});

describe("roles (R2)", () => {
  it("the owner role is locked; a new role gets exactly the permissions it was given", async () => {
    expect((await call("/api/roles/owner", { method: "PATCH", as: "owner", body: { permissions: ["customers.view"] } })).status).toBe(409);
    const created = await call("/api/roles", { method: "POST", as: "owner", body: { name: "cashier", label: "Cashier", permissions: ["invoices.view", "invoices.create", "payments.create"] } });
    expect(created.status).toBe(201);
    await person("cashier1", "cashier");
    expect((await call("/api/invoices", { as: "cashier1" })).status).toBe(200);
    expect((await call("/api/invoices/none/void", { method: "POST", as: "cashier1", body: { reason: "x" } })).status).toBe(403);
  });

  it("unknown permissions and duplicate role names are refused", async () => {
    expect((await call("/api/roles", { method: "POST", as: "owner", body: { name: "bad", label: "Bad", permissions: ["make.coffee"] } })).status).toBe(400);
    expect((await call("/api/roles", { method: "POST", as: "owner", body: { name: "cashier", label: "Again", permissions: [] } })).status).toBe(409);
  });

  it("changing a role takes effect on the next request, without a new login", async () => {
    expect((await call("/api/customers", { as: "viewer1" })).status).toBe(200);
    expect((await call("/api/customers", { method: "POST", as: "viewer1", body: { name: "Try Create" } })).status).toBe(403);
    expect((await call("/api/roles/viewer", { method: "PATCH", as: "owner", body: { permissions: [...DEFAULT_ROLES.find((r) => r.name === "viewer")!.permissions, "customers.create"] } })).status).toBe(200);
    expect((await call("/api/customers", { method: "POST", as: "viewer1", body: { name: "Now Allowed" } })).status).toBe(201);
    await call("/api/roles/viewer", { method: "PATCH", as: "owner", body: { permissions: DEFAULT_ROLES.find((r) => r.name === "viewer")!.permissions } });
  });
});
