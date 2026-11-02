import { useEffect, useState } from "react";
import { MODE_LABEL, formatMoney, type DashboardFy, type DashboardResponse } from "@jewellery/shared";
import { niceDate } from "../rates/api";
import { Alert } from "../customers/ui";
import { getDashboard } from "./api";

/** Spec 030: the dashboard on the Home screen. Read-only; tiles appear only for the permissions the user has. */
export default function DashboardPanel() {
  const [d, setD] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getDashboard().then(setD).catch((e) => setError(e instanceof Error ? e.message : "Could not load the dashboard"));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <p className="text-stone-500">Loading the dashboard...</p>;
  const { sales, money } = d;
  return (
    <section aria-label="Dashboard" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Dashboard <span className="text-sm font-normal text-stone-500">as on {niceDate(d.asOf)}</span></h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {sales && <Tile label="Today's sales" value={formatMoney(sales.todayPaise)} note={`${sales.todayCount} ${sales.todayCount === 1 ? "invoice" : "invoices"}`} />}
        {money && (
          <Tile
            label="Payments received today"
            value={formatMoney(money.receivedTodayPaise)}
            note={money.receivedTodayByMode.filter((r) => r.paise > 0).map((r) => `${MODE_LABEL[r.mode]} ${formatMoney(r.paise)}`).join(", ") || "None yet"}
          />
        )}
        {money && <Tile label="Outstanding" value={formatMoney(money.outstandingPaise)} note={`${money.customersWithOutstanding} customers owe money`} />}
        {money && <Tile label="Advances held" value={formatMoney(money.advancesHeldPaise)} note="Customers' money not yet used" />}
        {money && <Tile label="Advances taken today" value={formatMoney(money.advancesTakenTodayPaise)} />}
        {money && <Tile label="Cheques not yet cleared" value={formatMoney(money.pendingChequePaise)} note={`${money.pendingChequeCount} ${money.pendingChequeCount === 1 ? "cheque" : "cheques"}`} />}
        {sales && <Tile label="Sales waiting for the rate" value={String(sales.pendingRateCount)} note="Not in the totals until fixed" />}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {d.monthly.map((f) => (
          <MonthlyTable key={f.fy} fy={f} />
        ))}
      </div>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl px-4 py-3 min-w-0">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="font-semibold text-lg break-words">{value}</div>
      {note && <div className="text-xs text-stone-500 break-words">{note}</div>}
    </div>
  );
}

function MonthlyTable({ fy }: { fy: DashboardFy }) {
  const monthName = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const hasSales = fy.months.some((m) => m.salesPaise !== null);
  const hasReceipts = fy.months.some((m) => m.receiptsPaise !== null);
  const totalSales = fy.months.reduce((s, m) => s + (m.salesPaise ?? 0), 0);
  const totalReceipts = fy.months.reduce((s, m) => s + (m.receiptsPaise ?? 0), 0);
  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
      <h3 className="px-3 py-2 font-medium bg-stone-100 text-stone-600">Monthly, financial year {fy.fy}</h3>
      <table className="w-full text-sm min-w-[18rem]">
        <thead className="text-left text-stone-600">
          <tr>
            <th className="px-3 py-2 font-medium">Month</th>
            {hasSales && <th className="px-3 py-2 font-medium text-right">Sales</th>}
            {hasReceipts && <th className="px-3 py-2 font-medium text-right">Received</th>}
          </tr>
        </thead>
        <tbody>
          {fy.months.map((m) => (
            <tr key={m.month} className="border-t border-stone-100">
              <td className="px-3 py-1.5">{monthName(m.month)}</td>
              {hasSales && <td className="px-3 py-1.5 text-right">{formatMoney(m.salesPaise ?? 0)}</td>}
              {hasReceipts && <td className="px-3 py-1.5 text-right">{formatMoney(m.receiptsPaise ?? 0)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-stone-300 font-semibold">
          <tr>
            <td className="px-3 py-1.5">Year</td>
            {hasSales && <td className="px-3 py-1.5 text-right">{formatMoney(totalSales)}</td>}
            {hasReceipts && <td className="px-3 py-1.5 text-right">{formatMoney(totalReceipts)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
