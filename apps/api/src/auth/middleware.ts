import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { COOKIE_NAME, SESSION_MAX_AGE_SECONDS, lookupSession } from "./session";

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
