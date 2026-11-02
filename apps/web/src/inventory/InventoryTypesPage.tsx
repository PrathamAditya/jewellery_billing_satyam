import { useEffect, useState, type FormEvent } from "react";
import type { InventoryItemType } from "@jewellery/shared";
import { ApiError } from "../api";
import { Alert, Field, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { createType, listTypes, updateType } from "./api";

/** Spec 020 I10, I11: the item types the owner extends. Types are made inactive, never deleted. PC only for changes. */
export default function InventoryTypesPage() {
  const [types, setTypes] = useState<InventoryItemType[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => listTypes().then((r) => setTypes(r.items)).catch(() => setErr("Could not load the item types."));
  useEffect(() => {
    void load();
  }, []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const t = await createType(name.trim(), code.trim());
      setOk(`${t.name} added with the code ${t.itemCode}.`);
      setName("");
      setCode("");
      await load();
    } catch (e2) {
      const issue = e2 instanceof ApiError && Array.isArray((e2.body as { issues?: { message: string }[] }).issues) ? (e2.body as { issues: { message: string }[] }).issues[0]?.message : null;
      setErr(issue ?? (e2 instanceof ApiError ? e2.message : "Could not add the type. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(t: InventoryItemType) {
    setErr(null);
    setOk(null);
    try {
      await updateType(t.id, { active: !t.active });
      await load();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not change the type.");
    }
  }

  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Item types</h1>
        <a href="#/inventory" className="text-sm underline">Back to inventory</a>
      </div>
      {ok && <Alert kind="ok">{ok}</Alert>}
      {err && <Alert>{err}</Alert>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">U No. code</th>
              <th className="px-3 py-2">Status</th>
              <th className={`px-3 py-2 ${pcOnly}`} />
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className="border-t border-stone-100">
                <td className="px-3 py-2">{t.name}</td>
                <td className="px-3 py-2 font-mono">{t.itemCode}</td>
                <td className="px-3 py-2">{t.active ? "In use" : "Inactive"}</td>
                <td className={`px-3 py-2 text-right ${pcOnly}`}>
                  <button className={btnSecondary} onClick={() => void onToggle(t)}>
                    {t.active ? "Make inactive" : "Make active"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={onAdd} className={`bg-white border border-stone-200 rounded-xl p-4 space-y-3 ${pcOnly}`} aria-label="Add item type">
        <h2 className="font-semibold">Add a type</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Type name" />
          </Field>
          <Field label="U No. code" hint="4 letters or digits, unique, like PEND">
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} maxLength={4} aria-label="Item code" />
          </Field>
        </div>
        <button className={btnPrimary} disabled={busy || !name.trim() || code.trim().length !== 4}>
          Add type
        </button>
      </form>
    </main>
  );
}
