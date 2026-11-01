import { describe, expect, it } from "vitest";
import { calculateInvoice, type InvoiceInput, type InvoiceLineInput, type InvoiceResult } from "./invoice";

/** Per gram rupees to paise per kg, for readable test data. */
const perGram = (rupees: number, paise = 0) => (rupees * 100 + paise) * 1000;

const line = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  hsn: "7113",
  grossWeightMg: 9_800,
  netWeightMg: 9_800,
  polishMg: 0,
  goldRatePaisePerKg: perGram(285, 72), // 285.72 per gram
  labourRatePaisePerKg: 0,
  gstRateBps: 300,
  ...over,
});

const calc = (lines: InvoiceLineInput[], taxMode: "intra" | "inter" = "intra"): InvoiceResult => {
  const out = calculateInvoice({ lines, taxMode });
  if (!out.ok) throw new Error(JSON.stringify(out.errors));
  return out.result;
};

describe("A. the client's real invoice (docs/client-invoice-reference.md)", () => {
  const r = calc([line()]);
  it("matches the paper bill figure by figure", () => {
    expect(r.lines[0]).toEqual({
      chargeableWeightMg: 9_800,
      internalRatePaisePerKg: 28_572_000,
      goldAmountPaise: 280_006,
      labourAmountPaise: 0,
      amountPaise: 280_006, // 2,800.06
      displayRatePaisePerGram: 28_572, // 285.72
      gstRateBps: 300,
    });
    expect(r.groups).toEqual([{ gstRateBps: 300, taxablePaise: 280_006, cgstPaise: 4_200, sgstPaise: 4_200, igstPaise: 0 }]);
    expect(r.taxablePaise).toBe(280_006);
    expect(r.taxPaise).toBe(8_400);
    expect(r.totalBeforeRoundOffPaise).toBe(288_406); // 2,884.06 as on the paper bill
    expect(r.roundOffPaise).toBe(-6);
    expect(r.payablePaise).toBe(288_400);
  });
});

describe("B. gold with labour", () => {
  const r = calc([line({ grossWeightMg: 12_345, netWeightMg: 12_345, goldRatePaisePerKg: perGram(11_000, 50), labourRatePaisePerKg: perGram(450, 25) })]);
  it("splits the amount into gold and labour parts that add up", () => {
    const l = r.lines[0]!;
    expect(l.internalRatePaisePerKg).toBe(1_145_075_000);
    expect(l.amountPaise).toBe(14_135_951);
    expect(l.goldAmountPaise).toBe(13_580_117);
    expect(l.labourAmountPaise).toBe(555_834);
    expect(l.goldAmountPaise + l.labourAmountPaise).toBe(l.amountPaise);
    expect(l.displayRatePaisePerGram).toBe(1_145_075);
  });
  it("tax and round-off", () => {
    expect(r.groups[0]).toMatchObject({ cgstPaise: 212_039, sgstPaise: 212_039 });
    expect(r.totalBeforeRoundOffPaise).toBe(14_560_029);
    expect(r.roundOffPaise).toBe(-29);
    expect(r.payablePaise).toBe(14_560_000);
  });
});

describe("C. two lines, one rate group: tax once on the group total (Q1)", () => {
  const r = calc([line({ grossWeightMg: 1_000, netWeightMg: 1_000 }), line({ grossWeightMg: 1_000, netWeightMg: 1_000 })]);
  it("57,144 taxable gives 857 each, not 429 + 429", () => {
    expect(r.lines.map((l) => l.amountPaise)).toEqual([28_572, 28_572]);
    expect(r.groups).toEqual([{ gstRateBps: 300, taxablePaise: 57_144, cgstPaise: 857, sgstPaise: 857, igstPaise: 0 }]);
    expect(r.totalBeforeRoundOffPaise).toBe(58_858);
    expect(r.roundOffPaise).toBe(42);
    expect(r.payablePaise).toBe(58_900);
  });
});

describe("D. polish adds to the chargeable weight", () => {
  const r = calc([line({ grossWeightMg: 10_000, netWeightMg: 10_000, polishMg: 500 })]);
  it("amount, display rate, tax, payable", () => {
    expect(r.lines[0]).toMatchObject({ chargeableWeightMg: 10_500, amountPaise: 300_006, displayRatePaisePerGram: 28_572 });
    expect(r.groups[0]).toMatchObject({ cgstPaise: 4_500, sgstPaise: 4_500 });
    expect(r.totalBeforeRoundOffPaise).toBe(309_006);
    expect(r.roundOffPaise).toBe(-6);
    expect(r.payablePaise).toBe(309_000);
  });
});

describe("E. other state: IGST", () => {
  const r = calc([line()], "inter");
  it("one IGST figure, same total", () => {
    expect(r.groups).toEqual([{ gstRateBps: 300, taxablePaise: 280_006, cgstPaise: 0, sgstPaise: 0, igstPaise: 8_400 }]);
    expect(r.taxPaise).toBe(8_400);
    expect(r.totalBeforeRoundOffPaise).toBe(288_406);
    expect(r.payablePaise).toBe(288_400);
  });
});

describe("F. two rate groups", () => {
  const r = calc([
    line(),
    line({ hsn: "9988", grossWeightMg: 12_345, netWeightMg: 12_345, goldRatePaisePerKg: perGram(11_000, 50), labourRatePaisePerKg: perGram(450, 25), gstRateBps: 500 }),
  ]);
  it("groups are separate, sorted by rate, and add up", () => {
    expect(r.groups).toEqual([
      { gstRateBps: 300, taxablePaise: 280_006, cgstPaise: 4_200, sgstPaise: 4_200, igstPaise: 0 },
      { gstRateBps: 500, taxablePaise: 555_834, cgstPaise: 13_896, sgstPaise: 13_896, igstPaise: 0 },
    ]);
    expect(r.totalBeforeRoundOffPaise).toBe(872_032);
    expect(r.roundOffPaise).toBe(-32);
    expect(r.payablePaise).toBe(872_000);
  });
});

describe("G. round-off boundaries (R12)", () => {
  // Make a bill whose total before round-off is exactly `total`: a 0% line, so total = amount.
  // amount = weight_mg x rate / 1e6, so rate 1,000,000 paise per kg gives amount = weight_mg paise.
  it.each([
    [288_406, -6, 288_400],
    [288_449, -49, 288_400],
    [288_450, 50, 288_500],
    [288_451, 49, 288_500],
    [100_000, 0, 100_000],
    [100_049, -49, 100_000],
    [100_050, 50, 100_100],
  ])("total %i -> round-off %i -> payable %i", (total, roundOff, payable) => {
    const r = calc([line({ grossWeightMg: total, netWeightMg: total, goldRatePaisePerKg: 1_000_000, gstRateBps: 0 })]);
    expect(r.totalBeforeRoundOffPaise).toBe(total);
    expect(r.roundOffPaise).toBe(roundOff);
    expect(r.payablePaise).toBe(payable);
    expect(r.payablePaise % 100).toBe(0);
  });
});

describe("H. rounding and size", () => {
  it("100 kg at the top rate is exact", () => {
    const r = calc([line({ grossWeightMg: 100_000_000, netWeightMg: 100_000_000, goldRatePaisePerKg: 10_000_000_000, gstRateBps: 0 })]);
    expect(r.lines[0]!.amountPaise).toBe(1_000_000_000_000);
    expect(r.payablePaise).toBe(1_000_000_000_000);
  });
  it("labour 0: labour part 0, gold part is the amount", () => {
    const l = calc([line()]).lines[0]!;
    expect(l.labourAmountPaise).toBe(0);
    expect(l.goldAmountPaise).toBe(l.amountPaise);
  });
  it("labour above gold is fine", () => {
    const l = calc([line({ goldRatePaisePerKg: perGram(100), labourRatePaisePerKg: perGram(300) })]).lines[0]!;
    expect(l.internalRatePaisePerKg).toBe(perGram(400));
    expect(l.amountPaise).toBe(Math.round((9_800 * perGram(400)) / 1_000_000));
    expect(l.labourAmountPaise).toBeGreaterThan(l.goldAmountPaise);
  });
  it("a tiny line (1 mg at 1 paise per kg) is 0 paise, no error", () => {
    const r = calc([line({ grossWeightMg: 1, netWeightMg: 1, goldRatePaisePerKg: 1, gstRateBps: 0 })]);
    expect(r.lines[0]!.amountPaise).toBe(0);
    expect(r.payablePaise).toBe(0);
  });
  it("a 0% line pays no tax and can sit with a taxed line", () => {
    const r = calc([line(), line({ gstRateBps: 0 })]);
    expect(r.groups.map((g) => g.gstRateBps)).toEqual([0, 300]);
    expect(r.groups[0]).toMatchObject({ taxablePaise: 280_006, cgstPaise: 0, sgstPaise: 0 });
  });
  it("an odd half-split rounds each half the same way in intra mode", () => {
    // 25 bps (0.25%) on 28,572: each half = 28,572 x 25 / 20,000 = 35.715 -> 36
    const r = calc([line({ grossWeightMg: 1_000, netWeightMg: 1_000, gstRateBps: 25 })]);
    expect(r.groups[0]).toMatchObject({ cgstPaise: 36, sgstPaise: 36 });
  });
});

describe("I. validation", () => {
  const errorsFor = (input: InvoiceInput) => {
    const out = calculateInvoice(input);
    expect(out.ok).toBe(false);
    return out.ok ? [] : out.errors;
  };
  const bad = (over: Partial<InvoiceLineInput>) => errorsFor({ taxMode: "intra", lines: [line(over)] });

  it.each([
    ["net 0", { netWeightMg: 0 }, "netWeightMg", "invalid_net_weight"],
    ["negative net", { netWeightMg: -5 }, "netWeightMg", "invalid_net_weight"],
    ["net above 100 kg", { grossWeightMg: 100_000_001, netWeightMg: 100_000_001 }, "netWeightMg", "net_weight_too_large"],
    ["gross below net", { grossWeightMg: 9_799 }, "grossWeightMg", "gross_below_net"],
    ["negative polish", { polishMg: -1 }, "polishMg", "invalid_polish"],
    ["gold rate 0", { goldRatePaisePerKg: 0 }, "goldRatePaisePerKg", "invalid_gold_rate"],
    ["negative labour", { labourRatePaisePerKg: -1 }, "labourRatePaisePerKg", "invalid_labour_rate"],
    ["gst above 28%", { gstRateBps: 2_801 }, "gstRateBps", "invalid_gst_rate"],
    ["negative gst", { gstRateBps: -1 }, "gstRateBps", "invalid_gst_rate"],
    ["fractional weight", { netWeightMg: 9_800.5 }, "netWeightMg", "invalid_net_weight"],
    ["NaN rate", { goldRatePaisePerKg: Number.NaN }, "goldRatePaisePerKg", "invalid_gold_rate"],
    ["invalid HSN", { hsn: "7114" }, "hsn", "invalid_hsn"],
  ] as [string, Partial<InvoiceLineInput>, string, string][])("%s is rejected and names line 1 and the field", (_n, over, field, code) => {
    const errors = bad(over);
    expect(errors).toContainEqual(expect.objectContaining({ line: 1, field, code }));
    expect(errors.find((e) => e.code === code)!.message).toMatch(/^Line 1:/);
  });

  it("0 lines and 51 lines are rejected", () => {
    expect(errorsFor({ taxMode: "intra", lines: [] })).toContainEqual(expect.objectContaining({ code: "no_lines", line: null }));
    expect(errorsFor({ taxMode: "intra", lines: Array.from({ length: 51 }, () => line()) })).toContainEqual(expect.objectContaining({ code: "too_many_lines" }));
    expect(calculateInvoice({ taxMode: "intra", lines: Array.from({ length: 50 }, () => line()) }).ok).toBe(true);
  });

  it("an unknown tax mode is rejected", () => {
    expect(errorsFor({ taxMode: "both" as never, lines: [line()] })).toContainEqual(expect.objectContaining({ code: "invalid_tax_mode" }));
  });

  it("reports every problem at once, with the right line numbers", () => {
    const errors = errorsFor({ taxMode: "intra", lines: [line(), line({ netWeightMg: 0 }), line({ gstRateBps: 9_999, hsn: "9988" })] });
    expect(errors.map((e) => [e.line, e.code]).sort()).toEqual([
      [2, "invalid_net_weight"],
      [3, "invalid_gst_rate"],
    ].sort());
  });
});

describe("J. behaviour", () => {
  it("same input twice gives identical output and the input is not changed", () => {
    const input: InvoiceInput = { taxMode: "intra", lines: [line(), line({ gstRateBps: 500, hsn: "7114" })] };
    const frozen = JSON.stringify(input);
    Object.freeze(input);
    input.lines.forEach(Object.freeze);
    const a = calculateInvoice(input);
    const b = calculateInvoice(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("the result is JSON-safe: it survives a round trip through JSON (no BigInt)", () => {
    const out = calculateInvoice({ taxMode: "inter", lines: [line()] });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it("every figure is a safe whole number", () => {
    const r = calc([line({ goldRatePaisePerKg: 10_000_000_000, grossWeightMg: 100_000_000, netWeightMg: 100_000_000 })]);
    const nums: number[] = [r.taxablePaise, r.taxPaise, r.totalBeforeRoundOffPaise, r.roundOffPaise, r.payablePaise, ...r.lines.flatMap((l) => Object.values(l)), ...r.groups.flatMap((g) => Object.values(g))];
    for (const n of nums) expect(Number.isSafeInteger(n)).toBe(true);
  });

  it("totals always equal the sum of their parts", () => {
    for (const w of [1, 7, 999, 5_555, 7_777, 123_456]) {
      const r = calc([line({ grossWeightMg: w, netWeightMg: w }), line({ grossWeightMg: w + 3, netWeightMg: w + 3, gstRateBps: 500 })]);
      expect(r.taxablePaise).toBe(r.lines.reduce((s, l) => s + l.amountPaise, 0));
      expect(r.taxPaise).toBe(r.groups.reduce((s, g) => s + g.cgstPaise + g.sgstPaise + g.igstPaise, 0));
      expect(r.totalBeforeRoundOffPaise).toBe(r.taxablePaise + r.taxPaise);
      expect(r.payablePaise).toBe(r.totalBeforeRoundOffPaise + r.roundOffPaise);
      expect(r.payablePaise % 100).toBe(0);
      expect(Math.abs(r.roundOffPaise)).toBeLessThanOrEqual(50);
    }
  });
});
