import { useEffect, useState, type FormEvent } from "react";
import { formatMoney, parseRateInput, type LedgerResponse } from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import ReceiveDialog from "../payments/ReceiveDialog";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { niceDate } from "../rates/api";
import { addOpeningBalance, getLedger } from "./api";

/** Spec 019 section 4: the customer's full history with running balances. */
export default function LedgerTab({ customerId, customerName }: { customerId: string; customerName: string }) {
  const { can } = useAuth();
  const [from, setFrom] = useState("");
  const [l, setL] = useState<LedgerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<null | "payment" | "advance">(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => getLedger(customerId, from || undefined).then((r) => (setL(r), setError(null))).catch((e) => setError(e instanceof Error ? e.message : "Could not load the ledger"));
  useEffect(() => void load(), [customerId, from]);

  if (!l) return error ? <Alert>{error}</Alert> : <p className="text-stone-500">Loading...</p>;
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="ok">{notice}</Alert>}
      <div className="flex gap-4 flex-wrap items-end justify-between">
        <dl className="flex gap-6 flex-wrap">
          <div><dt className="text-sm text-stone-500">Owes</dt><dd className="font-semibold text-base">{formatMoney(l.outstandingPaise)}</dd></div>
          <div><dt className="text-sm text-stone-500">Advance held</dt><dd className="font-semibold text-base">{formatMoney(l.advanceHeldPaise)}</dd></div>
          {/* Spec 019d R18: credit notes not yet applied or paid back. */}
          <div><dt className="text-sm text-stone-500">Credit held</dt><dd className="font-semibold text-base">{formatMoney(l.creditHeldPaise)}</dd></div>
        </dl>
        <div className="flex gap-2 flex-wrap items-end">
          <Field label="Show from">
            <input className={`${inputClass} w-44`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Ledger from date" />
          </Field>
          {can("payments.create") && <button className={btnSecondary} onClick={() => setReceiving("payment")}>Receive payment</button>}
          {can("payments.create") && <button className={btnSecondary} onClick={() => setReceiving("advance")}>Receive advance</button>}
          {can("ledger.opening") && <button className={btnSecondary} onClick={() => setAdding(true)}>Add opening balance</button>}
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[44rem]">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Details</th>
              <th className="px-3 py-2 font-medium text-right">Debit</th>
              <th className="px-3 py-2 font-medium text-right">Credit</th>
              <th className="px-3 py-2 font-medium text-right">Owes after</th>
              <th className="px-3 py-2 font-medium text-right">Advance after</th>
              <th className="px-3 py-2 font-medium text-right">Credit after</th>
            </tr>
          </thead>
          <tbody>
            {l.entries.map((e, i) => (
              <tr key={i} className={`border-t border-stone-100 ${e.type === "Brought forward" ? "bg-stone-50 font-medium" : ""}`}>
                <td className="px-3 py-2 whitespace-nowrap">{niceDate(e.date)}</td>
                <td className="px-3 py-2">{e.type}</td>
                <td className="px-3 py-2">{e.reference ?? "-"}</td>
                <td className="px-3 py-2">{e.description}</td>
                <td className="px-3 py-2 text-right">{e.debitPaise ? formatMoney(e.debitPaise) : ""}</td>
                <td className="px-3 py-2 text-right">{e.creditPaise ? formatMoney(e.creditPaise) : ""}</td>
                <td className="px-3 py-2 text-right">{formatMoney(e.outstandingAfterPaise)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(e.advanceAfterPaise)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(e.creditAfterPaise)}</td>
              </tr>
            ))}
            {l.entries.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-stone-500">Nothing recorded for this customer yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {receiving && (
        <ReceiveDialog
          customer={{ id: customerId, name: customerName }}
          onClose={() => setReceiving(null)}
          onSaved={() => { setReceiving(null); setNotice("Payment saved."); void load(); }}
        />
      )}
      {adding && <OpeningDialog customerId={customerId} onClose={() => setAdding(false)} onDone={() => { setAdding(false); setNotice("Opening balance added."); void load(); }} />}
    </div>
  );
}

/** Spec 019 R1, R2: an amount owed to the shop or held for the customer, from the old system. */
export function OpeningDialog({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"owed" | "advance">("owed");
  const [amount, setAmount] = useState("");
  const [asOf, setAsOf] = useState("2026-03-31");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = parseRateInput(amount, "kg");
    if (!p.ok) return setError(p.message);
    setBusy(true);
    try {
      if (kind === "owed") {
        await addOpeningBalance({ customerId, amountPaise: p.paisePerKg, asOfDate: asOf, reference: reference || undefined, remarks: remarks || undefined });
      } else {
        // An old advance is an opening advance payment (spec 016 R3): held money, not a new receipt.
        const r = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ customerId, date: asOf, mode: "cash", purpose: "opening_advance", amountPaise: p.paisePerKg, oldReference: reference || "OLD-BOOKLET", remarks: remarks || undefined }) });
        if (!r.ok) throw new ApiError(r.status, (await r.json()) as { error?: string; message?: string });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add an opening balance" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
        <fieldset className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={kind === "owed"} onChange={() => setKind("owed")} /> The customer owed us this (receivable)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={kind === "advance"} onChange={() => setKind("advance")} /> We are holding an advance from the customer (old booklet)</label>
        </fieldset>
        <Field label="Amount (₹) *"><input className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus /></Field>
        <Field label="As on date *"><input className={inputClass} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Field label="Old reference (optional)"><input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} /></Field>
        <Field label="Remarks (optional)"><input className={inputClass} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={300} /></Field>
        <p className="text-sm text-stone-600">This is not a new sale and not money received today.</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
