/**
 * The only place money is rounded to a whole rupee.
 * Input and output are integer paise. Below 50 paise rounds down, 50 or more rounds up.
 */
export function roundOffPaise(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError(`roundOffPaise expects a non-negative integer, got ${paise}`);
  }
  return Math.floor((paise + 50) / 100) * 100;
}
