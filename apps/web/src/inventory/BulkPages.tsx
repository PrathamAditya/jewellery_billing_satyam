import { useEffect, useState, type FormEvent } from "react";
import {
  BULK_MOVEMENT_KINDS,
  BULK_MOVEMENT_LABEL,
  BULK_UNITS,
  BULK_UNIT_LABEL,
  newId,
  type BulkHistoryRow,
  type BulkItemResponse,
  type BulkMovementKind,
} from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { niceDate } from "../rates/api";
import { navigate } from "../router";
import { createBulk, getBulk, getBulkHistory, listBulk, recordBulkMovement } from "./api";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Spec 020b section 4: the bulk items list with quantities. Creating is PC only. */
export function BulkListPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<BulkItemResponse[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<(typeof BULK_UNITS)[number]>("pcs");
  const [opening, setOpening] = useState("0");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => newId());

  const load = () =>
    listBulk(q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "")
      .then((r) => setItems(r.items))
      .catch((e) => setErr(errorText(e, "Could not load the bulk items. Check the connection and try again.")));
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const n = Number(opening);
    if (!Number.isInteger(n) || n < 0) {
      setFormErr("Opening quantity is a whole number, 0 or more");
      return;
    }
    setBusy(true);
    setFormErr(null);
    try {
      const r = await createBulk({ id: clientId, name: name.trim(), unit, openingQuantity: n });
      navigate(`/inventory/bulk/${r.item.id}`);
    } catch (e2) {
      setFormErr(errorText(e2, "Could not save the bulk item. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-3 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Bulk items</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="#/inventory" className="text-sm underline">Back to inventory</a>
          {can("inventory.edit") && (
            <button className={`${btnPrimary} ${pcOnly}`} onClick={() => setAdding((v) => !v)}>
              {adding ? "Close" : "New bulk item"}
            </button>
          )}
        </div>
      </div>
      {err && <Alert>{err}</Alert>}
      {adding && (
        <form onSubmit={onAdd} className={`bg-white border border-stone-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end ${pcOnly}`} aria-label="New bulk item">
          {formErr && <div className="sm:col-span-3"><Alert>{formErr}</Alert></div>}
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Bulk item name" />
          </Field>
          <Field label="Unit">
            <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value as (typeof BULK_UNITS)[number])} aria-label="Unit">
              {BULK_UNITS.map((u) => (
                <option key={u} value={u}>
                  {BULK_UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Opening quantity">
            <input className={inputClass} type="number" min={0} value={opening} onChange={(e) => setOpening(e.target.value)} aria-label="Opening quantity" />
          </Field>
          <button className={btnPrimary} disabled={busy || !name.trim()}>
            Save
          </button>
        </form>
      )}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <div className="p-3">
          <input className={inputClass} placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bulk items" />
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2 text-right">In stock</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/inventory/bulk/${i.id}`)}>
                <td className="px-3 py-2 font-medium">{i.name}</td>
                <td className="px-3 py-2">{BULK_UNIT_LABEL[i.unit]}</td>
                <td className="px-3 py-2 text-right">{i.quantity}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-stone-500">No bulk items yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/** Spec 020b section 4: one bulk item, its quantity and movements. Recording a movement is PC only. */
export function BulkItemPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [item, setItem] = useState<BulkItemResponse | null>(null);
  const [rows, setRows] = useState<BulkHistoryRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const [i, h] = await Promise.all([getBulk(id), getBulkHistory(id)]);
      setItem(i.item);
      setRows(h.items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setErr(errorText(e, "Could not load the item. Check the connection and try again."));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (missing) return <main className="p-6 text-stone-600">This bulk item was not found.</main>;
  if (!item) return <main className="p-6 text-stone-500">{err ?? "Loading..."}</main>;

  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">{item.name}</h1>
        <a href="#/inventory/bulk" className="text-sm underline">Back to bulk items</a>
      </div>
      {ok && <Alert kind="ok">{ok}</Alert>}
      {err && <Alert>{err}</Alert>}
      <section className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-stone-500">In stock</div>
          <div className="text-3xl font-semibold" data-testid="bulk-quantity">
            {item.quantity} <span className="text-base font-normal text-stone-600">{BULK_UNIT_LABEL[item.unit]}</span>
          </div>
        </div>
        {can("inventory.edit") && (
          <button className={`${btnPrimary} ${pcOnly}`} onClick={() => setOpen(true)}>
            Record movement
          </button>
        )}
      </section>

      <section className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Movements</h2>
        <table className="w-full text-sm mt-2">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2 text-right">Change</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="px-3 py-2 whitespace-nowrap">{niceDate(r.at.slice(0, 10))}</td>
                <td className="px-3 py-2">{BULK_MOVEMENT_LABEL[r.kind]}</td>
                <td className="px-3 py-2 text-right">{r.quantityChange > 0 ? `+${r.quantityChange}` : r.quantityChange}</td>
                <td className="px-3 py-2 text-right">{r.balanceAfter}</td>
                <td className="px-3 py-2">{r.actor}</td>
                <td className="px-3 py-2">{r.reason ?? ""}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-stone-500">No movements yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {open && (
        <MovementDialog
          item={item}
          onClose={() => setOpen(false)}
          onSaved={async (msg) => {
            setOpen(false);
            setErr(null);
            setOk(msg);
            await load();
          }}
        />
      )}
    </main>
  );
}

function MovementDialog({ item, onClose, onSaved }: { item: BulkItemResponse; onClose: () => void; onSaved: (msg: string) => void | Promise<void> }) {
  const [kind, setKind] = useState<BulkMovementKind>("sold");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => newId());

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number(quantity);
    if (!Number.isInteger(n) || n === 0) {
      setErr("Enter a whole number of pieces");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await recordBulkMovement(item.id, { id: clientId, kind, quantity: n, reason: reason.trim() || null });
      await onSaved(`${BULK_MOVEMENT_LABEL[kind]} recorded. ${r.quantity} ${BULK_UNIT_LABEL[item.unit]} in stock now.`);
    } catch (e2) {
      setErr(errorText(e2, "Could not record the movement. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Record movement" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3" aria-label="Record movement">
        {err && <Alert>{err}</Alert>}
        <Field label="Kind">
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as BulkMovementKind)} aria-label="Movement kind">
            {BULK_MOVEMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {BULK_MOVEMENT_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={kind === "adjusted" ? "Quantity (use - to take out)" : `Quantity (${BULK_UNIT_LABEL[item.unit]})`}>
          <input className={inputClass} type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity" />
        </Field>
        <Field label={kind === "adjusted" ? "Reason (required)" : "Reason"}>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="Movement reason" />
        </Field>
        <div className="flex gap-2">
          <button className={btnPrimary} disabled={busy || !quantity || (kind === "adjusted" && !reason.trim())}>
            Save movement
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
