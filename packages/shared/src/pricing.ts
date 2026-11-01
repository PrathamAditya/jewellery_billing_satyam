import type { DiscountsBody } from "./invoice";

/** Spec 012c: typed amounts for the stone, the combined total and the discounts. Whole-number arithmetic only. */

/** The same ceiling as a price (spec 012c R1, LIMITS in packages/calc). */
export const MAX_AMOUNT_PAISE = 10_00_00_000 * 100;

export type ParsedAmount = { ok: true; value: number } | { ok: false; message: string };

/** "₹ 2,50,000" -> 25000000 paise. Rupees allow at most 2 decimals (paise). Nothing is rounded. */
export function parseRupeesToPaise(text: string, what = "amount"): ParsedAmount {
  const cleaned = text.replace(/[₹\s,]/g, "").replace(/^rs\.?/i, "");
  if (cleaned === "") return { ok: false, message: `Enter the ${what}` };
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false, message: `Enter the ${what} as a number, like 12,500` };
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > 2) return { ok: false, message: "Rupees allow at most 2 decimal places (paise)" };
  if (whole!.length > 12) return { ok: false, message: `That ${what} is too large` };
  const paise = Number(whole! + frac.padEnd(2, "0"));
  if (paise > MAX_AMOUNT_PAISE) return { ok: false, message: `That ${what} is too large` };
  return { ok: true, value: paise };
}

/** "5" -> 500 basis points, "1.25" -> 125. At most 2 decimals of a percent, from 0 to 100. */
export function parsePercentToBps(text: string): ParsedAmount {
  const cleaned = text.replace(/[%\s]/g, "");
  if (cleaned === "") return { ok: false, message: "Enter the percentage" };
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false, message: "Enter the percentage as a number, like 5 or 1.25" };
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > 2) return { ok: false, message: "A percentage allows at most 2 decimal places" };
  const bps = Number(whole!) * 100 + Number(frac.padEnd(2, "0"));
  if (bps > 10_000) return { ok: false, message: "A discount cannot be more than 100%" };
  return { ok: true, value: bps };
}

export type DiscountTarget = "gold" | "labour" | "total";
export const DISCOUNT_TARGETS: DiscountTarget[] = ["gold", "labour", "total"];
export const DISCOUNT_LABEL: Record<DiscountTarget, string> = { gold: "Gold", labour: "Labour", total: "Total" };

/** What the owner typed for one discount. Empty means no discount. */
export type DiscountText = { kind: "fixed" | "percent"; value: string };
export type DiscountTexts = Record<DiscountTarget, DiscountText>;

export const blankDiscounts = (): DiscountTexts => ({
  gold: { kind: "percent", value: "" },
  labour: { kind: "fixed", value: "" },
  total: { kind: "fixed", value: "" },
});

/** Turns the three discount rows into the request body. Errors are kept per target. */
export function parseDiscountTexts(t: DiscountTexts): { discounts: DiscountsBody; errors: Partial<Record<DiscountTarget, string>> } {
  const discounts: DiscountsBody = {};
  const errors: Partial<Record<DiscountTarget, string>> = {};
  for (const target of DISCOUNT_TARGETS) {
    const row = t[target];
    if (row.value.trim() === "") continue;
    const parsed = row.kind === "percent" ? parsePercentToBps(row.value) : parseRupeesToPaise(row.value, "discount");
    if (parsed.ok) discounts[target] = { kind: row.kind, value: parsed.value };
    else errors[target] = parsed.message;
  }
  return { discounts, errors };
}

/** A saved invoice's discounts back into the three rows, for editing. Exact in both directions. */
export function discountTextsFrom(d: DiscountsBody | null | undefined): DiscountTexts {
  const out = blankDiscounts();
  for (const target of DISCOUNT_TARGETS) {
    const saved = d?.[target];
    if (!saved) continue;
    out[target] = { kind: saved.kind, value: String(saved.value / 100) }; // paise to rupees, or basis points to percent
  }
  return out;
}

/** Paise as the text a rupee box shows: 30000 -> "300", 12550 -> "125.5". */
export const paiseToRupeeText = (paise: number) => String(paise / 100);
