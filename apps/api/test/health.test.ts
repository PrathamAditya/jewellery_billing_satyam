import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { healthResponseSchema } from "@jewellery/shared";
import app from "../src/index";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.dispose());

describe("api", () => {
  it("GET /api/health returns ok with db ok, matching the shared schema", async () => {
    const res = await app.request("/api/health", {}, { DB: t.db });
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ status: "ok", db: "ok" });
  });

  it("GET /api/health returns 503 with db error when the database fails", async () => {
    const broken = {
      prepare() {
        throw new Error("db down");
      },
    } as unknown as D1Database;
    const res = await app.request("/api/health", {}, { DB: broken });
    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(await res.json())).toMatchObject({ status: "degraded", db: "error" });
  });

  it("unknown /api path returns JSON 404", async () => {
    const res = await app.request("/api/nope", {}, { DB: t.db });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
