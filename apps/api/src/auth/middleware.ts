import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { COOKIE_NAME, SESSION_MAX_AGE_SECONDS, lookupSession } from "./session";
import { ruleFor } from "./permissionMap";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Spec 002 R10: data-changing requests must come from the site's own origin (blocks CSRF). */
export const originCheck = createMiddleware<AppEnv>(async (c, next) => {
  if (MUTATING.has(c.req.method)) {
    const origin = c.req.header("Origin");
    let ok = false;
    if (origin) {
      try {
        ok = new URL(origin).host === new URL(c.req.url).host;
      } catch {
        ok = false;
      }
    }
    if (!ok) return c.json({ error: "forbidden_origin" }, 403);
  }
  await next();
  });

export function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string, maxAge: number) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
}

/** Routes that work without a session (spec 002 R8). */
function isPublic(method: string, path: string): boolean {
  return (method === "GET" && path === "/api/health") || (method === "POST" && path === "/api/auth/login");
}

/** Spec 002 R8, R9: every /api route needs a valid session, except the public ones. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (isPublic(c.req.method, c.req.path)) return next();

  const token = getCookie(c, COOKIE_NAME);
  const found = token ? await lookupSession(c.env.DB, token, c.get("now")) : ({ ok: false } as const);
  if (!found.ok) return c.json({ error: "unauthorized" }, 401);

  c.set("user", found.user);
  if (found.refreshed && token) setSessionCookie(c, token, SESSION_MAX_AGE_SECONDS);
  await next();
  });

/** Routes a person may use while a temporary password must be replaced (spec 004 R6). */
const WHILE_PASSWORD_CHANGE = new Set(["GET /api/auth/me", "POST /api/auth/change-password", "POST /api/auth/logout"]);

/**
 * Spec 004 R3, R6: after the login check, every /api route needs its permission from the table in
 * `permissionMap.ts`. Unlisted routes are denied. Public routes pass straight through.
 */
export const enforcePermissions = (registeredRoutes: () => { method: string; path: string }[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
  const rule = ruleFor(c.req.method, c.req.path);
  if (rule?.permission === "public") return next();
  if (!rule) {
    // A real route with no entry in the table is denied. An unknown path falls through to the JSON 404 (spec 002 R8).
    const known = registeredRoutes().some((r) => r.method === c.req.method && new RegExp("^" + r.path.replace(/:[a-zA-Z]+/g, "[^/]+") + "$").test(c.req.path));
    if (known) return c.json({ error: "forbidden", message: "This action is not available" }, 403);
    return next();
  }

  const user = c.get("user");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.mustChangePassword && !WHILE_PASSWORD_CHANGE.has(`${c.req.method} ${c.req.path}`)) {
    return c.json({ error: "password_change_required", message: "Please choose a new password first" }, 403);
  }
  if (rule.permission === "any") return next();
  if (!user.permissions.includes(rule.permission)) {
    return c.json({ error: "forbidden", message: "You do not have permission for this action", permission: rule.permission }, 403);
  }
  await next();
  });
