import { useEffect, useMemo, useState } from "react";
import { MAX_MODES_PER_RECEIPT, MODE_LABEL, formatMoney, parseRateInput, type CustomerResponse, type InvoiceSummary } from "@jewellery/shared";
import { ApiError } from "../api";
import CustomerPicker from "../customers/CustomerPicker";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { getApplicable } from "../rates/api";
import { getLedger } from "../ledger/api";
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

type Mode = "cash" | "upi" | "card" | "cheque" | "bank_transfer";
const MODES: Mode[] = ["upi", "cash", "card", "cheque", "bank_transfer"];
/** Feedback point 3: one more payment mode on the same receipt. */
type ExtraLine = { mode: Mode; amountText: string; reference: string; chequeBank: string; chequeDate: string; chequeDrawer: string };
const blankExtra = (mode: Mode = "cash"): ExtraLine => ({ mode, amountText: "", reference: "", chequeBank: "", chequeDate: "", chequeDrawer: "" });
const rupeesOf = (t: string) => {
  const p = t.trim() ? parseRateInput(t, "kg") : null; // whole rupees with up to 2 decimals
  return p?.ok ? p.paisePerKg : null;
};

/** Spec 015 section 5: receive a payment, advance or against invoices, with a preview of where the money goes. */
export default function ReceiveDialog({ customer: fixed, invoice, order, onClose, onSaved }: Props) {
  const [today, setToday] = useState("");
  const [picked, setPicked] = useState<CustomerResponse | null>(null);
  const customerId = fixed?.id ?? invoice?.customerId ?? picked?.id ?? null;
  const customerName = fixed?.name ?? picked?.name ?? "";
  const [date, setDate] = useState("");
  const [mode, setMode] = useState<Mode>("upi");
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  // Feedback points 14 and 15: what the customer owes and what the shop already holds for them, shown before the money is typed.
  const [money, setMoney] = useState<{ outstandingPaise: number; advanceHeldPaise: number } | null>(null);
  const [reference, setReference] = useState("");
  const [amountText, setAmountText] = useState("");
  const [purpose, setPurpose] = useState<"advance" | "against_invoices" | "at_sale" | "opening_advance">(invoice ? "at_sale" : "advance");
  const [oldRef, setOldRef] = useState("");
  // Spec 019b C8: cheque details, shown when the mode is cheque.
  const [chequeBank, setChequeBank] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [chequeDrawer, setChequeDrawer] = useState("");
  // Spec 019b C9: a duplicate cheque number is saved, but the owner is told before leaving the dialog.
  const [notice, setNotice] = useState<{ id: string; text: string; receiptNo?: string | null } | null>(null);
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
    if (!customerId) {
      setMoney(null);
      return;
    }
    let alive = true;
    // A person without the ledger permission simply does not see the figures.
    getLedger(customerId).then((l) => alive && setMoney({ outstandingPaise: l.outstandingPaise, advanceHeldPaise: l.advanceHeldPaise })).catch(() => alive && setMoney(null));
    return () => {
      alive = false;
    };
  }, [customerId]);

  useEffect(() => {
    if (!customerId) {
      setOpen([]);
      return;
    }
    searchInvoices("", { customerId, status: "active" })
      .then((r) => setOpen(r.items.filter((i) => i.balanceDuePaise > 0).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNo.localeCompare(b.invoiceNo))))
      .catch(() => setOpen([]));
  }, [customerId]);

  /** The first mode's amount, each further mode's amount (null when not a valid amount), and the receipt's total. */
  const firstPaise = useMemo(() => rupeesOf(amountText), [amountText]);
  const extraPaise = useMemo(() => extras.map((x) => rupeesOf(x.amountText)), [extras]);
  const amountPaise = useMemo(() => (firstPaise === null || extraPaise.some((x) => x === null) ? null : firstPaise + extraPaise.reduce<number>((n, x) => n + (x ?? 0), 0)), [firstPaise, extraPaise]);
  const setExtra = (i: number, patch: Partial<ExtraLine>) => setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

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

  // The cash limit is about all the cash on this receipt.
  const cashPaise = (mode === "cash" ? (firstPaise ?? 0) : 0) + extras.reduce((n, x, i) => n + (x.mode === "cash" ? (extraPaise[i] ?? 0) : 0), 0);
  const cashWarning = limit !== null && cashPaise > 0 && cashPaise >= limit;

  async function submit() {
    setError(null);
    setFieldError(null);
    if (!customerId && purpose !== "at_sale") return setFieldError("Choose the customer");
    if (firstPaise === null || firstPaise <= 0) return setFieldError("Enter the amount in rupees, like 14,500");
    for (const [i, x] of extras.entries()) if (extraPaise[i] === null || extraPaise[i]! <= 0) return setFieldError(`Enter the amount of payment mode ${i + 2} in rupees, or remove it`);
    if (amountPaise === null) return setFieldError("Enter the amount in rupees, like 14,500");
    if (!date) return setFieldError("Choose the date");
    if (cashWarning && !warnConfirmed) return setError("Please confirm the cash amount first (tick the box below).");
    if (purpose === "opening_advance" && !oldRef.trim()) return setFieldError("Enter the receipt number from the old booklet");
    const body: Record<string, unknown> = { id, date, mode, reference: reference || undefined, amountPaise: firstPaise, purpose, customerId: customerId ?? undefined };
    if (extras.length) {
      body.extraModes = extras.map((x, i) => ({
        mode: x.mode,
        reference: x.reference.trim() || undefined,
        amountPaise: extraPaise[i],
        ...(x.mode === "cheque" ? { chequeBank: x.chequeBank.trim() || undefined, chequeDate: x.chequeDate || undefined, chequeDrawer: x.chequeDrawer.trim() || undefined } : {}),
      }));
    }
    if (order && purpose === "advance") body.orderId = order.id;
    if (purpose === "opening_advance") {
      body.oldReference = oldRef.trim();
      if (order) body.orderId = order.id;
    }
    if (purpose === "at_sale" && invoice) body.invoiceId = invoice.id;
    if (mode === "cheque") {
      body.chequeBank = chequeBank.trim() || undefined;
      body.chequeDate = chequeDate || undefined;
      body.chequeDrawer = chequeDrawer.trim() || undefined;
    }
    if (purpose === "against_invoices" && manual && plan) {
      body.allocation = plan.rows.filter((r) => r.amountPaise > 0).map((r) => ({ invoiceId: r.invoice.id, amountPaise: r.amountPaise }));
    }
    setBusy(true);
    try {
      const res = await createPayment(body);
      const dup = res.warnings.find((w) => w.code === "duplicate_cheque_number");
      if (dup && dup.code === "duplicate_cheque_number") {
        setNotice({ id: res.payment.id, text: `Saved. Another live cheque already uses the number ${dup.reference}. Check that it is not the same cheque.`, receiptNo: res.payment.receiptNo });
      } else {
        onSaved(res.payment.id);
      }
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

        {customerId && money && (
          <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm flex flex-col gap-1" aria-label="What the customer owes and holds">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>Outstanding: <strong>{formatMoney(money.outstandingPaise)}</strong>{open.length > 0 ? ` on ${open.length} invoice${open.length > 1 ? "s" : ""}` : ""}</span>
              <span>Advance already held: <strong>{formatMoney(money.advanceHeldPaise)}</strong></span>
              {invoice && <span>This invoice owes: <strong>{formatMoney(invoice.balanceDuePaise)}</strong></span>}
            </div>
            {(purpose === "advance" || purpose === "opening_advance") && amountPaise !== null && amountPaise > 0 && (
              <div>Advance after this receipt: <strong>{formatMoney(money.advanceHeldPaise + amountPaise)}</strong> (previous {formatMoney(money.advanceHeldPaise)} + this {formatMoney(amountPaise)})</div>
            )}
            {purpose === "against_invoices" && amountPaise !== null && amountPaise > 0 && (
              <div>Outstanding after this receipt: <strong>{formatMoney(Math.max(0, money.outstandingPaise - amountPaise))}</strong>{amountPaise > money.outstandingPaise ? ` (${formatMoney(amountPaise - money.outstandingPaise)} more than owed is kept as advance)` : ""}</div>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount (₹) *" error={fieldError ?? undefined}>
            <input className={inputClass} value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" placeholder="e.g. 14,500" autoFocus />
          </Field>
          <Field label="Date *" hint={today && date !== today ? "This is not today's date" : undefined}>
            <input className={inputClass} type="date" value={date} max={today || undefined} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mode">
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              {MODES.map((m) => (
                <option key={m} value={m}>{MODE_LABEL[m]}</option>
              ))}
            </select>
          </Field>
          <Field label="Reference (UPI number, cheque number)">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
          </Field>
        </div>

        {/* Feedback point 3: the customer paid by more than one mode (for example cash and UPI): one receipt, one line per mode. */}
        {extras.map((x, i) => (
          <div key={i} className="flex flex-col gap-3 border border-stone-200 rounded-lg p-3" role="group" aria-label={`Payment mode ${i + 2}`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={`Amount ${i + 2} (₹) *`}>
                <input className={inputClass} value={x.amountText} onChange={(e) => setExtra(i, { amountText: e.target.value })} inputMode="decimal" placeholder="e.g. 9,500" aria-label={`Amount of payment mode ${i + 2}`} />
              </Field>
              <Field label={`Mode ${i + 2}`}>
                <select className={inputClass} value={x.mode} onChange={(e) => setExtra(i, { mode: e.target.value as Mode })} aria-label={`Payment mode ${i + 2}`}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>{MODE_LABEL[m]}</option>
                  ))}
                </select>
              </Field>
              <Field label={`Reference ${i + 2}`}>
                <input className={inputClass} value={x.reference} onChange={(e) => setExtra(i, { reference: e.target.value })} maxLength={60} aria-label={`Reference of payment mode ${i + 2}`} />
              </Field>
            </div>
            {x.mode === "cheque" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Cheque bank"><input className={inputClass} value={x.chequeBank} onChange={(e) => setExtra(i, { chequeBank: e.target.value })} maxLength={100} aria-label={`Cheque bank of payment mode ${i + 2}`} /></Field>
                <Field label="Cheque date"><input className={inputClass} type="date" value={x.chequeDate} onChange={(e) => setExtra(i, { chequeDate: e.target.value })} aria-label={`Cheque date of payment mode ${i + 2}`} /></Field>
                <Field label="Name on the cheque"><input className={inputClass} value={x.chequeDrawer} onChange={(e) => setExtra(i, { chequeDrawer: e.target.value })} maxLength={100} aria-label={`Cheque name of payment mode ${i + 2}`} /></Field>
              </div>
            )}
            <div><button type="button" className="text-sm underline text-stone-600" onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}>Remove this payment mode</button></div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          {extras.length + 1 < MAX_MODES_PER_RECEIPT && (
            <button type="button" className={btnSecondary} onClick={() => setExtras((xs) => [...xs, blankExtra(mode === "cash" ? "upi" : "cash")])}>
              Add another payment mode
            </button>
          )}
          {extras.length > 0 && amountPaise !== null && (
            <span className="text-sm" role="status">Total received on this receipt: <strong>{formatMoney(amountPaise)}</strong></span>
          )}
        </div>

        {mode === "cheque" && (
          <div className="grid gap-3 sm:grid-cols-3 border border-stone-200 rounded-lg p-3">
            <Field label="Cheque bank">
              <input className={inputClass} value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} maxLength={100} />
            </Field>
            <Field label="Cheque date" hint="Can be a later date (post-dated)">
              <input className={inputClass} type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
            </Field>
            <Field label="Name on the cheque">
              <input className={inputClass} value={chequeDrawer} onChange={(e) => setChequeDrawer(e.target.value)} maxLength={100} />
            </Field>
          </div>
        )}

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
            <p>Cash of {formatMoney(cashPaise)} is at or above the cash limit of {formatMoney(limit!)}. You can still save it.</p>
            <label className="flex items-center gap-2 mt-2"><input type="checkbox" checked={warnConfirmed} onChange={(e) => setWarnConfirmed(e.target.checked)} /> I have checked this cash amount</label>
          </Alert>
        )}
        {notice && (
          <Alert kind="info">
            <p>{notice.text}</p>
            <button className={`${btnPrimary} mt-2`} onClick={() => onSaved(notice.id)}>Open the payment</button>
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}

        <div className="flex gap-2 justify-end">
          <button className={btnSecondary} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy || notice !== null} onClick={() => void submit()}>{busy ? "Saving..." : "Save payment"}</button>
        </div>
      </div>
    </Modal>
  );
}
