import { useCallback, useEffect, useState } from "react";
import {
  RATE_KINDS,
  RATE_LABELS,
  formatPerGram,
  formatPerKg,
  parseRateInput,
  type ApplicableRatesResponse,
  type NeedsConfirmationBody,
  type RateKind,
  type RateRow,
  type RateUnit,
  type RatesByDate,
} from "@jewellery/shared";
import { ApiError } from "../api";
import { Alert, btnPrimary, btnSecondary, pcOnly } from "../customers/ui";
import { useAuth } from "../auth";
import { getApplicable, listRates, niceDate, saveRate } from "./api";
import RateDialog from "./RateDialog";
import RateInput from "./RateInput";

type Row = { value: string; unit: RateUnit; error: string | null };
const blankRows = (): Record<RateKind, Row> => ({
  gold_24k995: { value: "", unit: "gram", error: null },
  gold_22k916: { value: "", unit: "gram", error: null },
  silver: { value: "", unit: "gram", error: null },
});

type Pending = { kind: RateKind; confirm: NeedsConfirmationBody };

const isPc = () => window.matchMedia("(min-width: 768px)").matches;

function Status({ rate }: { rate: ApplicableRatesResponse["rates"][RateKind] }) {
  if (!rate) return <span className="text-amber-800">No rate saved yet</span>;
  if (!rate.carriedForward) return <span className="text-green-700">Saved today: {formatPerGram(rate.pricePaisePerKg)} per gram</span>;
  return (
    <span className="text-amber-800">
      Not set today. Last: {formatPerGram(rate.pricePaisePerKg)} per gram ({niceDate(rate.rateDate)})
    </span>
  );
}

export default function RatesPage() {
  const { can } = useAuth();
  const [applicable, setApplicable] = useState<ApplicableRatesResponse | null>(null);
  const [rows, setRows] = useState<Record<RateKind, Row>>(blankRows);
  const [history, setHistory] = useState<RatesByDate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [dialog, setDialog] = useState<null | { date?: string; kind?: RateKind; current?: RateRow }>(null);

  const today = applicable?.date ?? "";

  const reload = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([getApplicable(), listRates()]);
      setApplicable(a);
      setHistory(l.items);
      setCursor(l.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load rates");
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  async function older() {
    if (!cursor) return;
    try {
      const l = await listRates(cursor);
      setHistory((p) => [...p, ...l.items]);
      setCursor(l.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    }
  }

  const setRow = (kind: RateKind, patch: Partial<Row>) => setRows((p) => ({ ...p, [kind]: { ...p[kind], ...patch } }));

  /** Saves one row. Returns "saved", "skipped" (nothing to do) or "confirm" (typo guard asked). */
  async function saveOne(kind: RateKind, confirmLargeChange = false): Promise<"saved" | "skipped" | "confirm" | "error"> {
    const row = rows[kind];
    if (!row.value.trim()) return "skipped";
    const parsed = parseRateInput(row.value, row.unit);
    if (!parsed.ok) {
      setRow(kind, { error: parsed.message });
      return "error";
    }
    try {
      await saveRate(today, kind, { price: row.value, unit: row.unit, confirmLargeChange });
      setRow(kind, { value: "", error: null });
      return "saved";
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "needs_confirmation") {
        setPending((p) => [...p.filter((x) => x.kind !== kind), { kind, confirm: e.body as unknown as NeedsConfirmationBody }]);
        return "confirm";
      }
      const issues = e instanceof ApiError && e.body.error === "validation" ? (e.body as unknown as { issues: { message: string }[] }).issues : null;
      setRow(kind, { error: issues?.[0]?.message ?? (e instanceof ApiError ? e.message : "Could not save") });
      return "error";
    }
  }

  async function saveAll() {
    setBusy(true);
    setNotice(null);
    setPending([]);
    const results = [];
    for (const kind of RATE_KINDS) results.push(await saveOne(kind));
    await reload();
    setBusy(false);
    const saved = results.filter((r) => r === "saved").length;
    if (saved) setNotice(`Saved ${saved} rate${saved > 1 ? "s" : ""} for today.`);
    else if (results.every((r) => r === "skipped")) setNotice("Nothing to save. Type a rate first.");
  }

  async function confirmPending(p: Pending, yes: boolean) {
    setPending((x) => x.filter((i) => i.kind !== p.kind));
    if (!yes) return;
    setBusy(true);
    const r = await saveOne(p.kind, true);
    await reload();
    setBusy(false);
    if (r === "saved") setNotice(`Saved ${RATE_LABELS[p.kind]} for today.`);
  }

  const cell = (d: RatesByDate, kind: RateKind) => {
    const r = d.rates[kind];
    return (
      <td key={kind} className="px-3 py-2 align-top">
        <button
          className="text-left hover:underline"
          // Editing is PC only (decision D5), so a tap on a phone does nothing.
          onClick={() => isPc() && setDialog(r ? { date: d.date, kind, current: r } : { date: d.date, kind })}
          title={r ? `${formatPerKg(r.pricePaisePerKg)} per kg. Click to edit or see earlier values` : "Not saved. Click to add"}
        >
          {r ? (
            <>
              <span className="font-medium">{formatPerGram(r.pricePaisePerKg)}</span>
              <span className="block text-xs text-stone-500">{formatPerKg(r.pricePaisePerKg)} / kg</span>
            </>
          ) : (
            <span className="text-stone-300">-</span>
          )}
        </button>
      </td>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold">Rates</h1>
        {can("rates.edit") && <button className={`${btnSecondary} ${pcOnly}`} onClick={() => setDialog({})}>
          Add a rate for an earlier date
        </button>}
      </div>

      {error && <Alert>{error}</Alert>}

      <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
        <h2 className="font-semibold">Rates for today{today ? ` (${niceDate(today)})` : ""}</h2>

        {/* Phone: view only (decision D5) */}
        <ul className="md:hidden flex flex-col gap-2 text-sm">
          {RATE_KINDS.map((k) => (
            <li key={k}>
              <span className="font-medium">{RATE_LABELS[k]}:</span> <Status rate={applicable?.rates[k] ?? null} />
            </li>
          ))}
        </ul>

        {/* PC: type the rates */}
        {/* A viewer sees the rates but cannot type them: the fieldset disables everything inside it. */}
        <fieldset disabled={!can("rates.edit")} className={`flex flex-col gap-4 min-w-0 ${pcOnly}`}>
          {RATE_KINDS.map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <RateInput
                label={RATE_LABELS[k]}
                value={rows[k].value}
                unit={rows[k].unit}
                error={rows[k].error}
                onChange={(value, unit) => setRow(k, { value, unit, error: null })}
              />
              <div className="text-xs pl-[7.5rem]">
                <Status rate={applicable?.rates[k] ?? null} />
              </div>
              {pending
                .filter((p) => p.kind === k)
                .map((p) => (
                  <div key={k} className="pl-[7.5rem]">
                    <Alert kind="info">
                      <p className="font-medium">{p.confirm.message}</p>
                      <p className="my-1">
                        Before {formatPerGram(p.confirm.previousPaisePerKg)} per gram, now {formatPerGram(p.confirm.newPaisePerKg)} per gram.
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button className={btnPrimary} disabled={busy} onClick={() => void confirmPending(p, true)}>
                          Yes, save it
                        </button>
                        <button className={btnSecondary} onClick={() => void confirmPending(p, false)}>
                          No, go back
                        </button>
                      </div>
                    </Alert>
                  </div>
                ))}
            </div>
          ))}
          {notice && <Alert kind="ok">{notice}</Alert>}
          {can("rates.edit") && <div>
            <button className={btnPrimary} disabled={busy || !today} onClick={() => void saveAll()}>
              {busy ? "Saving..." : "Save today's rates"}
            </button>
          </div>}
        </fieldset>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Saved rates</h2>
        <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[32rem]">
            <thead className="bg-stone-100 text-left text-stone-600">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                {RATE_KINDS.map((k) => (
                  <th key={k} className="px-3 py-2 font-medium">
                    {RATE_LABELS[k]} <span className="font-normal text-xs">per gram</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((d) => (
                <tr key={d.date} className="border-t border-stone-100">
                  <td className="px-3 py-2 whitespace-nowrap align-top">{niceDate(d.date)}</td>
                  {RATE_KINDS.map((k) => cell(d, k))}
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-stone-500">
                    No rates saved yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {cursor && (
          <button className={`${btnSecondary} self-center`} onClick={() => void older()}>
            Older rates
          </button>
        )}
      </section>

      {dialog && today && (
        <RateDialog
          today={today}
          date={dialog.date}
          kind={dialog.kind}
          current={dialog.current}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
