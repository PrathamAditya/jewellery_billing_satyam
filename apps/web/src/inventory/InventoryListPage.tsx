import { useEffect, useState } from "react";
import { INVENTORY_STATUSES, INVENTORY_STATUS_LABEL, formatWeightGrams, type InventoryItemResponse, type InventoryItemType } from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { navigate } from "../router";
import { listItems, listTypes } from "./api";
import { purityLabel } from "./labels";

/** Spec 020 section 4: the inventory list. Search and filters work on the phone; the buttons are PC only. */
export default function InventoryListPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [typeId, setTypeId] = useState("");
  const [status, setStatus] = useState("");
  const [types, setTypes] = useState<InventoryItemType[]>([]);
  const [items, setItems] = useState<InventoryItemResponse[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listTypes().then((r) => setTypes(r.items)).catch(() => setTypes([]));
  }, []);

  async function load(cursor: string | null) {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (typeId) params.set("typeId", typeId);
    if (status) params.set("status", status);
    if (cursor) params.set("cursor", cursor);
    try {
      const r = await listItems(`?${params.toString()}`);
      setItems(cursor ? (prev) => [...prev, ...r.items] : r.items);
      setNext(r.nextCursor);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load the items. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(null), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, typeId, status]);

  return (
    <main className="p-3 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Inventory</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="#/inventory/bulk" className="text-sm underline">Bulk items</a>
          <a href="#/inventory/locations" className="text-sm underline">Locations</a>
          {can("purchases.view") && (
            <a href="#/inventory/purchases" className="text-sm underline">Purchases</a>
          )}
          {can("inventory.edit") && (
            <a href="#/inventory/types" className={`text-sm underline ${pcOnly}`}>Item types</a>
          )}
          {can("inventory.edit") && (
            <button className={`${btnPrimary} ${pcOnly}`} onClick={() => navigate("/inventory/new")}>
              New item
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input className={inputClass} placeholder="Search U No., for example RING01" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search U No." />
        <select className={inputClass} value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Item type">
          <option value="">All types</option>
          {types.filter((t) => t.active).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {INVENTORY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INVENTORY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="text-red-700 text-sm">{err}</p>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">U No.</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Pieces</th>
              <th className="px-3 py-2">Purity</th>
              <th className="px-3 py-2 text-right">Net</th>
              <th className="px-3 py-2 max-md:hidden">Location</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/inventory/items/${i.id}`)}>
                <td className="px-3 py-2 font-medium">{i.uNo}</td>
                <td className="px-3 py-2">{i.typeName}</td>
                <td className="px-3 py-2 text-right">{i.pieces}</td>
                <td className="px-3 py-2">{purityLabel(i.purity)}</td>
                <td className="px-3 py-2 text-right">{formatWeightGrams(i.netWeightMg)} g</td>
                <td className="px-3 py-2 max-md:hidden">{i.locationName}</td>
                <td className="px-3 py-2">{i.voided ? <span className="text-red-700">Voided</span> : i.statusLabel}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-stone-500">No items found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {next && (
        <div className="text-center">
          <button className={btnSecondary} onClick={() => void load(next)} disabled={loading}>
            Load more
          </button>
        </div>
      )}
    </main>
  );
}
