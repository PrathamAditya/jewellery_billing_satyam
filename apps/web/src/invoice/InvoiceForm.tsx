import { useEffect, useMemo, useRef, useState } from "react";
import { calculateInvoice, type TaxMode } from "@jewellery/calc";
import { blankDiscounts, discountTextsFrom, newId, parseDiscountTexts, type ApplicableRatesResponse, type BulkItemResponse, type CustomerResponse, type DiscountTexts, type InvoiceResponse } from "@jewellery/shared";
import { ApiError, api } from "../api";
import CustomerPicker from "../customers/CustomerPicker";
import { Alert, Field, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { getApplicable } from "../rates/api";
import Breakdown from "./Breakdown";
import DiscountsEditor from "./DiscountsEditor";
import LinesEditor from "./LinesEditor";
import { createInvoice, createPendingInvoice, updateInvoice } from "./api";
import { blankLine, isTouched, lineTextFromSaved, parseLine, parsePendingLine, type LineText } from "./lines";

type Props = { invoice?: InvoiceResponse; onSaved: (i: InvoiceResponse) => void; onCancel: () => void };

const joinAddress = (c: CustomerResponse) => [c.address, [c.city, c.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");

/** New invoice and edit invoice (spec 013). Totals shown here are a preview: the server recalculates on save (R2). */
export default function InvoiceForm({ invoice, onSaved, onCancel }: Props) {
  const editing = !!invoice;
  const [today, setToday] = useState("");
  const [date, setDate] = useState(invoice?.invoiceDate ?? "");
  const [rates, setRates] = useState<ApplicableRatesResponse["rates"] | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(invoice?.customerId ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState(invoice?.customerName ?? "");
  const [mobile, setMobile] = useState(invoice?.customerMobile ?? "");
  const [address, setAddress] = useState(invoice?.customerAddress ?? "");
  const [pan, setPan] = useState(invoice?.customerPan ?? "");
  const [taxMode, setTaxMode] = useState<TaxMode>(invoice?.taxMode ?? "intra");
  const [reverseCharge, setReverseCharge] = useState(invoice?.reverseCharge ?? false);
  const [remarks, setRemarks] = useState(invoice?.remarks ?? "");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<LineText[]>(invoice ? invoice.lines.map(lineTextFromSaved) : [blankLine("22K916")]);
  // Spec 019c: a new sale whose gold rate is fixed when the customer pays. Not offered when editing.
  const [rateLater, setRateLater] = useState(false);
  // Spec 012c R4: the three discount rows. Empty means no discount.
  const [discounts, setDiscounts] = useState<DiscountTexts>(invoice ? discountTextsFrom(invoice.discounts) : blankDiscounts());
  // Spec 021: the bulk items for the optional Stock cell of each line.
  const [bulkItems, setBulkItems] = useState<BulkItemResponse[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One id per form: a double click or a retry cannot save two invoices (R9).
  const clientId = useRef(newId());

  useEffect(() => {
    getApplicable()
      .then((a) => {
        setToday(a.date);
        setDate((d) => d || a.date);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    api<{ items: BulkItemResponse[] }>("/api/inventory/bulk")
      .then((r) => setBulkItems(r.items))
      .catch(() => setBulkItems([]));
  }, []);
  useEffect(() => {
    if (!date) return;
    getApplicable(date)
      .then((a) => setRates(a.rates))
      .catch(() => setRates(null));
  }, [date]);

  const active = useMemo(() => rows.map((t, i) => ({ t, i, p: parseLine(t) })).filter(({ t }) => isTouched(t)), [rows]);
  const allParsed = active.length > 0 && active.every(({ p }) => p.input);
  const discountParse = useMemo(() => parseDiscountTexts(discounts), [discounts]);
  const discountsOk = Object.keys(discountParse.errors).length === 0;
  const preview = useMemo(
    () => (!rateLater && allParsed && discountsOk ? calculateInvoice({ taxMode, lines: active.map(({ p }) => p.input!), discounts: discountParse.discounts }) : null),
    [rateLater, allParsed, discountsOk, taxMode, active, discountParse],
  );
  // Spec 019c: the same touched rows, read for a sale whose rate is fixed later.
  const pendingRows = useMemo(() => rows.map((t, i) => ({ t, i, p: parsePendingLine(t) })).filter(({ t }) => isTouched(t)), [rows]);
  const pendingAllOk = pendingRows.length > 0 && pendingRows.every(({ p }) => p.input);
  const touchedRows = rateLater ? pendingRows : active;

  function pick(c: CustomerResponse) {
    setCustomerId(c.id);
    setPicked(`${c.customerNo} ${c.name}`);
    setName(c.name);
    setMobile(c.mobile ?? "");
    setAddress(joinAddress(c));
    setPan(c.pan ?? "");
  }

  async function save() {
    setFormError(null);
    setFieldErrors({});
    setRowErrors({});
    if (rateLater) {
      // Spec 021 S4: a sale whose rate is fixed later takes no stock. Its Stock cells are not shown, so say so here.
      if (rows.some((r) => r.stockKind !== "none")) return setFormError("A sale whose rate is fixed later takes no stock yet. Switch to Fixed now and clear the Stock cells first.");
      if (!pendingAllOk) return setFormError("Fix the highlighted boxes on the lines first.");
      if (!customerId) return setFormError("Pick the saved customer. A sale whose rate is fixed later is kept against the customer.");
    } else {
      if (!allParsed) return setFormError("Fix the highlighted boxes on the lines first.");
      if (!discountsOk) return setFormError("Fix the discount amounts first.");
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      invoiceDate: date,
      customerId,
      customerName: name,
      customerMobile: mobile,
      customerAddress: address,
      customerPan: pan,
      taxMode,
      reverseCharge,
      remarks,
      lines: rateLater ? pendingRows.map(({ p }) => p.input) : active.map(({ p }) => p.input),
      discounts: rateLater ? undefined : discountParse.discounts,
    };
    try {
      const saved = rateLater
        ? await createPendingInvoice({ ...body, id: clientId.current })
        : editing
          ? await updateInvoice(invoice!.id, { ...body, expectedRevision: invoice!.revisionNo, reason: reason.trim() || undefined })
          : await createInvoice({ ...body, id: clientId.current });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "validation") {
        const issues = (e.body as unknown as { issues: { field: string; message: string }[] }).issues;
        const f: Record<string, string> = {};
        const r: Record<number, string[]> = {};
        for (const i of issues) {
          const m = /^lines\.(\d+)\./.exec(i.field);
          if (m) (r[touchedRows[Number(m[1]) - 1]?.i ?? 0] ??= []).push(i.message);
          else f[i.field] = i.message;
        }
        setFieldErrors(f);
        setRowErrors(r);
      } else if (e instanceof ApiError && (e.body.error === "item_not_in_stock" || e.body.error === "insufficient_quantity")) {
        // Spec 021 S5, S7: the stock on one line is not there. The line is marked and named.
        const lineNo = (e.body as { lineNo?: number }).lineNo ?? 1;
        const row = touchedRows[lineNo - 1]?.i ?? 0;
        setRowErrors({ [row]: [e.message] });
        setFormError(`Line ${lineNo}: ${e.message}`);
      } else if (e instanceof ApiError && e.body.error === "calculation") {
        const errors = (e.body as unknown as { errors: { line: number | null; message: string }[] }).errors;
        const r: Record<number, string[]> = {};
        const general: string[] = [];
        for (const er of errors) {
          if (er.line === null) general.push(er.message);
          else (r[touchedRows[er.line - 1]?.i ?? 0] ??= []).push(er.message.replace(/^Line \d+: /, ""));
        }
        setRowErrors(r);
        if (general.length) setFormError(general.join(" "));
      } else {
        setFormError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => fieldErrors[k];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{editing ? `Edit ${invoice!.invoiceNo}` : "New invoice"}</h1>

      <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-4">
        <h2 className="font-semibold">Customer</h2>
        {!picked && !customerId && <CustomerPicker onPick={pick} autoFocus={!editing} />}
        {(picked || customerId) && (
          <p className="text-sm">
            Saved customer: <strong>{picked ?? name}</strong>{" "}
            <button className="underline ml-2" onClick={() => (setCustomerId(null), setPicked(null))}>
              Change
            </button>
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name *" error={err("customerName")}>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Mobile" error={err("customerMobile")}>
            <input className={inputClass} value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" autoComplete="off" />
          </Field>
          <Field label="Address" error={err("customerAddress")}>
            <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="PAN" error={err("customerPan")}>
            <input className={`${inputClass} uppercase`} value={pan} onChange={(e) => setPan(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <p className="text-xs text-stone-500">These details are copied onto the invoice. Changing the customer later does not change this invoice.</p>
      </section>

      <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex gap-4 flex-wrap items-end">
          {!editing && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Rate</span>
              <div className="flex">
                {([false, true] as const).map((later) => (
                  <button
                    key={String(later)}
                    type="button"
                    onClick={() => setRateLater(later)}
                    aria-pressed={rateLater === later}
                    className={`px-3 py-2 border first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 ${rateLater === later ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300"}`}
                  >
                    {later ? "Fixed when paid (credit)" : "Fixed now"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Invoice date" error={err("invoiceDate")}>
            <input className={`${inputClass} w-44`} type="date" value={date} max={today || undefined} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Sale is</span>
            <div className="flex">
              {(["intra", "inter"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTaxMode(m)}
                  aria-pressed={taxMode === m}
                  className={`px-3 py-2 border first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 ${taxMode === m ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300"}`}
                >
                  {m === "intra" ? "Same state (CGST + SGST)" : "Other state (IGST)"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />
            Reverse charge
          </label>
        </div>
        {today && date && date !== today && <Alert kind="info">This is not today's date. The invoice number comes from this date's financial year.</Alert>}
        {!rateLater && rates && date && Object.values(rates).every((r) => !r) && <Alert kind="info">No rates are saved yet for this date. Type the gold rate on each line.</Alert>}
        {rateLater && <Alert kind="info">Rate pending: the gold rate is not typed now. It is fixed when the customer pays, using that day's rate. The sale needs a saved customer.</Alert>}
        <LinesEditor rows={rows} onChange={setRows} rowErrors={rowErrors} rates={rates} showPurity pendingRate={rateLater} bulkItems={bulkItems} />
        {err("lines") && <Alert>{err("lines")}</Alert>}
        {rateLater ? (
          <p className="text-xs text-stone-500">Gross defaults to net when left blank. Rates are typed per gram. Labour is typed now and fixed with the sale.</p>
        ) : (
          <p className="text-xs text-stone-500">Choosing a purity fills today's rate. You can overtype it. Gross defaults to net when left blank. Rates are typed per gram.</p>
        )}
        {!rateLater && <DiscountsEditor value={discounts} onChange={setDiscounts} />}
      </section>

      {rateLater && <p className="text-stone-600 text-sm">Amount and GST are worked out when the rate is fixed. Chargeable weight: net plus polish, shown on the invoice.</p>}
      {!rateLater && preview?.ok && <Breakdown r={preview.result} descriptions={active.map(({ t }) => t.description)} />}
      {!rateLater && preview && !preview.ok && preview.errors.filter((e) => e.line === null).map((e) => <Alert key={e.code}>{e.message}</Alert>)}
      {!rateLater && !preview && <p className="text-stone-500">Type a net weight and a gold rate to see the totals.</p>}

      <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-4">
        <Field label="Remarks (internal, never printed)" error={err("remarks")}>
          <textarea className={inputClass} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {editing && (
          <Field label="Reason for this change (optional)">
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
          </Field>
        )}
      </section>

      {formError && <Alert>{formError}</Alert>}
      <div className="flex gap-2 justify-end">
        <button className={btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving..." : editing ? "Save changes" : rateLater ? "Save sale (rate pending)" : "Save invoice"}
        </button>
      </div>
    </div>
  );
}
