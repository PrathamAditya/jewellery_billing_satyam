import { useEffect, useState } from "react";
import { CREDIT_NOTE_KIND_LABEL, formatMoney, type CreditNoteSummary } from "@jewellery/shared";
import { ApiError } from "../api";
import { btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { niceDate } from "../rates/api";
import { navigate } from "../router";
import { listCreditNotes } from "./api";

/** Spec 019d section 4: the credit notes list (read only, works on the phone). */
export default function CreditNotesPage() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<CreditNoteSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(cursor: string | null) {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (kind) params.set("kind", kind);
    if (status) params.set("status", status);
    if (cursor) params.set("cursor", cursor);
    try {
      const r = await listCreditNotes(`?${params.toString()}`);
      setItems(cursor ? (prev) => [...prev, ...r.items] : r.items);
      setNext(r.nextCursor);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load credit notes. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(null), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, status]);

  return (
    <main className="p-3 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Credit notes</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input className={inputClass} placeholder="Search number, customer or bill" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search credit notes" />
        <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">All kinds</option>
          {Object.entries(CREDIT_NOTE_KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All</option>
          <option value="live">Live</option>
          <option value="voided">Voided</option>
        </select>
      </div>
      {err && <p className="text-red-700 text-sm">{err}</p>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Bill</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2 max-md:hidden">Kind</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Held</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/credit-notes/${n.id}`)}>
                <td className="px-3 py-2 font-medium">{n.cnNo}</td>
                <td className="px-3 py-2">{niceDate(n.cnDate)}</td>
                <td className="px-3 py-2">{n.invoiceNo}</td>
                <td className="px-3 py-2">{n.customerName}</td>
                <td className="px-3 py-2 max-md:hidden">{n.kindLabel}</td>
                <td className="px-3 py-2 text-right">{formatMoney(n.amountPaise)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(n.heldPaise)}</td>
                <td className="px-3 py-2">{n.voided ? <span className="text-red-700">Voided</span> : "Live"}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-stone-500">No credit notes yet. Credit notes are made from an invoice's page.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {next && (
        <div className="text-center">
          <button className={btnSecondary} onClick={() => void load(next)} disabled={loading}>Load more</button>
        </div>
      )}
      <p className={`text-xs text-stone-500 ${pcOnly}`}>Each credit note is opened from its number. Credit notes are never deleted; a wrong one is voided.</p>
    </main>
  );
}
