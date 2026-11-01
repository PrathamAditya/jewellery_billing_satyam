import { useEffect, useState } from "react";
import { formatMoney, type InvoiceSummary } from "@jewellery/shared";
import { navigate } from "../router";
import { niceDate } from "../rates/api";
import { useDebounced } from "../customers/useDebounced";
import { Alert, btnPrimary, inputClass, pcOnly } from "../customers/ui";
import { searchInvoices } from "./api";

export default function InvoiceList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<InvoiceSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = useDebounced(q, 250);

  useEffect(() => {
    let live = true;
    setLoading(true);
    searchInvoices(query, { status: status || undefined, from: from || undefined, to: to || undefined })
      .then((r) => live && (setItems(r.items), setNext(r.nextCursor), setError(null)))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load invoices"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [query, status, from, to]);

  async function more() {
    if (!next) return;
    setLoading(true);
    try {
      const r = await searchInvoices(query, { status: status || undefined, from: from || undefined, to: to || undefined, cursor: next });
      setItems((p) => [...p, ...r.items]);
      setNext(r.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <button className={`${btnPrimary} ${pcOnly}`} onClick={() => navigate("/invoices/new")}>
          New invoice
        </button>
      </div>

      <input className={inputClass} type="search" placeholder="Search by invoice number, customer name or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" autoFocus />
      <div className="flex gap-3 flex-wrap items-center text-sm">
        <label className="flex items-center gap-1">
          From <input className={`${inputClass} w-40`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="flex items-center gap-1">
          To <input className={`${inputClass} w-40`} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>
        <select className={`${inputClass} w-40`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All invoices</option>
          <option value="active">Active only</option>
          <option value="voided">Voided only</option>
        </select>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2 font-medium">Number</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium text-right">Payable</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <a href={`#/invoices/${i.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {i.invoiceNo}
                  </a>
                  {i.voidedAt && <span className="ml-2 text-xs text-red-700 border border-red-200 rounded px-1">voided</span>}
                  {i.revisionNo > 1 && <span className="ml-2 text-xs text-stone-500">rev {i.revisionNo}</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{niceDate(i.invoiceDate)}</td>
                <td className="px-3 py-2">
                  {i.customerName}
                  {i.customerMobile && <span className="text-stone-500"> {i.customerMobile}</span>}
                </td>
                <td className={`px-3 py-2 text-right whitespace-nowrap ${i.voidedAt ? "line-through text-stone-400" : ""}`}>{formatMoney(i.payablePaise)}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-stone-500">
                  {query || status || from || to ? "No invoices match this search." : "No invoices yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <p className="text-sm text-stone-500">Loading...</p>}
      {next && !loading && (
        <button className="self-center px-4 py-2 rounded-lg border border-stone-300 bg-white" onClick={() => void more()}>
          Next page
        </button>
      )}
    </div>
  );
}
