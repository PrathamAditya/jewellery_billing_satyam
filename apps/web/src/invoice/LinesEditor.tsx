import { calculateInvoice, labourExGstPaisePerKg, polishWeightMg } from "@jewellery/calc";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PURITIES,
  PURITY_RATE_KIND,
  formatMoney,
  formatPerGram,
  formatWeightGrams,
  paisePerKgToInput,
  parseRateInput,
  parseWeightGrams,
  type ApplicableRatesResponse,
  type BulkItemResponse,
  type ItemSuggestion,
  type Purity,
} from "@jewellery/shared";
import { btnSecondary, inputClass } from "../customers/ui";
import { getItemSuggestions } from "./api";
import { blankLine, copyRateBoxes, hasRateBoxes, isTouched, parseLine, parsePendingLine, type LineText } from "./lines";

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
  /** Spec 021: given only on the invoice form. The "Stock" cell shows when this is set (the calculator does not set it). */
  bulkItems?: BulkItemResponse[];
};

/** The text boxes of a row (the selects and the GST output are handled separately). */
type BoxKey = "description" | "gross" | "net" | "polish" | "gold" | "labour" | "stoneWeight" | "stoneAmount" | "total";

/** The lines grid shared by the Calculator (spec 012) and the invoice form (spec 013). */
export default function LinesEditor(props: Props) {
  // The pending-rate grid and the full grid are separate components, so switching between them never changes the hooks of one.
  if (props.pendingRate) return <PendingLines rows={props.rows} onChange={props.onChange} rowErrors={props.rowErrors ?? {}} />;
  return <FullLines {...props} />;
}

function DescriptionAutocomplete({
  index,
  value,
  placeholder,
  onChange,
  onPickSuggestion,
}: {
  index: number;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onPickSuggestion: (s: ItemSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ItemSuggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const timer = useRef<number | null>(null);
  const firstLine = value.split("\n")[0]?.trim() ?? "";

  useEffect(() => {
    if (!open) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      getItemSuggestions(firstLine)
        .then((r) => {
          setItems(r.items);
          setActiveIdx(0);
        })
        .catch(() => setItems([]));
    }, 120);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [open, firstLine]);

  return (
    <div className="relative">
      <textarea
        className={`${inputClass} min-h-[4.5rem] resize-y w-full`}
        style={{ minWidth: "16rem" }}
        rows={3}
        maxLength={200}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => (i + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => (i - 1 + items.length) % items.length);
          } else if (e.key === "Enter" && !e.shiftKey && activeIdx >= 0 && items[activeIdx] && firstLine.length > 0 && !value.includes("\n")) {
            e.preventDefault();
            onPickSuggestion(items[activeIdx]!);
            setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-label={`Description line ${index + 1}`}
        placeholder={placeholder}
      />
      {open && items.length > 0 && (
        <ul
          role="listbox"
          aria-label={`Item suggestions line ${index + 1}`}
          className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto bg-white border border-stone-300 rounded-lg shadow-lg text-sm divide-y divide-stone-100"
        >
          {items.map((s, idx) => (
            <li
              key={s.key}
              role="option"
              aria-selected={idx === activeIdx}
              onMouseDown={(e) => {
                e.preventDefault();
                onPickSuggestion(s);
                setOpen(false);
              }}
              className={`px-3 py-2 cursor-pointer flex items-center justify-between gap-2 ${idx === activeIdx ? "bg-stone-100" : "hover:bg-stone-50"}`}
            >
              <span className="font-medium text-stone-900">{s.label}</span>
              <span className="text-xs text-stone-500 whitespace-nowrap">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FullLines({ rows, onChange, rowErrors = {}, rates, showPurity = false, bulkItems }: Props) {
  const setField = (i: number, k: keyof LineText, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setHsn = (i: number, hsn: string) => onChange(rows.map((r, j) => (j === i ? { ...r, hsn, gst: hsn === "9988" ? "5" : "3" } : r)));
  const setPricing = (i: number, pricing: LineText["pricing"]) => onChange(rows.map((r, j) => (j === i ? { ...r, pricing } : r)));
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const showStock = bulkItems !== undefined;

  // Feedback point 4: the bill type sets the HSN (and so the GST rate) of every line at once. A line can still be changed on its own.
  const hsnSet = new Set(rows.map((r) => r.hsn));
  const billType: "sale" | "job" | "mixed" = hsnSet.size > 1 ? "mixed" : hsnSet.has("9988") ? "job" : "sale";
  const setBillType = (t: "sale" | "job") => onChange(rows.map((r) => ({ ...r, hsn: t === "job" ? "9988" : "7113", gst: t === "job" ? "5" : "3" })));
  // Feedback point 7: one switch for the whole bill. It moves with row 1 so every row is read the same way.
  const labourInclGst = rows.every((r) => r.labourInclGst);
  const setLabourInclGst = (on: boolean) => onChange(rows.map((r) => ({ ...r, labourInclGst: on })));

  function rateTextFor(purity: Purity): string | null {
    const kind = PURITY_RATE_KIND[purity];
    const applicable = kind ? rates?.[kind] : null;
    return applicable ? paisePerKgToInput(applicable.pricePaisePerKg, "gram") : null;
  }

  function applySuggestion(i: number, s: ItemSuggestion) {
    onChange(
      rows.map((r, j) => {
        if (j !== i) return r;
        const next: LineText = { ...r, description: s.description };
        if (s.source === "stock_item") {
          if (s.purity) next.purity = s.purity;
          if (s.hsn) {
            next.hsn = s.hsn;
            next.gst = s.hsn === "9988" ? "5" : "3";
          }
          if (s.grossWeightMg) next.gross = formatWeightGrams(s.grossWeightMg);
          if (s.netWeightMg) next.net = formatWeightGrams(s.netWeightMg);
          if (showStock && s.stockUNo) {
            next.stockKind = "item";
            next.stockUNo = s.stockUNo;
          }
          const autoRate = s.purity ? rateTextFor(s.purity) : null;
          if (autoRate) next.gold = autoRate;
        } else if (s.source === "previous_line") {
          if (s.purity) next.purity = s.purity;
          if (s.hsn) {
            next.hsn = s.hsn;
            next.gst = s.hsn === "9988" ? "5" : "3";
          }
          if (s.polishBps && !r.polish.trim()) next.polish = String(s.polishBps / 100);
          if (s.labourRatePaisePerKg && !r.labour.trim()) next.labour = paisePerKgToInput(s.labourRatePaisePerKg, "gram");
          const autoRate = s.purity ? rateTextFor(s.purity) : null;
          if (autoRate && !r.gold.trim()) next.gold = autoRate;
        } else {
          // Saved item type: fill description and default today's gold rate if still blank.
          const autoRate = rateTextFor(r.purity);
          if (autoRate && !r.gold.trim()) next.gold = autoRate;
        }
        return next;
      }),
    );
  }

  // Feedback point 5: copy the rate, labour and polish of line 1 to the other lines, or to one line. Lines stay editable afterwards.
  function copyFromFirst(only?: number) {
    const first = rows[0]!;
    if (!hasRateBoxes(first)) return setCopyNote("Line 1 has no rate, labour or polish typed yet, so there is nothing to copy.");
    if (rows.length < 2) return setCopyNote("There is only one line.");
    let n = 0;
    const next = rows.map((r, j) => {
      if (j === 0 || (only !== undefined && only !== j) || r.pricing === "combined") return r;
      n++;
      return copyRateBoxes(first, r);
    });
    onChange(next);
    setCopyNote(
      n
        ? `Copied the rate, labour and polish of line 1 to ${only !== undefined ? `line ${only + 1}` : `${n} other line${n > 1 ? "s" : ""}`}. You can still change any line.`
        : "Combined-total lines have no rate, so nothing was copied.",
    );
  }
  const addLine = () => {
    const last = rows[rows.length - 1]!;
    const defaultPurity: Purity = showPurity ? "22K916" : "other";
    const autoGold = showPurity ? rateTextFor(defaultPurity) ?? "" : "";
    // A new line follows the bill: the same HSN, same labour switch, and today's rate when known.
    onChange([...rows, { ...blankLine(defaultPurity), hsn: last.hsn, gst: last.gst, labourInclGst: last.labourInclGst, gold: autoGold }]);
  };
  const setStockKind = (i: number, stockKind: LineText["stockKind"]) =>
    onChange(
      rows.map((r, j) =>
        j === i ? { ...r, stockKind, stockUNo: stockKind === "item" ? r.stockUNo : "", bulkItemId: stockKind === "bulk" ? r.bulkItemId : "", bulkQty: stockKind === "bulk" ? r.bulkQty : "" } : r,
      ),
    );

  function setPurity(i: number, purity: Purity) {
    const applicable = rateTextFor(purity);
    onChange(
      rows.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, purity };
        // Fill the gold rate from the day's rate and let the owner overtype it. Other purities keep what is typed (O9).
        if (applicable) next.gold = applicable;
        return next;
      }),
    );
  }

  const box = (i: number, k: Exclude<BoxKey, "description">, label: string, placeholder?: string) => {
    const err = isTouched(rows[i]!) ? parseLine(rows[i]!).fieldErrors[k] : undefined;
    return (
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        <span>{label}</span>
        <input
          className={`${inputClass} ${err ? "border-red-400" : ""}`}
          value={rows[i]![k]}
          onChange={(e) => setField(i, k, e.target.value)}
          aria-label={`${label} line ${i + 1}`}
          placeholder={placeholder}
          inputMode="decimal"
        />
        {err && <span className="text-xs font-normal text-red-700">{err}</span>}
      </label>
    );
  };

  // Live per-line amount preview so the operator sees each item's amount while typing.
  const lineAmounts = useMemo(
    () =>
      rows.map((r) => {
        if (!isTouched(r)) return null;
        const p = parseLine(r);
        if (!p.input) return null;
        const calc = calculateInvoice({ taxMode: "intra", lines: [p.input] });
        return calc.ok ? calc.result.lines[0]?.amountPaise ?? null : null;
      }),
    [rows],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-1 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Bill type</span>
          <div className="flex" role="group" aria-label="Bill type">
            {(["sale", "job"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setBillType(t)}
                aria-pressed={billType === t}
                className={`px-3 py-2 border first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 ${billType === t ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300"}`}
              >
                {t === "sale" ? "Jewellery sale · HSN 7113 · 3%" : "Job work · HSN 9988 · 5%"}
              </button>
            ))}
          </div>
          {billType === "mixed" && <span className="text-stone-600">Mixed: each line has its own HSN.</span>}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={labourInclGst} onChange={(e) => setLabourInclGst(e.target.checked)} aria-label="Labour rates include GST" />
          Labour rates I type include GST
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((r, i) => {
          const combined = r.pricing === "combined";
          const separate = r.pricing === "separate";
          const lineAmt = lineAmounts[i];
          return (
            <div key={i} className="border border-stone-200 rounded-xl p-4 bg-stone-50/50 flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex items-center gap-2 pt-6">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-stone-200 text-stone-800 text-xs font-semibold">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-[16rem] flex flex-col gap-1">
                  <span className="text-xs font-medium text-stone-600">Description (type to pick saved item or U No.)</span>
                  <DescriptionAutocomplete
                    index={i}
                    value={r.description}
                    placeholder="Type item name (e.g. Ring) or U No. (RING01)"
                    onChange={(v) => setField(i, "description", v)}
                    onPickSuggestion={(s) => applySuggestion(i, s)}
                  />
                </div>
                {showPurity && (
                  <label className="flex flex-col gap-1 text-xs font-medium text-stone-600 w-32">
                    <span>Purity</span>
                    <select className={inputClass} value={r.purity} onChange={(e) => setPurity(i, e.target.value as Purity)} aria-label={`Purity line ${i + 1}`}>
                      {PURITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-xs font-medium text-stone-600 w-36">
                  <span>Pricing</span>
                  <select className={inputClass} value={r.pricing} onChange={(e) => setPricing(i, e.target.value as LineText["pricing"])} aria-label={`Pricing line ${i + 1}`}>
                    <option value="weight">By weight</option>
                    <option value="separate">Weight + stone</option>
                    <option value="combined">Combined total</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-stone-600 w-44">
                  <span>HSN</span>
                  <select className={inputClass} value={r.hsn} onChange={(e) => setHsn(i, e.target.value)} aria-label={`HSN line ${i + 1}`}>
                    <option value="7113">7113 Jewellery 3%</option>
                    <option value="9988">9988 Job work 5%</option>
                  </select>
                </label>
                <div className="flex flex-col gap-1 text-xs font-medium text-stone-600 w-16">
                  <span>GST %</span>
                  <output className="block py-2 text-base font-medium text-stone-800" aria-label={`GST line ${i + 1}`}>
                    {r.hsn === "9988" ? "5%" : "3%"}
                  </output>
                </div>
                <div className="flex flex-col items-end gap-1 ml-auto pt-5">
                  {lineAmt != null && <span className="text-sm font-semibold text-stone-900">Line: {formatMoney(lineAmt)}</span>}
                  <div className="flex items-center gap-2">
                    {i > 0 && !combined && (
                      <button className="px-2 py-1 text-xs text-stone-600 underline" onClick={() => copyFromFirst(i)} aria-label={`Copy rate, labour and polish from line 1 to line ${i + 1}`}>
                        Same as line 1
                      </button>
                    )}
                    <button
                      className="px-2 py-1.5 text-sm text-stone-600 hover:text-red-700 disabled:opacity-30"
                      disabled={rows.length === 1}
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 items-start">
                {box(i, "gross", "Gross g", "Same as net")}
                {box(i, "net", "Net g", "9.800")}
                {!combined && (
                  <div className="flex flex-col gap-0.5">
                    {box(i, "polish", "Polish %", "0")}
                    {(() => {
                      const n = parseWeightGrams(r.net);
                      const p = Number(r.polish || 0);
                      return n.ok && Number.isFinite(p) && p > 0 ? <span className="text-xs text-stone-500">= {formatWeightGrams(polishWeightMg(n.mg, Math.round(p * 100)))} g</span> : null;
                    })()}
                  </div>
                )}
                {!combined && box(i, "gold", "Gold rate", "285.72")}
                {!combined && (
                  <div className="flex flex-col gap-0.5">
                    {box(i, "labour", "Labour rate", "0")}
                    {r.labourInclGst &&
                      (() => {
                        const l = r.labour.trim() ? parseRateInput(r.labour, "gram") : null;
                        return l?.ok ? (
                          <span className="text-xs text-stone-500">= {formatPerGram(labourExGstPaisePerKg(l.paisePerKg, r.hsn === "9988" ? 500 : 300))} without GST</span>
                        ) : null;
                      })()}
                  </div>
                )}
                {separate && box(i, "stoneWeight", "Stone g", "0.300")}
                {separate && box(i, "stoneAmount", "Stone amount", "12,500")}
                {combined && box(i, "total", "Total amount", "50,000")}
                {showStock && (
                  <StockCell
                    row={r}
                    index={i}
                    bulkItems={bulkItems ?? []}
                    errors={isTouched(r) ? parseLine(r).fieldErrors : {}}
                    onKind={(k) => setStockKind(i, k)}
                    onField={(k, v) => setField(i, k, v)}
                  />
                )}
              </div>

              {(rowErrors[i] ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(rowErrors[i] ?? []).map((m) => (
                    <span key={m} role="alert" className="text-xs text-red-700">
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-1">
        <button className={btnSecondary} onClick={addLine} disabled={rows.length >= 50}>
          Add line
        </button>
        {rows.length > 1 && (
          <button className={btnSecondary} onClick={() => copyFromFirst()} aria-label="Copy rate, labour and polish from line 1 to all lines">
            Copy rate, labour and polish from line 1
          </button>
        )}
        {copyNote && (
          <span role="status" className="text-sm text-stone-600">
            {copyNote}
          </span>
        )}
      </div>
    </div>
  );
}

/** Spec 021: the optional stock of one line. A U No. or a bulk item with a quantity; "No stock" by default. */
function StockCell({
  row,
  index,
  bulkItems,
  errors,
  onKind,
  onField,
}: {
  row: LineText;
  index: number;
  bulkItems: BulkItemResponse[];
  errors: Partial<Record<keyof LineText, string>>;
  onKind: (k: LineText["stockKind"]) => void;
  onField: (k: "stockUNo" | "bulkItemId" | "bulkQty", v: string) => void;
}) {
  const msg = (k: keyof LineText) => (errors[k] ? <span className="text-xs font-normal text-red-700">{errors[k]}</span> : null);
  return (
    <div className="flex flex-col gap-1 text-xs font-medium text-stone-600">
      <span>Stock (optional)</span>
      <select className={inputClass} value={row.stockKind} onChange={(e) => onKind(e.target.value as LineText["stockKind"])} aria-label={`Stock line ${index + 1}`}>
        <option value="none">No stock</option>
        <option value="item">Item by U No.</option>
        <option value="bulk">Bulk item</option>
      </select>
      {row.stockKind === "item" && (
        <>
          <input
            className={`${inputClass} ${errors.stockUNo ? "border-red-400" : ""}`}
            value={row.stockUNo}
            onChange={(e) => onField("stockUNo", e.target.value)}
            aria-label={`U No. line ${index + 1}`}
            placeholder="RING01"
            autoComplete="off"
          />
          {msg("stockUNo")}
        </>
      )}
      {row.stockKind === "bulk" && (
        <>
          <select className={`${inputClass} ${errors.bulkItemId ? "border-red-400" : ""}`} value={row.bulkItemId} onChange={(e) => onField("bulkItemId", e.target.value)} aria-label={`Bulk item line ${index + 1}`}>
            <option value="">Choose…</option>
            {bulkItems.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.quantity} {b.unit} in stock)
              </option>
            ))}
          </select>
          {msg("bulkItemId")}
          <input
            className={`${inputClass} ${errors.bulkQty ? "border-red-400" : ""}`}
            value={row.bulkQty}
            onChange={(e) => onField("bulkQty", e.target.value)}
            aria-label={`Quantity line ${index + 1}`}
            placeholder="Qty"
            inputMode="numeric"
          />
          {msg("bulkQty")}
        </>
      )}
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
              <td className="pr-2 pb-2">{cell(i, "description", "Description", "Silver Chain", "w-56")}</td>
              <td className="pr-2 pb-2">
                <select className={`${inputClass} w-28`} value={r.purity} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, purity: e.target.value as Purity } : x)))} aria-label={`Purity line ${i + 1}`}>
                  {PURITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
              <td className="pr-2 pb-2">{cell(i, "gross", "Gross g", "9.800", "w-24")}</td>
              <td className="pr-2 pb-2">{cell(i, "net", "Net g", "9.800", "w-24")}</td>
              <td className="pr-2 pb-2">{cell(i, "polish", "Polish %", "0", "w-24")}</td>
              <td className="pr-2 pb-2">{cell(i, "labour", "Labour rate", "0", "w-28")}</td>
              <td className="pr-2 pb-2">
                <span className="block py-2 text-sm text-stone-500">Fixed when paid</span>
              </td>
              <td className="pb-2">
                <div className="flex flex-col gap-1">
                  <button className="px-2 py-2 text-sm text-stone-600 hover:text-red-700 disabled:opacity-30" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>
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
      <button className={`${btnSecondary} mt-1`} onClick={() => onChange([...rows, blankLine("silver")])} disabled={rows.length >= 50}>
        Add line
      </button>
    </div>
  );
}
