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
