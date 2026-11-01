import type { CustomerResponse } from "@jewellery/shared";
import { navigate } from "../router";
import CustomerForm from "./CustomerForm";
import CustomerPicker from "./CustomerPicker";
import { useEffect, useState } from "react";
import { getCustomer } from "./api";
import { Alert, pcOnly } from "./ui";

export function NewCustomerPage() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">New customer</h1>
      <div className="md:hidden">
        <Alert kind="info">Adding and editing customers is done on the PC. This phone view is read-only.</Alert>
      </div>
      <div className={pcOnly}>
        <CustomerForm
          onCancel={() => navigate("/customers")}
          onSaved={(c) => navigate(`/customers/${c.id}`)}
          onUseExisting={(c) => navigate(`/customers/${c.id}`)}
        />
      </div>
    </div>
  );
}

export function EditCustomerPage({ id }: { id: string }) {
  const [c, setC] = useState<CustomerResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getCustomer(id)
      .then(setC)
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load customer"));
  }, [id]);
  if (err) return <Alert>{err}</Alert>;
  if (!c) return <p className="text-stone-500">Loading...</p>;
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">Edit {c.name}</h1>
      <div className="md:hidden">
        <Alert kind="info">Adding and editing customers is done on the PC. This phone view is read-only.</Alert>
      </div>
      <div className={pcOnly}>
        <CustomerForm
          customer={c}
          onCancel={() => navigate(`/customers/${id}`)}
          onSaved={() => navigate(`/customers/${id}`)}
          onUseExisting={(o) => navigate(`/customers/${o.id}`)}
        />
      </div>
    </div>
  );
}

/** Preview of the reusable picker (spec 010, screens). Spec 013 will use the component inside the invoice form. */
export function PickerDemoPage() {
  const [picked, setPicked] = useState<CustomerResponse | null>(null);
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">Customer picker</h1>
      <CustomerPicker onPick={setPicked} />
      {picked && (
        <Alert kind="ok">
          Picked: <strong>{picked.name}</strong> ({picked.customerNo}
          {picked.mobile ? `, ${picked.mobile}` : ""})
        </Alert>
      )}
    </div>
  );
}
