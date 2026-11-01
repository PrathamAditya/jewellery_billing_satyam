import { describe, expect, it } from "vitest";
import { calculateInvoice, polishWeightMg } from "./invoice";

const line = (over: Record<string, unknown> = {}) => ({
  hsn: "7113", grossWeightMg: 12_020, netWeightMg: 12_020, polishMg: 1_202,
  goldRatePaisePerKg: 1_515_000_000, labourRatePaisePerKg: 0, gstRateBps: 300, ...over,
});

describe("spec 012b: HSN and polish", () => {
  it("rounds polish weight in milligrams half up", () => {
    expect([9800, 9801, 9810, 9820, 9999, 10000].map((n) => polishWeightMg(n, 250))).toEqual([245, 245, 245, 246, 250, 250]);
    expect(polishWeightMg(10000, 0)).toBe(0);
  });
  it("reproduces the reference invoice", () => {
    const out = calculateInvoice({ taxMode: "intra", lines: [line()] });
    expect(out).toMatchObject({ ok: true, result: { taxablePaise: 20_031_330, taxPaise: 600_940, totalBeforeRoundOffPaise: 20_632_270, roundOffPaise: 30, payablePaise: 20_632_300 } });
  });
  it("calculates job work as one expression and splits it only for traceability", () => {
    const out = calculateInvoice({ taxMode: "intra", lines: [line({ hsn: "9988", grossWeightMg: 10_000, netWeightMg: 10_000, polishMg: 200, goldRatePaisePerKg: 1_100_050_000, labourRatePaisePerKg: 45_025_000, gstRateBps: 500 })] });
    expect(out).toMatchObject({ ok: true, result: { taxablePaise: 679_265, taxPaise: 33_964, totalBeforeRoundOffPaise: 713_229, roundOffPaise: -29, payablePaise: 713_200 } });
    if (out.ok) expect(out.result.lines[0]).toMatchObject({ goldAmountPaise: 220_010, labourAmountPaise: 459_255, displayRatePaisePerGram: 66_595 });
  });
  it("accepts exactly the two HSN categories", () => {
    for (const hsn of ["7114", "9989", ""]) expect(calculateInvoice({ taxMode: "intra", lines: [line({ hsn })] }).ok).toBe(false);
    expect(calculateInvoice({ taxMode: "intra", lines: [line({ hsn: " 9988 " })] }).ok).toBe(true);
  });
});
