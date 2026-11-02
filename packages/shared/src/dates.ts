const indiaFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The business date (YYYY-MM-DD, India time) for an instant. "Today" always means this. */
export function indiaDate(at: Date = new Date()): string {
  return indiaFormat.format(at);
}

/** Spec 030 and 031: the first and last business date of a financial year, `2026-27` is 1 Apr 2026 to 31 Mar 2027. */
export function financialYearRange(fy: string): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}
