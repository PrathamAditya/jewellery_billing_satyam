/**
 * The only place money is rounded (CLAUDE.md rule 2): to a whole rupee below, and to a
 * whole paisa in `divRoundHalfUp`.
 */

/**
 * Input and output are integer paise. Below 50 paise rounds down, 50 or more rounds up.
 */
export function roundOffPaise(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError(`roundOffPaise expects a non-negative integer, got ${paise}`);
  }
  return Math.floor((paise + 50) / 100) * 100;
}

/**
 * numerator / denominator rounded to the nearest whole number, halves up, in exact integer
 * arithmetic. BigInt because weight x rate can pass 2^53 (100 kg at the top rate is 10^18).
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) throw new RangeError("divRoundHalfUp expects a non-negative numerator");
  if (denominator <= 0n) throw new RangeError("divRoundHalfUp expects a positive denominator");
  return (2n * numerator + denominator) / (2n * denominator);
}
