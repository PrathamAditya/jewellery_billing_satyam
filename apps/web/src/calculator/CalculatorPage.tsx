import { useMemo, useState } from "react";
import { calculateInvoice, type TaxMode } from "@jewellery/calc";
import { Alert, btnSecondary } from "../customers/ui";
import Breakdown from "../invoice/Breakdown";
import LinesEditor from "../invoice/LinesEditor";
import { BABA_EXAMPLE, blankLine, isTouched, parseLine, type LineText } from "../invoice/lines";

export default function CalculatorPage() {
  const [rows, setRows] = useState<LineText[]>([blankLine()]);
  const [taxMode, setTaxMode] = useState<TaxMode>("intra");

  const active = useMemo(() => rows.map((t, i) => ({ t, i, p: parseLine(t) })).filter(({ t }) => isTouched(t)), [rows]);
  const allParsed = active.length > 0 && active.every(({ p }) => p.input);
  const outcome = useMemo(() => (allParsed ? calculateInvoice({ taxMode, lines: active.map(({ p }) => p.input!) }) : null), [allParsed, taxMode, active]);

  // Map the engine's line numbers (counted over the filled rows) back to the rows on screen.
  const rowErrors: Record<number, string[]> = {};
  if (outcome && !outcome.ok) for (const e of outcome.errors) if (e.line !== null) (rowErrors[active[e.line - 1]!.i] ??= []).push(e.message.replace(/^Line \d+: /, ""));
  const wholeErrors = outcome && !outcome.ok ? outcome.errors.filter((e) => e.line === null) : [];

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

        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <LinesEditor rows={rows} onChange={setRows} rowErrors={rowErrors} />
          <div className="flex items-center gap-2 text-sm mt-3">
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
          <p className="text-xs text-stone-500 mt-2">Gross defaults to net when left blank. Rates are typed per gram. Labour can be left blank.</p>
        </div>

        {wholeErrors.map((e) => (
          <Alert key={e.code}>{e.message}</Alert>
        ))}
        {!outcome && <p className="text-stone-500">Type a net weight and a gold rate to see the bill.</p>}
        {outcome?.ok && <Breakdown r={outcome.result} descriptions={active.map(({ t }) => t.description)} />}
      </div>
    </div>
  );
}
