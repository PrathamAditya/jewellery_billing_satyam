import { useEffect, useState, type FormEvent } from "react";
import type { CustomerResponse, OrderSummary } from "@jewellery/shared";
import { formatMoney } from "@jewellery/shared";
import { navigate } from "../router";
import { useAuth } from "../auth";
import CustomerPicker from "../customers/CustomerPicker";
import { useDebounced } from "../customers/useDebounced";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { createOrder, listOrders } from "./api";
import { ApiError } from "../api";

function NewOrderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [customer, setCustomer] = useState<CustomerResponse | null>(null);
  const [description, setDescription] = useState("");
  const [expected, setExpected] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!customer) return setError("Choose the customer");
    try {
      const o = await createOrder({ customerId: customer.id, description, expectedDate: expected || undefined });
      onCreated(o.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the order");
    }
  }
  return (
    <Modal title="New order" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {customer ? (
          <p className="text-sm">Customer: <strong>{customer.name}</strong> <button type="button" className="underline ml-2" onClick={() => setCustomer(null)}>Change</button></p>
        ) : (
          <CustomerPicker onPick={setCustomer} />
        )}
        <Field label="What is the order for?"><input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="e.g. Bridal set, wedding in December" /></Field>
        <Field label="Expected delivery date (optional)"><input className={inputClass} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary}>Create order</button>
        </div>
      </form>
    </Modal>
  );
}

export default function OrdersPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<OrderSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useDebounced(q, 250);
  useEffect(() => {
    listOrders(query).then((r) => (setItems(r.items), setError(null))).catch((e) => setError(e instanceof Error ? e.message : "Could not load orders"));
  }, [query]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Orders</h1>
        {can("advances.create") && <button className={`${btnPrimary} ${pcOnly}`} onClick={() => setCreating(true)}>New order</button>}
      </div>
      <input className={inputClass} type="search" placeholder="Search by order number or customer" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
      {error && <Alert>{error}</Alert>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[32rem]">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr><th className="px-3 py-2 font-medium">Order</th><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">For</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium text-right">Advance held</th></tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/orders/${o.id}`)}>
                <td className="px-3 py-2"><a href={`#/orders/${o.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{o.orderNo}</a></td>
                <td className="px-3 py-2">{o.customerName}</td>
                <td className="px-3 py-2">{o.description || "-"}</td>
                <td className="px-3 py-2 capitalize">{o.status}</td>
                <td className="px-3 py-2 text-right">{formatMoney(o.remainingPaise)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-stone-500">No orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {creating && <NewOrderDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/orders/${id}`)} />}
    </div>
  );
}
