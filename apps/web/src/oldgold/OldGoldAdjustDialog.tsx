import { useEffect, useMemo, useState } from "react";
import { calculateOldGold } from "@jewellery/calc";
import { amountInWords, formatMoney, formatWeightGrams, newId, parseRateInput, parseWeightGrams, type OldGoldResponse } from "@jewellery/shared";
import { ApiError } from "../api";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { getApplicable } from "../rates/api";
import { createOldGold } from "./api";

const DEFAULT_PURITY: Record<string, string> = { "22K": "91.60", "24K": "99.90", other: "" };
type Row = { description: string; gross: string; less: string; karat: "22K" | "24K" | "other"; purity: string; rate: string };
const blankRow = (): Row => ({ description: "Old Gold", gross: "", less: "", karat: "22K", purity: DEFAULT_PURITY["22K"]!, rate: "" });

function purityBps(text: string): number | null {
  const t = text.trim().replace("%", "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

type Props = {
  invoice: { id: string; invoiceNo: string; customerId: string; customerName: string; balanceDuePaise: number };
  onClose: () => void;
  onSaved: (r: OldGoldResponse) => void;
};

/** Direct inline old gold adjustment modal on an invoice or its settlement page. */
export default function OldGoldAdjustDialog({ invoice, onClose, onSaved }: Props) {
  const [date, setDate] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [id] = useState(() => newId());

  useEffect(() => {
    getApplicable().then((a) => setDate(a.date)).catch(() => undefined);
  }, []);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

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
      return { gross: gross.ok ? gross.mg : 0, less: less.ok ? less.mg : 0, bps: bps ?? 0, rate: rate.ok ? rate.paisePerKg : 0, ok: gross.ok && less.ok && bps !== null && rate.ok && gross.mg > less.mg };
    });
    return { rows: out, problems, allOk: out.every((r) => r.ok) && problems.length === 0 };
  }, [rows]);

  const calc = useMemo(() => {
    if (!parsed.allOk) return null;
    const r = calculateOldGold(parsed.rows.map((x) => ({ netMg: x.gross - x.less, purityBps: x.bps, rateKgPaise: x.rate })));
    return r.ok ? r.result : null;
  }, [parsed]);

  const finalP = calc?.finalPaise ?? 0;
  const excess = Math.max(0, finalP - invoice.balanceDuePaise);
  const invAdjust = Math.min(finalP, invoice.balanceDuePaise);

  async function save() {
    setError(null);
    if (!date) return setError("Choose the date");
    if (!parsed.allOk || !calc) return setError(parsed.problems[0] ?? "Check the rows");
    if (invAdjust <= 0) return setError("This invoice has no balance due left.");

    const isSplit = excess > 0;
    const body: Record<string, unknown> = {
      id,
      date,
      customerId: invoice.customerId,
      treatment: isSplit ? "split" : "invoice_adjustment",
      invoiceId: invoice.id,
      invoiceAdjustPaise: invAdjust,
      advancePaise: isSplit ? excess : 0,
      directPaise: 0,
      rows: parsed.rows.map((r, i) => ({
        description: rows[i]!.description || "Old Gold",
        grossMg: r.gross,
        lessMg: r.less,
        karat: rows[i]!.karat,
        purityBps: r.bps,
        rateKgPaise: r.rate,
      })),
      remarks: remarks.trim() || undefined,
    };
    setBusy(true);
    try {
      const saved = await createOldGold(body);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save old gold adjustment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Adjust old gold on ${invoice.invoiceNo}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm flex flex-wrap gap-x-6 gap-y-1">
          <span>Customer: <strong>{invoice.customerName}</strong></span>
          <span>Balance due: <strong>{formatMoney(invoice.balanceDuePaise)}</strong></span>
        </div>
        <Field label="Date">
          <input className={`${inputClass} w-44`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
          {rows.map((r, i) => {
            const p = parsed.rows[i]!;
            const amt = calc ? calc.rows[i]?.amountPaise : undefined;
            return (
              <div key={i} className="border border-stone-200 rounded-lg p-3 bg-stone-50/40 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-stone-600">Item {i + 1}</span>
                  <div className="flex items-center gap-3">
                    {amt !== undefined && <span className="text-sm font-medium">{formatMoney(amt)}</span>}
                    <button type="button" className="text-xs text-stone-600 hover:text-red-700 disabled:opacity-30" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                  <Field label="Description">
                    <input className={inputClass} value={r.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Old gold description ${i + 1}`} />
                  </Field>
                  <Field label="Gross g *">
                    <input className={inputClass} value={r.gross} onChange={(e) => set(i, { gross: e.target.value })} placeholder="25.00" inputMode="decimal" aria-label={`Old gold gross ${i + 1}`} autoFocus={i === 0} />
                  </Field>
                  <Field label="Less g">
                    <input className={inputClass} value={r.less} onChange={(e) => set(i, { less: e.target.value })} placeholder="0" inputMode="decimal" aria-label={`Old gold less ${i + 1}`} />
                  </Field>
                  <Field label="Karat">
                    <select className={inputClass} value={r.karat} onChange={(e) => { const k = e.target.value as Row["karat"]; set(i, { karat: k, purity: DEFAULT_PURITY[k] ?? "" }); }} aria-label={`Old gold karat ${i + 1}`}>
                      <option value="22K">22K</option>
                      <option value="24K">24K</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="Purity % *">
                    <input className={inputClass} value={r.purity} onChange={(e) => set(i, { purity: e.target.value })} inputMode="decimal" aria-label={`Old gold purity ${i + 1}`} />
                  </Field>
                  <Field label="Rate / g *">
                    <input className={inputClass} value={r.rate} onChange={(e) => set(i, { rate: e.target.value })} placeholder="14,800" inputMode="decimal" aria-label={`Old gold rate ${i + 1}`} />
                  </Field>
                </div>
                {p.gross > p.less && <p className="text-xs text-stone-500">Net weight: {formatWeightGrams(p.gross - p.less)} g</p>}
              </div>
            );
          })}
        </div>
        <div>
          <button type="button" className={btnSecondary} disabled={rows.length >= 50} onClick={() => setRows((rs) => [...rs, blankRow()])}>
            Add row
          </button>
        </div>
        {calc && (
          <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm flex flex-col gap-1">
            <div className="flex justify-between"><span>Old gold value (rounded)</span><strong>{formatMoney(finalP)}</strong></div>
            <div className="text-xs text-stone-600">{amountInWords(finalP)}</div>
            <div className="flex justify-between"><span>Applied to {invoice.invoiceNo}</span><strong>{formatMoney(invAdjust)}</strong></div>
            {excess > 0 ? (
              <div className="flex justify-between text-amber-800"><span>Extra kept as customer advance (gets PAY- receipt)</span><strong>{formatMoney(excess)}</strong></div>
            ) : (
              <div className="flex justify-between"><span>Balance due after adjustment</span><strong>{formatMoney(Math.max(0, invoice.balanceDuePaise - invAdjust))}</strong></div>
            )}
          </div>
        )}
        {parsed.problems.length > 0 && rows.some((r) => r.gross || r.rate) && <Alert kind="info">{parsed.problems[0]}</Alert>}
        <Field label="Remarks (optional)">
          <input className={inputClass} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy || !calc} onClick={() => void save()}>
            {busy ? "Saving..." : "Adjust old gold"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
