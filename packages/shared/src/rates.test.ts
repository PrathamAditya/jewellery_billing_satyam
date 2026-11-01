import { describe, expect, it } from "vitest";
import {
  RATE_UNIT_MG,
  formatPerGram,
  formatPerKg,
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
