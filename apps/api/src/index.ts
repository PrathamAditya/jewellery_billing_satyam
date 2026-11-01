import { Hono } from "hono";
import type { HealthResponse } from "@jewellery/shared";
import type { AppEnv } from "./env";
import { originCheck, requireSession } from "./auth/middleware";
import { authRoutes } from "./auth/routes";
import { customerRoutes } from "./customers/routes";

/** `now` is injectable so tests can move the clock (sessions expire, rate limits reset). */
export function createApp(opts: { now?: () => Date } = {}) {
  const clock = opts.now ?? (() => new Date());
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    c.set("now", clock());
    await next();
  });
  app.use("/api/*", originCheck);
  app.use("/api/*", requireSession);

  app.get("/api/health", async (c) => {
    let db: HealthResponse["db"] = "ok";
    try {
      await c.env.DB.prepare("SELECT 1").first();
    } catch {
      db = "error";
    }
    const body: HealthResponse = {
      status: db === "ok" ? "ok" : "degraded",
      service: "jewellery-billing",
      db,
      time: clock().toISOString(),
    };
    return c.json(body, db === "ok" ? 200 : 503);
  });

  app.route("/api/auth", authRoutes);
  app.route("/api/customers", customerRoutes);

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  return app;
}

export default createApp();
