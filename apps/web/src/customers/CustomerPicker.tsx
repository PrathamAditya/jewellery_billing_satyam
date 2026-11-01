import { useEffect, useState } from "react";
import type { CustomerResponse } from "@jewellery/shared";
import { searchCustomers } from "./api";
import CustomerForm from "./CustomerForm";
import { useDebounced } from "./useDebounced";
import { Alert, Modal, btnSecondary, inputClass } from "./ui";

/**
 * Search as you type, pick a customer, or add a new one. Spec 013 (invoices) and the receipt
 * screens use this. `onPick` gets the chosen or newly created customer.
 */
export default function CustomerPicker({ onPick, autoFocus = true }: { onPick: (c: CustomerResponse) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CustomerResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const query = useDebounced(q, 250);

  useEffect(() => {
    if (!query.trim()) {
      setItems([]);
      return;
    }
    let live = true;
    setLoading(true);
    searchCustomers(query)
      .then((r) => live && (setItems(r.items), setError(null)))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Search failed"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [query]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className={inputClass}
          type="search"
          placeholder="Find customer by name, mobile, number or PAN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find customer"
          autoFocus={autoFocus}
        />
        <button type="button" className={`${btnSecondary} whitespace-nowrap`} onClick={() => setAdding(true)}>
          Add new customer
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {query.trim() && (
        <ul role="listbox" aria-label="Matching customers" className="bg-white border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-72 overflow-y-auto">
          {items.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-stone-50" onClick={() => onPick(c)}>
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-stone-500">
                  {" "}
                  {c.customerNo}
                  {c.mobile ? `, ${c.mobile}` : ""}
                  {c.city ? `, ${c.city}` : ""}
                </span>
              </button>
            </li>
          ))}
          {!loading && items.length === 0 && <li className="px-3 py-3 text-sm text-stone-500">No customer found. Use "Add new customer".</li>}
        </ul>
      )}
      {adding && (
        <Modal title="New customer" onClose={() => setAdding(false)}>
          <CustomerForm
            onCancel={() => setAdding(false)}
            onSaved={(c) => {
              setAdding(false);
              onPick(c);
            }}
            onUseExisting={(c) => {
              setAdding(false);
              onPick(c);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
