import { useEffect, useState } from "react";
import type { InvoiceResponse } from "@jewellery/shared";
import { Alert, pcOnly } from "../customers/ui";
import { navigate } from "../router";
import InvoiceForm from "./InvoiceForm";
import { getInvoice } from "./api";

const PhoneNote = () => (
  <div className="md:hidden">
    <Alert kind="info">Making and editing invoices is done on the PC. This phone view is read-only.</Alert>
  </div>
);

export function NewInvoicePage() {
  return (
    <div className="flex flex-col gap-4">
      <PhoneNote />
      <div className={pcOnly}>
        <InvoiceForm onCancel={() => navigate("/invoices")} onSaved={(i) => navigate(`/invoices/${i.id}`)} />
      </div>
    </div>
  );
}

export function EditInvoicePage({ id }: { id: string }) {
  const [inv, setInv] = useState<InvoiceResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getInvoice(id)
      .then(setInv)
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load invoice"));
  }, [id]);
  if (err) return <Alert>{err}</Alert>;
  if (!inv) return <p className="text-stone-500">Loading...</p>;
  if (inv.voidedAt) return <Alert>A voided invoice cannot be edited.</Alert>;
  return (
    <div className="flex flex-col gap-4">
      <PhoneNote />
      <div className={pcOnly}>
        <InvoiceForm invoice={inv} onCancel={() => navigate(`/invoices/${id}`)} onSaved={() => navigate(`/invoices/${id}`)} />
      </div>
    </div>
  );
}
