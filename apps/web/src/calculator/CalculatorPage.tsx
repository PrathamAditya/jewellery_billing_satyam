import { useMemo, useState } from "react";
import { calculateInvoice, type InvoiceError, type InvoiceLineInput, type InvoiceResult, type TaxMode } from "@jewellery/calc";
import { formatMoney, formatWeightGrams, parseRateInput, parseWeightGrams } from "@jewellery/shared";
import { Alert, btnSecondary, inputClass } from "../customers/ui";

type LineText = { description: string; hsn: string; gross: string; net: string; polish: string; gold: string; labour: string; gst: string };

const blankLine = (): LineText => ({ description: "", hsn: "7113", gross: "", net: "", polish: "", gold: "", labour: "", gst: "3" });

/** The client's real invoice (docs/client-invoice-reference.md), for comparing with the paper bill. */
const BABA_EXAMPLE: LineText = { description: "Silver Ornament", hsn: "7113", gross: "9.800", net: "9.800", polish: "", gold: "285.72", labour: "", gst: "3" };

type Parsed = { input: InvoiceLineInput | null; fieldErrors: Partial<Record<keyof LineText, string>> };

/** Turns what was typed on one row into calculator input, or says which box is wrong. */
function parseLine(t: LineText): Parsed {
  const fieldErrors: Parsed["fieldErrors"] = {};
  const net = parseWeightGrams(t.net);
  if (!net.ok) fieldErrors.net = net.message;
  // Gross is optional on the calculator: blank means "same as net".
  const gross = t.gross.trim() === "" ? net : parseWeightGrams(t.gross);
  if (!gross.ok) fieldErrors.gross = gross.message;
  const polish = t.polish.trim() === "" ? ({ ok: true, mg: 0 } as const) : parseWeightGrams(t.polish);
  if (!polish.ok) fieldErrors.polish = polish.message;
  const gold = parseRateInput(t.gold, "gram");
  if (!gold.ok) fieldErrors.gold = gold.message;
  const labourIsZero = t.labour.trim() === "" || /^[₹\s,.0]*$/.test(t.labour);
  const labour = labourIsZero ? ({ ok: true, paisePerKg: 0 } as const) : parseRateInput(t.labour, "gram");
  if (!labour.ok) fieldErrors.labour = labour.message;
  const gstText = t.gst.replace(/[%\s]/g, "");
  const gstOk = /^\d+(\.\d{1,2})?$/.test(gstText);
  if (!gstOk) fieldErrors.gst = "GST % like 3 or 1.5";

  if (Object.keys(fieldErrors).length) return { input: null, fieldErrors };
  return {
    fieldErrors,
    input: {
      description: t.description,
      hsn: t.hsn.trim(),
      grossWeightMg: (gross as { mg: number }).mg,
      netWeightMg: (net as { mg: number }).mg,
      polishMg: (polish as { mg: number }).mg,
      goldRatePaisePerKg: (gold as { paisePerKg: number }).paisePerKg,
      labourRatePaisePerKg: (labour as { paisePerKg: number }).paisePerKg,
      gstRateBps: Math.round(Number(gstText) * 100),
    },
  };
}

const pct = (bps: number) => `${bps / 100}%`.replace(/(\.\d)0%$/, "$1%");

function Breakdown({ r, lines }: { r: InvoiceResult; lines: InvoiceLineInput[] }) {
  const cell = "px-3 py-2 text-right whitespace-nowrap";
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-stone-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Line</th>
              <th className={`${cell} font-medium`}>Weight (net + polish)</th>
              <th className={`${cell} font-medium`}>Gold part</th>
              <th className={`${cell} font-medium`}>Labour part</th>
              <th className={`${cell} font-medium`}>Amount</th>
              <th className={`${cell} font-medium`}>Display rate / g</th>
              <th className={`${cell} font-medium`}>GST</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={i} className="border-t border-stone-100">
                <td className="px-3 py-2">{lines[i]?.description || `Line ${i + 1}`}</td>
                <td className={cell}>{formatWeightGrams(l.chargeableWeightMg)} g</td>
                <td className={cell}>{formatMoney(l.goldAmountPaise)}</td>
                <td className={cell}>{formatMoney(l.labourAmountPaise)}</td>
                <td className={`${cell} font-medium`}>{formatMoney(l.amountPaise)}</td>
                <td className={cell}>{formatMoney(l.displayRatePaisePerGram)}</td>
                <td className={cell}>{pct(l.gstRateBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-4 max-w-md self-end w-full" aria-label="Totals">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt>Amount Before Tax</dt>
            <dd>{formatMoney(r.taxablePaise)}</dd>
          </div>
          {r.groups.map((g) =>
            r.taxMode === "intra" ? (
              <div key={g.gstRateBps} className="flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <dt>(+) SGST @ {pct(g.gstRateBps / 2)}</dt>
                  <dd>{formatMoney(g.sgstPaise)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>(+) CGST @ {pct(g.gstRateBps / 2)}</dt>
                  <dd>{formatMoney(g.cgstPaise)}</dd>
                </div>
              </div>
            ) : (
              <div key={g.gstRateBps} className="flex justify-between">
                <dt>(+) IGST @ {pct(g.gstRateBps)}</dt>
                <dd>{formatMoney(g.igstPaise)}</dd>
              </div>
            ),
          )}
          <div className="flex justify-between border-t border-stone-200 pt-1.5 font-medium">
            <dt>Total Amount after Tax</dt>
            <dd>{formatMoney(r.totalBeforeRoundOffPaise)}</dd>
          </div>
          <div className="flex justify-between text-stone-600">
            <dt>Round-off</dt>
            <dd>{formatMoney(r.roundOffPaise)}</dd>
          </div>
          <div className="flex justify-between border-t border-stone-300 pt-1.5 text-base font-semibold">
            <dt>Payable</dt>
            <dd>{formatMoney(r.payablePaise)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export default function CalculatorPage() {
  const [rows, setRows] = useState<LineText[]>([blankLine()]);
  const [taxMode, setTaxMode] = useState<TaxMode>("intra");

  const parsed = useMemo(() => rows.map(parseLine), [rows]);
  const touched = (t: LineText) => Object.values(t).some((v, i) => i !== 1 && i !== 7 && v.trim() !== "");
  const active = rows.map((t, i) => ({ t, p: parsed[i]! })).filter(({ t }) => touched(t));
  const allParsed = active.length > 0 && active.every(({ p }) => p.input);

  const outcome = useMemo(
    () => (allParsed ? calculateInvoice({ taxMode, lines: active.map(({ p }) => p.input!) }) : null),
    [allParsed, taxMode, active],
  );

  const setField = (i: number, k: keyof LineText, v: string) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const errorsForLine = (activeIndex: number): InvoiceError[] => (outcome && !outcome.ok ? outcome.errors.filter((e) => e.line === activeIndex + 1) : []);
  const wholeErrors = outcome && !outcome.ok ? outcome.errors.filter((e) => e.line === null) : [];

  const box = (i: number, k: keyof LineText, label: string, placeholder?: string, width = "w-24") => {
    const err = touched(rows[i]!) ? parsed[i]!.fieldErrors[k] : undefined;
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

  return (
    <div className="flex flex-col gap-5">
      <div className="md:hidden">
        <Alert kind="info">The calculator is a billing tool for the PC. This phone view is read-only.</Alert>
      </div>

      <div className="max-md:hidden flex flex-col gap-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Invoice calculator</h1>
            <p className="text-sm text-stone-600">A preview to check figures against paper bills. Nothing is saved.</p>
          </div>
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => (setRows([{ ...BABA_EXAMPLE }]), setTaxMode("intra"))}>
              Fill with the Baba Jewellers example
            </button>
            <button className={btnSecondary} onClick={() => (setRows([blankLine()]), setTaxMode("intra"))}>
              Clear
            </button>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-4 overflow-x-auto">
          <table className="text-sm">
            <thead className="text-left text-stone-600">
              <tr>
                {["Description", "HSN", "Gross g", "Net g", "Polish g", "Gold rate / g", "Labour rate / g", "GST %", ""].map((h) => (
                  <th key={h} className="pr-2 pb-2 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((_, i) => {
                const activeIndex = active.findIndex(({ t }) => t === rows[i]);
                return (
                  <tr key={i} className="align-top">
                    <td className="pr-2 pb-2">{box(i, "description", "Description", "Silver Ornament", "w-44")}</td>
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
                          onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                          aria-label={`Remove line ${i + 1}`}
                        >
                          Remove
                        </button>
                        {activeIndex >= 0 &&
                          errorsForLine(activeIndex).map((e) => (
                            <span key={e.code} role="alert" className="text-xs text-red-700 max-w-40">
                              {e.message.replace(/^Line \d+: /, "")}
                            </span>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <button className={btnSecondary} onClick={() => setRows((p) => [...p, blankLine()])} disabled={rows.length >= 50}>
              Add line
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Sale is</span>
              <div className="flex">
                {(["intra", "inter"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setTaxMode(m)}
                    aria-pressed={taxMode === m}
                    className={`px-3 py-2 border first:rounded-l-lg last:rounded-r-lg -ml-px first:ml-0 ${taxMode === m ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300"}`}
                  >
                    {m === "intra" ? "Same state (CGST + SGST)" : "Other state (IGST)"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-stone-500 mt-2">Gross defaults to net when left blank. Rates are typed per gram. Labour can be left blank.</p>
        </div>

        {wholeErrors.map((e) => (
          <Alert key={e.code}>{e.message}</Alert>
        ))}
        {!outcome && <p className="text-stone-500">Type a net weight and a gold rate to see the bill.</p>}
        {outcome?.ok && <Breakdown r={outcome.result} lines={active.map(({ p }) => p.input!)} />}
      </div>
    </div>
  );
}
