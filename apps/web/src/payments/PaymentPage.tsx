import { useEffect, useState } from "react";
import { CHEQUE_STATUS_LABEL, KIND_LABEL, MODE_LABEL, amountInWords, formatMoney, type PaymentResponse } from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { navigate } from "../router";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { niceDate } from "../rates/api";
import { getPayment, moveCheque, reverseAllocation, voidPayment } from "./api";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default function PaymentPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [p, setP] = useState<PaymentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const load = () => getPayment(id).then(setP).catch((e) => setError(e instanceof ApiError && e.status === 404 ? "Payment not found." : "Could not load payment"));
  useEffect(() => void load(), [id]);

  async function doVoid() {
    setReasonError(null);
    if (!reason.trim()) return setReasonError("Please give a reason");
    try {
      setP(await voidPayment(id, reason.trim()));
      setVoiding(false);
      setNotice("Payment voided. Its amounts went back to the invoices.");
    } catch (e) {
      setReasonError(e instanceof ApiError ? e.message : "Could not void");
    }
  }
  async function doReverse() {
    setReasonError(null);
    if (!reason.trim()) return setReasonError("Please give a reason");
    try {
      setP(await reverseAllocation(reverseId!, reason.trim()));
      setReverseId(null);
      setReason("");
      setNotice("Allocation reversed. The money is back in the payment's advance.");
    } catch (e) {
      setReasonError(e instanceof ApiError ? e.message : "Could not reverse");
    }
  }

  /** Spec 019b C2, C4: deposited, cleared, or bounced (a bounce reverses the payment; the server checks who may do it). */
  async function doMove(status: "deposited" | "cleared" | "bounced", bounceReason?: string) {
    setReasonError(null);
    if (status === "bounced" && !bounceReason) return setReasonError("Please give the reason for the bounce");
    try {
      setP(await moveCheque(id, status, bounceReason));
      setBouncing(false);
      setReason("");
      setNotice(
        status === "bounced"
          ? "Cheque bounced. The payment is voided, and the invoices owe the money again."
          : `Cheque marked ${status}.`,
      );
    } catch (e) {
      setReasonError(e instanceof ApiError ? e.message : "Could not change the cheque");
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!p) return <p className="text-stone-500">Loading...</p>;

  return (
    <div className="flex flex-col gap-4">
      <a href="#/payments" className="text-sm text-stone-600 underline">All payments</a>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{p.receiptNo ?? "Payment at sale"}{p.voided && <span className="ml-3 text-sm text-red-700 border border-red-200 rounded px-1.5 py-0.5 align-middle">voided</span>}</h1>
          <p className="text-stone-500 text-sm">{niceDate(p.receiptDate)} · {p.payer.name} · {KIND_LABEL[p.kind]}</p>
          {p.voided && <p className="text-red-700 text-sm">Voided: {p.voidReason}</p>}
        </div>
        {p.kind !== "at_sale" && (
          <div className={`flex gap-2 ${pcOnly}`}>
            <button className={btnSecondary} onClick={() => navigate(`/print/payment/${p.id}`)}>Print receipt</button>
          </div>
        )}
        {!p.voided && can("payments.void") && (
          <div className={`flex gap-2 ${pcOnly}`}>
            <button className={btnSecondary} onClick={() => setVoiding(true)}>Void payment</button>
          </div>
        )}
      </div>
      {notice && <Alert kind="ok">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <dl className="bg-white border border-stone-200 rounded-xl px-4 py-2 grid sm:grid-cols-2 gap-x-6">
        <div className="py-1.5"><dt className="text-sm text-stone-500">Amount</dt><dd className="font-medium">{formatMoney(p.amountPaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Left as advance</dt><dd className="font-medium">{formatMoney(p.remainingPaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Mode</dt><dd>{MODE_LABEL[p.mode]}{p.reference ? ` · ${p.reference}` : ""}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">In words</dt><dd>{amountInWords(p.amountPaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Remarks</dt><dd>{p.remarks || "-"}</dd></div>
      </dl>

      {p.cheque && (
        <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3" aria-label="Cheque">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h2 className="font-semibold">Cheque: {CHEQUE_STATUS_LABEL[p.cheque.status]}</h2>
              <p className="text-sm text-stone-600">
                {[p.cheque.bank, p.cheque.drawer && `from ${p.cheque.drawer}`, p.cheque.date && `dated ${niceDate(p.cheque.date)}`].filter(Boolean).join(" · ") || "No cheque details recorded"}
              </p>
            </div>
            {!p.voided && (
              <div className={`flex gap-2 flex-wrap ${pcOnly}`}>
                {p.cheque.status === "received" && can("payments.create") && (
                  <button className={btnSecondary} onClick={() => void doMove("deposited")}>Mark deposited</button>
                )}
                {p.cheque.status === "deposited" && can("payments.create") && (
                  <button className={btnSecondary} onClick={() => void doMove("cleared")}>Mark cleared</button>
                )}
                {can("payments.void") && (
                  <button className={btnSecondary} onClick={() => { setBouncing(true); setReason(""); setReasonError(null); }}>Mark bounced</button>
                )}
              </div>
            )}
          </div>
          <ol className="text-sm flex flex-col gap-1">
            {p.cheque.events.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{CHEQUE_STATUS_LABEL[e.status]}</span> · {when(e.at)}
                {e.reason ? <span className="text-stone-600"> — {e.reason}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Applied to</h2>
        {p.allocations.length === 0 ? (
          <p className="text-sm text-stone-600">Nothing applied to an invoice yet. The whole amount is advance.</p>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-left text-stone-600">
                <tr><th className="px-3 py-2 font-medium">Invoice</th><th className="px-3 py-2 font-medium text-right">Amount</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody>
                {p.allocations.map((a) => (
                  <tr key={a.id} className="border-t border-stone-100">
                    <td className="px-3 py-2">{a.invoiceNo ? <a className="underline" href={`#/invoices/${a.invoiceId}`}>{a.invoiceNo}</a> : "-"}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(a.amountPaise)}</td>
                    <td className="px-3 py-2">{a.reversed ? <span className="text-stone-500">reversed</span> : "applied"}</td>
                    <td className="px-3 py-2 text-right">
                      {!a.reversed && !p.voided && can("payments.void") && (
                        <button className="underline" onClick={() => { setReverseId(a.id); setReason(""); setReasonError(null); }}>Reverse</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {bouncing && (
        <Modal title="Mark this cheque bounced?" onClose={() => setBouncing(false)}>
          <p className="text-sm text-stone-600">
            The payment is voided and everything applied to invoices goes back to them, so the customer owes it again. The record and its history stay.
          </p>
          <Field label="Reason *" error={reasonError ?? undefined}><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="flex gap-2 justify-end">
            <button className={btnSecondary} onClick={() => setBouncing(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => void doMove("bounced", reason.trim())}>Mark bounced</button>
          </div>
        </Modal>
      )}
      {voiding && (
        <Modal title="Void this payment?" onClose={() => setVoiding(false)}>
          <p className="text-sm text-stone-600">Everything applied to invoices goes back to them. The receipt number is kept and never reused.</p>
          <Field label="Reason *" error={reasonError ?? undefined}><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="flex gap-2 justify-end">
            <button className={btnSecondary} onClick={() => setVoiding(false)}>Cancel</button>
            <button className={btnPrimary} onClick={() => void doVoid()}>Void payment</button>
          </div>
        </Modal>
      )}
      {reverseId && (
        <Modal title="Reverse this allocation?" onClose={() => setReverseId(null)}>
          <p className="text-sm text-stone-600">The money goes back to this payment and the invoice owes it again.</p>
          <Field label="Reason *" error={reasonError ?? undefined}><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="flex gap-2 justify-end">
            <button className={btnSecondary} onClick={() => setReverseId(null)}>Cancel</button>
            <button className={btnPrimary} onClick={() => void doReverse()}>Reverse</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
