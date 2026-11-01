import { describe, expect, it } from "vitest";
import { formatMoney, formatWeightGrams, parseWeightGrams } from "./weight";

describe("parseWeightGrams (spec 012 R2)", () => {
  it.each([
    ["9.800", 9_800],
    ["9.8", 9_800],
    ["9", 9_000],
    ["0.001", 1],
    ["12,345.678", 12_345_678],
    ["9.800 g", 9_800],
    ["9.8gm", 9_800],
    [" 10 ", 10_000],
  ])("%j -> %d mg", (text, mg) => {
    expect(parseWeightGrams(text)).toEqual({ ok: true, mg });
  });
  it.each(["9.8004", "abc", "", "-1", "1e3", "9.8.1", "1234567890"])("rejects %j", (text) => {
    const r = parseWeightGrams(text);
    expect(r.ok).toBe(false);
  });
});

describe("formatting", () => {
  it("weight in grams", () => {
    expect(formatWeightGrams(9_800)).toBe("9.800");
    expect(formatWeightGrams(1)).toBe("0.001");
    expect(formatWeightGrams(12_345_678)).toBe("12345.678");
  });
  it("money with Indian grouping and a sign for negatives", () => {
    expect(formatMoney(288_406)).toBe("₹2,884.06");
    expect(formatMoney(14_560_000)).toBe("₹1,45,600.00");
    expect(formatMoney(0)).toBe("₹0.00");
    expect(formatMoney(-6)).toBe("-₹0.06");
    expect(formatMoney(-29)).toBe("-₹0.29");
  });
});
