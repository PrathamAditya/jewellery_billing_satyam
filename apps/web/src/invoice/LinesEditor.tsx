import { PURITIES, PURITY_RATE_KIND, paisePerKgToInput, type ApplicableRatesResponse, type Purity } from "@jewellery/shared";
import { btnSecondary, inputClass } from "../customers/ui";
import { blankLine, isTouched, parseLine, type LineText } from "./lines";

type Props = {
  rows: LineText[];
  onChange: (rows: LineText[]) => void;
  /** Messages from the server's calculation for each row (by row index). */
  rowErrors?: Record<number, string[]>;
  /** Show the purity column and fill the gold rate from these day rates (spec 013 R8). */
  rates?: ApplicableRatesResponse["rates"] | null;
  showPurity?: boolean;
};

/** The lines grid shared by the Calculator (spec 012) and the invoice form (spec 013). */
export default function LinesEditor({ rows, onChange, rowErrors = {}, rates, showPurity = false }: Props) {
  const setField = (i: number, k: keyof LineText, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

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

  const box = (i: number, k: Exclude<keyof LineText, "purity">, label: string, placeholder?: string, width = "w-24") => {
    const err = isTouched(rows[i]!) ? parseLine(rows[i]!).fieldErrors[k] : undefined;
    return (
      <div className="flex flex-col gap-0.5">
        <input
          className={`${inputClass} ${width} ${err ? "border-red-400" : ""}`}
          value={rows[i]![k]}
          onChange={(e) => setField(i, k, e.target.value)}
          aria-label={`${label} line ${i + 1}`}
          placeholder={placeholder}
          inputMode={k === "description" || k === "hsn" ? "text" : "decimal"}
        />
        {err && <span className="text-xs text-red-700 max-w-32">{err}</span>}
      </div>
    );
  };

  const headers = ["Description", ...(showPurity ? ["Purity"] : []), "HSN", "Gross g", "Net g", "Polish g", "Gold rate / g", "Labour rate / g", "GST %", ""];
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
          {rows.map((r, i) => (
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
              <td className="pr-2 pb-2">{box(i, "hsn", "HSN", "7113", "w-20")}</td>
              <td className="pr-2 pb-2">{box(i, "gross", "Gross g", "9.800")}</td>
              <td className="pr-2 pb-2">{box(i, "net", "Net g", "9.800")}</td>
              <td className="pr-2 pb-2">{box(i, "polish", "Polish g", "0")}</td>
              <td className="pr-2 pb-2">{box(i, "gold", "Gold rate", "285.72", "w-28")}</td>
              <td className="pr-2 pb-2">{box(i, "labour", "Labour rate", "0", "w-28")}</td>
              <td className="pr-2 pb-2">{box(i, "gst", "GST %", "3", "w-16")}</td>
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
          ))}
        </tbody>
      </table>
      <button className={`${btnSecondary} mt-1`} onClick={() => onChange([...rows, blankLine(showPurity ? "22K916" : "other")])} disabled={rows.length >= 50}>
        Add line
      </button>
    </div>
  );
}
