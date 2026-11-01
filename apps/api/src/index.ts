import { Hono } from "hono";
import type { HealthResponse } from "@jewlray/shared";

const app = new Hono();

app.get("/api/health", (c) => {
  const body: HealthResponse = {
    status: "ok",
    service: "jewlray-billing",
    time: new Date().toISOString(),
  };
  return c.json(body);
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
