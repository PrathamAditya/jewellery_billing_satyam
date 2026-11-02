import { Hono } from "hono";
import type { HealthResponse } from "@jewellery/shared";
import type { AppEnv } from "./env";
import { enforcePermissions, originCheck, requireSession } from "./auth/middleware";
import { authRoutes } from "./auth/routes";
import { customerRoutes } from "./customers/routes";
import { invoiceRoutes } from "./invoices/routes";
import { roleRoutes, userRoutes } from "./users/routes";
import { allocationRoutes, paymentRoutes } from "./payments/routes";
import { customerAdvances, orderRoutes, refundRoutes } from "./orders/routes";
import { oldGoldRoutes } from "./oldgold/routes";
import { settlementRoutes } from "./settlement/routes";
import { ledgerRoutes, openingRoutes } from "./ledger/routes";
import { rateRoutes } from "./rates/routes";
import { settingsRoutes } from "./settings/routes";
import { creditNoteRoutes, creditReversalRoutes } from "./creditNotes/routes";
import { inventoryRoutes } from "./inventory/routes";
import { bulkRoutes } from "./inventory/bulk";

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
  app.use("/api/*", enforcePermissions(() => app.routes.filter((r) => r.method !== "ALL" && !r.path.includes("*"))));

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
  app.route("/api/rates", rateRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/invoices", invoiceRoutes);
  app.route("/api/users", userRoutes);
  app.route("/api/roles", roleRoutes);
  app.route("/api/payments", paymentRoutes);
  app.route("/api/allocations", allocationRoutes);
  app.route("/api/orders", orderRoutes);
  app.route("/api/refunds", refundRoutes);
  app.route("/api/old-gold", oldGoldRoutes);
  app.route("/api/invoices", settlementRoutes);
  app.route("/api/opening-balances", openingRoutes);
  app.route("/api/credit-notes", creditNoteRoutes);
  app.route("/api/credit-notes", creditReversalRoutes);
  app.route("/api/inventory/bulk", bulkRoutes);
  app.route("/api/inventory", inventoryRoutes);
  app.route("/api/", ledgerRoutes);
  app.get("/api/customers/:id/advances", async (c) => c.json({ items: await customerAdvances(c.env.DB, c.req.param("id")) }));

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  return app;
}

export default createApp();
