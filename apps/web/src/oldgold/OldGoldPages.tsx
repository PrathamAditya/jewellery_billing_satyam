import { useEffect, useMemo, useState } from "react";
import { calculateOldGold } from "@jewellery/calc";
import { OLD_GOLD_STATUS, formatMoney, formatPerGram, formatWeightGrams, parseRateInput, parseWeightGrams, amountInWords, newId, type CustomerResponse, type OldGoldTreatment } from "@jewellery/shared";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import CustomerPicker from "../customers/CustomerPicker";
import { useDebounced } from "../customers/useDebounced";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { navigate } from "../router";
import { niceDate, getApplicable } from "../rates/api";
import { searchInvoices } from "../invoice/api";
import { createOldGold, getOldGold, listOldGold, openOrdersOf, voidOldGold } from "./api";

const DEFAULT_PURITY: Record<string, string> = { "22K": "91.60", "24K": "99.90", other: "" };

type Row = { description: string; gross: string; less: string; karat: "22K" | "24K" | "other"; purity: string; rate: string };
const blankRow = (): Row => ({ description: "Old Gold", gross: "", less: "", karat: "22K", purity: DEFAULT_PURITY["22K"]!, rate: "" });

/** "75.26" -> 7526 basis points, exact. Null if not a valid percentage with at most 2 decimals. */
function purityBps(text: string): number | null {
  const t = text.trim().replace("%", "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

export function OldGoldListPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ id: string; receiptNo: string; receiptDate: string; customerName: string; finalPaise: number; treatment: OldGoldTreatment; voided: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const query = useDebounced(q, 250);
  useEffect(() => {
    listOldGold(query).then((r) => (setItems(r.items), setError(null))).catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, [query]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Old gold purchases</h1>
        {can("oldgold.create") && <button className={`${btnPrimary} ${pcOnly}`} onClick={() => navigate("/old-gold/new")}>New receipt</button>}
      </div>
      <input className={inputClass} type="search" placeholder="Search by receipt number or customer" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search old gold" />
      {error && <Alert>{error}</Alert>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[32rem]">
          <thead className="bg-stone-100 text-left text-stone-600"><tr><th className="px-3 py-2 font-medium">Receipt</th><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Seller</th><th className="px-3 py-2 font-medium">Settled as</th><th className="px-3 py-2 font-medium text-right">Final amount</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/old-gold/${r.id}`)}>
                <td className="px-3 py-2"><a className="font-medium hover:underline" href={`#/old-gold/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.receiptNo}</a>{r.voided && <span className="ml-2 text-xs text-red-700 border border-red-200 rounded px-1">voided</span>}</td>
                <td className="px-3 py-2">{niceDate(r.receiptDate)}</td>
                <td className="px-3 py-2">{r.customerName}</td>
                <td className="px-3 py-2">{OLD_GOLD_STATUS[r.treatment]}</td>
                <td className="px-3 py-2 text-right">{formatMoney(r.finalPaise)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-stone-500">No old gold receipts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NewOldGoldPage() {
  // Spec 017 R8: opened from an invoice's settlement page, the seller and invoice are filled in.
  const [prefill] = useState<{ customerId: string; invoiceId: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem("oldGoldPrefill");
      sessionStorage.removeItem("oldGoldPrefill");
      return raw ? (JSON.parse(raw) as { customerId: string; invoiceId: string }) : null;
    } catch {
      return null;
    }
  });
  const [customer, setCustomer] = useState<CustomerResponse | null>(null);
  useEffect(() => {
    if (!prefill) return;
    api<CustomerResponse>(`/api/customers/${prefill.customerId}`).then(setCustomer).catch(() => undefined);
    setTreatment("invoice_adjustment");
    setInvoiceId(prefill.invoiceId);
  }, [prefill]);
  const [date, setDate] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [treatment, setTreatment] = useState<OldGoldTreatment>("advance");
  const [direct, setDirect] = useState("");
  const [advance, setAdvance] = useState("");
  const [invoiceAmt, setInvoiceAmt] = useState("");
  const [invoices, setInvoices] = useState<{ id: string; invoiceNo: string; balanceDuePaise: number }[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [orders, setOrders] = useState<{ id: string; orderNo: string; status: string }[]>([]);
  const [orderId, setOrderId] = useState("");
  const [payoutMode, setPayoutMode] = useState<"bank_transfer" | "upi" | "cheque">("bank_transfer");
  const [payoutRef, setPayoutRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [id] = useState(() => newId());

  useEffect(() => { getApplicable().then((a) => setDate(a.date)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!customer) return setInvoices([]), setOrders([]);
    searchInvoices("", { customerId: customer.id, status: "active" }).then((r) => setInvoices(r.items.filter((i) => i.balanceDuePaise > 0))).catch(() => setInvoices([]));
    openOrdersOf(customer.id).then((r) => setOrders(r.items.filter((o) => o.status === "open"))).catch(() => setOrders([]));
  }, [customer]);

  /** Each row as the server will see it, or the first problem. */
  const parsed = useMemo(() => {
    const problems: string[] = [];
    const out = rows.map((r, i) => {
      const gross = parseWeightGrams(r.gross);
      const less = r.less.trim() ? parseWeightGrams(r.less) : ({ ok: true, mg: 0 } as const);
      const bps = purityBps(r.purity);
      const rate = parseRateInput(r.rate, "gram");
      if (!gross.ok) problems.push(`Row ${i + 1}: ${gross.message}`);
      if (!less.ok) problems.push(`Row ${i + 1}: ${less.message}`);
      if (bps === null || bps <= 0 || bps > 10000) problems.push(`Row ${i + 1}: purity must be more than 0% and at most 100%`);
      if (!rate.ok) problems.push(`Row ${i + 1}: ${rate.message}`);
      if (gross.ok && less.ok && gross.mg <= less.mg) problems.push(`Row ${i + 1}: less must be less than gross`);
      return { gross: gross.ok ? gross.mg : 0, less: less.ok ? less.mg : 0, bps: bps ?? 0, rate: rate.ok ? rate.paisePerKg : 0, ok: gross.ok && less.ok && gross.ok && bps !== null && rate.ok && gross.mg > less.mg };
    });
    return { rows: out, problems, allOk: out.every((r) => r.ok) && problems.length === 0 };
  }, [rows]);

  const calc = useMemo(() => {
    if (!parsed.allOk) return null;
    const r = calculateOldGold(parsed.rows.map((x) => ({ netMg: x.gross - x.less, purityBps: x.bps, rateKgPaise: x.rate })));
    return r.ok ? r.result : null;
  }, [parsed]);

  const rupees = (t: string) => { const p = parseRateInput(t, "kg"); return p.ok ? p.paisePerKg : t.trim() ? null : 0; };
  const directP = rupees(direct), advanceP = rupees(advance), invoiceP = rupees(invoiceAmt);
  const finalP = calc?.finalPaise ?? 0;
  const splitSum = (directP ?? 0) + (advanceP ?? 0) + (invoiceP ?? 0);
  const partsOk = treatment !== "split" || splitSum === finalP;

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setError(null);
    if (!customer) return setError("Choose the seller");
    if (!parsed.allOk || !calc) return setError(parsed.problems[0] ?? "Check the rows");
    const body: Record<string, unknown> = {
      id,
      date,
      customerId: customer.id,
      treatment,
      rows: parsed.rows.map((r, i) => ({ description: rows[i]!.description || "Old Gold", grossMg: r.gross, lessMg: r.less, karat: rows[i]!.karat, purityBps: r.bps, rateKgPaise: r.rate })),
      remarks: remarks || undefined,
    };
    if (treatment === "direct_payment") { body.directPaise = finalP; body.payoutMode = payoutMode; body.payoutReference = payoutRef || undefined; }
    if (treatment === "advance") { body.advancePaise = finalP; if (orderId) body.orderId = orderId; }
    if (treatment === "invoice_adjustment") { body.invoiceAdjustPaise = finalP; body.invoiceId = invoiceId; }
    if (treatment === "split") {
      if (!partsOk) return setError(`The three amounts must add up to ${formatMoney(finalP)}`);
      body.directPaise = directP ?? 0; body.advancePaise = advanceP ?? 0; body.invoiceAdjustPaise = invoiceP ?? 0;
      if ((directP ?? 0) > 0) { body.payoutMode = payoutMode; body.payoutReference = payoutRef || undefined; }
      if (invoiceId) body.invoiceId = invoiceId;
      if (orderId) body.orderId = orderId;
    }
    setBusy(true);
    try {
      const r = await createOldGold(body);
      navigate(`/old-gold/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the receipt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">New old gold receipt</h1>
      <div className="md:hidden"><Alert kind="info">Old gold receipts are made on the PC. This phone view is read-only.</Alert></div>
      <div className={`${pcOnly} flex flex-col gap-5`}>
        <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
          <h2 className="font-semibold">Seller</h2>
          {customer ? (<p className="text-sm">{customer.name} <button className="underline ml-2" onClick={() => setCustomer(null)}>Change</button></p>) : <CustomerPicker onPick={setCustomer} />}
          <Field label="Date"><input className={`${inputClass} w-44`} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </section>

        <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
          <h2 className="font-semibold">Old gold</h2>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead className="text-left text-stone-600"><tr>{["Description", "Gross g", "Less g", "Net g", "Karat", "Purity %", "Rate / g", "Amount", ""].map((h) => <th key={h} className="pr-2 pb-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = parsed.rows[i]!;
                  const amount = calc ? calc.rows[i]?.amountPaise : undefined;
                  return (
                    <tr key={i} className="align-top">
                      <td className="pr-2 pb-2"><input className={`${inputClass} w-32`} value={r.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Description row ${i + 1}`} /></td>
                      <td className="pr-2 pb-2"><input className={`${inputClass} w-24`} value={r.gross} onChange={(e) => set(i, { gross: e.target.value })} aria-label={`Gross g row ${i + 1}`} placeholder="25.00" /></td>
                      <td className="pr-2 pb-2"><input className={`${inputClass} w-24`} value={r.less} onChange={(e) => set(i, { less: e.target.value })} aria-label={`Less g row ${i + 1}`} placeholder="2.02" /></td>
                      <td className="pr-2 pb-2 pt-2 whitespace-nowrap">{p.gross > p.less ? formatWeightGrams(p.gross - p.less) : "-"}</td>
                      <td className="pr-2 pb-2">
                        <select className={`${inputClass} w-24`} value={r.karat} onChange={(e) => { const k = e.target.value as Row["karat"]; set(i, { karat: k, purity: DEFAULT_PURITY[k] ?? "" }); }} aria-label={`Karat row ${i + 1}`}>
                          <option value="22K">22K</option><option value="24K">24K</option><option value="other">Other</option>
                        </select>
                      </td>
                      <td className="pr-2 pb-2"><input className={`${inputClass} w-24`} value={r.purity} onChange={(e) => set(i, { purity: e.target.value })} aria-label={`Purity row ${i + 1}`} /></td>
                      <td className="pr-2 pb-2"><input className={`${inputClass} w-28`} value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} aria-label={`Rate row ${i + 1}`} placeholder="14,800" /></td>
                      <td className="pr-2 pb-2 pt-2 whitespace-nowrap text-right">{amount !== undefined ? formatMoney(amount) : "-"}</td>
                      <td className="pb-2"><button className="px-2 py-2 text-sm text-stone-600 hover:text-red-700 disabled:opacity-30" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove row ${i + 1}`}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div><button className={btnSecondary} disabled={rows.length >= 10} onClick={() => setRows((rs) => [...rs, blankRow()])}>Add row</button></div>
          <p className="text-xs text-stone-500">Amount = net weight x purity % x rate. Type the rate per gram for this receipt. Nothing is taken from today's rates.</p>
          {calc && (
            <dl className="ml-auto text-sm flex flex-col gap-1 w-full max-w-sm">
              <div className="flex justify-between"><dt>Original amount</dt><dd>{formatMoney(calc.originalPaise)}</dd></div>
              <div className="flex justify-between"><dt>Round off</dt><dd>{formatMoney(calc.roundOffPaise)}</dd></div>
              <div className="flex justify-between font-semibold text-base border-t pt-1"><dt>Final amount</dt><dd>{formatMoney(calc.finalPaise)}</dd></div>
              <p className="text-xs text-stone-600">{amountInWords(calc.finalPaise)}</p>
            </dl>
          )}
          {parsed.problems.length > 0 && rows.some((r) => r.gross || r.rate) && <Alert kind="info">{parsed.problems[0]}</Alert>}
        </section>

        <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
          <h2 className="font-semibold">Settlement</h2>
          <fieldset className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={treatment === "advance"} onChange={() => setTreatment("advance")} /> Keep as the customer's advance</label>
            <label className="flex items-center gap-2"><input type="radio" checked={treatment === "direct_payment"} onChange={() => setTreatment("direct_payment")} /> Pay the customer now (bank transfer, UPI or cheque)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={treatment === "invoice_adjustment"} onChange={() => setTreatment("invoice_adjustment")} disabled={!customer} /> Use it against an invoice</label>
            <label className="flex items-center gap-2"><input type="radio" checked={treatment === "split"} onChange={() => setTreatment("split")} /> Split between these</label>
          </fieldset>
          {(treatment === "invoice_adjustment" || treatment === "split") && (
            <Field label="Invoice">
              <select className={inputClass} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                <option value="">Choose an invoice</option>
                {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNo} · owes {formatMoney(i.balanceDuePaise)}</option>)}
              </select>
            </Field>
          )}
          {(treatment === "advance" || treatment === "split") && orders.length > 0 && (
            <Field label="Order (optional)">
              <select className={inputClass} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">No order</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNo}</option>)}
              </select>
            </Field>
          )}
          {treatment === "split" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Paid now (₹)"><input className={inputClass} value={direct} onChange={(e) => setDirect(e.target.value)} /></Field>
              <Field label="Kept as advance (₹)"><input className={inputClass} value={advance} onChange={(e) => setAdvance(e.target.value)} /></Field>
              <Field label="Used on invoice (₹)"><input className={inputClass} value={invoiceAmt} onChange={(e) => setInvoiceAmt(e.target.value)} /></Field>
              {calc && <p className={`text-sm sm:col-span-3 ${partsOk ? "text-green-700" : "text-red-700"}`}>{partsOk ? "The three amounts add up." : `They add up to ${formatMoney(splitSum)}; the final amount is ${formatMoney(finalP)}.`}</p>}
            </div>
          )}
          {(treatment === "direct_payment" || (treatment === "split" && (directP ?? 0) > 0)) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Paid by"><select className={inputClass} value={payoutMode} onChange={(e) => setPayoutMode(e.target.value as typeof payoutMode)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select></Field>
              <Field label="Reference"><input className={inputClass} value={payoutRef} onChange={(e) => setPayoutRef(e.target.value)} /></Field>
            </div>
          )}
          <Field label="Remarks (optional)"><input className={inputClass} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </section>

        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={() => navigate("/old-gold")}>Cancel</button>
          <button className={btnPrimary} disabled={busy || !calc} onClick={() => void save()}>{busy ? "Saving..." : "Save receipt"}</button>
        </div>
      </div>
    </div>
  );
}

export function OldGoldPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [r, setR] = useState<Awaited<ReturnType<typeof getOldGold>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const load = () => getOldGold(id).then(setR).catch((e) => setError(e instanceof ApiError && e.status === 404 ? "Receipt not found." : "Could not load the receipt"));
  useEffect(() => void load(), [id]);
  async function doVoid() {
    if (!reason.trim()) return setReasonError("Please give a reason");
    try { setR(await voidOldGold(id, reason.trim())); setVoiding(false); } catch (e) { setReasonError(e instanceof ApiError ? e.message : "Could not void"); }
  }
  if (error) return <Alert>{error}</Alert>;
  if (!r) return <p className="text-stone-500">Loading...</p>;
  return (
    <div className="flex flex-col gap-4">
      <a href="#/old-gold" className="text-sm text-stone-600 underline">All old gold receipts</a>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{r.receiptNo}{r.voided && <span className="ml-3 text-sm text-red-700 border border-red-200 rounded px-1.5 py-0.5 align-middle">voided</span>}</h1>
          <p className="text-stone-500 text-sm">{niceDate(r.receiptDate)} · {r.payer.name} · {r.status}</p>
          {r.voided && <p className="text-red-700 text-sm">Voided: {r.voidReason}</p>}
        </div>
        <div className={`flex gap-2 ${pcOnly}`}>
          <button className={btnSecondary} onClick={() => navigate(`/print/old-gold/${r.id}`)}>Print receipt</button>
          {!r.voided && can("oldgold.void") && <button className={btnSecondary} onClick={() => setVoiding(true)}>Void receipt</button>}
        </div>
      </div>
      <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-900">Stock and GST for old gold are not posted until the CA decides.</p>
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left text-stone-600"><tr><th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Description</th><th className="px-3 py-2 font-medium text-right">Gross g</th><th className="px-3 py-2 font-medium text-right">Less g</th><th className="px-3 py-2 font-medium text-right">Net g</th><th className="px-3 py-2 font-medium text-right">Purity %</th><th className="px-3 py-2 font-medium text-right">Rate / g</th><th className="px-3 py-2 font-medium text-right">Amount</th></tr></thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.lineNo} className="border-t border-stone-100">
                <td className="px-3 py-2">{x.lineNo}</td><td className="px-3 py-2">{x.description}</td>
                <td className="px-3 py-2 text-right">{formatWeightGrams(x.grossMg)}</td><td className="px-3 py-2 text-right">{formatWeightGrams(x.lessMg)}</td><td className="px-3 py-2 text-right">{formatWeightGrams(x.netMg)}</td>
                <td className="px-3 py-2 text-right">{(x.purityBps / 100).toFixed(2)}</td><td className="px-3 py-2 text-right">{formatPerGram(x.rateKgPaise)}</td><td className="px-3 py-2 text-right">{formatMoney(x.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="bg-white border border-stone-200 rounded-xl px-4 py-2 grid sm:grid-cols-3 gap-x-6">
        <div className="py-1.5"><dt className="text-sm text-stone-500">Original amount</dt><dd>{formatMoney(r.originalPaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Round off</dt><dd>{formatMoney(r.roundOffPaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Final amount</dt><dd className="font-semibold">{formatMoney(r.finalPaise)}</dd></div>
      </dl>
      <p className="text-sm text-stone-700">{amountInWords(r.finalPaise)}</p>
      <dl className="bg-white border border-stone-200 rounded-xl px-4 py-2 grid sm:grid-cols-2 gap-x-6">
        <div className="py-1.5"><dt className="text-sm text-stone-500">Settled as</dt><dd>{r.treatmentLabel}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Settlement note</dt><dd>{r.settlementNote}</dd></div>
        {r.payment && <div className="py-1.5"><dt className="text-sm text-stone-500">Advance receipt</dt><dd><a className="underline" href={`#/payments/${r.payment.id}`}>{r.payment.receiptNo}</a> · {formatMoney(r.payment.remainingPaise)} still held</dd></div>}
        {r.payouts.map((p) => <div key={p.id} className="py-1.5"><dt className="text-sm text-stone-500">Paid to customer</dt><dd>{formatMoney(p.amountPaise)} by {p.mode.replace("_", " ")}{p.reference ? ` · ${p.reference}` : ""}</dd></div>)}
      </dl>
      {voiding && (
        <Modal title="Void this receipt?" onClose={() => setVoiding(false)}>
          <p className="text-sm text-stone-600">The receipt number is kept. Its advance and any payouts are voided. Refused if its advance has already been used.</p>
          <Field label="Reason *" error={reasonError ?? undefined}><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="flex gap-2 justify-end"><button className={btnSecondary} onClick={() => setVoiding(false)}>Cancel</button><button className={btnPrimary} onClick={() => void doVoid()}>Void receipt</button></div>
        </Modal>
      )}
    </div>
  );
}
