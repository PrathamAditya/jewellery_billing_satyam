import { useEffect, useMemo, useState, type FormEvent } from "react";
import { calculateCreditNote, type InvoiceResult } from "@jewellery/calc";
import { CREDIT_NOTE_KIND_LABEL, formatMoney, indiaDate, parseRupeesToPaise, type CreditNoteKind, type InvoiceResponse } from "@jewellery/shared";
import { ApiError, api } from "../api";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { navigate } from "../router";
import { createCreditNote } from "./api";

type StoredCalc = InvoiceResult;

/**
 * Spec 019d section 4: returns, exchanges and old gold adjustments against one bill. The preview uses the same
 * pure calculation as the server; the server recalculates on save and its figures are the saved ones.
 */
export default function CreditNoteDialog({ invoice, onClose }: { invoice: InvoiceResponse; onClose: () => void }) {
  const calc = invoice.calc as StoredCalc;
  const [kind, setKind] = useState<CreditNoteKind>("credit");
  const [date, setDate] = useState(indiaDate());
  const [reason, setReason] = useState("");
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [replacementId, setReplacementId] = useState("");
  const [ogpId, setOgpId] = useState("");
  const [candidates, setCandidates] = useState<{ id: string; invoiceNo: string; balanceDuePaise: number }[]>([]);
  const [receipts, setReceipts] = useState<{ id: string; receiptNo: string; finalPaise: number; treatment: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!invoice.customerId) return;
    void api<{ items: { id: string; invoiceNo: string; balanceDuePaise: number; voidedAt: string | null }[] }>(`/api/invoices?customerId=${invoice.customerId}`)
      .then((r) => setCandidates(r.items.filter((i) => i.id !== invoice.id && !i.voidedAt).map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, balanceDuePaise: i.balanceDuePaise }))))
      .catch(() => setCandidates([]));
    void api<{ items: { id: string; receiptNo: string; finalPaise: number; treatment: string }[] }>(`/api/old-gold?customerId=${invoice.customerId}&status=active`)
      .then((r) => setReceipts(r.items.filter((i) => i.treatment === "invoice_adjustment")))
      .catch(() => setReceipts([]));
  }, [invoice.id, invoice.customerId]);

  // The preview: parse each typed value and run the same calculation the server runs.
  const parsed = useMemo(() => {
    const lines: { invoiceLineNo: number; taxablePaise: number; error?: string }[] = [];
    calc.lines.forEach((_, i) => {
      const lineNo = i + 1;
      const text = amounts[lineNo] ?? "";
      if (!text.trim()) return;
      const p = parseRupeesToPaise(text, `value for line ${lineNo}`);
      lines.push(p.ok ? { invoiceLineNo: lineNo, taxablePaise: p.value } : { invoiceLineNo: lineNo, taxablePaise: 0, error: p.message });
    });
    return lines;
  }, [amounts, calc.lines]);
  const lineErrors = parsed.filter((p) => p.error);
  const preview = useMemo(() => {
    const good = parsed.filter((p) => !p.error);
    if (good.length === 0) return null;
    const rates = new Map(calc.lines.map((l, i) => [i + 1, l.gstRateBps] as const));
    const out = calculateCreditNote({ taxMode: invoice.taxMode, lines: good.map((p) => ({ taxablePaise: p.taxablePaise, gstRateBps: rates.get(p.invoiceLineNo) ?? 0 })) });
    return out.ok ? out.result : null;
  }, [parsed, calc.lines, invoice.taxMode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setFieldErr({});
    if (lineErrors.length) {
      setFieldErr({ lines: lineErrors[0]!.error! });
      return;
    }
    if (parsed.length === 0) return setErr("Type the returned value on at least one line.");
    if (!reason.trim()) return setFieldErr({ reason: "Please give a reason" });
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        invoiceId: invoice.id,
        cnDate: date,
        kind,
        lines: parsed.map((p) => ({ invoiceLineNo: p.invoiceLineNo, taxablePaise: p.taxablePaise })),
        reason: reason.trim(),
      };
      if (kind === "exchange") body.replacementInvoiceId = replacementId;
      if (kind === "old_gold") body.ogpId = ogpId;
      const saved = await createCreditNote(body);
      navigate(`/credit-notes/${saved.id}`);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not save the credit note. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Credit note against ${invoice.invoiceNo}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 text-sm">
        {err && <Alert>{err}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Kind">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as CreditNoteKind)}>
              {(Object.keys(CREDIT_NOTE_KIND_LABEL) as CreditNoteKind[]).map((k) => (
                <option key={k} value={k}>{CREDIT_NOTE_KIND_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Credit note date" hint="Between the bill's date and today">
            <input type="date" className={inputClass} value={date} min={invoice.invoiceDate} max={indiaDate()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Reason" error={fieldErr.reason}>
            <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Chain returned, wrong size" />
          </Field>
        </div>

        {kind === "exchange" && (
          <Field label="Replacement invoice (the new goods, same customer)" hint="Create it first from New invoice, then come back here">
            <select className={inputClass} value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
              <option value="">Choose an invoice</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.invoiceNo} (due {formatMoney(c.balanceDuePaise)})</option>
              ))}
            </select>
          </Field>
        )}
        {kind === "old_gold" && (
          <Field label="Old gold receipt (invoice adjustment against this bill)" hint="Record it from this bill's settlement first, with the same amount">
            <select className={inputClass} value={ogpId} onChange={(e) => setOgpId(e.target.value)}>
              <option value="">Choose a receipt</option>
              {receipts.map((r) => (
                <option key={r.id} value={r.id}>{r.receiptNo} ({formatMoney(r.finalPaise)}, {r.treatment.replace("_", " ")})</option>
              ))}
            </select>
          </Field>
        )}

        <div>
          <div className="font-medium mb-1">Returned lines</div>
          <p className="text-xs text-stone-500 mb-2">Type the value of the goods returned, before GST, for each line. Leave a line empty if it is not returned.</p>
          {fieldErr.lines && <p className="text-red-700 text-xs mb-2">{fieldErr.lines}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1">#</th>
                  <th>Description</th>
                  <th className="text-right">GST</th>
                  <th className="text-right">Value on bill</th>
                  <th className="text-right">Return value (₹)</th>
                </tr>
              </thead>
              <tbody>
                {calc.lines.map((l, i) => {
                  const lineNo = i + 1;
                  const row = invoice.lines.find((x) => x.lineNo === lineNo);
                  return (
                    <tr key={lineNo} className="border-t border-stone-100">
                      <td className="py-1">{lineNo}</td>
                      <td>{row?.description || "Line"}</td>
                      <td className="text-right">{(l.gstRateBps / 100).toFixed(2)}%</td>
                      <td className="text-right">{formatMoney(l.taxablePaise)}</td>
                      <td className="text-right">
                        <input
                          className={`${inputClass} w-32 text-right`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={amounts[lineNo] ?? ""}
                          onChange={(e) => setAmounts((a) => ({ ...a, [lineNo]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-stone-50 rounded-lg p-3 flex flex-wrap gap-x-6 gap-y-1">
          {preview ? (
            <>
              <span>Taxable <strong>{formatMoney(preview.taxablePaise)}</strong></span>
              <span>GST <strong>{formatMoney(preview.taxPaise)}</strong></span>
              <span>Round-off <strong>{formatMoney(preview.roundOffPaise)}</strong></span>
              <span>Credit note <strong>{formatMoney(preview.amountPaise)}</strong></span>
            </>
          ) : (
            <span className="text-stone-500">Type a return value to see the amount.</span>
          )}
        </div>
        <p className="text-xs text-stone-500">Stock is not updated yet (spec 021). The bill's balance and the customer's ledger are updated when the credit note is saved.</p>

        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>Save credit note</button>
        </div>
      </form>
    </Modal>
  );
}
