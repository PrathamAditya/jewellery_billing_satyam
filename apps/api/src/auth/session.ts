import { newId, type Permission } from "@jewellery/shared";
import { permissionsForRole } from "./permissions";
import { auditStatement } from "../db/audit";

export const COOKIE_NAME = "__Host-session";
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = SESSION_DAYS * DAY_MS;
/** Spec 002 R6: using a session more than 1 day after the last refresh extends it. */
const REFRESH_AFTER_MS = DAY_MS;

/** The logged-in person for one request (spec 004). Permissions come from the role on every request. */
export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  permissions: Permission[];
  mustChangePassword: boolean;
};

export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** 256 random bits, base64url (no padding). This is what the cookie holds. */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type SessionLookup =
  | { ok: true; user: AuthUser; tokenHash: string; refreshed: boolean }
  | { ok: false };

/**
 * Finds the session for a cookie token (R4, R6). Expired sessions are removed.
 * A session for a disabled user is rejected. The refresh is applied here.
 */
export async function lookupSession(db: D1Database, token: string, now: Date): Promise<SessionLookup> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.last_seen_at, s.expires_at, u.id, u.username, u.role, u.disabled_at, u.display_name, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<{
      last_seen_at: string;
      expires_at: string;
      id: string;
      username: string;
      role: string;
      disabled_at: string | null;
      display_name: string;
      must_change_password: number;
    }>();
  if (!row) return { ok: false };

  if (Date.parse(row.expires_at) <= now.getTime()) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
    return { ok: false };
  }
  if (row.disabled_at) return { ok: false };

  let refreshed = false;
  if (now.getTime() - Date.parse(row.last_seen_at) > REFRESH_AFTER_MS) {
    await db
      .prepare("UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1")
      .bind(tokenHash, now.toISOString(), new Date(now.getTime() + SESSION_MS).toISOString())
      .run();
    refreshed = true;
  }
  const permissions = await permissionsForRole(db, row.role);
  const user: AuthUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    permissions,
    mustChangePassword: row.must_change_password === 1,
  };
  return { ok: true, user, tokenHash, refreshed };
}

/** Statements that create a session and its audit row, for one atomic batch (R4, R14). */
export function createSessionStatements(
  db: D1Database,
  args: { tokenHash: string; userId: string; now: Date; userAgent: string | null; ip: string },
): D1PreparedStatement[] {
  const iso = args.now.toISOString();
  return [
    db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent)
         VALUES (?1, ?2, ?3, ?3, ?4, ?5)`,
      )
      .bind(
        args.tokenHash,
        args.userId,
        iso,
        new Date(args.now.getTime() + SESSION_MS).toISOString(),
        args.userAgent?.slice(0, 300) ?? null,
      ),
    auditStatement(db, {
      actor: args.userId,
      action: "login_success",
      entity: "user",
      entityId: args.userId,
      detail: { ip: args.ip },
    }),
  ];
}

export function failureAttemptStatement(
  db: D1Database,
  args: { ip: string; username: string | null; now: Date },
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO login_attempts (id, at, ip, username) VALUES (?1, ?2, ?3, ?4)")
    .bind(newId(), args.now.toISOString(), args.ip, args.username?.slice(0, 64) ?? null);
}
