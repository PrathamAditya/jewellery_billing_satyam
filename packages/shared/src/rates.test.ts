import { describe, expect, it } from "vitest";
import {
  RATE_UNIT_MG,
  formatPerGram,
  formatPerKg,
  gold22From24PaisePerKg,
  groupIndian,
  isLargeChange,
  isValidBusinessDate,
  paisePerKgToInput,
  parseRateInput,
  percentChange,
  type RateUnit,
} from "./rates";

describe("parseRateInput (spec 011 R3, R4)", () => {
  const ok: [string, string, RateUnit, number][] = [
    ["gold 24K995", "12,000", "gram", 1_200_000_000],
    ["gold 24K995", "1,20,00,000", "kg", 1_200_000_000],
    ["gold 22K916", "₹ 11,000.5", "gram", 1_100_050_000],
    ["silver", "150", "gram", 15_000_000],
    ["silver", "150.123", "gram", 15_012_300],
    ["silver on the client invoice (285.72 per gram)", "285.72", "gram", 28_572_000],
    ["silver", "1,50,123", "kg", 15_012_300],
    ["silver", "1,50,123.45", "kg", 15_012_345],
    ["rs prefix", "Rs. 150", "gram", 15_000_000],
    ["the maximum per kg", "10,00,00,000", "kg", 10_000_000_000],
    ["the maximum per gram", "1,00,000", "gram", 10_000_000_000],
  ];
  it.each(ok)("%s: %j per %s -> %d", (_n, typed, unit, expected) => {
    expect(parseRateInput(typed, unit)).toEqual({ ok: true, paisePerKg: expected });
  });

  const bad: [string, RateUnit][] = [
    ["150.1234", "gram"],
    ["1,50,000.555", "kg"],
    ["0", "kg"],
    ["0.000", "gram"],
    ["-5", "kg"],
    ["abc", "gram"],
    ["", "gram"],
    ["12 000 x", "kg"],
    ["10,00,00,001", "kg"],
    ["1,00,001", "gram"],
    ["1e5", "kg"],
    ["12.5.5", "gram"],
  ];
  it.each(bad)("rejects %j per %s", (typed, unit) => {
    const r = parseRateInput(typed, unit);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(3);
  });

  it("the same price typed per gram and per kg gives the same stored value", () => {
    for (const perGram of ["12,345.678", "150", "9,999.9", "0.001"]) {
      const g = parseRateInput(perGram, "gram");
      expect(g.ok).toBe(true);
      if (!g.ok) continue;
      const perKgText = (g.paisePerKg / 100).toFixed(2);
      expect(parseRateInput(perKgText, "kg")).toEqual({ ok: true, paisePerKg: g.paisePerKg });
    }
  });

  it("the unit is 1 kg in mg", () => {
    expect(RATE_UNIT_MG).toBe(1_000_000);
  });
});

describe("display (R5)", () => {
  it("groups digits the Indian way", () => {
    expect(groupIndian("5")).toBe("5");
    expect(groupIndian("1000")).toBe("1,000");
    expect(groupIndian("12000")).toBe("12,000");
    expect(groupIndian("120000")).toBe("1,20,000");
    expect(groupIndian("12000000")).toBe("1,20,00,000");
    expect(groupIndian("1000000000")).toBe("1,00,00,00,000");
  });
  it("per gram: 2 decimals, 3 only when needed", () => {
    expect(formatPerGram(1_200_000_000)).toBe("₹12,000.00");
    expect(formatPerGram(15_012_300)).toBe("₹150.123");
    expect(formatPerGram(15_000_000)).toBe("₹150.00");
    expect(formatPerGram(1_100_050_000)).toBe("₹11,000.50");
  });
  it("per kg: paise only when there are some", () => {
    expect(formatPerKg(1_200_000_000)).toBe("₹1,20,00,000");
    expect(formatPerKg(15_012_345)).toBe("₹1,50,123.45");
  });
});

describe("typo guard (R12)", () => {
  it("more than 10% needs confirmation, exactly 10% does not", () => {
    expect(isLargeChange(1_200_000_000, 1_350_000_000)).toBe(true); // +12.5%
    expect(isLargeChange(1_200_000_000, 1_320_000_000)).toBe(false); // +10% exactly
    expect(isLargeChange(1_200_000_000, 1_080_000_000)).toBe(false); // -10% exactly
    expect(isLargeChange(1_200_000_000, 1_079_999_999)).toBe(true);
  });
  it("percentChange to one decimal", () => {
    expect(percentChange(1_200_000_000, 1_350_000_000)).toBe(12.5);
    expect(percentChange(1_200_000_000, 1_080_000_000)).toBe(-10);
  });
});

describe("isValidBusinessDate", () => {
  it("accepts real dates only", () => {
    expect(isValidBusinessDate("2026-11-01")).toBe(true);
    expect(isValidBusinessDate("2024-02-29")).toBe(true);
    expect(isValidBusinessDate("2026-02-30")).toBe(false);
    expect(isValidBusinessDate("2026-13-01")).toBe(false);
    expect(isValidBusinessDate("1-11-2026")).toBe(false);
  });
});

describe("paisePerKgToInput", () => {
  it("round-trips exactly in both units", () => {
    expect(paisePerKgToInput(1_200_000_000, "gram")).toBe("12000");
    expect(paisePerKgToInput(1_200_000_000, "kg")).toBe("12000000");
    expect(paisePerKgToInput(15_012_300, "gram")).toBe("150.123");
    expect(paisePerKgToInput(15_012_345, "kg")).toBe("150123.45");
    for (const p of [1_200_000_000, 15_012_300, 15_012_345 * 100, 1_100_050_000, 100]) {
      for (const unit of ["gram", "kg"] as const) {
        expect(parseRateInput(paisePerKgToInput(p, unit), unit)).toEqual({ ok: true, paisePerKg: p });
      }
    }
  });
});

describe("gold22From24PaisePerKg (feedback point 1: 22K from 24K)", () => {
  // Expected values worked out separately as 24K x 916 / 995, rounded to 3 decimals per gram.
  const cases: [string, string, string][] = [
    ["a round 24K rate", "12,000", "11047.236"], // 11047.2361...
    ["a typical 24K rate", "7,500", "6904.523"], // 6904.5226...
    ["a rate that rounds up", "9,999", "9205.11"], // 9205.1095... -> 9205.110
    ["a small rate", "100", "92.06"], // 92.0603...
  ];
  it.each(cases)("%s: 24K %s per gram gives 22K %s per gram", (_n, typed, expected) => {
    const p24 = parseRateInput(typed, "gram");
    if (!p24.ok) throw new Error("bad fixture");
    const p22 = gold22From24PaisePerKg(p24.paisePerKg);
    expect(p22 % 100).toBe(0); // always typeable per gram with 3 decimals
    expect(paisePerKgToInput(p22, "gram")).toBe(expected);
  });
  it("is exact for the 995 to 916 ratio on a multiple of 995", () => {
    expect(gold22From24PaisePerKg(995_000_000)).toBe(916_000_000);
  });
});
