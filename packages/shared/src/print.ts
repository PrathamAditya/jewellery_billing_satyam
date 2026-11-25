/** Spec 014: helpers shared by the print views. Pure, no I/O. */

/** Weight in grams as the paper bill shows it: 12020 -> "12.02", 12345 -> "12.345", 1202 -> "1.202". */
export function formatWeightPrint(mg: number): string {
  if (!Number.isSafeInteger(mg) || mg < 0) throw new RangeError(`Weight must be whole milligrams, got ${mg}`);
  const grams = Math.floor(mg / 1000);
  const rest = String(mg % 1000).padStart(3, "0");
  // keep at least two decimals; drop a trailing zero from the third decimal only
  const decimals = rest.endsWith("0") ? rest.slice(0, 2) : rest;
  return `${grams}.${decimals}`;
}

/** Round-off as printed: "+ ₹ 0.30", "- ₹ 0.06", "₹ 0.00" (spec 014 R13). */
export function formatRoundOffPrint(paise: number): string {
  if (paise === 0) return "₹ 0.00";
  const sign = paise > 0 ? "+" : "-";
  const abs = Math.abs(paise);
  return `${sign} ₹ ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Spec 014 R7: rows per invoice page. More rows go on continuation sheets. */
export const INVOICE_LINES_PER_PAGE = 14;

export function paginate<T>(rows: T[], perPage = INVOICE_LINES_PER_PAGE): T[][] {
  if (rows.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  return pages;
}

/**
 * Satyam feedback, point 8: a bill with many items (or long descriptions) must never run into the footer or be cut off.
 * Rows go on pages by their height, not by a fixed count. A row's height is measured in "units": a one-line row is 1.
 * Every page but the last holds up to `capCont` units. The last page also carries the totals and has less room: `capLast`.
 */
export function rowUnits(description: string, charsPerLine = 26): number {
  const lines = (description || "Item")
    .split("\n")
    .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / charsPerLine)), 0);
  return 0.5 + 0.5 * Math.min(lines, 8); // a one-line row is 1 unit, two lines 1.5, three lines 2
}

export function paginateByUnits<T>(rows: T[], unitsOf: (row: T) => number, capCont: number, capLast: number): T[][] {
  if (rows.length === 0) return [[]];
  const pages: T[][] = [];
  let cur: T[] = [];
  let used = 0;
  for (const r of rows) {
    const u = unitsOf(r);
    if (cur.length > 0 && used + u > capCont) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(r);
    used += u;
  }
  pages.push(cur);

  // The last page must also fit the totals. Move its trailing rows to a new last page when it is too full.
  const last = pages[pages.length - 1]!;
  if (last.reduce((n, r) => n + unitsOf(r), 0) > capLast) {
    const tail: T[] = [];
    let t = 0;
    for (let i = last.length - 1; i >= 0; i--) {
      const u = unitsOf(last[i]!);
      if (tail.length > 0 && t + u > capLast) break;
      tail.unshift(last[i]!);
      t += u;
    }
    const head = last.slice(0, last.length - tail.length);
    pages.pop();
    if (head.length) pages.push(head);
    pages.push(tail);
  }
  return pages;
}

/** Spec 014 R9 / R11: the metal line under an item, from its purity and HSN. */
export function metalLine(purity: string, hsn: string): string {
  if (hsn === "9988") return "Job work";
  return purity === "silver" ? "Silver" : "Gold";
}

/** Spec 014 R8: copies in print order, shop front and back first, then customer. */
export function copyOrder(labels: string[], choice: "first" | "second" | "both"): string[] {
  if (choice === "first") return [labels[0] ?? "SHOP COPY"];
  if (choice === "second") return [labels[1] ?? "CUSTOMER COPY"];
  return [labels[0] ?? "SHOP COPY", labels[1] ?? "CUSTOMER COPY"];
}
