import { describe, expect, it } from "vitest";
import { allowanceMg, checkPayout, checkReturnWeight, checkWastageAllowance, heldMg, labourPaise, labourPayable, wastageMg } from "./karigar";

describe("labourPaise (spec 023 K7): per gram and per piece, half up to the paisa", () => {
  it("97.000 g finished at ₹150 per gram is ₹14,550.00 (1,455,000 paise)", () => {
    expect(labourPaise({ basis: "gram", weightMg: 97_000, pieces: 3, ratePaise: 15_000 })).toEqual({ ok: true, result: 1_455_000 });
  });

  it.each([
    // weight mg, rate paise per gram, paise
    [1, 1, 0], // 0.001 paise rounds down
    [499, 1, 0], // 0.499 paise rounds down
    [500, 1, 1], // 0.5 paise rounds up (half up)
    [1_499, 1, 1],
    [1_500, 1, 2], // 1.5 paise rounds up
    [12_345, 333, 4_111], // 12345 x 333 = 4,110,885; / 1000 = 4110.885, rounds up to 4111
  ])("%i mg at %i paise per gram gives %i paise", (weightMg, ratePaise, paise) => {
    expect(labourPaise({ basis: "gram", weightMg, pieces: 0, ratePaise })).toEqual({ ok: true, result: paise });
  });

  it("3 pieces at ₹200 each is ₹600.00 (60,000 paise)", () => {
    expect(labourPaise({ basis: "piece", weightMg: 0, pieces: 3, ratePaise: 20_000 })).toEqual({ ok: true, result: 60_000 });
  });

  it("a rate of 0 gives 0 paise (the lines are still written)", () => {
    expect(labourPaise({ basis: "gram", weightMg: 97_000, pieces: 3, ratePaise: 0 })).toEqual({ ok: true, result: 0 });
  });

  it("large values stay exact (BigInt): 100 kg at ₹1,00,000 per gram", () => {
    // 100,000 g at ₹1,00,000 per gram is ₹1,00,00,00,000, which is 1,000,000,000,000 paise
    expect(labourPaise({ basis: "gram", weightMg: 100_000_000, pieces: 0, ratePaise: 10_000_000 })).toEqual({ ok: true, result: 1_000_000_000_000 });
  });

  it.each([
    [{ basis: "gram", weightMg: 0, pieces: 3, ratePaise: 100 }, "Labour per gram needs a weight of at least 1 mg"],
    [{ basis: "piece", weightMg: 0, pieces: 0, ratePaise: 100 }, "Labour per piece needs at least 1 piece"],
    [{ basis: "gram", weightMg: 1000, pieces: 1, ratePaise: -1 }, "The labour rate cannot be negative"],
  ])("refuses %j", (input, error) => {
    expect(labourPaise(input as never)).toEqual({ ok: false, error });
  });
});

describe("allowanceMg and checkWastageAllowance (spec 023 K9, K10): Q200 default 2.00% (200 bps)", () => {
  it("2.00% of 100.000 g is 2.000 g", () => {
    expect(allowanceMg(100_000, 200)).toBe(2_000);
  });

  it("rounds half up: 25 mg at 2.00% is 0.5 mg, which is 1 mg", () => {
    expect(allowanceMg(25, 200)).toBe(1);
    expect(allowanceMg(24, 200)).toBe(0); // 0.48 rounds down
  });

  it("12.345 g at 2.00% is 0.2469 g, which is 247 mg", () => {
    expect(allowanceMg(12_345, 200)).toBe(247);
  });

  it("a held weight equal to the allowance is within it; one milligram more is refused", () => {
    expect(checkWastageAllowance({ heldMg: 2_000, issuedMg: 100_000, wastageBps: 200 })).toEqual({
      ok: true,
      result: { wastageMg: 2_000, allowanceMg: 2_000 },
    });
    expect(checkWastageAllowance({ heldMg: 2_001, issuedMg: 100_000, wastageBps: 200 })).toEqual({
      ok: false,
      error: "2001 mg is still held and more than the 2000 mg allowed",
    });
  });

  it("a job with no allowance (0 bps) must return every milligram", () => {
    expect(checkWastageAllowance({ heldMg: 1, issuedMg: 100_000, wastageBps: 0 }).ok).toBe(false);
    expect(checkWastageAllowance({ heldMg: 0, issuedMg: 100_000, wastageBps: 0 }).ok).toBe(true);
  });

  it("refuses a basis point value outside 0 to 1000 (10%)", () => {
    expect(() => allowanceMg(100_000, 1_001)).toThrow(RangeError);
    expect(() => allowanceMg(100_000, -1)).toThrow(RangeError);
    expect(allowanceMg(100_000, 1_000)).toBe(10_000);
  });
});

describe("wastage and held metal (spec 023 K9, K15)", () => {
  it("issued 100.000 g, finished 97.000 g, remainder 1.500 g: wastage 1.500 g and nothing held", () => {
    expect(wastageMg(100_000, 97_000, 1_500)).toBe(1_500);
    expect(heldMg({ issuedMg: 100_000, finishedMg: 97_000, remainderMg: 1_500, wastageWrittenMg: 0 })).toBe(1_500);
    expect(heldMg({ issuedMg: 100_000, finishedMg: 97_000, remainderMg: 1_000, wastageWrittenMg: 2_000 })).toBe(0);
  });

  it("returning more than was issued gives a negative wastage (a gain), which the caller refuses", () => {
    expect(wastageMg(100_000, 99_000, 1_500)).toBe(-500);
  });
});

describe("checkReturnWeight (spec 023 K6): a return is at most what the karigar holds on the job", () => {
  it("returns 97.000 g of 100.000 g held, leaving 3.000 g", () => {
    expect(checkReturnWeight({ weightMg: 97_000, heldBeforeMg: 100_000 })).toEqual({ ok: true, result: 3_000 });
  });

  it("refuses one milligram more than is held, and a zero weight", () => {
    expect(checkReturnWeight({ weightMg: 100_001, heldBeforeMg: 100_000 })).toEqual({
      ok: false,
      error: "Only 100000 mg is with the karigar on this job for this purity",
    });
    expect(checkReturnWeight({ weightMg: 0, heldBeforeMg: 100_000 })).toEqual({ ok: false, error: "The weight must be more than 0" });
  });
});

describe("labour balance and payouts (spec 023 K12, K13, K16)", () => {
  it("labour owed is accrued less paid: ₹14,550.00 - ₹10,000.00 = ₹4,550.00", () => {
    expect(labourPayable(1_455_000, 1_000_000)).toBe(455_000);
  });

  it("a payout up to the balance is allowed and leaves the rest; more is refused with the amount owed", () => {
    expect(checkPayout({ amountPaise: 455_000, payableBeforePaise: 455_000 })).toEqual({ ok: true, result: 0 });
    expect(checkPayout({ amountPaise: 455_001, payableBeforePaise: 455_000 })).toEqual({ ok: false, error: "Only ₹4550.00 is owed to this karigar" });
    expect(checkPayout({ amountPaise: 0, payableBeforePaise: 455_000 })).toEqual({ ok: false, error: "The payout must be more than ₹0" });
  });
});
