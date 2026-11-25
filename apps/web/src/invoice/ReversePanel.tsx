import { useMemo, useState } from "react";
import { calculateInvoice, solveForPayable, type DiscountsInput, type TaxMode } from "@jewellery/calc";
import { formatMoney, formatPerGram, formatWeightGrams, paisePerKgToInput, parseRateInput, parseWeightGrams } from "@jewellery/shared";
import { btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { isTouched, parseLine, type LineText } from "./lines";

type Unknown = "gold" | "labour" | "weight";
const LABEL: Record<Unknown, string> = { gold: "Gold rate per gram", labour: "Labour rate per gram", weight: "Net weight" };

/**
 * Feedback point 11: reverse calculation. The owner types the final amount (with GST, as on the bill) and picks what to
 * work out on one line: the gold rate, the labour rate or the net weight. Everything else on the bill stays as typed.
 * The answer is only put on the line when the owner presses Use this.
 */
export default function ReversePanel({ rows, onChange, taxMode, discounts }: { rows: LineText[]; onChange: (rows: LineText[]) => void; taxMode: TaxMode; discounts: DiscountsInput }) {
  const [open, setOpen] = useState(false);
  const [lineNo, setLineNo] = useState(1);
  const [unknown, setUnknown] = useState<Unknown>("gold");
  const [amountText, setAmountText] = useState("");
  const [answer, setAnswer] = useState<{ text: string; apply: (() => void) | null; exact: boolean } | null>(null);

  const idx = Math.min(Math.max(lineNo, 1), rows.length) - 1;
  const row = rows[idx]!;
  const target = useMemo(() => {
    const p = amountText.trim() ? parseRateInput(amountText, "kg") : null; // rupees with up to 2 decimals
    return p?.ok ? p.paisePerKg : null;
  }, [amountText]);

  /** The line with the unknown set to x: milli-rupees per gram for rates, milligrams for the weight. */
  function withX(r: LineText, x: number): LineText {
    if (unknown === "gold") return { ...r, gold: paisePerKgToInput(x * 100, "gram") };
    if (unknown === "labour") return { ...r, labour: paisePerKgToInput(x * 100, "gram") };
    const oldNet = parseWeightGrams(r.net);
    const grossIsNet = r.gross.trim() === "" || (oldNet.ok && parseWeightGrams(r.gross).ok && (parseWeightGrams(r.gross) as { mg: number }).mg === oldNet.mg);
    return { ...r, net: formatWeightGrams(x), gross: grossIsNet ? formatWeightGrams(x) : r.gross };
  }

  /** The bill's final amount when the unknown is x, or null when the bill is not valid yet. */
  function totalFor(x: number): number | null {
    const touched = rows.map((r, j) => (j === idx ? withX(r, x) : r)).filter((r, j) => j === idx || isTouched(r));
    const parsed = touched.map(parseLine);
    if (parsed.some((p) => !p.input)) return null;
    const out = calculateInvoice({ taxMode, lines: parsed.map((p) => p.input!), discounts });
    return out.ok ? out.result.payablePaise : null;
  }

  function solve() {
    setAnswer(null);
    if (row.pricing === "combined") return setAnswer({ text: "A line with a combined total has no rate or weight to work out. Choose another line.", apply: null, exact: false });
    if (target === null) return setAnswer({ text: "Type the final amount in rupees, like 28,840.", apply: null, exact: false });
    const hi = unknown === "weight" ? 100_000_000 : 100_000_000; // 100 kg, or ₹1,00,000 per gram
    const lo = unknown === "labour" ? 0 : 1;
    if (totalFor(hi) === null) return setAnswer({ text: `Fill in the other boxes of line ${idx + 1} first${unknown === "weight" ? " (the gold rate)" : " (the net weight)"}, and fix any red boxes.`, apply: null, exact: false });
    const r = solveForPayable(totalFor, target, lo, hi);
    if (!r.ok) return setAnswer({ text: r.message, apply: null, exact: false });
    const shown = unknown === "weight" ? `${formatWeightGrams(r.x)} g` : `${formatPerGram(r.x * 100)} per gram`;
    const text = r.exact
      ? `${LABEL[unknown]} on line ${idx + 1} is ${shown}. The bill then comes to exactly ${formatMoney(target)}.`
      : `No ${LABEL[unknown].toLowerCase()} gives exactly ${formatMoney(target)}. The closest is ${shown}, which makes the bill ${formatMoney(r.payablePaise)}.`;
    setAnswer({
      text,
      exact: r.exact,
      apply: () => {
        onChange(rows.map((x, j) => (j === idx ? withX(x, r.x) : x)));
        setAnswer({ text: `Done: ${shown} is now on line ${idx + 1}.`, apply: null, exact: true });
      },
    });
  }

  if (!open) {
    return (
      <div>
        <button className={btnSecondary} onClick={() => setOpen(true)}>
          Reverse calculation
        </button>
      </div>
    );
  }
  return (
    <section className="border border-stone-300 rounded-xl p-4 flex flex-col gap-3 bg-stone-50" aria-label="Reverse calculation">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Reverse calculation</h3>
        <button className="text-sm underline text-stone-600" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <p className="text-sm text-stone-600">Type the final amount of the bill (with GST). Choose what to work out on one line. The other boxes stay as you typed them.</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Final amount (₹)</span>
          <input className={`${inputClass} w-40`} value={amountText} onChange={(e) => (setAmountText(e.target.value), setAnswer(null))} inputMode="decimal" placeholder="e.g. 2,06,323" aria-label="Final amount for reverse calculation" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Work out</span>
          <select className={`${inputClass} w-52`} value={unknown} onChange={(e) => (setUnknown(e.target.value as Unknown), setAnswer(null))} aria-label="What to work out">
            {(Object.keys(LABEL) as Unknown[]).map((k) => (
              <option key={k} value={k}>
                {LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">On line</span>
          <select className={`${inputClass} w-24`} value={idx + 1} onChange={(e) => (setLineNo(Number(e.target.value)), setAnswer(null))} aria-label="Line for reverse calculation">
            {rows.map((_, j) => (
              <option key={j} value={j + 1}>
                {j + 1}
              </option>
            ))}
          </select>
        </label>
        <button className={btnPrimary} onClick={solve}>
          Work it out
        </button>
      </div>
      {answer && (
        <div role="status" className="text-sm flex flex-col gap-2">
          <p className={answer.exact || answer.apply ? "text-stone-900" : "text-amber-800"}>{answer.text}</p>
          {answer.apply && (
            <div>
              <button className={btnPrimary} onClick={answer.apply}>
                Use this on line {idx + 1}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
