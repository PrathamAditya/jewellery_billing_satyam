import { useEffect, useState } from "react";
import type { CustomerResponse } from "@jewellery/shared";
import { navigate } from "../router";
import { searchCustomers } from "./api";
import { useDebounced } from "./useDebounced";
import { useAuth } from "../auth";
import { Alert, btnPrimary, inputClass, pcOnly } from "./ui";

export default function CustomerList() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);
  const [items, setItems] = useState<CustomerResponse[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = useDebounced(q, 250);

  useEffect(() => {
    let live = true;
    setLoading(true);
    searchCustomers(query, { includeVoided })
      .then((r) => {
        if (!live) return;
        setItems(r.items);
        setNext(r.nextCursor);
        setError(null);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load customers"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [query, includeVoided]);

  async function more() {
    if (!next) return;
    setLoading(true);
    try {
      const r = await searchCustomers(query, { includeVoided, cursor: next });
      setItems((p) => [...p, ...r.items]);
      setNext(r.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Customers</h1>
        {can("customers.create") && <button className={`${btnPrimary} ${pcOnly}`} onClick={() => navigate("/customers/new")}>
          New customer
        </button>}
      </div>

      <input
        className={inputClass}
        type="search"
        placeholder="Search by number, name, mobile or PAN"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search customers"
        autoFocus
      />
      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" checked={includeVoided} onChange={(e) => setIncludeVoided(e.target.checked)} />
        Show voided
      </label>

      {error && <Alert>{error}</Alert>}

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2 font-medium">No.</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Mobile</th>
              <th className="px-3 py-2 font-medium max-sm:hidden">City</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>
                <td className="px-3 py-2 whitespace-nowrap">{c.customerNo}</td>
                <td className="px-3 py-2">
                  <a href={`#/customers/${c.id}`} className="font-medium underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {c.name}
                  </a>
                  {c.voidedAt && <span className="ml-2 text-xs text-red-700 border border-red-200 rounded px-1">voided</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{c.mobile ?? ""}</td>
                <td className="px-3 py-2 max-sm:hidden">{c.city ?? ""}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-stone-500">
                  {query ? "No customers match this search." : "No customers yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <p className="text-sm text-stone-500">Loading...</p>}
      {next && !loading && (
        <button className="self-center px-4 py-2 rounded-lg border border-stone-300 bg-white" onClick={() => void more()}>
          Next page
        </button>
      )}
    </div>
  );
}
