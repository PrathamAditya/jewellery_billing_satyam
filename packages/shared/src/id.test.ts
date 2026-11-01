import { describe, expect, it } from "vitest";
import { newId } from "./id";

describe("newId (UUIDv7)", () => {
  it("has the UUIDv7 shape with the RFC variant", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("starts with the current time in milliseconds", () => {
    const before = Date.now();
    const ts = parseInt(newId().replace(/-/g, "").slice(0, 12), 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThan(Date.now() + 10_000);
  });

  it("5000 ids are unique and already in sorted order", () => {
    const ids = Array.from({ length: 5000 }, () => newId());
    expect(new Set(ids).size).toBe(5000);
    expect(ids).toEqual([...ids].sort());
  });
});
