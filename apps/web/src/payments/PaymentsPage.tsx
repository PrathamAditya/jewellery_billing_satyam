import { useEffect, useState } from "react";
import { KIND_LABEL, MODE_LABEL, formatMoney, type PaymentSummary } from "@jewellery/shared";
import { navigate } from "../router";
import { niceDate } from "../rates/api";
import { useAuth } from "../auth";
import { useDebounced } from "../customers/useDebounced";
import { Alert, btnPrimary, inputClass, pcOnly } from "../customers/ui";
import { listPayments } from "./api";
import ReceiveDialog from "./ReceiveDialog";

export default function PaymentsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<PaymentSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const query = useDebounced(q, 250);

  useEffect(() => {
    listPayments(query, { status: status || undefined })
      .then((r) => (setItems(r.items), setNext(r.nextCursor), setError(null)))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load payments"));
  }, [query, status]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Payments</h1>
        {can("payments.create") && <button className={`${btnPrimary} ${pcOnly}`} onClick={() => setReceiving(true)}>Receive payment</button>}
      </div>
      <div className="flex gap-2 flex-wrap">
        <input className={`${inputClass} flex-1 min-w-48`} type="search" placeholder="Search by receipt number, customer or reference" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />
        <select className={`${inputClass} w-40`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="voided">Voided</option>
        </select>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2 font-medium">Receipt</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">Mode</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
              <th className="px-3 py-2 font-medium text-right">Left as advance</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/payments/${p.id}`)}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <a href={`#/payments/${p.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{p.receiptNo ?? "At sale"}</a>
                  {p.voided && <span className="ml-2 text-xs text-red-700 border border-red-200 rounded px-1">voided</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{niceDate(p.receiptDate)}</td>
                <td className="px-3 py-2">{p.payerName}</td>
                <td className="px-3 py-2">{MODE_LABEL[p.mode]}</td>
                <td className="px-3 py-2">{KIND_LABEL[p.kind]}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{formatMoney(p.amountPaise)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{formatMoney(p.remainingPaise)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-500">No payments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {next && <p className="text-sm text-stone-500">More payments are on the next page of the search.</p>}
      {receiving && (
        <ReceiveDialog
          onClose={() => setReceiving(false)}
          onSaved={(id) => {
            setReceiving(false);
            navigate(`/payments/${id}`);
          }}
        />
      )}
    </div>
  );
}
