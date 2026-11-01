import { describe, expect, it } from "vitest";
import { divRoundHalfUp, roundOffPaise } from "./round";

describe("roundOffPaise", () => {
  it.each([
    [0, 0],
    [49, 0],
    [50, 100],
    [99, 100],
    [100, 100],
    [12349, 12300],
    [12350, 12400],
    [12399, 12400],
  ])("%i paise -> %i paise", (input, expected) => {
    expect(roundOffPaise(input)).toBe(expected);
  });

  it.each([-1, 49.5, Number.NaN, Number.POSITIVE_INFINITY])("throws for %s", (input) => {
    expect(() => roundOffPaise(input)).toThrow(RangeError);
  });
});

describe("divRoundHalfUp (spec 012 H)", () => {
  it.each([
    [5n, 2n, 3n],
    [4n, 2n, 2n],
    [7n, 3n, 2n],
    [8n, 3n, 3n],
    [0n, 5n, 0n],
    [1n, 3n, 0n],
    [3n, 2n, 2n],
    [280005_600000n, 1_000_000n, 280006n],
  ])("%s / %s = %s", (n, d, expected) => {
    expect(divRoundHalfUp(n, d)).toBe(expected);
  });

  it("is exact above 2^53", () => {
    const n = 100_000_000n * 10_000_000_000n; // 10^18
    expect(Number(n)).toBeGreaterThan(2 ** 53);
    expect(divRoundHalfUp(n, 1_000_000n)).toBe(1_000_000_000_000n);
    expect(divRoundHalfUp(n + 500_000n, 1_000_000n)).toBe(1_000_000_000_001n); // exactly .5 rounds up
    expect(divRoundHalfUp(n + 499_999n, 1_000_000n)).toBe(1_000_000_000_000n);
  });

  it("rejects a negative numerator and a non-positive denominator", () => {
    expect(() => divRoundHalfUp(-1n, 2n)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1n, -2n)).toThrow(RangeError);
  });
});
