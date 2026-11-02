import { useEffect, useState, type FormEvent } from "react";
import {
  INVENTORY_STATUSES,
  INVENTORY_STATUS_LABEL,
  formatWeightGrams,
  newId,
  parseWeightGrams,
  PURITIES,
  DEFAULT_LOCATION_ID,
  type InventoryHistoryRow,
  type InventoryItemResponse,
  type InventoryItemType,
  type InventoryStatus,
  type StockLocation,
  type StockTransfer,
} from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Field, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { niceDate } from "../rates/api";
import { navigate } from "../router";
import { changeItemStatus, createItem, getItem, getItemHistory, listLocations, listTransfers, listTypes, voidItem } from "./api";
import { purityLabel } from "./labels";
import { TransferDialog } from "./LocationPages";

type Issue = { field: string; message: string };
const fieldIssues = (e: unknown): Issue[] => (e instanceof ApiError && Array.isArray((e.body as { issues?: Issue[] }).issues) ? (e.body as { issues: Issue[] }).issues : []);
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Spec 020 section 4: one item with its status history. Changes are PC only. */
export function InventoryItemPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [item, setItem] = useState<InventoryItemResponse | null>(null);
  const [history, setHistory] = useState<InventoryHistoryRow[]>([]);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [status, setStatus] = useState<InventoryStatus | "">("");
  const [reason, setReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<StockLocation[]>([]);
  const [moves, setMoves] = useState<StockTransfer[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);

  async function load() {
    try {
      const [i, h, p, t] = await Promise.all([getItem(id), getItemHistory(id), listLocations(), listTransfers(`?itemId=${id}`)]);
      setItem(i.item);
      setHistory(h.items);
      setPlaces(p.items);
      setMoves(t.items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setErr(errorText(e, "Could not load the item. Check the connection and try again."));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onStatus(e: FormEvent) {
    e.preventDefault();
    if (!item || !status) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await changeItemStatus(item.id, status, reason.trim());
      setItem(r.item);
      setStatus("");
      setReason("");
      setOk(`Status changed to ${INVENTORY_STATUS_LABEL[r.item.status]}.`);
      setHistory((await getItemHistory(id)).items);
    } catch (e) {
      setErr(errorText(e, "Could not change the status. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onVoid(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await voidItem(item.id, voidReason.trim());
      setItem(r.item);
      setOk(`${r.item.uNo} is voided. Its number is kept on record and is not issued again.`);
    } catch (e) {
      setErr(errorText(e, "Could not void the item. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <main className="p-6 text-stone-600">This item was not found.</main>;
  if (!item) return <main className="p-6 text-stone-500">{err ?? "Loading..."}</main>;

  const canEdit = can("inventory.edit") && !item.voided;
  const canStatus = canEdit && item.status !== "written_off";
  const nextStatuses = INVENTORY_STATUSES.filter((s) => s !== item.status);

  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">
          {item.uNo} <span className="text-base font-normal text-stone-600">{item.typeName}</span>
        </h1>
        <a href="#/inventory" className="text-sm underline">Back to inventory</a>
      </div>
      {item.voided && <Alert kind="info">This item is voided: {item.voidReason}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}
      {err && <Alert>{err}</Alert>}
      <section className="bg-white border border-stone-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <Detail label="Status" value={item.statusLabel} />
        <Detail label="Pieces" value={String(item.pieces)} />
        <Detail label="Purity" value={purityLabel(item.purity)} />
        <Detail label="Metal" value={item.metal === "gold" ? "Gold" : "Silver"} />
        <Detail label="Gross weight" value={`${formatWeightGrams(item.grossWeightMg)} g`} />
        <Detail label="Net weight" value={`${formatWeightGrams(item.netWeightMg)} g`} />
        <Detail label="HSN" value={item.hsn} />
        <Detail label="Location" value={item.location ? `${item.locationName} (${item.location})` : item.locationName} />
        <Detail label="Labour note" value={item.labourNote ?? "None"} />
        <Detail label="Created" value={niceDate(item.createdAt.slice(0, 10))} />
      </section>

      {canStatus && (
        <form onSubmit={onStatus} className={`bg-white border border-stone-200 rounded-xl p-4 space-y-3 ${pcOnly}`}>
          <h2 className="font-semibold">Change status</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="New status">
              <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as InventoryStatus)} aria-label="New status">
                <option value="">Choose a status</option>
                {nextStatuses.map((s) => (
                  <option key={s} value={s}>
                    {INVENTORY_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason">
              <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="Reason" />
            </Field>
          </div>
          <button className={btnPrimary} disabled={busy || !status || !reason.trim()}>
            Change status
          </button>
        </form>
      )}

      <section className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Status history</h2>
        <table className="w-full text-sm mt-2">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t border-stone-100">
                <td className="px-3 py-2 whitespace-nowrap">{niceDate(h.at.slice(0, 10))}</td>
                <td className="px-3 py-2">{h.fromStatus ? INVENTORY_STATUS_LABEL[h.fromStatus] : "-"}</td>
                <td className="px-3 py-2">{INVENTORY_STATUS_LABEL[h.toStatus]}</td>
                <td className="px-3 py-2">{h.actor}</td>
                <td className="px-3 py-2">{h.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <div className="flex items-center justify-between gap-2 px-4 pt-4 flex-wrap">
          <h2 className="font-semibold">Location history</h2>
          {canEdit && item.status === "in_stock" && (
            <button className={`${btnPrimary} ${pcOnly}`} onClick={() => setTransferOpen(true)}>
              Transfer
            </button>
          )}
        </div>
        <table className="w-full text-sm mt-2">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id} className="border-t border-stone-100">
                <td className="px-3 py-2 whitespace-nowrap">{niceDate(m.at.slice(0, 10))}</td>
                <td className="px-3 py-2">{m.fromLocationName}</td>
                <td className="px-3 py-2">{m.toLocationName}</td>
                <td className="px-3 py-2">{m.actor}</td>
                <td className="px-3 py-2">{m.reason ?? ""}</td>
              </tr>
            ))}
            {moves.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-stone-500">
                  Not moved since it was entered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {transferOpen && (
        <TransferDialog
          kind="item"
          itemId={item.id}
          fromLocationId={item.locationId}
          places={places}
          onClose={() => setTransferOpen(false)}
          onSaved={async (msg) => {
            setTransferOpen(false);
            setErr(null);
            setOk(msg);
            await load();
          }}
        />
      )}

      {canEdit && (item.status === "in_stock" || item.status === "written_off") && (
        <form onSubmit={onVoid} className={`bg-white border border-stone-200 rounded-xl p-4 space-y-3 ${pcOnly}`}>
          <h2 className="font-semibold">Void this item</h2>
          <p className="text-xs text-stone-500">A voided item stays on record. Its U No. is not issued again.</p>
          <Field label="Reason">
            <input className={inputClass} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={300} aria-label="Void reason" />
          </Field>
          <button className={btnSecondary} disabled={busy || !voidReason.trim()}>
            Void item
          </button>
        </form>
      )}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

/** Spec 020 section 4: the New item form (PC only; the phone sees a note). */
export function NewInventoryItemPage() {
  const [types, setTypes] = useState<InventoryItemType[]>([]);
  const [form, setForm] = useState({ typeId: "", pieces: "1", metal: "gold", purity: "22K916", gross: "", net: "", hsn: "7113", labourNote: "", locationId: DEFAULT_LOCATION_ID, uNo: "" });
  const [places, setPlaces] = useState<StockLocation[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => newId());

  useEffect(() => {
    listTypes().then((r) => {
      const active = r.items.filter((t) => t.active);
      setTypes(active);
      setForm((f) => ({ ...f, typeId: f.typeId || active[0]?.id || "" }));
    });
    listLocations().then((r) => setPlaces(r.items.filter((p) => p.active)));
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    const gross = parseWeightGrams(form.gross);
    const net = parseWeightGrams(form.net);
    if (!gross.ok) next.grossWeightMg = gross.message;
    if (!net.ok) next.netWeightMg = net.message;
    const pieces = Number(form.pieces);
    if (!Number.isInteger(pieces) || pieces < 1 || pieces > 10) next.pieces = "Pieces: 1 to 10 (a pair is 2)";
    if (!form.typeId) next.typeId = "Choose the item type";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const r = await createItem({
        id: clientId,
        typeId: form.typeId,
        uNo: form.uNo.trim() || null,
        pieces,
        metal: form.metal,
        purity: form.purity,
        grossWeightMg: gross.ok ? gross.mg : 0,
        netWeightMg: net.ok ? net.mg : 0,
        hsn: form.hsn,
        labourNote: form.labourNote.trim() || null,
        locationId: form.locationId,
      });
      navigate(`/inventory/items/${r.item.id}`);
    } catch (err) {
      const issues = fieldIssues(err);
      if (issues.length) {
        const map: Record<string, string> = {};
        for (const i of issues) map[i.field || "form"] = i.message;
        setErrors(map);
      } else {
        setFormError(errorText(err, "Could not save the item. Check the connection and try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <h1 className="text-xl font-semibold">New inventory item</h1>
      <p className="md:hidden text-sm text-stone-600">Items are added from a PC. On the phone you can look them up.</p>
      <form onSubmit={onSubmit} className={`bg-white border border-stone-200 rounded-xl p-4 space-y-4 ${pcOnly}`} aria-label="New item">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Item type" error={errors.typeId}>
            <select className={inputClass} value={form.typeId} onChange={set("typeId")} aria-label="Item type">
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.itemCode})
                </option>
              ))}
            </select>
          </Field>
          <Field label="U No." hint="Leave blank for the next number" error={errors.uNo}>
            <input className={inputClass} value={form.uNo} onChange={set("uNo")} placeholder="Automatic" aria-label="U No." />
          </Field>
          <Field label="Pieces" hint="A pair is 2" error={errors.pieces}>
            <input className={inputClass} type="number" min={1} max={10} value={form.pieces} onChange={set("pieces")} aria-label="Pieces" />
          </Field>
          <Field label="Metal">
            <select className={inputClass} value={form.metal} onChange={(e) => setForm((f) => ({ ...f, metal: e.target.value, purity: e.target.value === "silver" ? "silver" : f.purity === "silver" ? "22K916" : f.purity }))} aria-label="Metal">
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
            </select>
          </Field>
          <Field label="Purity" error={errors.purity}>
            <select className={inputClass} value={form.purity} onChange={set("purity")} aria-label="Purity">
              {PURITIES.map((p) => (
                <option key={p} value={p}>
                  {purityLabel(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="HSN">
            <select className={inputClass} value={form.hsn} onChange={set("hsn")} aria-label="HSN">
              <option value="7113">7113 (jewellery)</option>
              <option value="9988">9988 (job work)</option>
            </select>
          </Field>
          <Field label="Gross weight (g)" hint="Like 12.500" error={errors.grossWeightMg}>
            <input className={inputClass} inputMode="decimal" value={form.gross} onChange={set("gross")} aria-label="Gross weight" />
          </Field>
          <Field label="Net weight (g)" hint="Like 12.000" error={errors.netWeightMg}>
            <input className={inputClass} inputMode="decimal" value={form.net} onChange={set("net")} aria-label="Net weight" />
          </Field>
          <Field label="Location" hint="Where the item sits">
            <select className={inputClass} value={form.locationId} onChange={set("locationId")} aria-label="Location">
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Labour note">
            <input className={inputClass} value={form.labourNote} onChange={set("labourNote")} maxLength={200} aria-label="Labour note" />
          </Field>
        </div>
        <div className="flex gap-2">
          <button className={btnPrimary} disabled={busy}>
            Save item
          </button>
          <a href="#/inventory" className={btnSecondary}>Cancel</a>
        </div>
      </form>
    </main>
  );
}
