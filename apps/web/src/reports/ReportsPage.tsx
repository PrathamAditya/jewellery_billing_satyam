import { useState } from "react";
import { REPORT_KINDS, REPORT_LABEL, indiaDate, financialYearRange, type ReportFormat, type ReportKind } from "@jewellery/shared";
import { Alert, btnPrimary, btnSecondary, inputClass } from "../customers/ui";

/** Financial years from the current one back five years, e.g. 2026-27, 2025-26. */
function financialYears(today: string): string[] {
  const y = Number(today.slice(0, 4));
  const start = Number(today.slice(5, 7)) >= 4 ? y : y - 1;
  return Array.from({ length: 6 }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, "0")}`);
}

/** Spec 031: the four reports, Excel or PDF, by date range or by financial year. Read-only. */
export default function ReportsPage() {
  const today = indiaDate();
  const years = financialYears(today);
  const [kind, setKind] = useState<ReportKind>("sales-register");
  const [byFy, setByFy] = useState(true);
  const [fy, setFy] = useState(years[0]!);
  const [from, setFrom] = useState(financialYearRange(years[0]!).from);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: ReportFormat) {
    setError(null);
    setBusy(format);
    const qs = new URLSearchParams(byFy ? { fy } : { from, to });
    qs.set("format", format);
    try {
      const res = await fetch(`/api/reports/${kind}?${qs.toString()}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; issues?: { message: string }[] };
        throw new Error(body.issues?.[0]?.message ?? body.message ?? "The report could not be made");
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${kind}.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report could not be made");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <p className="text-sm text-stone-600">Download a report for the CA or the owner. Excel (.xlsx) opens in any spreadsheet program; PDF prints on A4 landscape.</p>
      <fieldset className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-2">
        <legend className="px-1 font-medium">Report</legend>
        {REPORT_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="radio" name="report" checked={kind === k} onChange={() => setKind(k)} />
            {REPORT_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <fieldset className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
        <legend className="px-1 font-medium">Period</legend>
        {kind === "outstanding" && <p className="text-sm text-stone-600">Outstanding is the balance on the day the report is made, so the period does not apply.</p>}
        <label className="flex items-center gap-2">
          <input type="radio" name="period" checked={byFy} onChange={() => setByFy(true)} /> Financial year
        </label>
        {byFy && (
          <select className={inputClass + " max-w-xs"} aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y} (1 Apr {y.slice(0, 4)} to 31 Mar {Number(y.slice(0, 4)) + 1})
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name="period" checked={!byFy} onChange={() => setByFy(false)} /> Date range
        </label>
        {!byFy && (
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <label className="flex flex-col gap-1 text-sm">
              From
              <input className={inputClass} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              To
              <input className={inputClass} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}
      </fieldset>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-3 flex-wrap">
        <button className={btnPrimary} disabled={busy !== null} onClick={() => download("xlsx")}>
          {busy === "xlsx" ? "Making the Excel file..." : "Download Excel (.xlsx)"}
        </button>
        <button className={btnSecondary} disabled={busy !== null} onClick={() => download("pdf")}>
          {busy === "pdf" ? "Making the PDF..." : "Download PDF"}
        </button>
      </div>
    </div>
  );
}
