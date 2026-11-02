import { useEffect, useState } from "react";
import type { LedgerSummary, OutstandingRow } from "@jewellery/shared";
import { formatMoney, formatWeightGrams } from "@jewellery/shared";
import { navigate } from "../router";
import { niceDate } from "../rates/api";
import { useDebounced } from "../customers/useDebounced";
import { Alert, inputClass } from "../customers/ui";
import { getLedgerSummary, getOutstanding } from "./api";
import { searchInvoices } from "../invoice/api";
import type { InvoiceSummary } from "@jewellery/shared";

/** Spec 019 R6, R7: who owes money, and who the shop holds money for. */
export default function OutstandingPage() {
  const [q, setQ] = useState("");
  const query = useDebounced(q, 250);
  const [items, setItems] = useState<OutstandingRow[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Spec 019c R13: sales whose rate is not fixed yet. Not in the totals above.
  const [pending, setPending] = useState<InvoiceSummary[]>([]);
  useEffect(() => {
    searchInvoices("", { rateStatus: "pending" }).then((r) => setPending(r.items)).catch(() => undefined);
  }, []);
  useEffect(() => {
    getLedgerSummary().then(setSummary).catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);
  useEffect(() => {
    getOutstanding(query).then((r) => (setItems(r.items), setError(null))).catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, [query]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Outstanding</h1>
      {summary && (
        <dl className="bg-white border border-stone-200 rounded-xl px-4 py-3 flex gap-8 flex-wrap">
          <div><dt className="text-sm text-stone-500">Customers owe</dt><dd className="font-semibold text-lg">{formatMoney(summary.totalOutstandingPaise)}</dd></div>
          <div><dt className="text-sm text-stone-500">Advances held</dt><dd className="font-semibold text-lg">{formatMoney(summary.totalAdvanceHeldPaise)}</dd></div>
          <div><dt className="text-sm text-stone-500">Customers with balances</dt><dd className="font-semibold text-lg">{summary.customersWithOutstanding}</dd></div>
        </dl>
      )}
      {pending.length > 0 && (
        <section className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <h2 className="px-3 py-2 font-medium bg-stone-100 text-stone-600">Pending rate (not in the totals until the rate is fixed)</h2>
          <table className="w-full text-sm min-w-[32rem]">
            <thead className="text-left text-stone-600"><tr><th className="px-3 py-2 font-medium">Sale</th><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium text-right">Weight</th><th className="px-3 py-2 font-medium text-right">Held on the sale</th></tr></thead>
            <tbody>
              {pending.map((i) => (
                <tr key={i.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>
                  <td className="px-3 py-2">{i.invoiceNo} <span className="text-stone-500">{niceDate(i.invoiceDate)}</span></td>
                  <td className="px-3 py-2 font-medium">{i.customerName}</td>
                  <td className="px-3 py-2 text-right">{formatWeightGrams(i.pendingWeightMg)} g</td>
                  <td className="px-3 py-2 text-right">{formatMoney(i.pendingHeldPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <input className={inputClass} type="search" placeholder="Search by customer name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search outstanding" />
      {error && <Alert>{error}</Alert>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[32rem]">
          <thead className="bg-stone-100 text-left text-stone-600"><tr><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">Oldest unpaid</th><th className="px-3 py-2 font-medium text-right">Owes</th><th className="px-3 py-2 font-medium text-right">Advance held</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.customerId} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/customers/${r.customerId}`)}>
                <td className="px-3 py-2 font-medium">{r.customerName}</td>
                <td className="px-3 py-2">{r.oldestUnpaidDate ? niceDate(r.oldestUnpaidDate) : "-"}</td>
                <td className="px-3 py-2 text-right">{formatMoney(r.outstandingPaise)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(r.advanceHeldPaise)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-stone-500">Nobody owes money right now.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
