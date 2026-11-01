import { Hono } from "hono";
import type { HealthResponse } from "@jewellery/shared";
import type { Bindings } from "./env";

const app = new Hono<{ Bindings: Bindings }>();

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
    time: new Date().toISOString(),
  };
  return c.json(body, db === "ok" ? 200 : 503);
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
