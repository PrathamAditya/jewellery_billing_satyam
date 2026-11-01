export const NUMBER_SERIES = ["INV", "PAY", "OGP", "ORD", "CN"] as const;
export type NumberSeries = (typeof NUMBER_SERIES)[number];

/** Financial year (1 April to 31 March) of a business date, e.g. "2026-04-01" -> "2026-27". */
export function financialYearOf(businessDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!m) throw new RangeError(`Invalid business date: ${businessDate}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`Invalid business date: ${businessDate}`);
  }
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Spec 003 R6: the printed number is `INV-0001`, padded to 4 digits and growing beyond.
 * With `fyInNumber` it is `INV-2026-27-0001`. The financial year is stored separately with every document.
 */
export function formatDocumentNumber(series: NumberSeries, fy: string, n: number, fyInNumber = false): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`Invalid number: ${n}`);
  const serial = String(n).padStart(4, "0");
  return fyInNumber ? `${series}-${fy}-${serial}` : `${series}-${serial}`;
}
