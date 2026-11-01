import { describe, expect, it } from "vitest";
import { roundOffPaise } from "./round";

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
