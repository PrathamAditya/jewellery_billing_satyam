import { MAX_PRICE_PAISE_PER_KG } from "@jewellery/shared";
import { calculateInvoice, LIMITS, type CalculateOutcome, type InvoiceError, type InvoiceLineInput, type TaxMode } from "./invoice";

/**
 * Spec 019c. Pure: a credit sale whose gold rate is fixed later.
 * Before fixing, a line has its weights, purity and labour rate only. Fixing gives every line its gold rate and
 * then the normal calculation runs (`calculateInvoice`), so a fixed sale gives the same figures as an ordinary invoice.
 */

export type PendingLineInput = {
  hsn: string;
  grossWeightMg: number;
  netWeightMg: number;
  /** Polish weight in mg (the API converts the polish percentage first, spec 012b R2). */
  polishMg: number;
  labourRatePaisePerKg: number;
};

export type PendingSaleInput = { taxMode: TaxMode; lines: PendingLineInput[] };

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

/** Spec 019c R1, R3 (Q94): HSN 7113 only, weight pricing only, so every line is checked the same way as spec 012 R1. */
export function validatePendingLines(input: PendingSaleInput): InvoiceError[] {
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
    if (typeof l.hsn !== "string" || l.hsn.trim() !== "7113") {
      bad(n, "hsn", l.hsn?.trim() === "9988" ? "pending_job_work" : "invalid_hsn", `Line ${n}: a sale with the rate fixed later can only be HSN 7113`);
    }
    if (!isInt(l.netWeightMg) || l.netWeightMg <= 0) bad(n, "netWeightMg", "invalid_net_weight", `Line ${n}: net weight must be more than 0`);
    else if (l.netWeightMg > LIMITS.maxNetWeightMg) bad(n, "netWeightMg", "net_weight_too_large", `Line ${n}: net weight is above 100 kg`);
    if (!isInt(l.grossWeightMg) || l.grossWeightMg < 0) bad(n, "grossWeightMg", "invalid_gross_weight", `Line ${n}: gross weight is not valid`);
    else if (isInt(l.netWeightMg) && l.grossWeightMg < l.netWeightMg) bad(n, "grossWeightMg", "gross_below_net", `Line ${n}: gross weight cannot be less than net weight`);
    if (!isInt(l.polishMg) || l.polishMg < 0) bad(n, "polishMg", "invalid_polish", `Line ${n}: polish cannot be negative`);
    if (!isInt(l.labourRatePaisePerKg) || l.labourRatePaisePerKg < 0) bad(n, "labourRatePaisePerKg", "invalid_labour_rate", `Line ${n}: labour rate cannot be negative`);
    else if (l.labourRatePaisePerKg > MAX_PRICE_PAISE_PER_KG) bad(n, "labourRatePaisePerKg", "labour_rate_too_large", `Line ${n}: labour rate is too large`);
  });
  return errors;
}

/** Spec 019c R5: the weight that is charged on a line (net plus polish, spec 012 R5). Shown while the rate is pending. */
export const pendingChargeableWeightMg = (l: Pick<PendingLineInput, "netWeightMg" | "polishMg">): number => l.netWeightMg + l.polishMg;

/**
 * Spec 019c R8: the fixing calculation. `goldRatesPaisePerKg` holds one gold rate per line, in line order.
 * The tax rate follows the HSN (7113 at 3%), as in spec 013 R2. No discounts or stones on these sales (Q94).
 */
export function fixPendingRate(input: PendingSaleInput, goldRatesPaisePerKg: number[]): CalculateOutcome {
  const errors = validatePendingLines(input);
  if (errors.length) return { ok: false, errors };
  if (goldRatesPaisePerKg.length !== input.lines.length) {
    return { ok: false, errors: [{ line: null, field: "goldRates", code: "rate_missing", message: "A gold rate is needed for every line" }] };
  }
  const lines: InvoiceLineInput[] = input.lines.map((l, i) => ({
    hsn: l.hsn.trim(),
    grossWeightMg: l.grossWeightMg,
    netWeightMg: l.netWeightMg,
    polishMg: l.polishMg,
    goldRatePaisePerKg: goldRatesPaisePerKg[i]!,
    labourRatePaisePerKg: l.labourRatePaisePerKg,
    gstRateBps: 300,
    pricingMode: "weight",
  }));
  return calculateInvoice({ taxMode: input.taxMode, lines });
}
