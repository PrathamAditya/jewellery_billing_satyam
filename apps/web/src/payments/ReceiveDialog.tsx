import { useEffect, useMemo, useState } from "react";
import { MODE_LABEL, formatMoney, parseRateInput, type CustomerResponse, type InvoiceSummary, type PaymentWarning } from "@jewellery/shared";
import { ApiError } from "../api";
import CustomerPicker from "../customers/CustomerPicker";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { getApplicable } from "../rates/api";
import { getSettings } from "../settings/api";
import { searchInvoices } from "../invoice/api";
import { createPayment } from "./api";
import { newId } from "@jewellery/shared";

type Props = {
  /** Fixed customer (opened from a customer or invoice). */
  customer?: { id: string; name: string };
  /** Fixed order: the advance is put on it (spec 016 R2). */
  order?: { id: string; orderNo: string };
  /** Fixed invoice: offers "At sale" as well. */
  invoice?: { id: string; invoiceNo: string; balanceDuePaise: number; customerId: string | null };
  onClose: () => void;
  onSaved: (paymentId: string) => void;
};

/** Spec 015 section 5: receive a payment, advance or against invoices, with a preview of where the money goes. */
export default function ReceiveDialog({ customer: fixed, invoice, order, onClose, onSaved }: Props) {
  const [today, setToday] = useState("");
  const [picked, setPicked] = useState<CustomerResponse | null>(null);
  const customerId = fixed?.id ?? invoice?.customerId ?? picked?.id ?? null;
  const customerName = fixed?.name ?? picked?.name ?? "";
  const [date, setDate] = useState("");
  const [mode, setMode] = useState<"cash" | "upi" | "card" | "cheque" | "bank_transfer">("upi");
  const [reference, setReference] = useState("");
  const [amountText, setAmountText] = useState("");
  const [purpose, setPurpose] = useState<"advance" | "against_invoices" | "at_sale" | "opening_advance">(invoice ? "at_sale" : "advance");
  const [oldRef, setOldRef] = useState("");
  const [open, setOpen] = useState<InvoiceSummary[]>([]);
  const [manual, setManual] = useState(false);
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState<number | null>(null);
  const [warnConfirmed, setWarnConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [id] = useState(() => newId());

  useEffect(() => {
    getApplicable().then((a) => {
      setToday(a.date);
      setDate((d) => d || a.date);
    }).catch(() => undefined);
    getSettings().then((s) => setLimit(s.limits.cashWarningPaise)).catch(() => setLimit(null));
  }, []);

  useEffect(() => {
    if (!customerId || purpose !== "against_invoices") {
      setOpen([]);
      return;
    }
    searchInvoices("", { customerId, status: "active" })
      .then((r) => setOpen(r.items.filter((i) => i.balanceDuePaise > 0).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNo.localeCompare(b.invoiceNo))))
      .catch(() => setOpen([]));
  }, [customerId, purpose]);

  const amountPaise = useMemo(() => {
    const parsed = parseRateInput(amountText, "kg"); // whole rupees with up to 2 decimals
    return parsed.ok ? parsed.paisePerKg : null;
  }, [amountText]);

  /** The same first-in, first-out rule as the server (spec 015 R3), shown before saving. */
  const plan = useMemo(() => {
    if (purpose !== "against_invoices" || amountPaise === null) return null;
    if (manual) {
      const rows = open.map((i) => ({ invoice: i, amount: parseRateInput(manualAmounts[i.id] ?? "", "kg") }));
      const sum = rows.reduce((s, r) => s + (r.amount.ok ? r.amount.paisePerKg : 0), 0);
      return { rows: rows.map((r) => ({ invoice: r.invoice, amountPaise: r.amount.ok ? r.amount.paisePerKg : 0 })), leftover: amountPaise - sum };
    }
    let left = amountPaise;
    const rows = open.map((i) => {
      const take = Math.min(left, i.balanceDuePaise);
      left -= take;
      return { invoice: i, amountPaise: take };
    });
    return { rows, leftover: left };
  }, [purpose, amountPaise, open, manual, manualAmounts]);

  const cashWarning = mode === "cash" && limit !== null && amountPaise !== null && amountPaise >= limit;

  async function submit() {
    setError(null);
    setFieldError(null);
    if (!customerId && purpose !== "at_sale") return setFieldError("Choose the customer");
    if (amountPaise === null) return setFieldError("Enter the amount in rupees, like 14,500");
    if (!date) return setFieldError("Choose the date");
    if (cashWarning && !warnConfirmed) return setError("Please confirm the cash amount first (tick the box below).");
    if (purpose === "opening_advance" && !oldRef.trim()) return setFieldError("Enter the receipt number from the old booklet");
    const body: Record<string, unknown> = { id, date, mode, reference: reference || undefined, amountPaise, purpose, customerId: customerId ?? undefined };
    if (order && purpose === "advance") body.orderId = order.id;
    if (purpose === "opening_advance") {
      body.oldReference = oldRef.trim();
      if (order) body.orderId = order.id;
    }
    if (purpose === "at_sale" && invoice) body.invoiceId = invoice.id;
    if (purpose === "against_invoices" && manual && plan) {
      body.allocation = plan.rows.filter((r) => r.amountPaise > 0).map((r) => ({ invoiceId: r.invoice.id, amountPaise: r.amountPaise }));
    }
    setBusy(true);
    try {
      const res = await createPayment(body);
      onSaved(res.payment.id);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = invoice ? `Receive payment for ${invoice.invoiceNo}` : "Receive payment";
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!fixed && !invoice && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Customer</span>
            {customerName ? (
              <p className="text-sm">
                {customerName}{" "}
                <button className="underline ml-2" onClick={() => setPicked(null)}>Change</button>
              </p>
            ) : (
              <CustomerPicker onPick={setPicked} />
            )}
          </div>
        )}
        {(fixed || invoice) && customerName && <p className="text-sm">Customer: <strong>{customerName}</strong></p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount (₹) *" error={fieldError ?? undefined}>
            <input className={inputClass} value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" placeholder="e.g. 14,500" autoFocus />
          </Field>
          <Field label="Date *" hint={today && date !== today ? "This is not today's date" : undefined}>
            <input className={inputClass} type="date" value={date} max={today || undefined} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mode">
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              {(["upi", "cash", "card", "cheque", "bank_transfer"] as const).map((m) => (
                <option key={m} value={m}>{MODE_LABEL[m]}</option>
              ))}
            </select>
          </Field>
          <Field label="Reference (UPI number, cheque number)">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium mb-1">What is this payment for?</legend>
          {invoice && (
            <label className="flex items-center gap-2"><input type="radio" checked={purpose === "at_sale"} onChange={() => setPurpose("at_sale")} /> Received at the time of sale (on {invoice.invoiceNo})</label>
          )}
          <label className="flex items-center gap-2"><input type="radio" checked={purpose === "advance"} onChange={() => setPurpose("advance")} /> {order ? `Advance on ${order.orderNo}` : "Advance for a future order (no invoice yet)"}</label>
          <label className="flex items-center gap-2"><input type="radio" checked={purpose === "opening_advance"} onChange={() => setPurpose("opening_advance")} /> Advance from the old booklet (already received before)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={purpose === "against_invoices"} onChange={() => setPurpose("against_invoices")} disabled={!customerId} /> Pay outstanding invoices</label>
        </fieldset>

        {purpose === "opening_advance" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Receipt number in the old booklet *"><input className={inputClass} value={oldRef} onChange={(e) => setOldRef(e.target.value)} maxLength={60} /></Field>
            <p className="text-sm text-stone-600 self-end">This is not a new receipt and it is not counted as money received today.</p>
          </div>
        )}

        {purpose === "against_invoices" && customerId && (
          <div className="flex flex-col gap-2 border border-stone-200 rounded-lg p-3">
            {open.length === 0 ? (
              <p className="text-sm text-stone-600">No invoices owe money. The whole amount is kept as advance.</p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Choose the amounts myself</label>
                <ul className="text-sm flex flex-col gap-1">
                  {open.map((i) => {
                    const row = plan?.rows.find((r) => r.invoice.id === i.id);
                    return (
                      <li key={i.id} className="flex items-center justify-between gap-2">
                        <span>{i.invoiceNo} <span className="text-stone-500">owes {formatMoney(i.balanceDuePaise)}</span></span>
                        {manual ? (
                          <input className={`${inputClass} w-32`} value={manualAmounts[i.id] ?? ""} onChange={(e) => setManualAmounts((p) => ({ ...p, [i.id]: e.target.value }))} aria-label={`Amount for ${i.invoiceNo}`} />
                        ) : (
                          <span>{formatMoney(row?.amountPaise ?? 0)}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {plan && (
                  <p className="text-sm text-stone-700">
                    {plan.leftover > 0 ? `Kept as advance: ${formatMoney(plan.leftover)}` : plan.leftover < 0 ? <span className="text-red-700">Allocated more than the amount: {formatMoney(-plan.leftover)} too much</span> : "All of it goes to the invoices above."}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {cashWarning && (
          <Alert kind="info">
            <p>Cash of {formatMoney(amountPaise!)} is at or above the cash limit of {formatMoney(limit!)}. You can still save it.</p>
            <label className="flex items-center gap-2 mt-2"><input type="checkbox" checked={warnConfirmed} onChange={(e) => setWarnConfirmed(e.target.checked)} /> I have checked this cash amount</label>
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}

        <div className="flex gap-2 justify-end">
          <button className={btnSecondary} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy} onClick={() => void submit()}>{busy ? "Saving..." : "Save payment"}</button>
        </div>
      </div>
    </Modal>
  );
}
