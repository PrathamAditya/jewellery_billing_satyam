/** Spec 015 R13: amounts in words, Indian style, as printed on receipts (owner's samples). */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0 to 99 in words, e.g. 23 -> "Twenty Three". */
function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = ONES[n % 10]!;
  return o ? `${t} ${o}` : t;
}

/** 0 to 99,99,99,999 rupees in words with Indian groups (crore, lakh, thousand, hundred). */
function rupeesInWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const hundred = Math.floor((n % 1_000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${rupeesInWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(below100(rest));
  return parts.join(" ");
}

/**
 * Whole paise to words: 20632300 -> "Rupees Two Lakh Six Thousand Three Hundred Twenty Three Only."
 * With paise: 15000 + 50 -> "Rupees One Hundred Fifty and Fifty Paise Only." (format per spec 015 R13).
 */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError(`amountInWords expects whole non-negative paise, got ${paise}`);
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const words = `Rupees ${rupeesInWords(rupees)}`;
  return p ? `${words} and ${below100(p)} Paise Only.` : `${words} Only.`;
}
