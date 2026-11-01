import { describe, expect, it } from "vitest";
import { blankDiscounts, discountTextsFrom, parseDiscountTexts, parsePercentToBps, parseRupeesToPaise } from "./pricing";

describe("rupee amounts (spec 012c)", () => {
  it("reads rupees with commas and a rupee sign into whole paise", () => {
    expect(parseRupeesToPaise("₹ 2,50,000")).toEqual({ ok: true, value: 25_000_000 });
    expect(parseRupeesToPaise("12.5")).toEqual({ ok: true, value: 1_250 });
    expect(parseRupeesToPaise("0.05")).toEqual({ ok: true, value: 5 });
  });

  it("rejects more than 2 decimals, blanks, text and negatives (never rounds)", () => {
    expect(parseRupeesToPaise("12.345").ok).toBe(false);
    expect(parseRupeesToPaise("").ok).toBe(false);
    expect(parseRupeesToPaise("abc").ok).toBe(false);
    expect(parseRupeesToPaise("-5").ok).toBe(false);
  });
});

describe("percentages (spec 012c R4)", () => {
  it("reads a percent into basis points, up to 2 decimals and up to 100%", () => {
    expect(parsePercentToBps("5")).toEqual({ ok: true, value: 500 });
    expect(parsePercentToBps("1.25%")).toEqual({ ok: true, value: 125 });
    expect(parsePercentToBps("100")).toEqual({ ok: true, value: 10_000 });
    expect(parsePercentToBps("100.01").ok).toBe(false);
    expect(parsePercentToBps("1.555").ok).toBe(false);
  });
});

describe("discount rows (spec 012c R4, R9)", () => {
  it("an empty row means no discount; the others become the request body", () => {
    const t = blankDiscounts();
    t.gold = { kind: "percent", value: "1" };
    t.labour = { kind: "fixed", value: "300" };
    expect(parseDiscountTexts(t)).toEqual({ discounts: { gold: { kind: "percent", value: 100 }, labour: { kind: "fixed", value: 30_000 } }, errors: {} });
  });

  it("names the row whose value is wrong", () => {
    const t = blankDiscounts();
    t.total = { kind: "percent", value: "150" };
    expect(parseDiscountTexts(t).errors).toEqual({ total: "A discount cannot be more than 100%" });
  });

  it("a saved discount goes back into the same rows", () => {
    const back = discountTextsFrom({ gold: { kind: "percent", value: 125 }, total: { kind: "fixed", value: 100_050 } });
    expect(back.gold).toEqual({ kind: "percent", value: "1.25" });
    expect(back.total).toEqual({ kind: "fixed", value: "1000.5" });
    expect(back.labour).toEqual({ kind: "fixed", value: "" });
  });
});
