import { Hono } from "hono";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, PERMISSIONS, newId, roleNameSchema, rolePermissionsSchema } from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { readJson } from "../http";
import { hashPassword } from "../auth/password";
import { LOCKED_OWNER } from "../auth/permissions";

export const userRoutes = new Hono<AppEnv>();
export const roleRoutes = new Hono<AppEnv>();

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const PAGE = 50;

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  disabled_at: string | null;
  last_login_at: string | null;
  must_change_password: number;
};

const toUser = (r: UserRow) => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name || r.username,
  role: r.role,
  disabled: r.disabled_at !== null,
  lastLoginAt: r.last_login_at,
  mustChangePassword: r.must_change_password === 1,
});

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

async function roleExists(db: D1Database, role: string) {
  return !!(await db.prepare("SELECT name FROM roles WHERE name = ?1").bind(role).first());
}

/** Spec 004 R5: the last active owner cannot be disabled or given another role. */
async function wouldRemoveLastOwner(db: D1Database, target: UserRow): Promise<boolean> {
  if (target.role !== "owner" || target.disabled_at) return false;
  const others = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled_at IS NULL AND id != ?1").bind(target.id).first<{ n: number }>();
  return (others?.n ?? 0) === 0;
}

userRoutes.get("/", async (c) => {
  const rows = (await c.env.DB.prepare("SELECT id, username, display_name, role, disabled_at, last_login_at, must_change_password FROM users ORDER BY username").all<UserRow>()).results;
  return c.json({ items: rows.map(toUser) });
});

userRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const b = (await readJson(c)) as { username?: string; displayName?: string; role?: string; temporaryPassword?: string } | undefined;
  const username = (b?.username ?? "").trim().toLowerCase();
  const displayName = (b?.displayName ?? "").trim();
  const role = b?.role ?? "";
  const pw = b?.temporaryPassword ?? "";
  const issues: { field: string; message: string }[] = [];
  if (!USERNAME.test(username)) issues.push({ field: "username", message: "Username: 3 to 30 letters, digits, dot, dash or underscore" });
  if (displayName.length < 2 || displayName.length > 60) issues.push({ field: "displayName", message: "Name must be 2 to 60 characters" });
  if (!(await roleExists(db, role))) issues.push({ field: "role", message: "Choose a role" });
  if (pw.length < MIN_PASSWORD_LENGTH || pw.length > MAX_PASSWORD_LENGTH) issues.push({ field: "temporaryPassword", message: `Temporary password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  if (issues.length) return c.json({ error: "validation", issues }, 400);

  const user = c.get("user");
  const id = newId();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users (id, created_at, created_by, updated_at, updated_by, username, password_hash, role, display_name, must_change_password)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, ?6, ?7, 1)`,
        )
        .bind(id, now, user.id, username, await hashPassword(pw), role, displayName),
      auditStatement(db, { actor: user.id, action: "user_create", entity: "user", entityId: id, detail: { role } }),
    ]);
  } catch (e) {
    if (isUniqueError(e)) return c.json({ error: "username_taken", message: "That username is already used" }, 409);
    throw e;
  }
  return c.json(toUser((await db.prepare("SELECT id, username, display_name, role, disabled_at, last_login_at, must_change_password FROM users WHERE id = ?1").bind(id).first<UserRow>())!), 201);
});

userRoutes.patch("/:id", async (c) => {
  const db = c.env.DB;
  const actor = c.get("user");
  const target = await db.prepare("SELECT id, username, display_name, role, disabled_at, last_login_at, must_change_password FROM users WHERE id = ?1").bind(c.req.param("id")).first<UserRow>();
  if (!target) return c.json({ error: "not_found" }, 404);
  const b = (await readJson(c)) as { role?: string; displayName?: string; disabled?: boolean } | undefined;
  if (!b) return c.json({ error: "invalid_request" }, 400);

  if (b.role !== undefined && b.role !== target.role) {
    if (!(await roleExists(db, b.role))) return c.json({ error: "validation", issues: [{ field: "role", message: "Choose a role" }] }, 400);
    if (await wouldRemoveLastOwner(db, target)) return c.json({ error: "last_owner", message: "There must always be at least one active owner" }, 409);
  }
  if (b.disabled === true && (await wouldRemoveLastOwner(db, target))) {
    return c.json({ error: "last_owner", message: "There must always be at least one active owner" }, 409);
  }
  if (b.displayName !== undefined && (b.displayName.trim().length < 2 || b.displayName.trim().length > 60)) {
    return c.json({ error: "validation", issues: [{ field: "displayName", message: "Name must be 2 to 60 characters" }] }, 400);
  }

  const now = new Date().toISOString();
  const statements = [];
  const changed: string[] = [];
  if (b.role !== undefined && b.role !== target.role) {
    statements.push(db.prepare("UPDATE users SET role = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1").bind(target.id, b.role, now, actor.id));
    changed.push("role");
  }
  if (b.displayName !== undefined && b.displayName.trim() !== target.display_name) {
    statements.push(db.prepare("UPDATE users SET display_name = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1").bind(target.id, b.displayName.trim(), now, actor.id));
    changed.push("displayName");
  }
  if (b.disabled !== undefined && (b.disabled === true) !== (target.disabled_at !== null)) {
    statements.push(
      db.prepare("UPDATE users SET disabled_at = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1").bind(target.id, b.disabled ? now : null, now, actor.id),
    );
    if (b.disabled) statements.push(db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(target.id)); // a disabled person is logged out at once
    changed.push(b.disabled ? "disabled" : "enabled");
  }
  if (changed.length === 0) return c.json(toUser(target));
  statements.push(auditStatement(db, { actor: actor.id, action: "user_update", entity: "user", entityId: target.id, detail: { changed, role: b.role } }));
  await db.batch(statements);
  return c.json(toUser((await db.prepare("SELECT id, username, display_name, role, disabled_at, last_login_at, must_change_password FROM users WHERE id = ?1").bind(target.id).first<UserRow>())!));
});

userRoutes.post("/:id/reset-password", async (c) => {
  const db = c.env.DB;
  const actor = c.get("user");
  const target = await db.prepare("SELECT id FROM users WHERE id = ?1").bind(c.req.param("id")).first<{ id: string }>();
  if (!target) return c.json({ error: "not_found" }, 404);
  const b = (await readJson(c)) as { temporaryPassword?: string } | undefined;
  const pw = b?.temporaryPassword ?? "";
  if (pw.length < MIN_PASSWORD_LENGTH || pw.length > MAX_PASSWORD_LENGTH) return c.json({ error: "validation", issues: [{ field: "temporaryPassword", message: `Temporary password must be at least ${MIN_PASSWORD_LENGTH} characters` }] }, 400);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?2, must_change_password = 1, updated_at = ?3, updated_by = ?4 WHERE id = ?1").bind(target.id, await hashPassword(pw), now, actor.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(target.id),
    auditStatement(db, { actor: actor.id, action: "user_password_reset", entity: "user", entityId: target.id }),
  ]);
  return c.json({ ok: true });
});

userRoutes.post("/:id/end-sessions", async (c) => {
  const db = c.env.DB;
  const actor = c.get("user");
  const target = await db.prepare("SELECT id FROM users WHERE id = ?1").bind(c.req.param("id")).first<{ id: string }>();
  if (!target) return c.json({ error: "not_found" }, 404);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(target.id),
    auditStatement(db, { actor: actor.id, action: "user_sessions_ended", entity: "user", entityId: target.id }),
  ]);
  return c.json({ ok: true });
});

/** Spec 004 R7: what a person did. Action, record and time only, never the values. */
userRoutes.get("/:id/activity", async (c) => {
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  const rows = (
    await c.env.DB.prepare(
      `SELECT action, entity, entity_id, at FROM audit_log WHERE actor = ?1 AND action != 'login_failure'
       ORDER BY at DESC, id DESC LIMIT ${PAGE + 1} OFFSET ${offset}`,
    )
      .bind(c.req.param("id"))
      .all<{ action: string; entity: string; entity_id: string; at: string }>()
  ).results;
  return c.json({
    items: rows.slice(0, PAGE).map((r) => ({ action: r.action, entity: r.entity, entityId: r.entity_id, at: r.at })),
    nextCursor: rows.length > PAGE ? String(offset + PAGE) : null,
  });
});

// ---- roles ----

type RoleRow = { name: string; label: string; permissions_json: string; system: number };
const toRole = (r: RoleRow) => ({ name: r.name, label: r.label, permissions: r.name === LOCKED_OWNER ? [...PERMISSIONS] : (JSON.parse(r.permissions_json) as string[]), system: r.system === 1 });

roleRoutes.get("/", async (c) => {
  const rows = (await c.env.DB.prepare("SELECT name, label, permissions_json, system FROM roles ORDER BY system DESC, name").all<RoleRow>()).results;
  return c.json({ items: rows.map(toRole) });
});

roleRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const actor = c.get("user");
  const b = (await readJson(c)) as { name?: string; label?: string; permissions?: string[] } | undefined;
  const name = roleNameSchema.safeParse(b?.name ?? "");
  const label = (b?.label ?? "").trim();
  const perms = rolePermissionsSchema.safeParse(b?.permissions ?? []);
  const issues: { field: string; message: string }[] = [];
  if (!name.success) issues.push({ field: "name", message: name.error.issues[0]!.message });
  if (label.length < 2 || label.length > 40) issues.push({ field: "label", message: "Label must be 2 to 40 characters" });
  if (!perms.success) issues.push({ field: "permissions", message: perms.error.issues[0]!.message });
  if (issues.length) return c.json({ error: "validation", issues }, 400);
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare("INSERT INTO roles (name, label, permissions_json, system, created_at, created_by, updated_at, updated_by) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?4, ?5)")
        .bind(name.data!, label, JSON.stringify(perms.data), now, actor.id),
      auditStatement(db, { actor: actor.id, action: "role_create", entity: "role", entityId: name.data!, detail: { count: perms.data!.length } }),
    ]);
  } catch (e) {
    if (isUniqueError(e)) return c.json({ error: "role_exists", message: "A role with that name already exists" }, 409);
    throw e;
  }
  return c.json(toRole((await db.prepare("SELECT name, label, permissions_json, system FROM roles WHERE name = ?1").bind(name.data!).first<RoleRow>())!), 201);
});

roleRoutes.patch("/:name", async (c) => {
  const db = c.env.DB;
  const actor = c.get("user");
  const role = await db.prepare("SELECT name, label, permissions_json, system FROM roles WHERE name = ?1").bind(c.req.param("name")).first<RoleRow>();
  if (!role) return c.json({ error: "not_found" }, 404);
  const b = (await readJson(c)) as { label?: string; permissions?: string[] } | undefined;
  if (!b) return c.json({ error: "invalid_request" }, 400);
  if (role.system === 1 && b.permissions !== undefined) {
    return c.json({ error: "system_role", message: "The owner role always has every permission" }, 409);
  }
  const statements = [];
  const changed: string[] = [];
  if (b.label !== undefined && b.label.trim() !== role.label) {
    if (b.label.trim().length < 2 || b.label.trim().length > 40) return c.json({ error: "validation", issues: [{ field: "label", message: "Label must be 2 to 40 characters" }] }, 400);
    statements.push(db.prepare("UPDATE roles SET label = ?2, updated_at = ?3, updated_by = ?4 WHERE name = ?1").bind(role.name, b.label.trim(), new Date().toISOString(), actor.id));
    changed.push("label");
  }
  if (b.permissions !== undefined) {
    const perms = rolePermissionsSchema.safeParse(b.permissions);
    if (!perms.success) return c.json({ error: "validation", issues: [{ field: "permissions", message: perms.error.issues[0]!.message }] }, 400);
    const before = JSON.parse(role.permissions_json) as string[];
    if (JSON.stringify(before.slice().sort()) !== JSON.stringify(perms.data!.slice().sort())) {
      statements.push(db.prepare("UPDATE roles SET permissions_json = ?2, updated_at = ?3, updated_by = ?4 WHERE name = ?1").bind(role.name, JSON.stringify(perms.data), new Date().toISOString(), actor.id));
      changed.push("permissions");
    }
  }
  if (changed.length === 0) return c.json(toRole(role));
  statements.push(auditStatement(db, { actor: actor.id, action: "role_update", entity: "role", entityId: role.name, detail: { changed } }));
  await db.batch(statements);
  return c.json(toRole((await db.prepare("SELECT name, label, permissions_json, system FROM roles WHERE name = ?1").bind(role.name).first<RoleRow>())!));
});

