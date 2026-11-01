import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { changePasswordRequestSchema, loginRequestSchema, type UserResponse } from "@jewellery/shared";
import type { AppEnv } from "../env";
import { readJson } from "../http";
import { auditStatement } from "../db/audit";
import { setSessionCookie } from "./middleware";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";
import {
  COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionStatements,
  failureAttemptStatement,
  newSessionToken,
  sha256Hex,
} from "./session";

const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 5;
const GLOBAL_LIMIT = 30;
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const parsed = loginRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

  const db = c.env.DB;
  const now = c.get("now");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const username = parsed.data.username.toLowerCase();
  const windowStart = new Date(now.getTime() - WINDOW_MS).toISOString();

  // R12: rate limit, checked before the password so a correct password cannot get through.
  await db
    .prepare("DELETE FROM login_attempts WHERE at < ?1")
    .bind(new Date(now.getTime() - ATTEMPT_RETENTION_MS).toISOString())
    .run();
  const counts = await db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ip = ?2 THEN 1 ELSE 0 END), 0) AS from_ip
       FROM login_attempts WHERE at > ?1`,
    )
    .bind(windowStart, ip)
    .first<{ total: number; from_ip: number }>();
  if ((counts?.from_ip ?? 0) >= PER_IP_LIMIT || (counts?.total ?? 0) >= GLOBAL_LIMIT) {
    c.header("Retry-After", String(WINDOW_MS / 1000));
    return c.json({ error: "too_many_attempts" }, 429);
  }

  const user = await db
    .prepare("SELECT id, username, role, password_hash, disabled_at FROM users WHERE username = ?1")
    .bind(username)
    .first<{ id: string; username: string; role: string; password_hash: string; disabled_at: string | null }>();

  // R11: an unknown username costs the same time as a wrong password.
  const passwordOk = await verifyPassword(parsed.data.password, user?.password_hash ?? (await dummyPasswordHash()));

  if (!user || user.disabled_at || !passwordOk) {
    await db.batch([
      failureAttemptStatement(db, { ip, username, now }),
      auditStatement(db, {
        actor: "anonymous",
        action: "login_failure",
        entity: "user",
        entityId: user?.id ?? "unknown",
        detail: { ip, reason: !user ? "unknown_user" : user.disabled_at ? "disabled" : "bad_password" },
      }),
    ]);
    return c.json({ error: "invalid_credentials", message: "Invalid username or password" }, 401);
  }

  const token = newSessionToken();
  await db.batch(
    createSessionStatements(db, {
      tokenHash: await sha256Hex(token),
      userId: user.id,
      now,
      userAgent: c.req.header("User-Agent") ?? null,
      ip,
    }),
  );
  setSessionCookie(c, token, SESSION_MAX_AGE_SECONDS);
  const body: UserResponse = { id: user.id, username: user.username, role: user.role };
  return c.json(body);
});

authRoutes.get("/me", (c) => {
  const { id, username, role } = c.get("user");
  const body: UserResponse = { id, username, role };
  return c.json(body);
});

authRoutes.post("/logout", async (c) => {
  const user = c.get("user");
  const token = getCookie(c, COOKIE_NAME)!; // the session middleware already required it
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(token)),
    auditStatement(db, { actor: user.id, action: "logout", entity: "user", entityId: user.id }),
  ]);
  deleteCookie(c, COOKIE_NAME, { path: "/", secure: true });
  return c.json({ ok: true });
});

authRoutes.post("/change-password", async (c) => {
  const parsed = changePasswordRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "invalid_request", message: "New password must be at least 10 characters" }, 400);

  const user = c.get("user");
  const db = c.env.DB;
  const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(parsed.data.currentPassword, row.password_hash))) {
    return c.json({ error: "wrong_password", message: "Current password is wrong" }, 403);
  }

  const token = getCookie(c, COOKIE_NAME)!;
  await db.batch([
    db
      .prepare("UPDATE users SET password_hash = ?2, updated_at = ?3, updated_by = ?1 WHERE id = ?1")
      .bind(user.id, await hashPassword(parsed.data.newPassword), c.get("now").toISOString()),
    db.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2").bind(user.id, await sha256Hex(token)),
    auditStatement(db, { actor: user.id, action: "password_change", entity: "user", entityId: user.id }),
  ]);
  return c.json({ ok: true });
});
