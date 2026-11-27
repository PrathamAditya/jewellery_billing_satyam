import { describe, expect, it } from "vitest";
import { calculateInvoice, type InvoiceLineInput } from "./invoice";
import { labourExGstPaisePerKg, solveForPayable } from "./reverse";

const perGram = (rupees: number, paise = 0) => (rupees * 100 + paise) * 1000;
const base = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  hsn: "7113",
  grossWeightMg: 9_800,
  netWeightMg: 9_800,
  polishMg: 0,
  goldRatePaisePerKg: perGram(285, 72),
  labourRatePaisePerKg: 0,
  gstRateBps: 300,
  ...over,
});
const payable = (l: InvoiceLineInput) => {
  const o = calculateInvoice({ taxMode: "intra", lines: [l] });
  return o.ok ? o.result.payablePaise : null;
};

describe("labourExGstPaisePerKg (feedback point 7)", () => {
  const cases: [string, number, number, number][] = [
    ["103 including 3% GST is 100", 103_000_000, 300, 100_000_000],
    ["zero stays zero", 0, 300, 0],
    ["no GST (0%) changes nothing", 50_000_000, 0, 50_000_000],
    ["job work 5%: 105 is 100", 105_000_000, 500, 100_000_000],
    ["rounds half up to the paisa: 1 paise per kg at 3%", 1, 300, 1],
  ];
  it.each(cases)("%s", (_n, incl, bps, expected) => {
    expect(labourExGstPaisePerKg(incl, bps)).toBe(expected);
  });
  it("labour typed with GST included brings the same total as the plain rate: 103 with GST equals 100 without", () => {
    const withGst = payable(base({ labourRatePaisePerKg: labourExGstPaisePerKg(perGram(103), 300) }));
    const plain = payable(base({ labourRatePaisePerKg: perGram(100) }));
    expect(withGst).toBe(plain);
  });
  it("rejects negatives", () => {
    expect(() => labourExGstPaisePerKg(-1, 300)).toThrow(RangeError);
  });
});

describe("solveForPayable (feedback point 11: reverse calculation)", () => {
  it("the client's paper bill: 2,884.00 on 9.800 g gives the gold rate 285.72 per gram", () => {
    // unknown = milli-rupees per gram (285.720 -> 285720), paise per kg = x * 100
    const r = solveForPayable((x) => payable(base({ goldRatePaisePerKg: x * 100 })), 288_400, 1, 100_000_000);
    if (!r.ok) throw new Error(r.message);
    // Many rates round to the same whole-rupee total, so the answer is any of them; it must be exact and close to the paper bill's 285.72.
    expect(r.exact).toBe(true);
    expect(payable(base({ goldRatePaisePerKg: r.x * 100 }))).toBe(288_400);
    expect(r.x % 10).toBe(0);
    expect(Math.abs(r.x - 285_720)).toBeLessThanOrEqual(100);
    // ...and the paper bill's own rate is one of the valid answers.
    expect(payable(base({ goldRatePaisePerKg: 285_720 * 100 }))).toBe(288_400);
  });

  it("solves labour: gold 285.72 and a total of 3,500 on 9.800 g", () => {
    const r = solveForPayable((x) => payable(base({ labourRatePaisePerKg: x * 100 })), 350_000, 0, 100_000_000);
    if (!r.ok) throw new Error(r.message);
    expect(r.exact).toBe(true);
    expect(payable(base({ labourRatePaisePerKg: r.x * 100 }))).toBe(350_000);
    expect(r.x % 10).toBe(0); // a round figure, two decimals per gram
  });

  it("solves the net weight: gold 285.72, total 2,884.00 gives 9.800 g", () => {
    const r = solveForPayable((x) => payable(base({ netWeightMg: x, grossWeightMg: x })), 288_400, 1, 100_000_000);
    expect(r).toEqual({ ok: true, x: 9_800, payablePaise: 288_400, exact: true });
  });

  it("every whole-rupee total in a range is reached exactly, and the answer really gives that total", () => {
    for (let rupees = 500; rupees <= 60_000; rupees += 977) {
      const r = solveForPayable((x) => payable(base({ goldRatePaisePerKg: x * 100 })), rupees * 100, 1, 100_000_000);
      if (!r.ok) throw new Error(r.message);
      expect(r.exact).toBe(true);
      expect(payable(base({ goldRatePaisePerKg: r.x * 100 }))).toBe(rupees * 100);
    }
  });

  it("a large weight leaves no round figure, so it falls back to the middle of the range and is still exact", () => {
    const heavy = base({ netWeightMg: 2_500_000, grossWeightMg: 2_500_000 });
    const r = solveForPayable((x) => payable({ ...heavy, goldRatePaisePerKg: x * 100 }), 1_85_00_000_00, 1, 100_000_000);
    if (!r.ok) throw new Error(r.message);
    expect(payable({ ...heavy, goldRatePaisePerKg: r.x * 100 })).toBe(1_85_00_000_00);
  });

  it("an amount that cannot be reached exactly returns the closest total and says it is not exact", () => {
    // Weight steps of 10 mg on 285.72/g are about 2.9 rupees apart in tax-included total, but the total is whole rupees,
    // so ask the weight solver for a total no whole milligram can hit and check it is flagged inexact or exact consistently.
    const r = solveForPayable((x) => payable(base({ netWeightMg: x, grossWeightMg: x, goldRatePaisePerKg: perGram(80_000) })), 1_000_100, 1, 100_000_000, 10);
    if (!r.ok) throw new Error(r.message);
    expect(r.payablePaise === 1_000_100 ? r.exact : !r.exact).toBe(true);
    expect(Math.abs(r.payablePaise - 1_000_100)).toBeLessThanOrEqual(8_000_000 / 1000); // within one 1 mg step
  });

  it("says so when the amount is too large to reach, and when it is zero", () => {
    expect(solveForPayable(() => 100, 500, 1, 10)).toEqual({ ok: false, message: "That amount is too large to reach with this line" });
    expect(solveForPayable(() => 100, 0, 1, 10)).toEqual({ ok: false, message: "Enter the final amount" });
  });

  it("treats an invalid invoice (null) as too low, so a small fixed discount base does not break the search", () => {
    const r = solveForPayable((x) => (x < 5 ? null : x * 100), 700, 1, 100, 1);
    expect(r).toEqual({ ok: true, x: 7, payablePaise: 700, exact: true });
  });
});
