import { useEffect, useState, type FormEvent } from "react";
import { CUSTOMER_PAYMENT_MODES, MODE_LABEL, PURITY_RATE_KIND, formatMoney, formatWeightGrams, parseRateInput, parseRupeesToPaise, type ApplicableRatesResponse, type InvoiceResponse, type PaymentMode } from "@jewellery/shared";
import { ApiError, api } from "../api";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { getApplicable, niceDate } from "../rates/api";
import { navigate } from "../router";
import { fixRate } from "./api";

/** Spec 019c R5: money paid on a sale whose rate is not fixed yet. It is held as the customer's advance. */
export function ReceiveOnSaleDialog({ inv, today, onClose }: { inv: InvoiceResponse; today: string; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const parsed = parseRupeesToPaise(amount, "amount");
    if (!parsed.ok) return setErr(parsed.message);
    setBusy(true);
    try {
      const res = await api<{ payment: { id: string } }>("/api/payments", {
        method: "POST",
        body: { date, customerId: inv.customerId, mode, reference: reference.trim() || undefined, amountPaise: parsed.value, purpose: "pending_sale", invoiceId: inv.id },
      });
      navigate(`/payments/${res.payment.id}`);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Something went wrong");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Money on ${inv.invoiceNo}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-stone-600">
          The rate of this sale is not fixed yet, so this money is kept as {inv.customerName}'s advance. It is applied to the sale when the rate is fixed.
        </p>
        <Field label="Amount (₹) *">
          <input className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
        <Field label="Mode">
          <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
            {CUSTOMER_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>{MODE_LABEL[m]}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference (UPI number, cheque number)">
          <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Date">
          <input className={inputClass} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? "Saving..." : "Save payment"}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Spec 019c R8 and Q90: fixes the rate of a whole sale on one day. A line uses the applicable rate of its purity on
 * that day; a line with no rate (or a rate typed here) takes the typed rate. The money held is applied by the server.
 */
export function FixRateDialog({ inv, today, onClose, onDone }: { inv: InvoiceResponse; today: string; onClose: () => void; onDone: (i: InvoiceResponse) => void }) {
  const [rateDate, setRateDate] = useState(today);
  const [rates, setRates] = useState<ApplicableRatesResponse["rates"] | null>(null);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!rateDate) return;
    getApplicable(rateDate)
      .then((a) => setRates(a.rates))
      .catch(() => setRates(null));
  }, [rateDate]);

  const kindFor = (purity: string) => {
    const kind = PURITY_RATE_KIND[purity as keyof typeof PURITY_RATE_KIND];
    return kind && rates ? rates[kind] : null;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const typedRates: { lineNo: number; goldRatePaisePerKg: number }[] = [];
    for (const l of inv.lines) {
      const text = typed[l.lineNo]?.trim();
      if (!text) continue;
      const r = parseRateInput(text, "gram");
      if (!r.ok) return setErr(`Line ${l.lineNo}: ${r.message}`);
      typedRates.push({ lineNo: l.lineNo, goldRatePaisePerKg: r.paisePerKg });
    }
    setBusy(true);
    try {
      const saved = await fixRate(inv.id, { expectedRevision: inv.revisionNo, rateDate, reason: reason.trim() || undefined, typedRates: typedRates.length ? typedRates : undefined });
      onDone(saved);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.body.error === "rate_missing") setErr(e2.message);
      else setErr(e2 instanceof ApiError ? e2.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Fix the rate of ${inv.invoiceNo}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-stone-600">
          The amount is worked out with the rate of the day the customer pays, and saved as a new version of this invoice. Money already paid on the sale is applied to it. This can be done once; later corrections are edits.
        </p>
        <Field label="Rate date *" hint="The day whose rate is used">
          <input className={inputClass} type="date" value={rateDate} max={today} min={inv.invoiceDate} onChange={(e) => setRateDate(e.target.value)} />
        </Field>
        {rateDate !== today && <Alert kind="info">Rate of {niceDate(rateDate)}. A rate saved earlier is used if none was saved that day.</Alert>}
        <div className="flex flex-col gap-3">
          {inv.lines.map((l) => {
            const r = kindFor(l.purity);
            return (
              <div key={l.lineNo} className="border border-stone-200 rounded-lg p-3 text-sm">
                <p className="font-medium">Line {l.lineNo}: {l.description || "Item"} · {l.purity} · net {formatWeightGrams(l.netWeightMg)} g</p>
                <p className="text-stone-600 mt-1">
                  {r ? `Rate: ₹${(r.pricePaisePerKg / 100000).toFixed(2)} per gram (${r.carriedForward ? `carried forward from ${niceDate(r.rateDate)}` : "saved for this day"})` : "No saved rate for this purity on this day. Type the rate."}
                </p>
                <Field label={r ? "Overtype the rate per gram (optional)" : "Rate per gram *"}>
                  <input className={inputClass} value={typed[l.lineNo] ?? ""} onChange={(e) => setTyped({ ...typed, [l.lineNo]: e.target.value })} inputMode="decimal" placeholder={r ? "" : "0.00"} />
                </Field>
              </div>
            );
          })}
        </div>
        <Field label="Reason (optional)">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>{busy ? "Saving..." : "Fix the rate and save"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** The pending sale's money in one line, for the invoice page. */
export function PendingNote({ inv }: { inv: InvoiceResponse }) {
  return (
    <Alert kind="info">
      Rate pending: the gold rate is fixed when the customer pays. Chargeable weight {formatWeightGrams(inv.pendingWeightMg)} g. Money held on this sale: {formatMoney(inv.pendingHeldPaise)}.
    </Alert>
  );
}

