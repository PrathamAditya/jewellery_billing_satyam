import { divRoundHalfUp } from "./round";

/**
 * Satyam feedback, points 7 and 11. Pure helpers, whole numbers only.
 *
 * 1. `labourExGstPaisePerKg`: a labour rate typed WITH GST included, turned into the rate without GST that the
 *    invoice engine uses (it adds GST once, on gold + labour together).
 * 2. `solveForPayable`: the reverse calculation. The owner types the final amount and one unknown (gold rate,
 *    labour rate or net weight) is worked out so that the invoice comes to that amount.
 */

/** rate x 10000 / (10000 + GST in basis points), rounded half up to a whole paisa per kg. 3% is 300. */
export function labourExGstPaisePerKg(rateInclGstPaisePerKg: number, gstRateBps: number): number {
  if (!Number.isSafeInteger(rateInclGstPaisePerKg) || rateInclGstPaisePerKg < 0) throw new RangeError("labour rate must be a non-negative whole number");
  if (!Number.isSafeInteger(gstRateBps) || gstRateBps < 0) throw new RangeError("GST rate must be a non-negative whole number");
  return Number(divRoundHalfUp(BigInt(rateInclGstPaisePerKg) * 10_000n, BigInt(10_000 + gstRateBps)));
}

export type SolveOutcome =
  | { ok: true; x: number; payablePaise: number; /** True when the invoice comes to exactly the typed amount. */ exact: boolean }
  | { ok: false; message: string };

/**
 * `evaluate(x)` is the invoice's final payable (paise) when the unknown is `x`, or null when the invoice is not valid
 * for that `x`. It must not go down as `x` goes up. Searches the whole numbers from `lo` to `hi`.
 *
 * Many values of `x` can give the same rupee total (the total is rounded to the rupee). Among them this picks the
 * one that is a multiple of `step` (a round figure such as 285.72 per gram) nearest the middle of that range, or the
 * exact middle when no multiple of `step` fits. If the amount cannot be reached exactly it returns the closest one.
 */
export function solveForPayable(evaluate: (x: number) => number | null, targetPaise: number, lo: number, hi: number, step = 10): SolveOutcome {
  if (!Number.isSafeInteger(targetPaise) || targetPaise <= 0) return { ok: false, message: "Enter the final amount" };
  const below = (x: number) => {
    const v = evaluate(x);
    return v === null || v < targetPaise;
  };
  if (below(hi)) return { ok: false, message: "That amount is too large to reach with this line" };

  // Smallest x whose total reaches the target.
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = Math.floor((a + b) / 2);
    if (below(mid)) a = mid + 1;
    else b = mid;
  }
  const xLow = a;
  const vLow = evaluate(xLow)!;

  if (vLow !== targetPaise) {
    // The target falls between two neighbouring values: take whichever is closer (the lower one on a tie).
    const prev = xLow - 1 >= lo ? evaluate(xLow - 1) : null;
    if (prev !== null && targetPaise - prev <= vLow - targetPaise) return { ok: true, x: xLow - 1, payablePaise: prev, exact: false };
    return { ok: true, x: xLow, payablePaise: vLow, exact: false };
  }

  // Largest x whose total is still the target.
  a = xLow;
  b = hi;
  while (a < b) {
    const mid = Math.ceil((a + b) / 2);
    const v = evaluate(mid);
    if (v !== null && v <= targetPaise) a = mid;
    else b = mid - 1;
  }
  const xHigh = a;
  const middle = Math.floor((xLow + xHigh) / 2);
  const nearest = Math.round(middle / step) * step;
  const pick = [nearest, nearest - step, nearest + step]
    .filter((x) => x >= xLow && x <= xHigh)
    .sort((p, q) => Math.abs(p - middle) - Math.abs(q - middle))[0];
  return { ok: true, x: pick ?? middle, payablePaise: targetPaise, exact: true };
}
