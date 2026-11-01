import { z } from "zod";

/** Spec 011: daily gold and silver rates. Stored as whole paise per 1 kg, typed per kg or per gram. */

export const RATE_KINDS = ["gold_24k995", "gold_22k916", "silver"] as const;
export type RateKind = (typeof RATE_KINDS)[number];

export const RATE_LABELS: Record<RateKind, string> = {
  gold_24k995: "Gold 24K995",
  gold_22k916: "Gold 22K916",
  silver: "Silver",
};

export function isRateKind(value: string): value is RateKind {
  return (RATE_KINDS as readonly string[]).includes(value);
}

/** One kilogram in milligrams. A price is per this many mg (spec 011 R3, R5). */
export const RATE_UNIT_MG = 1_000_000;

/** Largest price (R4): ₹10,00,00,000 per kg, which is ₹1,00,000 per gram. */
export const MAX_PRICE_PAISE_PER_KG = 10_00_00_000 * 100;

/** More than this change from the previous price needs a confirmation (R12). */
export const LARGE_CHANGE_PERCENT = 10;

export type RateUnit = "gram" | "kg";

export type ParsedRate = { ok: true; paisePerKg: number } | { ok: false; message: string };

/**
 * Turns what the owner typed into whole paise per kg (R3), with whole-number arithmetic only.
 * Per kg allows 2 decimals. Per gram allows 3, which is always an exact number of paise per kg.
 * More decimals than allowed are rejected, never rounded.
 */
export function parseRateInput(text: string, unit: RateUnit): ParsedRate {
  const cleaned = text.replace(/[₹\s,]/g, "").replace(/^rs\.?/i, "");
  if (cleaned === "") return { ok: false, message: "Enter a rate" };
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false, message: "Enter the rate as a number, like 12,000 or 1,20,00,000" };

  const [whole, frac = ""] = cleaned.split(".");
  const maxDecimals = unit === "kg" ? 2 : 3;
  if (frac.length > maxDecimals) {
    return { ok: false, message: `Per ${unit} allows at most ${maxDecimals} decimal places` };
  }
  if (whole!.length > 12) return { ok: false, message: "That rate is too large" };

  // kg: paise = rupees x 100.  gram: milli-rupees per gram x 100 = paise per kg.
  const scaled = Number(whole! + frac.padEnd(maxDecimals, "0"));
  const paisePerKg = unit === "kg" ? scaled : scaled * 100;

  if (paisePerKg <= 0) return { ok: false, message: "The rate must be more than 0" };
  if (paisePerKg > MAX_PRICE_PAISE_PER_KG) {
    return { ok: false, message: "That rate is too large (limit ₹10,00,00,000 per kg, ₹1,00,000 per gram)" };
  }
  return { ok: true, paisePerKg };
}

/** Indian digit grouping: 12000000 -> "1,20,00,000". */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** "₹1,20,00,000" (adds ".50" only when there are paise). */
export function formatPerKg(paisePerKg: number): string {
  const rupees = Math.floor(paisePerKg / 100);
  const paise = paisePerKg % 100;
  return `₹${groupIndian(String(rupees))}${paise ? `.${String(paise).padStart(2, "0")}` : ""}`;
}

/** "₹12,000.00" or "₹150.123": 2 decimals, 3 when the third is needed to be exact. Display only (R5). */
export function formatPerGram(paisePerKg: number): string {
  const milli = paisePerKg / 100; // milli-rupees per gram, always a whole number for prices from parseRateInput
  const whole = Math.floor(milli / 1000);
  const frac = String(Math.round(milli % 1000)).padStart(3, "0");
  const decimals = frac.endsWith("0") ? frac.slice(0, 2) : frac;
  return `₹${groupIndian(String(whole))}.${decimals}`;
}

/** The price as text for an input box in the given unit, exact and without trailing zeros: 15012300 -> "150.123" per gram. */
export function paisePerKgToInput(paisePerKg: number, unit: RateUnit): string {
  const trim = (whole: number, frac: string) => (frac.replace(/0+$/, "") ? `${whole}.${frac.replace(/0+$/, "")}` : String(whole));
  if (unit === "kg") return trim(Math.floor(paisePerKg / 100), String(paisePerKg % 100).padStart(2, "0"));
  const milli = paisePerKg / 100;
  return trim(Math.floor(milli / 1000), String(milli % 1000).padStart(3, "0"));
}

/** True when `next` differs from `previous` by more than the allowed percentage (R12), using whole numbers. */
export function isLargeChange(previousPaise: number, nextPaise: number): boolean {
  return Math.abs(nextPaise - previousPaise) * 100 > previousPaise * LARGE_CHANGE_PERCENT;
}

/** Percentage change to one decimal place, for the confirmation message. */
export function percentChange(previousPaise: number, nextPaise: number): number {
  return Math.round(((nextPaise - previousPaise) * 1000) / previousPaise) / 10;
}

/** A calendar date as YYYY-MM-DD that really exists. */
export function isValidBusinessDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
}

/** Body of PUT /api/rates/:date/:kind. The price is validated by parseRateInput on the server. */
export const saveRateRequestSchema = z.object({
  price: z.string().max(40),
  unit: z.enum(["gram", "kg"]),
  reason: z.string().trim().max(300).optional(),
  confirmLargeChange: z.boolean().optional(),
});
export type SaveRateRequest = z.infer<typeof saveRateRequestSchema>;

// ---- API shapes ----

export type RateRow = {
  id: string;
  date: string;
  kind: RateKind;
  pricePaisePerKg: number;
  updatedAt: string;
  updatedBy: string;
};

export type ApplicableRate = { pricePaisePerKg: number; rateDate: string; carriedForward: boolean };

export type ApplicableRatesResponse = { date: string; rates: Record<RateKind, ApplicableRate | null> };

export type RatesByDate = { date: string; rates: Partial<Record<RateKind, RateRow>> };

export type RatesListResponse = { items: RatesByDate[]; nextCursor: string | null };

export type SaveRateResponse = { rate: RateRow; created: boolean; changed: boolean };

export type NeedsConfirmationBody = {
  error: "needs_confirmation";
  message: string;
  previousPaisePerKg: number;
  newPaisePerKg: number;
  percent: number;
};

export type RateHistoryEntry = {
  revisionNo: number;
  at: string;
  by: string;
  reason: string | null;
  fromPaisePerKg: number;
  toPaisePerKg: number;
};
