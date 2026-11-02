import { useEffect, useState, type FormEvent } from "react";
import { BULK_UNIT_LABEL, newId, type LocationStockResponse, type StockLocation } from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { navigate } from "../router";
import { createLocation, createTransfer, getLocationStock, listLocations, updateLocation } from "./api";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Spec 021b section 4: the stock places. Adding, renaming and making inactive are PC only. */
export function LocationsPage() {
  const { can } = useAuth();
  const [places, setPlaces] = useState<StockLocation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => newId());
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can("inventory.edit");

  async function load() {
    try {
      setPlaces((await listLocations()).items);
    } catch (e) {
      setErr(errorText(e, "Could not load the places. Check the connection and try again."));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameErr("Give the place a name");
      return;
    }
    setBusy(true);
    setNameErr(null);
    setErr(null);
    setOk(null);
    try {
      const r = await createLocation({ id: clientId, name: name.trim() });
      setOk(`${r.location.name} is added.`);
      setName("");
      setClientId(newId());
      await load();
    } catch (e2) {
      setNameErr(errorText(e2, "Could not add the place. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editing.name.trim()) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await updateLocation(editing.id, { name: editing.name.trim() });
      setOk(`Renamed to ${r.location.name}.`);
      setEditing(null);
      await load();
    } catch (e2) {
      setErr(errorText(e2, "Could not rename the place. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onActive(p: StockLocation) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await updateLocation(p.id, { active: !p.active });
      setOk(r.location.active ? `${r.location.name} is active again.` : `${r.location.name} is now inactive.`);
      await load();
    } catch (e2) {
      setErr(errorText(e2, "Could not change the place. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Stock locations</h1>
        <a href="#/inventory" className="text-sm underline">Back to inventory</a>
      </div>
      <p className="text-sm text-stone-600">Items and bulk quantities sit at one place. Move them with a transfer from the item or bulk item page.</p>
      {ok && <Alert kind="ok">{ok}</Alert>}
      {err && <Alert>{err}</Alert>}

      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Place</th>
              <th className="px-3 py-2">Status</th>
              {canEdit && <th className={`px-3 py-2 ${pcOnly}`}>Change</th>}
            </tr>
          </thead>
          <tbody>
            {places.map((p) => (
              <tr key={p.id} className="border-t border-stone-100 align-top">
                <td className="px-3 py-2 font-medium">
                  <a href={`#/inventory/locations/${p.id}`} className="underline">
                    {p.name}
                  </a>
                  {p.isDefault && <span className="ml-2 text-xs text-stone-500">default</span>}
                  {editing?.id === p.id && canEdit && (
                    <form onSubmit={onRename} className={`mt-2 flex gap-2 ${pcOnly}`} aria-label={`Rename ${p.name}`}>
                      <input className={inputClass} value={editing.name} maxLength={60} onChange={(e) => setEditing({ id: p.id, name: e.target.value })} aria-label="New name" />
                      <button className={btnPrimary} disabled={busy || !editing.name.trim()}>
                        Save name
                      </button>
                      <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </form>
                  )}
                </td>
                <td className="px-3 py-2">{p.active ? "Active" : "Inactive"}</td>
                {canEdit && (
                  <td className={`px-3 py-2 ${pcOnly}`}>
                    <div className="flex gap-2 flex-wrap">
                      <button className="underline" onClick={() => setEditing({ id: p.id, name: p.name })} disabled={busy}>
                        Rename
                      </button>
                      {!p.isDefault && (
                        <button className="underline" onClick={() => onActive(p)} disabled={busy}>
                          {p.active ? "Make inactive" : "Make active"}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {places.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-stone-500">
                  No places yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form onSubmit={onAdd} className={`bg-white border border-stone-200 rounded-xl p-4 space-y-3 ${pcOnly}`} aria-label="Add a place">
          <h2 className="font-semibold">Add a place</h2>
          <Field label="Name" error={nameErr ?? undefined} hint="Like Testing centre, unique in any case">
            <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Place name" />
          </Field>
          <button className={btnPrimary} disabled={busy}>
            Add place
          </button>
        </form>
      )}
    </main>
  );
}

/** Spec 021b section 4: what is at one place. Read only on the PC and the phone. */
export function LocationStockPage({ id }: { id: string }) {
  const [data, setData] = useState<LocationStockResponse | null>(null);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getLocationStock(id)
      .then(setData)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setErr(errorText(e, "Could not load this place. Check the connection and try again."));
      });
  }, [id]);

  if (missing) return <main className="p-6 text-stone-600">This place was not found.</main>;
  if (!data) return <main className="p-6 text-stone-500">{err ?? "Loading..."}</main>;

  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">
          {data.location.name} {!data.location.active && <span className="text-base font-normal text-stone-500">(inactive)</span>}
        </h1>
        <a href="#/inventory/locations" className="text-sm underline">All places</a>
      </div>
      {err && <Alert>{err}</Alert>}

      <section className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Items (U No.)</h2>
        <table className="w-full text-sm mt-2">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">U No.</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/inventory/items/${i.id}`)}>
                <td className="px-3 py-2 font-medium">{i.uNo}</td>
                <td className="px-3 py-2">{i.typeName}</td>
                <td className="px-3 py-2">{i.statusLabel}</td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-stone-500">
                  No items here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4">Bulk items</h2>
        <table className="w-full text-sm mt-2">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {data.bulk.map((b) => (
              <tr key={b.bulkItemId} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/inventory/bulk/${b.bulkItemId}`)}>
                <td className="px-3 py-2 font-medium">{b.name}</td>
                <td className="px-3 py-2 text-right">
                  {b.quantity} {BULK_UNIT_LABEL[b.unit as keyof typeof BULK_UNIT_LABEL] ?? b.unit}
                </td>
              </tr>
            ))}
            {data.bulk.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-stone-500">
                  No bulk items here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

/**
 * Spec 021b section 4: the transfer dialog, used by the item page and the bulk item page (PC only).
 * The from place is pre-filled. A bulk transfer also takes a quantity.
 */
export function TransferDialog({
  kind,
  itemId,
  bulk,
  fromLocationId,
  places,
  balances,
  onClose,
  onSaved,
}: {
  kind: "item" | "bulk";
  itemId?: string;
  bulk?: { id: string; name: string; unit: string };
  fromLocationId: string;
  places: StockLocation[];
  /** Bulk only: the balance at each place, shown as a hint. */
  balances?: Record<string, number>;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}) {
  const active = places.filter((p) => p.active);
  const [from, setFrom] = useState(fromLocationId);
  const [to, setTo] = useState(() => active.find((p) => p.id !== fromLocationId)?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => newId());
  const placeName = (id: string) => places.find((p) => p.id === id)?.name ?? "";
  const fromChoices = places.filter((p) => p.active || p.id === fromLocationId);
  const toChoices = active.filter((p) => p.id !== from);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!to) {
      setErr("Choose the place it is moving to");
      return;
    }
    const n = kind === "bulk" ? Number(quantity) : 1;
    if (kind === "bulk" && (!Number.isInteger(n) || n < 1)) {
      setErr("Enter a whole number of pieces, 1 or more");
      return;
    }
    setBusy(true);
    try {
      await createTransfer({
        id: clientId,
        kind,
        inventoryItemId: kind === "item" ? itemId : null,
        bulkItemId: kind === "bulk" ? bulk?.id : null,
        quantity: kind === "bulk" ? n : undefined,
        fromLocationId: from,
        toLocationId: to,
        reason: reason.trim() || null,
      });
      await onSaved(kind === "item" ? `Moved to ${placeName(to)}.` : `${n} moved to ${placeName(to)}.`);
    } catch (e2) {
      setErr(errorText(e2, "Could not make the transfer. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const title = kind === "item" ? "Transfer item" : `Transfer ${bulk?.name ?? "bulk item"}`;
  const unit = bulk ? BULK_UNIT_LABEL[bulk.unit as keyof typeof BULK_UNIT_LABEL] ?? bulk.unit : "";
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3" aria-label="Transfer">
        {err && <Alert>{err}</Alert>}
        <Field label="From">
          <select className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From place">
            {fromChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {balances && balances[p.id] !== undefined ? ` (${balances[p.id]} ${unit})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To place">
            <option value="">Choose a place</option>
            {toChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {kind === "bulk" && (
          <Field label={`Quantity (${unit})`}>
            <input className={inputClass} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Transfer quantity" />
          </Field>
        )}
        <Field label="Reason (optional)">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="Transfer reason" />
        </Field>
        <div className="flex gap-2">
          <button className={btnPrimary} disabled={busy || !to}>
            Make transfer
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
