import { useEffect, useState } from "react";
import {
  RATE_KINDS,
  RATE_LABELS,
  formatPerGram,
  formatPerKg,
  paisePerKgToInput,
  parseRateInput,
  type NeedsConfirmationBody,
  type RateHistoryEntry,
  type RateKind,
  type RateRow,
  type RateUnit,
} from "@jewellery/shared";
import { ApiError } from "../api";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { getRateHistory, niceDate, saveRate } from "./api";
import RateInput from "./RateInput";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

type Props = {
  today: string;
  /** Leave out to pick a date and kind inside the dialog (adding an earlier rate). */
  date?: string;
  kind?: RateKind;
  current?: RateRow;
  onClose: () => void;
  onSaved: () => void;
};

/** Edit a saved rate, or add one for an earlier date. Shows the earlier values (spec 011 R10, R11). */
export default function RateDialog({ today, date: dateProp, kind: kindProp, current, onClose, onSaved }: Props) {
  const [date, setDate] = useState(dateProp ?? "");
  const [kind, setKind] = useState<RateKind>(kindProp ?? "gold_24k995");
  const [unit, setUnit] = useState<RateUnit>("gram");
  const [value, setValue] = useState(current ? paisePerKgToInput(current.pricePaisePerKg, "gram") : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<NeedsConfirmationBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RateHistoryEntry[]>([]);

  const picking = !dateProp;
  const isPast = !!date && date !== today;

  useEffect(() => {
    if (!current) return;
    getRateHistory(current.date, current.kind)
      .then((r) => setHistory(r.items))
      .catch(() => setHistory([]));
  }, [current]);

  async function save(confirmLargeChange: boolean) {
    setFormError(null);
    setError(null);
    if (!date) return setFormError("Choose a date");
    if (date > today) return setFormError("A rate cannot be saved for a future date");
    const parsed = parseRateInput(value, unit);
    if (!parsed.ok) return setError(parsed.message);
    setBusy(true);
    try {
      await saveRate(date, kind, { price: value, unit, reason: reason.trim() || undefined, confirmLargeChange });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "needs_confirmation") {
        setConfirm(e.body as unknown as NeedsConfirmationBody);
      } else if (e instanceof ApiError && e.body.error === "validation") {
        const issues = (e.body as unknown as { issues: { message: string }[] }).issues;
        setError(issues[0]?.message ?? "Check the rate");
      } else {
        setFormError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const title = current ? `${RATE_LABELS[current.kind]}, ${niceDate(current.date)}` : "Add a rate for an earlier date";

  return (
    <Modal title={title} onClose={onClose}>
      {picking && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <input className={inputClass} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Rate">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as RateKind)}>
              {RATE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RATE_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {isPast && !current && <Alert kind="info">This is not today's date. Old invoices keep the rate they used, so this only fills the record.</Alert>}

      <RateInput label={RATE_LABELS[kind]} value={value} unit={unit} onChange={(v, u) => (setValue(v), setUnit(u))} error={error} autoFocus />

      {current && (
        <Field label="Reason for this change (optional)">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
        </Field>
      )}

      {confirm && (
        <Alert kind="info">
          <p className="font-medium">{confirm.message}</p>
          <p className="my-1">
            Before: {formatPerGram(confirm.previousPaisePerKg)} per gram ({formatPerKg(confirm.previousPaisePerKg)} per kg)
            <br />
            Now: {formatPerGram(confirm.newPaisePerKg)} per gram ({formatPerKg(confirm.newPaisePerKg)} per kg)
          </p>
          <div className="flex gap-2 flex-wrap mt-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save(true)}>
              Yes, save it
            </button>
            <button type="button" className={btnSecondary} onClick={() => setConfirm(null)}>
              No, go back
            </button>
          </div>
        </Alert>
      )}

      {formError && <Alert>{formError}</Alert>}

      {!confirm && (
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save(false)}>
            {busy ? "Saving..." : isPast && !current ? "Save anyway" : "Save"}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-1">Earlier values</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {history.map((h) => (
              <li key={h.revisionNo} className="text-stone-700">
                <span className="text-stone-500">{when(h.at)}:</span> {formatPerGram(h.fromPaisePerKg)} to {formatPerGram(h.toPaisePerKg)} per gram
                {h.reason ? ` ("${h.reason}")` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
