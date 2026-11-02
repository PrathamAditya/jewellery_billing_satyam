import { useEffect, useState } from "react";
import {
  CASH_KIND_LABEL,
  cashDifferencePaise,
  expectedCashPaise,
  formatMoney,
  indiaDate,
  parseRupeesToPaise,
  type CashClosingDayResponse,
  type CashClosingListResponse,
} from "@jewellery/shared";
import { useAuth } from "../auth";
import { niceDate } from "../rates/api";
import { Alert, Field, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { addCashNote, closeCashDay, getCashDay, listCashClosings } from "./api";

/** Why the day cannot be closed yet, in words the owner can act on. */
function cannotCloseReason(day: CashClosingDayResponse, date: string, today: string): string {
  if (date > today) return "This day has not ended yet.";
  if (day.lastClosedDate && date <= day.lastClosedDate) return `${niceDate(day.lastClosedDate)} is already closed. Days close in order.`;
  if (day.blockedByDate) return `${niceDate(day.blockedByDate)} has cash entries and is not closed. Close that day first.`;
  return "This day cannot be closed yet.";
}

/** Spec 032: count the drawer, close the day. Phone: read only (the form is PC only). */
export default function CashClosingPage() {
  const { can } = useAuth();
  const [date, setDate] = useState(() => indiaDate());
  const [day, setDay] = useState<CashClosingDayResponse | null>(null);
  const [list, setList] = useState<CashClosingListResponse["items"]>([]);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDay = (d: string) =>
    getCashDay(d)
      .then((r) => (setDay(r), setLoadError(null)))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load the day"));
  const loadList = () => listCashClosings().then((r) => setList(r.items)).catch(() => setList([]));

  useEffect(() => {
    setOpening("");
    setCounted("");
    setReason("");
    setMessage(null);
    setErrors({});
    loadDay(date);
  }, [date]);
  useEffect(() => {
    loadList();
  }, []);

  if (!can("payments.view")) return <Alert>You do not have permission to see the cash closing.</Alert>;

  // The figures on screen. A typed opening (first closing only) and a typed count move the difference live.
  const typedOpening = day?.opening.source === "typed" && !day.closing ? parseRupeesToPaise(opening, "opening cash") : null;
  const openingPaise = day ? (day.closing ? day.closing.openingPaise : day.opening.source === "typed" ? (typedOpening?.ok ? typedOpening.value : null) : day.opening.paise) : null;
  const expectedPaise = day?.closing ? day.closing.expectedPaise : openingPaise !== null && day && !day.blockedByDate ? expectedCashPaise(openingPaise, day.totals.netPaise) : null;
  const countedParsed = counted.trim() ? parseRupeesToPaise(counted, "counted cash") : null;
  const countedPaise = countedParsed?.ok ? countedParsed.value : null;
  const difference = countedPaise !== null && expectedPaise !== null ? cashDifferencePaise(countedPaise, expectedPaise) : null;
  const diffLine =
    difference === null ? "" : difference === 0 ? "The drawer agrees with the expected cash." : difference > 0 ? `Extra cash: ${formatMoney(difference)} more than expected.` : `Short: ${formatMoney(-difference)} less than expected.`;

  const close = async () => {
    if (!day) return;
    const e: Record<string, string> = {};
    if (day.opening.source === "typed") {
      if (!typedOpening || !typedOpening.ok) e.opening = typedOpening && !typedOpening.ok ? typedOpening.message : "Type the cash in the drawer at the start of the day";
    }
    if (!countedParsed || !countedParsed.ok) e.counted = countedParsed && !countedParsed.ok ? countedParsed.message : "Count the cash and type the amount";
    if (difference !== null && difference !== 0 && !reason.trim()) e.reason = "Say why the cash differs from what was expected";
    setErrors(e);
    if (Object.keys(e).length || countedPaise === null) return;
    setSaving(true);
    setMessage(null);
    const body: Record<string, unknown> = { date, countedPaise, reason: reason.trim() || undefined };
    if (day.opening.source === "typed" && typedOpening?.ok) body.openingPaise = typedOpening.value;
    try {
      await closeCashDay(body);
      setMessage({ kind: "ok", text: `${niceDate(date)} is closed.` });
      await loadDay(date);
      await loadList();
    } catch (err) {
      const b = (err as { body?: { error?: string; message?: string; issues?: { field: string; message: string }[] } }).body;
      if (b?.issues) setErrors(Object.fromEntries(b.issues.map((i) => [i.field, i.message])));
      setMessage({ kind: "error", text: b?.message ?? (err instanceof Error ? err.message : "The day could not be closed") });
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await addCashNote(date, note.trim());
      setNote("");
      await loadDay(date);
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "The note could not be saved" });
    }
  };

  const t = day?.totals;
  const canCloseNow = !!day && day.canClose && (day.opening.source !== "typed" || (typedOpening?.ok ?? false));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold">Cash closing</h1>
        <label className="flex items-center gap-2 text-sm">
          Day
          <input className={`${inputClass} w-auto`} type="date" value={date} max={indiaDate()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
        </label>
      </div>
      {loadError && <Alert>{loadError}</Alert>}
      {message && <Alert kind={message.kind === "ok" ? "ok" : "error"}>{message.text}</Alert>}

      {day && t && (
        <>
          <section className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
            <h2 className="font-semibold">{niceDate(day.date)}{day.closing && <span className="ml-2 text-xs text-green-800 border border-green-200 bg-green-50 rounded px-1">closed</span>}</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm max-w-md">
              <dt className="text-stone-600">Opening cash{day.opening.source === "carried" && day.opening.fromDate ? ` (last count, ${niceDate(day.opening.fromDate)})` : ""}</dt>
              <dd className="text-right">{openingPaise !== null ? formatMoney(openingPaise) : "Type below"}</dd>
              <dt className="text-stone-600">Cash received ({t.receiptsCount})</dt>
              <dd className="text-right">{formatMoney(t.receiptsPaise)}</dd>
              <dt className="text-stone-600">Cash refunded ({t.refundsCount})</dt>
              <dd className="text-right">-{formatMoney(t.refundsPaise)}</dd>
              <dt className="text-stone-600">Credit note payouts in cash ({t.creditPayoutsCount})</dt>
              <dd className="text-right">-{formatMoney(t.creditPayoutsPaise)}</dd>
              <dt className="text-stone-600">Old gold payouts in cash ({t.oldGoldPayoutsCount})</dt>
              <dd className="text-right">-{formatMoney(t.oldGoldPayoutsPaise)}</dd>
              <dt className="font-semibold">Expected cash</dt>
              <dd className="text-right font-semibold">{expectedPaise !== null ? formatMoney(expectedPaise) : "Type the opening cash"}</dd>
              {day.closing && (
                <>
                  <dt className="text-stone-600">Counted</dt>
                  <dd className="text-right">{formatMoney(day.closing.countedPaise)}</dd>
                  <dt className="text-stone-600">Difference</dt>
                  <dd className="text-right">{formatMoney(day.closing.differencePaise)}</dd>
                </>
              )}
            </dl>
            {day.blockedByDate && <Alert kind="info">{niceDate(day.blockedByDate)} has cash entries and is not closed. Close that day first.</Alert>}
            {day.currentExpectedPaise !== null && day.closing && day.currentExpectedPaise !== day.closing.expectedPaise && (
              <Alert kind="info">Cash for this day changed after it was closed. The drawer would now be expected to hold {formatMoney(day.currentExpectedPaise)}. The saved closing is unchanged; add a correction note.</Alert>
            )}
            {day.closing && <p className="text-sm text-stone-600">Closed by {day.closing.closedBy} on {niceDate(day.closing.date)}. Reason: {day.closing.reason ?? "none"}</p>}
            {day.notes.length > 0 && (
              <ul className="text-sm border-t border-stone-100 pt-2 flex flex-col gap-1">
                {day.notes.map((n) => <li key={n.id}><span className="text-stone-500">{niceDate(n.date)}, {n.createdBy}:</span> {n.note}</li>)}
              </ul>
            )}
          </section>

          <section className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[32rem]">
              <thead className="bg-stone-100 text-left text-stone-600">
                <tr><th className="px-3 py-2 font-medium">Kind</th><th className="px-3 py-2 font-medium">Reference</th><th className="px-3 py-2 font-medium">Party</th><th className="px-3 py-2 font-medium text-right">In</th><th className="px-3 py-2 font-medium text-right">Out</th></tr>
              </thead>
              <tbody>
                {day.movements.map((m, i) => (
                  <tr key={`${m.kind}-${i}`} className="border-t border-stone-100">
                    <td className="px-3 py-2">{CASH_KIND_LABEL[m.kind]}</td>
                    <td className="px-3 py-2">{m.reference ?? "At sale"}</td>
                    <td className="px-3 py-2">{m.party}</td>
                    <td className="px-3 py-2 text-right">{m.direction === "in" ? formatMoney(m.amountPaise) : ""}</td>
                    <td className="px-3 py-2 text-right">{m.direction === "out" ? formatMoney(m.amountPaise) : ""}</td>
                  </tr>
                ))}
                {day.movements.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-stone-500">No cash moved on this day.</td></tr>}
              </tbody>
            </table>
          </section>

          {!day.closing && can("cash.close") && (
            <section className={`bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3 ${pcOnly}`}>
              <h2 className="font-semibold">Close this day</h2>
              {!day.canClose && <Alert kind="info">{cannotCloseReason(day, date, indiaDate())}</Alert>}
              {day.opening.source === "typed" && (
                <Field label="Cash in the drawer at the start of the day (₹)" error={errors.opening} hint="Only for the first closing. Later days start with the count of the last closed day.">
                  <input className={inputClass} inputMode="decimal" placeholder="e.g. 2,000" value={opening} onChange={(e) => setOpening(e.target.value)} />
                </Field>
              )}
              <Field label="Cash counted in the drawer (₹)" error={errors.counted}>
                <input className={inputClass} inputMode="decimal" placeholder="e.g. 4,350" value={counted} onChange={(e) => setCounted(e.target.value)} disabled={!day.canClose} />
              </Field>
              <p className="text-sm font-medium" aria-live="polite">{diffLine}</p>
              {difference !== null && difference !== 0 && (
                <Field label="Reason for the difference" error={errors.reason} hint="Required when the count is not the expected cash.">
                  <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
                </Field>
              )}
              <div>
                <button className={btnPrimary} disabled={saving || !canCloseNow} onClick={close}>{saving ? "Closing..." : "Close the day"}</button>
              </div>
              <p className="text-xs text-stone-500">A closed day cannot be edited or reopened. A correction is added as a note.</p>
            </section>
          )}

          {day.closing && can("cash.close") && (
            <section className={`bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-2 ${pcOnly}`}>
              <h2 className="font-semibold">Add a correction note</h2>
              <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="What needs correcting" aria-label="Correction note" />
              <div><button className={btnSecondary} onClick={addNote} disabled={!note.trim()}>Add note</button></div>
            </section>
          )}
        </>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">History</h2>
        <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[32rem]">
            <thead className="bg-stone-100 text-left text-stone-600">
              <tr><th className="px-3 py-2 font-medium">Day</th><th className="px-3 py-2 font-medium text-right">Expected</th><th className="px-3 py-2 font-medium text-right">Counted</th><th className="px-3 py-2 font-medium text-right">Difference</th><th className="px-3 py-2 font-medium">Closed by</th><th className="px-3 py-2 font-medium">Notes</th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => setDate(r.date)}>
                  <td className="px-3 py-2 whitespace-nowrap"><button className="underline" onClick={() => setDate(r.date)}>{niceDate(r.date)}</button></td>
                  <td className="px-3 py-2 text-right">{formatMoney(r.expectedPaise)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(r.countedPaise)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(r.differencePaise)}</td>
                  <td className="px-3 py-2">{r.closedBy}</td>
                  <td className="px-3 py-2">{r.noteCount || ""}</td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-stone-500">No day has been closed yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
