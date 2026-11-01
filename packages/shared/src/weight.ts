import { groupIndian } from "./rates";

/** Spec 012 R2: weights are typed in grams with up to 3 decimals and kept as whole milligrams. */
export type ParsedWeight = { ok: true; mg: number } | { ok: false; message: string };

export function parseWeightGrams(text: string): ParsedWeight {
  const cleaned = text.replace(/[\s,]/g, "").replace(/g(ms?)?$/i, "");
  if (cleaned === "") return { ok: false, message: "Enter a weight in grams" };
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false, message: "Enter the weight in grams, like 9.800" };
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > 3) return { ok: false, message: "A weight allows at most 3 decimal places (milligrams)" };
  if (whole!.length > 9) return { ok: false, message: "That weight is too large" };
  return { ok: true, mg: Number(whole! + frac.padEnd(3, "0")) };
}

/** 9800 -> "9.800" */
export function formatWeightGrams(mg: number): string {
  return `${Math.floor(mg / 1000)}.${String(mg % 1000).padStart(3, "0")}`;
}

/** Whole-number paise as rupees with 2 decimals and Indian grouping: 288406 -> "₹2,884.06", -6 -> "-₹0.06". */
export function formatMoney(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}₹${groupIndian(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, "0")}`;
}
