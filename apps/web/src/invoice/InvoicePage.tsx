import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { InvoiceResult } from "@jewellery/calc";
import { formatMoney, formatPerGram, formatWeightGrams, type InvoiceHistoryEntry, type InvoiceResponse } from "@jewellery/shared";
import { ApiError } from "../api";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { navigate } from "../router";
import { niceDate } from "../rates/api";
import Breakdown from "./Breakdown";
import { getInvoice, getInvoiceHistory, voidInvoice } from "./api";
import ReceiveDialog from "../payments/ReceiveDialog";
import SettlementTab from "../settlement/SettlementTab";
import { formatMoney as fm } from "@jewellery/shared";
import { useAuth } from "../auth";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const PART_LABEL: Record<string, string> = { date: "Date", customer: "Customer", taxMode: "Tax mode", reverseCharge: "Reverse charge", remarks: "Remarks", lines: "Lines" };

function History({ id, current, onOpen }: { id: string; current: number; onOpen: (rev: number) => void }) {
  const [items, setItems] = useState<InvoiceHistoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getInvoiceHistory(id)
      .then((r) => setItems(r.items))
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load history"));
  }, [id, current]);
  if (err) return <Alert>{err}</Alert>;
  if (!items) return <p className="text-sm text-stone-500">Loading...</p>;
  if (items.length === 0) return <p className="text-stone-500">No changes yet. This invoice has never been edited.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((h) => (
        <li key={h.revisionNo} className="bg-white border border-stone-200 rounded-xl p-4 text-sm">
          <p className="text-stone-500">
            {when(h.at)}, version {h.revisionNo} replaced{h.reason ? ` - "${h.reason}"` : ""}
          </p>
          <p className="mt-1">
            Changed: {h.changes.map((c) => PART_LABEL[c] ?? c).join(", ") || "nothing visible"}. Payable{" "}
            <span className="line-through text-stone-500">{formatMoney(h.fromPayablePaise)}</span> to {formatMoney(h.toPayablePaise)}.
          </p>
          <button className="underline mt-1" onClick={() => onOpen(h.revisionNo)}>
            View version {h.revisionNo}
          </button>
        </li>
      ))}
    </ol>
  );
}

function VoidDialog({ inv, onClose, onDone }: { inv: InvoiceResponse; onClose: () => void; onDone: (i: InvoiceResponse) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setErr("Please give a reason");
    setBusy(true);
    try {
      onDone(await voidInvoice(inv.id, reason.trim()));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Something went wrong");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Void ${inv.invoiceNo}?`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-stone-600">A voided invoice keeps its number and stays in the list, marked voided. It cannot be edited or brought back. Make a new invoice instead.</p>
        <Field label="Reason *">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            Void invoice
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function InvoicePage({ id }: { id: string }) {
  const { can } = useAuth();
  const [inv, setInv] = useState<InvoiceResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "settlement" | "history">("details");
  const [voiding, setVoiding] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(
    (revision?: number) => {
      getInvoice(id, revision)
        .then(setInv)
        .catch((e) => setErr(e instanceof ApiError && e.status === 404 ? "Invoice not found." : e instanceof Error ? e.message : "Could not load invoice"));
    },
    [id],
  );
  useEffect(() => load(), [load]);

  if (err) return <Alert>{err}</Alert>;
  if (!inv) return <p className="text-stone-500">Loading...</p>;

  const calc = inv.calc as InvoiceResult;
  const lineRow = (label: string, value: string | null) => (
    <div className="grid sm:grid-cols-[9rem_1fr] gap-1 py-1.5">
      <dt className="text-stone-500 text-sm">{label}</dt>
      <dd className="break-words">{value || <span className="text-stone-400">-</span>}</dd>
    </div>
  );
  const tabBtn = (t: "details" | "settlement" | "history", label: string) => (
    <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm border-b-2 ${tab === t ? "border-stone-900 font-medium" : "border-transparent text-stone-500"}`}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <a href="#/invoices" className="text-sm text-stone-600 underline">
        All invoices
      </a>
      {inv.isEarlierVersion && (
        <Alert kind="info">
          This is an earlier version (version {inv.revisionNo}), shown exactly as it was saved.{" "}
          <button className="underline" onClick={() => load()}>
            Back to the current version
          </button>
        </Alert>
      )}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">
            {inv.invoiceNo}
            {inv.voidedAt && <span className="ml-3 text-sm text-red-700 border border-red-200 rounded px-1.5 py-0.5 align-middle">voided</span>}
          </h1>
          <p className="text-stone-500 text-sm">
            {niceDate(inv.invoiceDate)} · {inv.customerName}
            {inv.revisionNo > 1 && !inv.isEarlierVersion ? ` · version ${inv.revisionNo}` : ""}
          </p>
          {inv.voidedAt && <p className="text-red-700 text-sm mt-1">Voided: {inv.voidReason}</p>}
        </div>
        <div className={`flex gap-2 ${pcOnly}`}>
          <button className={btnSecondary} disabled title="The print layout comes in spec 014">
            Print
          </button>
          {!inv.voidedAt && !inv.isEarlierVersion && (
            <>
              {can("invoices.edit") && (
              <button className={btnPrimary} onClick={() => navigate(`/invoices/${inv.id}/edit`)}>
                Edit
              </button>
              )}
              {can("invoices.void") && (
              <button className={btnSecondary} onClick={() => setVoiding(true)}>
                Void
              </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {tabBtn("details", "Details")}
        {tabBtn("settlement", "Settlement")}
        {tabBtn("history", "History")}
      </div>

      {!inv.voidedAt && (
        <div className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap text-sm">
          <div className="flex gap-6 flex-wrap">
            <span>Received <strong>{fm(inv.receivedPaise)}</strong></span>
            <span>Balance due <strong>{fm(inv.balanceDuePaise)}</strong></span>
            <span className="text-stone-600">{inv.paymentStatus === "paid" ? "Paid in full" : inv.paymentStatus === "part_paid" ? "Part paid" : "Not paid"}</span>
          </div>
          {!inv.isEarlierVersion && can("payments.create") && inv.balanceDuePaise > 0 && (
            <button className={btnPrimary} onClick={() => setReceiving(true)}>Receive payment</button>
          )}
        </div>
      )}

      {tab === "details" && (
        <div className="flex flex-col gap-4">
          <dl className="bg-white border border-stone-200 rounded-xl px-4 py-2 divide-y divide-stone-100">
            {lineRow("Customer", inv.customerName)}
            {lineRow("Mobile", inv.customerMobile)}
            {lineRow("Address", inv.customerAddress)}
            {lineRow("PAN", inv.customerPan)}
            {lineRow("Sale", inv.taxMode === "intra" ? "Same state (CGST + SGST)" : "Other state (IGST)")}
            {lineRow("Reverse charge", inv.reverseCharge ? "Yes" : "No")}
            {lineRow("Remarks", inv.remarks)}
            {lineRow("Saved", `${when(inv.createdAt)}${inv.updatedAt !== inv.createdAt ? `, last changed ${when(inv.updatedAt)}` : ""}`)}
          </dl>

          <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-stone-600 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Purity</th>
                  <th className="px-3 py-2 font-medium">HSN</th>
                  <th className="px-3 py-2 font-medium text-right">Gross g</th>
                  <th className="px-3 py-2 font-medium text-right">Net g</th>
                  <th className="px-3 py-2 font-medium text-right">Polish g</th>
                  <th className="px-3 py-2 font-medium text-right">Gold rate / g</th>
                  <th className="px-3 py-2 font-medium text-right">Labour rate / g</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.lineNo} className="border-t border-stone-100">
                    <td className="px-3 py-2">{l.lineNo}</td>
                    <td className="px-3 py-2">{l.description || "-"}</td>
                    <td className="px-3 py-2">{l.purity}</td>
                    <td className="px-3 py-2">{l.hsn}</td>
                    <td className="px-3 py-2 text-right">{formatWeightGrams(l.grossWeightMg)}</td>
                    <td className="px-3 py-2 text-right">{formatWeightGrams(l.netWeightMg)}</td>
                    <td className="px-3 py-2 text-right">{formatWeightGrams(l.polishMg)}</td>
                    <td className="px-3 py-2 text-right">{formatPerGram(l.goldRatePaisePerKg)}</td>
                    <td className="px-3 py-2 text-right">{formatPerGram(l.labourRatePaisePerKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Breakdown r={calc} descriptions={inv.lines.map((l) => l.description)} />
        </div>
      )}
      {tab === "settlement" && <SettlementTab invoice={{ id: inv.id, invoiceNo: inv.invoiceNo, customerId: inv.customerId, balanceDuePaise: inv.balanceDuePaise }} />}
      {tab === "history" && <History id={inv.id} current={inv.revisionNo} onOpen={(rev) => (setTab("details"), load(rev))} />}

      {receiving && (
        <ReceiveDialog
          invoice={{ id: inv.id, invoiceNo: inv.invoiceNo, balanceDuePaise: inv.balanceDuePaise, customerId: inv.customerId }}
          onClose={() => setReceiving(false)}
          onSaved={(pid) => navigate(`/payments/${pid}`)}
        />
      )}
      {voiding && (
        <VoidDialog
          inv={inv}
          onClose={() => setVoiding(false)}
          onDone={(v) => {
            setInv(v);
            setVoiding(false);
          }}
        />
      )}
    </div>
  );
}
