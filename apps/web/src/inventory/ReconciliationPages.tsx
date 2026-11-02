import { useEffect, useState, type FormEvent } from "react";
import { BULK_UNIT_LABEL, RECONCILIATION_STATUS_LABEL, type Reconciliation, type ReconciliationDetailResponse, type ReconciliationLine, type StockLocation } from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Field, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { navigate } from "../router";
import {
  addReconciliationLine,
  closeReconciliation,
  getReconciliation,
  getReconciliationReport,
  listItems,
  listLocations,
  listReconciliations,
  openReconciliation,
  saveReconciliationCounts,
} from "./api";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date());
const signed = (n: number | null) => (n === null ? "-" : n > 0 ? `+${n}` : String(n));

/** Spec 025 section 4: the stock counts, and the form to open one (PC only). */
export function ReconciliationsPage() {
  const { can } = useAuth();
  const [items, setItems] = useState<Reconciliation[]>([]);
  const [places, setPlaces] = useState<StockLocation[]>([]);
  const [month, setMonth] = useState(thisMonth());
  const [place, setPlace] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can("reconciliation.edit");

  async function load() {
    try {
      setItems((await listReconciliations()).items);
      setPlaces((await listLocations()).items.filter((p) => p.active));
    } catch (e) {
      setErr(errorText(e, "Could not load the stock counts. Check the connection and try again."));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function onOpen(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setExistingId(null);
    try {
      const r = await openReconciliation({ month, locationId: place || null });
      navigate(`/inventory/reconciliations/${r.reconciliation.id}`);
    } catch (e2) {
      setErr(errorText(e2, "Could not open the count. Try again."));
      const id = e2 instanceof ApiError ? (e2.body as unknown as { reconciliationId?: string }).reconciliationId : undefined;
      if (id) setExistingId(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-3 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Stock count</h1>
        <a href="#/inventory" className="text-sm underline">Back to inventory</a>
      </div>
      <p className="text-sm text-stone-600">
        Count the stock at a place once a month. The system stock is taken when the count is opened. Each difference is written as an adjustment when the count is closed, and a closed count is never changed.
      </p>
      {err && (
        <Alert>
          {err}
          {existingId && (
            <>
              {" "}
              <a href={`#/inventory/reconciliations/${existingId}`} className="underline">Open the count that is already running</a>
            </>
          )}
        </Alert>
      )}

      {canEdit && (
        <form onSubmit={onOpen} className={`bg-white border border-stone-200 rounded-xl p-4 ${pcOnly} space-y-3`} aria-label="Open a count">
          <h2 className="font-medium">Open a count</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Month">
              <input type="month" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
            </Field>
            <Field label="Place">
              <select className={inputClass} value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Place">
                <option value="">All active places</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <button className={btnPrimary} disabled={busy || !month}>
                Open count
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Month</th>
              <th className="px-3 py-2">Place</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Opened</th>
              <th className="px-3 py-2">Counted</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="px-3 py-2">
                  <a href={`#/inventory/reconciliations/${r.id}`} className="underline font-medium">
                    {r.month}
                  </a>
                </td>
                <td className="px-3 py-2">{r.locationName}</td>
                <td className="px-3 py-2">{RECONCILIATION_STATUS_LABEL[r.status]}</td>
                <td className="px-3 py-2">{dateText(r.openedAt)}</td>
                <td className="px-3 py-2">
                  {r.countedCount} of {r.lineCount}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-stone-500">
                  No counts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const lineLabel = (l: ReconciliationLine) => (l.lineKind === "item" ? `${l.uNo} ${l.typeName ?? ""}`.trim() : `${l.bulkName} (${BULK_UNIT_LABEL[l.unit!]})`);

/** Spec 025 section 4: one count, one line per item and bulk item. Counting and closing are PC only. */
export function ReconciliationPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [detail, setDetail] = useState<ReconciliationDetailResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Edits typed on this page, by line id: "found" or "not_found" for an item, the number typed for a bulk item.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [addUNo, setAddUNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ adjustments: number } | null>(null);
  const canEdit = can("reconciliation.edit");

  async function load() {
    try {
      setDetail(await getReconciliation(id));
    } catch (e) {
      setErr(errorText(e, "Could not load the count. Check the connection and try again."));
    }
  }
  useEffect(() => {
    void load();
  }, [id]);

  if (!detail) {
    return (
      <main className="p-3 sm:p-6 max-w-5xl mx-auto w-full">
        {err ? <Alert>{err}</Alert> : <p className="text-stone-500">Loading the count...</p>}
      </main>
    );
  }
  const { reconciliation: rec, lines } = detail;
  const open = rec.status === "open";
  const editable = open && canEdit;
  const dirty = Object.keys(edits);

  const currentValue = (l: ReconciliationLine) => {
    if (l.id in edits) return edits[l.id]!;
    if (l.lineKind === "item") return l.countedStatus ?? "";
    return l.counted === null ? "" : String(l.counted);
  };
  // The difference as the screen shows it now, before a save (the same rule as the server).
  const liveDifference = (l: ReconciliationLine) => {
    const v = currentValue(l);
    if (v === "") return null;
    const counted = l.lineKind === "item" ? (v === "found" ? 1 : 0) : Number(v);
    return counted - l.expected;
  };

  async function onSave() {
    if (dirty.length === 0) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const payload = dirty.map((lineId) => {
        const l = lines.find((x) => x.id === lineId)!;
        const v = edits[lineId]!;
        const counted = v === "" ? null : l.lineKind === "item" ? v : Number(v);
        return { id: lineId, counted, note: lineId in notes ? notes[lineId]! : l.note };
      });
      // A save takes at most 100 lines; the rest go in the next call.
      let latest: ReconciliationDetailResponse | null = null;
      for (let i = 0; i < payload.length; i += 100) {
        latest = await saveReconciliationCounts(id, payload.slice(i, i + 100));
      }
      if (latest) setDetail(latest);
      setEdits({});
      setNotes({});
      setOk("Counts saved.");
    } catch (e) {
      setErr(errorText(e, "Could not save the counts. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const q = addUNo.replace(/\s+/g, "").toUpperCase();
    if (!q) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const found = (await listItems(`?q=${encodeURIComponent(q)}`)).items.find((i) => i.uNo.toUpperCase() === q);
      if (!found) {
        setErr(`No item with U No. ${q} was found.`);
        return;
      }
      setDetail(await addReconciliationLine(id, found.id));
      setAddUNo("");
      setOk(`${found.uNo} is on the count. Mark it found or not found.`);
    } catch (e2) {
      setErr(errorText(e2, "Could not add the item. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onAskClose() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      if (dirty.length) await onSave();
      const report = await getReconciliationReport(id);
      const uncounted = report.summary.notCounted;
      if (uncounted > 0) {
        setErr(`${uncounted} ${uncounted === 1 ? "line is" : "lines are"} not counted yet. Count every line before closing.`);
        return;
      }
      setConfirm({ adjustments: report.summary.adjustments });
    } catch (e) {
      setErr(errorText(e, "Could not prepare the close. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onClose() {
    setBusy(true);
    setErr(null);
    try {
      await closeReconciliation(id);
      setConfirm(null);
      await load();
      setOk("The count is closed. The adjustments are written.");
    } catch (e) {
      setErr(errorText(e, "Could not close the count. Nothing was written."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-3 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">
          Stock count {rec.month} at {rec.locationName}
        </h1>
        <a href="#/inventory/reconciliations" className="text-sm underline">
          All counts
        </a>
      </div>
      <p className="text-sm text-stone-600">
        {RECONCILIATION_STATUS_LABEL[rec.status]} since {dateText(rec.openedAt)}. System stock is taken at that time.
        {!open && rec.closedAt ? ` Closed on ${dateText(rec.closedAt)}; it cannot be changed.` : ""}
      </p>
      {err && <Alert>{err}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      {confirm && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3" role="dialog" aria-label="Confirm close">
          <p className="font-medium">
            Closing this count writes {confirm.adjustments} {confirm.adjustments === 1 ? "adjustment" : "adjustments"} to the stock.
          </p>
          <p className="text-sm">After closing, the count cannot be changed. A correction is a new count.</p>
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={onClose} disabled={busy}>
              Confirm close
            </button>
            <button className={btnSecondary} onClick={() => setConfirm(null)} disabled={busy}>
              Keep counting
            </button>
          </div>
        </div>
      )}

      {editable && (
        <form onSubmit={onAdd} className={`bg-white border border-stone-200 rounded-xl p-4 flex flex-wrap items-end gap-2 ${pcOnly}`} aria-label="Add an item found">
          <Field label="Add an item found (U No.)">
            <input className={inputClass} value={addUNo} onChange={(e) => setAddUNo(e.target.value)} placeholder="RING01" aria-label="U No. of the item found" />
          </Field>
          <button className={btnSecondary} disabled={busy || !addUNo.trim()}>
            Add item
          </button>
        </form>
      )}

      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Place</th>
              <th className="px-3 py-2 max-md:hidden">At opening</th>
              <th className="px-3 py-2 max-md:hidden">Moved</th>
              <th className="px-3 py-2">Expected</th>
              <th className="px-3 py-2">Counted</th>
              <th className="px-3 py-2">Difference</th>
              <th className="px-3 py-2 max-md:hidden">Note</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const v = currentValue(l);
              const diff = liveDifference(l);
              const countedText = l.lineKind === "item" ? (v === "found" ? "Found" : v === "not_found" ? "Not found" : "Not counted") : v === "" ? "Not counted" : v;
              return (
                <tr key={l.id} className={`border-t border-stone-100 align-top ${l.addedLater ? "bg-stone-50" : ""}`}>
                  <td className="px-3 py-2 font-medium">
                    {lineLabel(l)}
                    {l.addedLater && <span className="ml-2 text-xs text-stone-500">found, not on the list at opening</span>}
                    {l.systemStatus && l.systemStatus !== "in_stock" && <span className="block text-xs text-stone-500">Status in system: {l.systemStatus.replace("_", " ")}</span>}
                  </td>
                  <td className="px-3 py-2">{l.locationName}</td>
                  <td className="px-3 py-2 max-md:hidden">{l.systemAtOpening}</td>
                  <td className="px-3 py-2 max-md:hidden">{signed(l.movedSinceOpening)}</td>
                  <td className="px-3 py-2">{l.expected}</td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <div className={pcOnly}>
                        {l.lineKind === "item" ? (
                          <select
                            className={inputClass}
                            value={v}
                            aria-label={`Count of ${lineLabel(l)}`}
                            onChange={(e) => setEdits((x) => ({ ...x, [l.id]: e.target.value }))}
                          >
                            <option value="">Not counted</option>
                            <option value="found">Found</option>
                            <option value="not_found">Not found</option>
                          </select>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            className={`${inputClass} w-28`}
                            value={v}
                            aria-label={`Count of ${lineLabel(l)}`}
                            onChange={(e) => setEdits((x) => ({ ...x, [l.id]: e.target.value }))}
                          />
                        )}
                      </div>
                    ) : null}
                    <span className={editable ? "md:hidden" : ""}>{countedText}</span>
                  </td>
                  <td className="px-3 py-2 font-medium">{signed(diff)}</td>
                  <td className="px-3 py-2 max-md:hidden">
                    {editable ? (
                      <input
                        className={`${inputClass} ${pcOnly}`}
                        maxLength={300}
                        value={notes[l.id] ?? l.note ?? ""}
                        aria-label={`Note for ${lineLabel(l)}`}
                        onChange={(e) => setNotes((x) => ({ ...x, [l.id]: e.target.value }))}
                      />
                    ) : (
                      l.note ?? ""
                    )}
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-stone-500">
                  Nothing to count at this place.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className={`flex gap-2 flex-wrap ${pcOnly}`}>
          <button className={btnPrimary} onClick={onSave} disabled={busy || dirty.length === 0}>
            Save counts{dirty.length ? ` (${dirty.length} changed)` : ""}
          </button>
          <button className={btnSecondary} onClick={onAskClose} disabled={busy || confirm !== null}>
            Close count
          </button>
        </div>
      )}
    </main>
  );
}
