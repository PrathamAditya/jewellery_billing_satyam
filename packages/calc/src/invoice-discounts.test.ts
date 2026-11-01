import { describe, expect, it } from "vitest";
import { calculateInvoice, shareProportionally, type DiscountsInput, type InvoiceLineInput } from "./invoice";

/** Spec 012c section 6. Money in paise, weight in mg, rates in paise per kg (6,000 per gram = 600,000,000). */

const weight = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  hsn: "7113",
  grossWeightMg: 10_000,
  netWeightMg: 10_000,
  polishMg: 0,
  goldRatePaisePerKg: 600_000_000,
  labourRatePaisePerKg: 0,
  gstRateBps: 300,
  ...over,
});

function calc(lines: InvoiceLineInput[], discounts?: DiscountsInput, taxMode: "intra" | "inter" = "intra") {
  const out = calculateInvoice({ taxMode, lines, discounts });
  if (!out.ok) throw new Error("expected a valid invoice: " + JSON.stringify(out.errors));
  return out.result;
}
const errorsOf = (lines: InvoiceLineInput[], discounts?: DiscountsInput) => {
  const out = calculateInvoice({ taxMode: "intra", lines, discounts });
  return out.ok ? [] : out.errors;
};

describe("A. discounts across two lines", () => {
  const lines = [
    weight({ netWeightMg: 10_000, grossWeightMg: 10_000, labourRatePaisePerKg: 50_000_000 }), // 6,000,000 gold + 500,000 labour
    weight({ netWeightMg: 5_000, grossWeightMg: 5_000, labourRatePaisePerKg: 40_000_000 }), // 3,000,000 gold + 200,000 labour
  ];
  const discounts: DiscountsInput = { gold: { kind: "percent", value: 100 }, labour: { kind: "fixed", value: 30_000 }, total: { kind: "fixed", value: 100_000 } };
  const r = calc(lines, discounts);

  it("prices the two lines before discount", () => {
    expect(r.lines.map((l) => l.amountPaise)).toEqual([6_500_000, 3_200_000]);
    expect(r.totalValuePaise).toBe(9_700_000);
  });

  it("shares the gold discount: 1% of 9,000,000 = 90,000 in shares 60,000 and 30,000", () => {
    expect(r.discountGoldPaise).toBe(90_000);
  });

  it("shares the labour discount by largest remainder: 21,429 and 8,571", () => {
    expect(r.discountLabourPaise).toBe(30_000);
    expect(shareProportionally([500_000n, 200_000n], 30_000n)).toEqual([21_429n, 8_571n]);
  });

  it("shares the total discount: 67,000 and 33,000, with the amounts after gold and labour", () => {
    expect(r.discountTotalPaise).toBe(100_000);
    expect(shareProportionally([6_418_571n, 3_161_429n], 100_000n)).toEqual([67_000n, 33_000n]);
  });

  it("gives the taxable amounts, tax, total and discount total of example A", () => {
    expect(r.lines.map((l) => l.taxablePaise)).toEqual([6_351_571, 3_128_429]);
    expect(r.taxablePaise).toBe(9_480_000);
    expect(r.groups).toEqual([{ gstRateBps: 300, taxablePaise: 9_480_000, cgstPaise: 142_200, sgstPaise: 142_200, igstPaise: 0 }]);
    expect(r.totalBeforeRoundOffPaise).toBe(9_764_400);
    expect(r.roundOffPaise).toBe(0);
    expect(r.payablePaise).toBe(9_764_400);
    expect(r.discountPaise).toBe(220_000);
    expect(r.lines.map((l) => l.discountPaise)).toEqual([6_500_000 - 6_351_571, 3_200_000 - 3_128_429]);
  });
});

describe("B. separate stone", () => {
  const r = calc([weight({ netWeightMg: 5_000, grossWeightMg: 5_300, pricingMode: "separate", stoneWeightMg: 300, stoneAmountPaise: 1_250_000 })]);
  it("adds the stone amount to the metal amount", () => {
    expect(r.lines[0]).toMatchObject({ pricingMode: "separate", goldAmountPaise: 3_000_000, stoneAmountPaise: 1_250_000, amountPaise: 4_250_000, taxablePaise: 4_250_000 });
    expect(r.groups[0]).toMatchObject({ cgstPaise: 63_750, sgstPaise: 63_750 });
    expect(r.payablePaise).toBe(4_377_500);
  });
});

describe("C. combined total", () => {
  const r = calc([weight({ netWeightMg: 6_000, grossWeightMg: 6_000, pricingMode: "combined", totalAmountPaise: 5_000_000 })]);
  it("uses the typed total and gives the display rate per gram", () => {
    expect(r.lines[0]).toMatchObject({ pricingMode: "combined", goldAmountPaise: 0, labourAmountPaise: 0, stoneAmountPaise: 0, amountPaise: 5_000_000, displayRatePaisePerGram: 833_333 });
    expect(r.groups[0]).toMatchObject({ cgstPaise: 75_000, sgstPaise: 75_000 });
    expect(r.payablePaise).toBe(5_150_000);
  });
});

describe("D. percent total discount", () => {
  it("5% of 6,500,000 is 325,000, leaving 6,175,000 taxable", () => {
    const r = calc([weight({ netWeightMg: 10_000, grossWeightMg: 10_000, goldRatePaisePerKg: 650_000_000 })], { total: { kind: "percent", value: 500 } });
    expect(r.discountTotalPaise).toBe(325_000);
    expect(r.taxablePaise).toBe(6_175_000);
  });
});

describe("E. rules and errors", () => {
  it("a fixed gold discount above the gold base is rejected, naming gold", () => {
    const e = errorsOf([weight({ netWeightMg: 10_000, grossWeightMg: 10_000, goldRatePaisePerKg: 600_000_000 })], { gold: { kind: "fixed", value: 6_000_001 } });
    expect(e).toEqual([expect.objectContaining({ field: "discounts.gold", code: "discount_exceeds_base" })]);
    expect(e[0]!.message).toContain("Gold");
  });

  it("a labour discount on a base of 0 is rejected (only combined lines, which have no labour part)", () => {
    const e = errorsOf([weight({ netWeightMg: 5_000, grossWeightMg: 5_000, pricingMode: "combined", totalAmountPaise: 100_000 })], { labour: { kind: "fixed", value: 100 } });
    expect(e).toEqual([expect.objectContaining({ field: "discounts.labour", code: "nothing_to_discount" })]);
  });

  it("a total discount above the remaining total is rejected", () => {
    const e = errorsOf([weight({ netWeightMg: 10_000, grossWeightMg: 10_000 })], { total: { kind: "fixed", value: 6_500_001 } });
    expect(e).toEqual([expect.objectContaining({ field: "discounts.total", code: "discount_exceeds_base" })]);
  });

  it("percent above 100%, a negative value, and a fractional paise value are each rejected, naming the target", () => {
    const line = [weight()];
    expect(errorsOf(line, { gold: { kind: "percent", value: 10_001 } })).toEqual([expect.objectContaining({ field: "discounts.gold", code: "discount_over_100_percent" })]);
    expect(errorsOf(line, { labour: { kind: "fixed", value: -5 } })).toEqual([expect.objectContaining({ field: "discounts.labour", code: "invalid_discount_value" })]);
    expect(errorsOf(line, { total: { kind: "fixed", value: 1.5 } })).toEqual([expect.objectContaining({ field: "discounts.total", code: "invalid_discount_value" })]);
  });

  it("a combined line ignores sent rates, a separate line needs a stone amount (0 is allowed), a weight line ignores stone fields", () => {
    const combined = calc([weight({ netWeightMg: 6_000, grossWeightMg: 6_000, pricingMode: "combined", totalAmountPaise: 5_000_000, goldRatePaisePerKg: -5, labourRatePaisePerKg: -7 })]);
    expect(combined.lines[0]!.amountPaise).toBe(5_000_000);

    const noStone = { ...weight({ pricingMode: "separate", stoneWeightMg: 0 }) } as InvoiceLineInput;
    delete noStone.stoneAmountPaise;
    expect(errorsOf([noStone])).toEqual([expect.objectContaining({ field: "stoneAmountPaise" })]);
    expect(calc([weight({ pricingMode: "separate", stoneAmountPaise: 0 })]).lines[0]!.amountPaise).toBe(6_000_000);

    const plain = calc([weight({ stoneAmountPaise: 999_999, stoneWeightMg: 500, totalAmountPaise: 1 })]);
    expect(plain.lines[0]).toMatchObject({ pricingMode: "weight", stoneAmountPaise: 0, amountPaise: 6_000_000 });
  });

  it("the stone weight is part of gross, so it cannot be more than gross minus net", () => {
    expect(errorsOf([weight({ netWeightMg: 5_000, grossWeightMg: 5_300, pricingMode: "separate", stoneWeightMg: 301, stoneAmountPaise: 0 })])).toEqual([
      expect.objectContaining({ field: "stoneWeightMg", code: "stone_above_gross" }),
    ]);
  });
});

describe("shareProportionally (spec 012c R6)", () => {
  it("shares always add up to the total, ties go to the earlier line, zero weights get nothing", () => {
    expect(shareProportionally([1n, 1n, 1n], 2n)).toEqual([1n, 1n, 0n]);
    expect(shareProportionally([0n, 5n, 0n], 3n)).toEqual([0n, 3n, 0n]);
    expect(shareProportionally([3n, 0n], 0n)).toEqual([0n, 0n]);
  });
});

describe("property: shares add up and no taxable amount is ever negative", () => {
  // A small seeded generator, so a failure can be reproduced.
  let seed = 20261102;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  it("200 generated invoices", () => {
    for (let c = 0; c < 200; c++) {
      const count = 1 + rnd(4);
      const lines: InvoiceLineInput[] = Array.from({ length: count }, () => {
        const net = 1 + rnd(20_000);
        const mode = (["weight", "separate", "combined"] as const)[rnd(3)]!;
        return weight({
          netWeightMg: net,
          grossWeightMg: net + rnd(500),
          goldRatePaisePerKg: 1 + rnd(900_000_000),
          labourRatePaisePerKg: rnd(60_000_000),
          gstRateBps: rnd(2) ? 300 : 500,
          pricingMode: mode,
          stoneAmountPaise: rnd(500_000),
          stoneWeightMg: 0,
          totalAmountPaise: 1 + rnd(3_000_000),
        });
      });
      const noDiscount = calc(lines);
      const goldBase = noDiscount.lines.reduce((s, l) => s + l.goldAmountPaise, 0);
      const goldFixed = rnd(goldBase + 1);
      const withGold = calc(lines, { gold: { kind: "fixed", value: goldFixed } });
      const labourBase = withGold.lines.reduce((s, l) => s + l.labourAmountPaise, 0);
      const labourFixed = rnd(labourBase + 1);
      const withTwo = calc(lines, { gold: { kind: "fixed", value: goldFixed }, labour: { kind: "fixed", value: labourFixed } });
      const remaining = withTwo.totalValuePaise - withTwo.discountGoldPaise - withTwo.discountLabourPaise;
      const totalFixed = remaining === 0 ? 0 : rnd(remaining + 1);
      const r = calc(lines, { gold: { kind: "fixed", value: goldFixed }, labour: { kind: "fixed", value: labourFixed }, total: { kind: "fixed", value: totalFixed } });

      expect(r.discountGoldPaise).toBe(goldFixed);
      expect(r.discountLabourPaise).toBe(labourFixed);
      expect(r.discountTotalPaise).toBe(totalFixed);
      expect(r.lines.reduce((s, l) => s + l.discountPaise, 0)).toBe(r.discountPaise);
      expect(r.taxablePaise).toBe(r.totalValuePaise - r.discountPaise);
      for (const l of r.lines) expect(l.taxablePaise).toBeGreaterThanOrEqual(0);
    }
  });
});
