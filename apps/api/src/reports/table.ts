/**
 * Spec 031: one report as a table, used by both the Excel and the PDF writer. Money is whole paise;
 * the writers turn it into text or a number without any float arithmetic.
 */
export type Money = { paise: number };
export type Cell = string | number | Money | null;

export type Column = { label: string; align: "left" | "right"; /** Relative width (characters). */ width: number; money?: boolean };

export type ReportTable = {
  /** Sheet name in Excel (31 characters at most), also the PDF heading. */
  sheetName: string;
  title: string;
  /** "1 Apr 2026 to 31 Mar 2027 (FY 2026-27)" or "As on 2 Nov 2026". */
  subtitle: string;
  columns: Column[];
  rows: Cell[][];
  totals: Cell[] | null;
  /** Footnote lines, for example what is excluded. */
  notes: string[];
  /** File name without extension. */
  fileName: string;
};

/** Exact decimal text for paise: 288406 -> "2884.06", -6 -> "-0.06". No floats. */
export function paiseToDecimal(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Indian grouping for text output: 12345678 paise -> "1,23,456.78". */
export function paiseToIndian(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const whole = String(Math.floor(abs / 100));
  let head = whole;
  let tail = "";
  if (whole.length > 3) {
    tail = "," + whole.slice(-3);
    head = whole.slice(0, -3);
  }
  const groups: string[] = [];
  while (head.length > 2) {
    groups.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head) groups.unshift(head);
  return `${sign}${groups.join(",")}${tail}.${String(abs % 100).padStart(2, "0")}`;
}

/** "2026-11-01" -> "1 Nov 2026", the screens' date style. */
export function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

export function cellText(cell: Cell): string {
  if (cell === null) return "";
  if (typeof cell === "object") return paiseToIndian(cell.paise);
  return String(cell);
}
