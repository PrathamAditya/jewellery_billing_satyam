import { describe, expect, it } from "vitest";
import { calculateInvoice, type InvoiceLineInput } from "./invoice";
import { fixPendingRate, pendingChargeableWeightMg, validatePendingLines, type PendingLineInput, type PendingSaleInput } from "./pendingRate";

/** Spec 019c section 6: pending sales (validation, chargeable weight, and the fixing calculation). */

const perGram = (rupees: number, paise = 0) => (rupees * 100 + paise) * 1000;
const pl = (over: Partial<PendingLineInput> = {}): PendingLineInput => ({
  hsn: "7113",
  grossWeightMg: 9_800,
  netWeightMg: 9_800,
  polishMg: 0,
  labourRatePaisePerKg: 0,
  ...over,
});
const sale = (lines: PendingLineInput[], taxMode: "intra" | "inter" = "intra"): PendingSaleInput => ({ taxMode, lines });

describe("R1, R2, R3: validating a pending sale", () => {
  const cases: [string, PendingSaleInput, string | null][] = [
    ["a valid silver line", sale([pl()]), null],
    ["a valid line with polish and labour", sale([pl({ polishMg: 490, labourRatePaisePerKg: 5_000_000 })]), null],
    ["HSN 9988 is refused", sale([pl({ hsn: "9988" })]), "pending_job_work"],
    ["an unknown HSN is refused", sale([pl({ hsn: "1234" })]), "invalid_hsn"],
    ["zero net weight", sale([pl({ netWeightMg: 0, grossWeightMg: 0 })]), "invalid_net_weight"],
    ["gross below net", sale([pl({ grossWeightMg: 9_000 })]), "gross_below_net"],
    ["negative polish", sale([pl({ polishMg: -1 })]), "invalid_polish"],
    ["negative labour", sale([pl({ labourRatePaisePerKg: -1 })]), "invalid_labour_rate"],
    ["labour above the limit", sale([pl({ labourRatePaisePerKg: 10_00_00_001 * 100 })]), "labour_rate_too_large"],
    ["no lines", sale([]), "no_lines"],
    ["51 lines", sale(Array.from({ length: 51 }, () => pl())), "too_many_lines"],
    ["a bad tax mode", { taxMode: "both" as "intra", lines: [pl()] }, "invalid_tax_mode"],
  ];
  for (const [name, input, code] of cases) {
    it(`${name}: ${code ?? "accepted"}`, () => {
      const codes = validatePendingLines(input).map((e) => e.code);
      if (code === null) expect(codes).toEqual([]);
      else expect(codes).toContain(code);
    });
  }
});

describe("R5: the chargeable weight shown while the rate is pending", () => {
  it("is net plus polish, and polish is not charged on the gross weight", () => {
    expect(pendingChargeableWeightMg({ netWeightMg: 9_800, polishMg: 490 })).toBe(10_290);
    expect(pendingChargeableWeightMg({ netWeightMg: 9_800, polishMg: 0 })).toBe(9_800);
  });
});

describe("R8: fixing the rate gives the same figures as an ordinary invoice", () => {
  // The client's silver example (spec 013 section 6): 9.800 g at Rs 285.72 per gram.
  it("silver 9.800 g fixed at 285.72 per gram is payable Rs 2,884.00, as the paper bill", () => {
    const out = fixPendingRate(sale([pl()]), [perGram(285, 72)]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.taxablePaise).toBe(280_006);
    expect(out.result.taxPaise).toBe(8_400);
    expect(out.result.roundOffPaise).toBe(-6);
    expect(out.result.payablePaise).toBe(288_400);
  });

  const ordinaryLines = (lines: PendingLineInput[], rates: number[]): InvoiceLineInput[] =>
    lines.map((l, i) => ({ ...l, goldRatePaisePerKg: rates[i]!, gstRateBps: 300 }));

  const cases: { name: string; lines: PendingLineInput[]; rates: number[]; taxMode: "intra" | "inter" }[] = [
    { name: "one line with polish and labour, intra", lines: [pl({ polishMg: 490, labourRatePaisePerKg: 5_000_000 })], rates: [perGram(7_250)], taxMode: "intra" },
    { name: "two purities, inter", lines: [pl(), pl({ netWeightMg: 4_321, grossWeightMg: 5_000, polishMg: 100, labourRatePaisePerKg: 300_000 })], rates: [perGram(285, 72), perGram(11_000)], taxMode: "inter" },
  ];
  for (const c of cases) {
    it(`matches calculateInvoice: ${c.name}`, () => {
      const pending = fixPendingRate(sale(c.lines, c.taxMode), c.rates);
      const ordinary = calculateInvoice({ taxMode: c.taxMode, lines: ordinaryLines(c.lines, c.rates) });
      expect(pending).toEqual(ordinary);
    });
  }

  it("refuses a missing gold rate for a line", () => {
    const out = fixPendingRate(sale([pl(), pl()]), [perGram(285, 72)]);
    expect(out.ok).toBe(false);
  });

  it("refuses a zero gold rate, which the normal calculation also refuses", () => {
    const out = fixPendingRate(sale([pl()]), [0]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]?.code).toBe("invalid_gold_rate");
  });

  it("refuses an invalid sale before fixing", () => {
    const out = fixPendingRate(sale([pl({ hsn: "9988" })]), [perGram(285, 72)]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]?.code).toBe("pending_job_work");
  });
});
