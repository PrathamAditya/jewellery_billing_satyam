import { describe, expect, it } from "vitest";
import { calculateCreditNote } from "./creditNote";
import { calculateInvoice, type InvoiceLineInput } from "./invoice";

/** Spec 019d R3: table of worked examples. Amounts in paise. */
type Row = { name: string; taxMode: "intra" | "inter"; lines: { taxablePaise: number; gstRateBps: number }[]; taxable: number; tax: number; total: number; amount: number; roundOff: number };

const rows: Row[] = [
  // 3% on 1,000.00: intra halves 15.00 + 15.00 = 30.00, total 1,030.00, already whole rupees
  { name: "intra, one rate, whole rupees", taxMode: "intra", lines: [{ taxablePaise: 100_000, gstRateBps: 300 }], taxable: 100_000, tax: 3_000, total: 103_000, amount: 103_000, roundOff: 0 },
  // inter: IGST 3% on 1,000.00 = 30.00
  { name: "inter, IGST", taxMode: "inter", lines: [{ taxablePaise: 100_000, gstRateBps: 300 }], taxable: 100_000, tax: 3_000, total: 103_000, amount: 103_000, roundOff: 0 },
  // one group at 3%: taxable 1,500.50, each half = round(150050 x 300 / 20000) = 2251 (2250.75 rounds up), tax 45.02, total 1,545.52, rounded to 1,546.00
  { name: "two lines, same rate, half rounds up (total 1,545.52 to 1,546)", taxMode: "intra", lines: [{ taxablePaise: 100_000, gstRateBps: 300 }, { taxablePaise: 50_050, gstRateBps: 300 }], taxable: 150_050, tax: 4_502, total: 154_552, amount: 154_600, roundOff: 48 },
  // two rate groups: 3% on 800.00 = 24.00, 18% on 200.00 = 36.00; intra halves 12 + 12, 18 + 18 = 60.00
  { name: "two rate groups", taxMode: "intra", lines: [{ taxablePaise: 80_000, gstRateBps: 300 }, { taxablePaise: 20_000, gstRateBps: 1_800 }], taxable: 100_000, tax: 6_000, total: 106_000, amount: 106_000, roundOff: 0 },
    { name: "IGST 3% lands on a whole rupee", taxMode: "inter", lines: [{ taxablePaise: 97_087, gstRateBps: 300 }], taxable: 97_087, tax: 2_913, total: 100_000, amount: 100_000, roundOff: 0 },
  { name: "round-off up (49 paise down, 50 up)", taxMode: "inter", lines: [{ taxablePaise: 99_950, gstRateBps: 0 }], taxable: 99_950, tax: 0, total: 99_950, amount: 100_000, roundOff: 50 },
  { name: "round-off down by 40 paise", taxMode: "inter", lines: [{ taxablePaise: 100_040, gstRateBps: 0 }], taxable: 100_040, tax: 0, total: 100_040, amount: 100_000, roundOff: -40 },
];

describe("calculateCreditNote (spec 019d R3)", () => {
  for (const r of rows) {
    it(r.name, () => {
      const out = calculateCreditNote({ taxMode: r.taxMode, lines: r.lines });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.taxablePaise).toBe(r.taxable);
      expect(out.result.taxPaise).toBe(r.tax);
      expect(out.result.totalBeforeRoundOffPaise).toBe(r.total);
      expect(out.result.amountPaise).toBe(r.amount);
      expect(out.result.roundOffPaise).toBe(r.roundOff);
      expect(out.result.amountPaise % 100).toBe(0);
    });
  }

  it("returning a whole invoice reproduces the invoice's own tax and payable", () => {
    const line: InvoiceLineInput = { hsn: "7113", grossWeightMg: 9_800, netWeightMg: 9_800, polishMg: 0, goldRatePaisePerKg: 285_720_000, labourRatePaisePerKg: 0, gstRateBps: 300 };
    const inv = calculateInvoice({ lines: [line], taxMode: "intra" });
    if (!inv.ok) throw new Error("setup");
    const cn = calculateCreditNote({ taxMode: "intra", lines: inv.result.lines.map((l) => ({ taxablePaise: l.taxablePaise, gstRateBps: l.gstRateBps })) });
    if (!cn.ok) throw new Error("setup");
    expect(cn.result.taxPaise).toBe(inv.result.taxPaise);
    expect(cn.result.taxablePaise).toBe(inv.result.taxablePaise);
    expect(cn.result.amountPaise).toBe(inv.result.payablePaise);
  });

  it("refuses no lines, more than 50 lines, zero or negative values and bad rates", () => {
    expect(calculateCreditNote({ taxMode: "intra", lines: [] }).ok).toBe(false);
    expect(calculateCreditNote({ taxMode: "intra", lines: Array.from({ length: 51 }, () => ({ taxablePaise: 100, gstRateBps: 300 })) }).ok).toBe(false);
    expect(calculateCreditNote({ taxMode: "intra", lines: [{ taxablePaise: 0, gstRateBps: 300 }] }).ok).toBe(false);
    expect(calculateCreditNote({ taxMode: "intra", lines: [{ taxablePaise: -5, gstRateBps: 300 }] }).ok).toBe(false);
    expect(calculateCreditNote({ taxMode: "intra", lines: [{ taxablePaise: 100, gstRateBps: 10_001 }] }).ok).toBe(false);
    expect(calculateCreditNote({ taxMode: "intra", lines: [{ taxablePaise: 1.5, gstRateBps: 300 }] }).ok).toBe(false);
  });
});
