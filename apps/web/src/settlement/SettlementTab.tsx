import { useEffect, useState } from "react";
import { formatMoney, parseRateInput, type SettlementResponse } from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { navigate } from "../router";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { niceDate } from "../rates/api";
import ReceiveDialog from "../payments/ReceiveDialog";
import { reverseAllocation } from "../payments/api";
import { customerAdvanceList, getSettlement, saveSettlementRemarks, useAdvances } from "./api";

/** Spec 017: the invoice's money on one page. Recalculates after every change. */
export default function SettlementTab({ invoice }: { invoice: { id: string; invoiceNo: string; customerId: string | null; balanceDuePaise: number } }) {
  const { can } = useAuth();
  const [s, setS] = useState<SettlementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [using, setUsing] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = () => getSettlement(invoice.id).then((r) => (setS(r), setRemarks(r.remarks ?? ""), setError(null))).catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  useEffect(() => void load(), [invoice.id]);

  async function saveRemarks() {
    try {
      setS(await saveSettlementRemarks(invoice.id, remarks.trim() || null));
      setNotice("Remarks saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the remarks");
    }
  }

  async function doReverse() {
    if (!reason.trim()) return setError("Please give a reason");
    try {
      await reverseAllocation(reverseId!, reason.trim());
      setReverseId(null);
      setReason("");
      await load();
      // Shown only after the figures are reloaded, so the page never claims a change it does not yet show.
      setNotice("Line reversed. The money is back with its advance.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reverse");
    }
  }

  if (!s) return error ? <Alert>{error}</Alert> : <p className="text-stone-500">Loading...</p>;
  const voided = s.invoice.voided;
  return (
    <div className="flex flex-col gap-5">
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="ok">{notice}</Alert>}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Received against this invoice</h2>
        {s.lines.length === 0 && s.creditLines.length === 0 ? <p className="text-sm text-stone-600">Nothing received yet.</p> : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-left text-stone-600"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Mode</th><th className="px-3 py-2 font-medium">Reference</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium text-right">Amount</th><th className="px-3 py-2"></th></tr></thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.allocationId} className="border-t border-stone-100">
                    <td className="px-3 py-2 whitespace-nowrap">{niceDate(l.date)}</td>
                    <td className="px-3 py-2">{l.mode}</td>
                    <td className="px-3 py-2"><a className="underline" href={`#/payments/${l.paymentId}`}>{l.reference}</a></td>
                    <td className="px-3 py-2">{l.type}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(l.amountPaise)}</td>
                    <td className="px-3 py-2 text-right">{can("payments.void") && !voided && <button className="underline" onClick={() => { setReverseId(l.allocationId); setReason(""); }}>Reverse</button>}</td>
                  </tr>
                ))}
                {/* Spec 019d R17: credit applied to this bill. Reversed from the credit note page. */}
                {s.creditLines.map((c) => (
                  <tr key={c.applicationId} className="border-t border-stone-100">
                    <td className="px-3 py-2 whitespace-nowrap">{niceDate(c.date)}</td>
                    <td className="px-3 py-2">Credit</td>
                    <td className="px-3 py-2"><a className="underline" href={`#/credit-notes/${c.creditNoteId}`}>{c.creditNoteNo}</a></td>
                    <td className="px-3 py-2">Credit note</td>
                    <td className="px-3 py-2 text-right">{formatMoney(c.amountPaise)}</td>
                    <td className="px-3 py-2 text-right" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <dl className="bg-white border border-stone-200 rounded-xl px-4 py-2 grid sm:grid-cols-3 gap-x-6">
        <div className="py-1.5"><dt className="text-sm text-stone-500">Invoice value</dt><dd>{formatMoney(s.payablePaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Less: received</dt><dd>{formatMoney(s.receivedPaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Balance due</dt><dd className="font-semibold text-base">{formatMoney(s.balanceDuePaise)}</dd></div>
      </dl>
      {s.advanceReference && <p className="text-sm"><span className="text-stone-500">Advance reference:</span> {s.advanceReference}</p>}

      {s.autoNote.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm flex flex-col gap-1">
          <h3 className="font-medium">Settlement note</h3>
          {s.autoNote.map((x, i) => <p key={i}>{x}</p>)}
        </section>
      )}

      {!voided && (
        <div className="flex gap-2 flex-wrap">
          {can("payments.create") && s.balanceDuePaise > 0 && <button className={btnPrimary} onClick={() => setReceiving(true)}>Receive payment</button>}
          {can("payments.create") && s.balanceDuePaise > 0 && s.invoice.customerId && <button className={btnSecondary} onClick={() => setUsing(true)}>Use an advance</button>}
          {can("oldgold.create") && s.balanceDuePaise > 0 && s.invoice.customerId && (
            <button className={btnSecondary} onClick={() => { sessionStorage.setItem("oldGoldPrefill", JSON.stringify({ customerId: s.invoice.customerId, invoiceId: invoice.id })); navigate("/old-gold/new"); }}>Add old gold receipt</button>
          )}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Remarks</h3>
        <textarea className={inputClass} rows={3} maxLength={1000} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!can("invoices.edit")} aria-label="Settlement remarks" />
        {can("invoices.edit") && <div><button className={btnSecondary} onClick={() => void saveRemarks()}>Save remarks</button></div>}
      </section>

      {receiving && (
        <ReceiveDialog
          invoice={{ id: invoice.id, invoiceNo: invoice.invoiceNo, balanceDuePaise: s.balanceDuePaise, customerId: s.invoice.customerId }}
          onClose={() => setReceiving(false)}
          onSaved={(pid) => navigate(`/payments/${pid}`)}
        />
      )}
      {using && s.invoice.customerId && (
        <UseAdvanceDialog invoiceId={invoice.id} invoiceNo={invoice.invoiceNo} customerId={s.invoice.customerId} balanceDuePaise={s.balanceDuePaise} onClose={() => setUsing(false)} onDone={() => { setUsing(false); void load().then(() => setNotice("Advance applied to the invoice.")); }} />
      )}
      {reverseId && (
        <Modal title="Reverse this line?" onClose={() => setReverseId(null)}>
          <p className="text-sm text-stone-600">The money goes back to its advance and the invoice owes it again.</p>
          <Field label="Reason *"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="flex gap-2 justify-end"><button className={btnSecondary} onClick={() => setReverseId(null)}>Cancel</button><button className={btnPrimary} onClick={() => void doReverse()}>Reverse</button></div>
        </Modal>
      )}
    </div>
  );
}

/** Spec 017 R7: pick which advances to use and how much of each. Oldest advance is filled first. */
function UseAdvanceDialog({ invoiceId, invoiceNo, customerId, balanceDuePaise, onClose, onDone }: { invoiceId: string; invoiceNo: string; customerId: string; balanceDuePaise: number; onClose: () => void; onDone: () => void }) {
  const [list, setList] = useState<{ paymentId: string; receiptNo: string | null; orderNo: string | null; receiptDate: string; kind: string; remainingPaise: number }[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    customerAdvanceList(customerId).then((r) => {
      setList(r.items);
      // Fill the oldest first, up to what is owed (the same order the database uses for advances).
      let left = balanceDuePaise;
      const next: Record<string, string> = {};
      for (const a of r.items) {
        const take = Math.min(left, a.remainingPaise);
        if (take > 0) next[a.paymentId] = (take / 100).toFixed(2);
        left -= Math.max(0, take);
      }
      setAmounts(next);
    }).catch((e) => setError(e instanceof Error ? e.message : "Could not load advances"));
  }, [customerId, balanceDuePaise]);

  async function submit() {
    setError(null);
    const allocations: { paymentId: string; amountPaise: number }[] = [];
    for (const [paymentId, text] of Object.entries(amounts)) {
      if (!text.trim()) continue;
      const p = parseRateInput(text, "kg");
      if (!p.ok) return setError(p.message);
      if (p.paisePerKg > 0) allocations.push({ paymentId, amountPaise: p.paisePerKg });
    }
    if (allocations.length === 0) return setError("Enter an amount for at least one advance");
    setBusy(true);
    try {
      await useAdvances(invoiceId, allocations);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply the advance");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Use an advance on ${invoiceNo}`} onClose={onClose}>
      {list.length === 0 ? <p className="text-sm text-stone-600">This customer has no advance left.</p> : (
        <ul className="flex flex-col gap-2 text-sm">
          {list.map((a) => (
            <li key={a.paymentId} className="flex items-center justify-between gap-2">
              <span>{a.receiptNo ?? "Old booklet"}{a.orderNo ? ` · ${a.orderNo}` : ""} <span className="text-stone-500">· {formatMoney(a.remainingPaise)} left</span></span>
              <input className={`${inputClass} w-32`} value={amounts[a.paymentId] ?? ""} onChange={(e) => setAmounts((p) => ({ ...p, [a.paymentId]: e.target.value }))} aria-label={`Use from ${a.receiptNo ?? "booklet advance"}`} />
            </li>
          ))}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2 justify-end">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={busy || list.length === 0} onClick={() => void submit()}>{busy ? "Applying..." : "Apply"}</button>
      </div>
    </Modal>
  );
}
