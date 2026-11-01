import { MAX_PRICE_PAISE_PER_KG, RATE_UNIT_MG } from "@jewellery/shared";
import { divRoundHalfUp, roundOffPaise } from "./round";

/** Spec 012. Pure: no database, no clock. Money is integer paise, weight integer mg, rates paise per kg. */

export type TaxMode = "intra" | "inter";

export type InvoiceLineInput = {
  description?: string;
  hsn: string;
  grossWeightMg: number;
  netWeightMg: number;
  polishMg: number;
  goldRatePaisePerKg: number;
  labourRatePaisePerKg: number;
  /** Basis points: 3% is 300. */
  gstRateBps: number;
};

/** Spec 012b R2. Percentage is basis points (2% is 200). */
export function polishWeightMg(netWeightMg: number, polishBps: number): number {
  return Number(divRoundHalfUp(BigInt(netWeightMg) * BigInt(polishBps), 10_000n));
}

export type InvoiceInput = { lines: InvoiceLineInput[]; taxMode: TaxMode };

export type LineResult = {
  chargeableWeightMg: number;
  internalRatePaisePerKg: number;
  goldAmountPaise: number;
  labourAmountPaise: number;
  amountPaise: number;
  /** For printing only (R8): paise per gram. */
  displayRatePaisePerGram: number;
  gstRateBps: number;
};

export type GroupResult = {
  gstRateBps: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

export type InvoiceResult = {
  taxMode: TaxMode;
  lines: LineResult[];
  groups: GroupResult[];
  taxablePaise: number;
  taxPaise: number;
  totalBeforeRoundOffPaise: number;
  /** Can be negative (R12). */
  roundOffPaise: number;
  payablePaise: number;
};

export type InvoiceError = {
  /** 1-based line number, or null when the problem is with the invoice as a whole. */
  line: number | null;
  field: string;
  code: string;
  message: string;
};

export type CalculateOutcome = { ok: true; result: InvoiceResult } | { ok: false; errors: InvoiceError[] };

export const LIMITS = {
  maxLines: 50,
  maxNetWeightMg: 100_000_000, // 100 kg
  maxGstRateBps: 2800,
} as const;

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

function validate(input: InvoiceInput): InvoiceError[] {
  const errors: InvoiceError[] = [];
  const bad = (line: number | null, field: string, code: string, message: string) => errors.push({ line, field, code, message });

  if (input.taxMode !== "intra" && input.taxMode !== "inter") bad(null, "taxMode", "invalid_tax_mode", "Tax mode must be intra or inter");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    bad(null, "lines", "no_lines", "Add at least one line");
    return errors;
  }
  if (input.lines.length > LIMITS.maxLines) bad(null, "lines", "too_many_lines", `An invoice can have at most ${LIMITS.maxLines} lines`);

  input.lines.forEach((l, i) => {
    const n = i + 1;
    if (typeof l.hsn !== "string" || !["7113", "9988"].includes(l.hsn.trim())) bad(n, "hsn", "invalid_hsn", `Line ${n}: Choose 7113 or 9988`);
    if (!isInt(l.netWeightMg) || l.netWeightMg <= 0) bad(n, "netWeightMg", "invalid_net_weight", `Line ${n}: net weight must be more than 0`);
    else if (l.netWeightMg > LIMITS.maxNetWeightMg) bad(n, "netWeightMg", "net_weight_too_large", `Line ${n}: net weight is above 100 kg`);
    if (!isInt(l.grossWeightMg) || l.grossWeightMg < 0) bad(n, "grossWeightMg", "invalid_gross_weight", `Line ${n}: gross weight is not valid`);
    else if (isInt(l.netWeightMg) && l.grossWeightMg < l.netWeightMg) bad(n, "grossWeightMg", "gross_below_net", `Line ${n}: gross weight cannot be less than net weight`);
    if (!isInt(l.polishMg) || l.polishMg < 0) bad(n, "polishMg", "invalid_polish", `Line ${n}: polish cannot be negative`);
    if (!isInt(l.goldRatePaisePerKg) || l.goldRatePaisePerKg <= 0) bad(n, "goldRatePaisePerKg", "invalid_gold_rate", `Line ${n}: gold rate must be more than 0`);
    else if (l.goldRatePaisePerKg > MAX_PRICE_PAISE_PER_KG) bad(n, "goldRatePaisePerKg", "gold_rate_too_large", `Line ${n}: gold rate is too large`);
    if (!isInt(l.labourRatePaisePerKg) || l.labourRatePaisePerKg < 0) bad(n, "labourRatePaisePerKg", "invalid_labour_rate", `Line ${n}: labour rate cannot be negative`);
    else if (l.labourRatePaisePerKg > MAX_PRICE_PAISE_PER_KG) bad(n, "labourRatePaisePerKg", "labour_rate_too_large", `Line ${n}: labour rate is too large`);
    const expectedGst = l.hsn.trim() === "9988" ? 500 : 300;
    if (!isInt(l.gstRateBps) || l.gstRateBps !== expectedGst) bad(n, "gstRateBps", "invalid_gst_rate", `Line ${n}: GST rate must match the HSN`);
  });
  return errors;
}

/** weight (mg) x rate (paise per kg) / 1 kg in mg, rounded half up to a paisa (R6, R7). */
const amountFor = (weightMg: number, ratePaisePerKg: number): number =>
  Number(divRoundHalfUp(BigInt(weightMg) * BigInt(ratePaisePerKg), BigInt(RATE_UNIT_MG)));

/** Works out every figure on the bill (spec 012). Returns errors instead of throwing for bad input. */
export function calculateInvoice(input: InvoiceInput): CalculateOutcome {
  const errors = validate(input);
  if (errors.length) return { ok: false, errors };

  const lines: LineResult[] = input.lines.map((l) => {
    const chargeableWeightMg = l.netWeightMg + l.polishMg; // R5
    const internalRatePaisePerKg = l.goldRatePaisePerKg + l.labourRatePaisePerKg; // R4
    const jobWork = l.hsn.trim() === "9988";
    // Job work is the single expression from D13; do not round its parts first.
    const amountPaise = jobWork
      ? Number(divRoundHalfUp(BigInt(chargeableWeightMg) * BigInt(internalRatePaisePerKg) - BigInt(l.netWeightMg) * BigInt(l.goldRatePaisePerKg), BigInt(RATE_UNIT_MG)))
      : amountFor(chargeableWeightMg, internalRatePaisePerKg);
    const goldAmountPaise = jobWork
      ? amountFor(chargeableWeightMg, l.goldRatePaisePerKg) - amountFor(l.netWeightMg, l.goldRatePaisePerKg)
      : amountFor(chargeableWeightMg, l.goldRatePaisePerKg);
    return {
      chargeableWeightMg,
      internalRatePaisePerKg,
      goldAmountPaise,
      labourAmountPaise: amountPaise - goldAmountPaise,
      amountPaise,
      // paise per gram = amount / weight in mg x 1000 mg per gram (R8)
      displayRatePaisePerGram: Number(divRoundHalfUp(BigInt(amountPaise) * 1000n, BigInt(chargeableWeightMg))),
      gstRateBps: l.gstRateBps,
    };
  });

  // R9: tax once per rate group, on the sum of that group's line amounts.
  const taxableByRate = new Map<number, number>();
  for (const l of lines) taxableByRate.set(l.gstRateBps, (taxableByRate.get(l.gstRateBps) ?? 0) + l.amountPaise);

  const groups: GroupResult[] = [...taxableByRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([gstRateBps, taxablePaise]) => {
      const t = BigInt(taxablePaise);
      const bps = BigInt(gstRateBps);
      if (input.taxMode === "intra") {
        const half = Number(divRoundHalfUp(t * bps, 20_000n)); // R10: each half is rate / 2
        return { gstRateBps, taxablePaise, cgstPaise: half, sgstPaise: half, igstPaise: 0 };
      }
      return { gstRateBps, taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: Number(divRoundHalfUp(t * bps, 10_000n)) };
    });

  const taxablePaise = lines.reduce((s, l) => s + l.amountPaise, 0); // R11
  const taxPaise = groups.reduce((s, g) => s + g.cgstPaise + g.sgstPaise + g.igstPaise, 0);
  const totalBeforeRoundOffPaise = taxablePaise + taxPaise;
  const payablePaise = roundOffPaise(totalBeforeRoundOffPaise); // R12

  return {
    ok: true,
    result: {
      taxMode: input.taxMode,
      lines,
      groups,
      taxablePaise,
      taxPaise,
      totalBeforeRoundOffPaise,
      roundOffPaise: payablePaise - totalBeforeRoundOffPaise,
      payablePaise,
    },
  };
}
