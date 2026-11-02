import { polishWeightMg } from "@jewellery/calc";
import { PURITIES, PURITY_RATE_KIND, formatWeightGrams, paisePerKgToInput, parseWeightGrams, type ApplicableRatesResponse, type Purity } from "@jewellery/shared";
import { btnSecondary, inputClass } from "../customers/ui";
import { blankLine, isTouched, parseLine, parsePendingLine, type LineText } from "./lines";

type Props = {
  rows: LineText[];
  onChange: (rows: LineText[]) => void;
  /** Messages from the server's calculation for each row (by row index). */
  rowErrors?: Record<number, string[]>;
  /** Show the purity column and fill the gold rate from these day rates (spec 013 R8). */
  rates?: ApplicableRatesResponse["rates"] | null;
  showPurity?: boolean;
  /** Spec 019c: the sale's rate is fixed later. Gold, stone, total and pricing boxes are not shown. */
  pendingRate?: boolean;
};

/** The text boxes of a row (the selects and the GST output are handled separately). */
type BoxKey = "description" | "gross" | "net" | "polish" | "gold" | "labour" | "stoneWeight" | "stoneAmount" | "total";

/** The lines grid shared by the Calculator (spec 012) and the invoice form (spec 013). */
export default function LinesEditor({ rows, onChange, rowErrors = {}, rates, showPurity = false, pendingRate = false }: Props) {
  if (pendingRate) return <PendingLines rows={rows} onChange={onChange} rowErrors={rowErrors} />;
  const setField = (i: number, k: keyof LineText, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setHsn = (i: number, hsn: string) => onChange(rows.map((r, j) => (j === i ? { ...r, hsn, gst: hsn === "9988" ? "5" : "3" } : r)));
  const setPricing = (i: number, pricing: LineText["pricing"]) => onChange(rows.map((r, j) => (j === i ? { ...r, pricing } : r)));

  function setPurity(i: number, purity: Purity) {
    const kind = PURITY_RATE_KIND[purity];
    const applicable = kind ? rates?.[kind] : null;
    onChange(
      rows.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, purity };
        // Fill the gold rate from the day's rate and let the owner overtype it. Other purities keep what is typed (O9).
        if (applicable) next.gold = paisePerKgToInput(applicable.pricePaisePerKg, "gram");
        return next;
      }),
    );
  }

  const box = (i: number, k: BoxKey, label: string, placeholder?: string, width = "w-24") => {
    const err = isTouched(rows[i]!) ? parseLine(rows[i]!).fieldErrors[k] : undefined;
    return (
      <div className="flex flex-col gap-0.5">
        <input
          className={`${inputClass} ${width} ${err ? "border-red-400" : ""}`}
          value={rows[i]![k]}
          onChange={(e) => setField(i, k, e.target.value)}
          aria-label={`${label} line ${i + 1}`}
          placeholder={placeholder}
          inputMode={k === "description" ? "text" : "decimal"}
        />
        {err && <span className="text-xs text-red-700 max-w-32">{err}</span>}
      </div>
    );
  };
  const dash = <span className="block py-2 text-stone-400">–</span>;

  const headers = ["Description", ...(showPurity ? ["Purity"] : []), "Pricing", "HSN", "Gross g", "Net g", "Polish %", "Gold rate / g", "Labour rate / g", "Stone g", "Stone ₹", "Total ₹", "GST %", ""];
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead className="text-left text-stone-600">
          <tr>
            {headers.map((h, i) => (
              <th key={`${h}${i}`} className="pr-2 pb-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const combined = r.pricing === "combined";
            const separate = r.pricing === "separate";
            return (
              <tr key={i} className="align-top">
                <td className="pr-2 pb-2">{box(i, "description", "Description", "Silver Ornament", "w-44")}</td>
                {showPurity && (
                  <td className="pr-2 pb-2">
                    <select className={`${inputClass} w-28`} value={r.purity} onChange={(e) => setPurity(i, e.target.value as Purity)} aria-label={`Purity line ${i + 1}`}>
                      {PURITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="pr-2 pb-2">
                  <select className={`${inputClass} w-32`} value={r.pricing} onChange={(e) => setPricing(i, e.target.value as LineText["pricing"])} aria-label={`Pricing line ${i + 1}`}>
                    <option value="weight">By weight</option>
                    <option value="separate">Weight + stone</option>
                    <option value="combined">Combined total</option>
                  </select>
                </td>
                <td className="pr-2 pb-2">
                  <select className={`${inputClass} w-32`} value={r.hsn} onChange={(e) => setHsn(i, e.target.value)} aria-label={`HSN line ${i + 1}`}>
                    <option value="7113">7113 Jewellery 3%</option>
                    <option value="9988">9988 Job work 5%</option>
                  </select>
                </td>
                <td className="pr-2 pb-2">{box(i, "gross", "Gross g", "9.800")}</td>
                <td className="pr-2 pb-2">{box(i, "net", "Net g", "9.800")}</td>
                <td className="pr-2 pb-2">
                  {combined ? (
                    dash
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {box(i, "polish", "Polish %", "0")}
                      {(() => {
                        const n = parseWeightGrams(r.net);
                        const p = Number(r.polish || 0);
                        return n.ok && Number.isFinite(p) ? <span className="text-xs text-stone-500">= {formatWeightGrams(polishWeightMg(n.mg, Math.round(p * 100)))} g</span> : null;
                      })()}
                    </div>
                  )}
                </td>
                <td className="pr-2 pb-2">{combined ? dash : box(i, "gold", "Gold rate", "285.72", "w-28")}</td>
                <td className="pr-2 pb-2">{combined ? dash : box(i, "labour", "Labour rate", "0", "w-28")}</td>
                <td className="pr-2 pb-2">{separate ? box(i, "stoneWeight", "Stone g", "0.300", "w-24") : dash}</td>
                <td className="pr-2 pb-2">{separate ? box(i, "stoneAmount", "Stone amount", "12,500", "w-28") : dash}</td>
                <td className="pr-2 pb-2">{combined ? box(i, "total", "Total amount", "50,000", "w-28") : dash}</td>
                <td className="pr-2 pb-2">
                  <output className="block py-2 text-sm" aria-label={`GST line ${i + 1}`}>
                    {r.hsn === "9988" ? "5%" : "3%"}
                  </output>
                </td>
                <td className="pb-2">
                  <div className="flex flex-col gap-1">
                    <button
                      className="px-2 py-2 text-sm text-stone-600 hover:text-red-700 disabled:opacity-30"
                      disabled={rows.length === 1}
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      Remove
                    </button>
                    {(rowErrors[i] ?? []).map((m) => (
                      <span key={m} role="alert" className="text-xs text-red-700 max-w-40">
                        {m}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className={`${btnSecondary} mt-1`} onClick={() => onChange([...rows, blankLine(showPurity ? "22K916" : "other")])} disabled={rows.length >= 50}>
        Add line
      </button>
    </div>
  );
}

/** Spec 019c: weights, purity and the labour rate only. The gold rate is fixed when the customer pays. */
function PendingLines({ rows, onChange, rowErrors }: { rows: LineText[]; onChange: (rows: LineText[]) => void; rowErrors: Record<number, string[]> }) {
  const setField = (i: number, k: keyof LineText, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const cell = (i: number, k: "description" | "gross" | "net" | "polish" | "labour", label: string, placeholder: string, width: string) => {
    const err = isTouched(rows[i]!) ? parsePendingLine(rows[i]!).fieldErrors[k] : undefined;
    return (
      <div className="flex flex-col gap-0.5">
        <input
          className={`${inputClass} ${width} ${err ? "border-red-400" : ""}`}
          value={rows[i]![k]}
          onChange={(e) => setField(i, k, e.target.value)}
          aria-label={`${label} line ${i + 1}`}
          placeholder={placeholder}
          inputMode={k === "description" ? "text" : "decimal"}
        />
        {err && <span className="text-xs text-red-700 max-w-32">{err}</span>}
      </div>
    );
  };
  const headers = ["Description", "Purity", "Gross g", "Net g", "Polish %", "Labour rate / g", "Gold rate", ""];
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead className="text-left text-stone-600">
          <tr>{headers.map((h, i) => <th key={`${h}${i}`} className="pr-2 pb-2 font-medium whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              <td className="pr-2 pb-2">{cell(i, "description", "Description", "Silver Chain", "w-44")}</td>
              <td className="pr-2 pb-2">
                <select className={`${inputClass} w-28`} value={r.purity} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, purity: e.target.value as Purity } : x)))} aria-label={`Purity line ${i + 1}`}>
                  {PURITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </td>
              <td className="pr-2 pb-2">{cell(i, "gross", "Gross g", "9.800", "w-24")}</td>
              <td className="pr-2 pb-2">{cell(i, "net", "Net g", "9.800", "w-24")}</td>
              <td className="pr-2 pb-2">{cell(i, "polish", "Polish %", "0", "w-24")}</td>
              <td className="pr-2 pb-2">{cell(i, "labour", "Labour rate", "0", "w-28")}</td>
              <td className="pr-2 pb-2"><span className="block py-2 text-sm text-stone-500">Fixed when paid</span></td>
              <td className="pb-2">
                <div className="flex flex-col gap-1">
                  <button className="px-2 py-2 text-sm text-stone-600 hover:text-red-700 disabled:opacity-30" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>
                    Remove
                  </button>
                  {(rowErrors[i] ?? []).map((m) => (
                    <span key={m} role="alert" className="text-xs text-red-700 max-w-40">{m}</span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className={`${btnSecondary} mt-1`} onClick={() => onChange([...rows, blankLine("silver")])} disabled={rows.length >= 50}>
        Add line
      </button>
    </div>
  );
}
