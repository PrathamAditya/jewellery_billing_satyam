import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "@jewlray/shared";
import app from "../src/index";

describe("api", () => {
  it("GET /api/health returns ok matching the shared schema", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(healthResponseSchema.safeParse(await res.json()).success).toBe(true);
  });

  it("unknown /api path returns JSON 404", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
