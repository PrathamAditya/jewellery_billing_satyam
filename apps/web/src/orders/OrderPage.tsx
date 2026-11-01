import { useEffect, useState } from "react";
import { formatMoney, type OrderResponse } from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { navigate } from "../router";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { niceDate } from "../rates/api";
import ReceiveDialog from "../payments/ReceiveDialog";
import { cancelOrder, closeOrder, getOrder } from "./api";

export default function OrderPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [o, setO] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resolution, setResolution] = useState<"transfer" | "refund">("transfer");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMode, setRefundMode] = useState<"cash" | "upi" | "bank_transfer" | "cheque">("bank_transfer");
  const [refundRef, setRefundRef] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = () => getOrder(id).then(setO).catch((e) => setError(e instanceof ApiError && e.status === 404 ? "Order not found." : "Could not load the order"));
  useEffect(() => void load(), [id]);

  async function doClose() {
    try {
      setO(await closeOrder(id));
      setNotice("Order closed. Its advances stay with the customer.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not close");
    }
  }

  async function doCancel() {
    setCancelError(null);
    const body: Record<string, unknown> = { resolution };
    if (resolution === "refund") {
      const parsed = refundAmount.trim() ? Math.round(Number(refundAmount.replace(/,/g, "")) * 100) : undefined;
      if (refundAmount.trim() && (!Number.isFinite(parsed) || parsed! <= 0)) return setCancelError("Enter the refund in rupees");
      body.refundAmountPaise = parsed;
      body.refundMode = refundMode;
      body.refundReference = refundRef || undefined;
    }
    try {
      setO(await cancelOrder(id, body));
      setCancelling(false);
      setNotice(resolution === "refund" ? "Order cancelled and the refund recorded." : "Order cancelled. The advance stays with the customer.");
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : "Could not cancel");
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!o) return <p className="text-stone-500">Loading...</p>;
  const open = o.status === "open";
  return (
    <div className="flex flex-col gap-4">
      <a href="#/orders" className="text-sm text-stone-600 underline">All orders</a>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{o.orderNo} <span className="text-base font-normal capitalize text-stone-600">· {o.status}</span></h1>
          <p className="text-stone-500 text-sm">{o.customerName}{o.description ? ` · ${o.description}` : ""}{o.expectedDate ? ` · expected ${niceDate(o.expectedDate)}` : ""}</p>
        </div>
        {open && can("advances.create") && (
          <div className={`flex gap-2 ${pcOnly}`}>
            <button className={btnPrimary} onClick={() => setReceiving(true)}>Receive advance</button>
            <button className={btnSecondary} onClick={() => void doClose()}>Close order</button>
            {can("advances.cancel") && <button className={btnSecondary} onClick={() => { setCancelling(true); setCancelError(null); }}>Cancel order</button>}
          </div>
        )}
      </div>
      {notice && <Alert kind="ok">{notice}</Alert>}

      <dl className="bg-white border border-stone-200 rounded-xl px-4 py-2 grid sm:grid-cols-2 gap-x-6">
        <div className="py-1.5"><dt className="text-sm text-stone-500">Advance held for this order</dt><dd className="font-medium">{formatMoney(o.remainingPaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Cancelled as</dt><dd>{o.cancelResolution ?? "-"}</dd></div>
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Advances</h2>
        {o.advances.length === 0 ? <p className="text-sm text-stone-600">No advance yet.</p> : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-left text-stone-600"><tr><th className="px-3 py-2 font-medium">Receipt</th><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Kind</th><th className="px-3 py-2 font-medium text-right">Amount</th><th className="px-3 py-2 font-medium text-right">Still held</th></tr></thead>
              <tbody>
                {o.advances.map((a) => (
                  <tr key={a.id} className="border-t border-stone-100">
                    <td className="px-3 py-2"><a className="underline" href={`#/payments/${a.id}`}>{a.receiptNo ?? "Old booklet"}</a></td>
                    <td className="px-3 py-2">{niceDate(a.receiptDate)}</td>
                    <td className="px-3 py-2">{a.kind === "opening_advance" ? "Opening advance (old booklet)" : "Advance"}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(a.amountPaise)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(a.remainingPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {o.refunds.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Refunds</h2>
          <ul className="text-sm flex flex-col gap-1">
            {o.refunds.map((r) => (
              <li key={r.id}>{niceDate(r.refundDate)} · {formatMoney(r.amountPaise)} by {r.mode.replace("_", " ")} from {r.receiptNo ?? "booklet"}{r.reversed ? " (reversed)" : ""}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">History</h2>
        <ol className="text-sm flex flex-col gap-1">
          {o.history.map((h, i) => <li key={i}><span className="text-stone-500">{new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</span> · {h.action}</li>)}
        </ol>
      </section>

      {receiving && (
        <ReceiveDialog
          customer={{ id: o.customerId, name: o.customerName }}
          order={{ id: o.id, orderNo: o.orderNo }}
          onClose={() => setReceiving(false)}
          onSaved={(pid) => navigate(`/payments/${pid}`)}
        />
      )}
      {cancelling && (
        <Modal title={`Cancel ${o.orderNo}?`} onClose={() => setCancelling(false)}>
          <p className="text-sm text-stone-600">The advance held for this order is {formatMoney(o.remainingPaise)}.</p>
          <fieldset className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={resolution === "transfer"} onChange={() => setResolution("transfer")} /> Keep the money as the customer's advance for future purchases</label>
            <label className="flex items-center gap-2"><input type="radio" checked={resolution === "refund"} onChange={() => setResolution("refund")} /> Pay the customer back</label>
          </fieldset>
          {resolution === "refund" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount to refund (₹, blank = all)"><input className={inputClass} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} inputMode="decimal" /></Field>
              <Field label="Paid by"><select className={inputClass} value={refundMode} onChange={(e) => setRefundMode(e.target.value as typeof refundMode)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option></select></Field>
              <Field label="Reference"><input className={inputClass} value={refundRef} onChange={(e) => setRefundRef(e.target.value)} /></Field>
            </div>
          )}
          {cancelError && <Alert>{cancelError}</Alert>}
          <div className="flex gap-2 justify-end">
            <button className={btnSecondary} onClick={() => setCancelling(false)}>Back</button>
            <button className={btnPrimary} onClick={() => void doCancel()}>Cancel order</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
