import { useMemo, useRef, useState, type FormEvent } from "react";
import { cleanMobile, createCustomerSchema, newId, type CustomerResponse } from "@jewellery/shared";
import { ApiError } from "../api";
import { createCustomer, searchCustomers, updateCustomer } from "./api";
import { Alert, Field, btnPrimary, btnSecondary, inputClass } from "./ui";

type Values = {
  name: string;
  mobile: string;
  altMobile: string;
  address: string;
  city: string;
  pincode: string;
  pan: string;
  aadhaar: string;
  notes: string;
};

const blank: Values = { name: "", mobile: "", altMobile: "", address: "", city: "", pincode: "", pan: "", aadhaar: "", notes: "" };

const fromCustomer = (c: CustomerResponse): Values => ({
  name: c.name,
  mobile: c.mobile ?? "",
  altMobile: c.altMobile ?? "",
  address: c.address ?? "",
  city: c.city ?? "",
  pincode: c.pincode ?? "",
  pan: c.pan ?? "",
  aadhaar: "", // the full number is never sent to the screen; blank means "keep"
  notes: c.notes ?? "",
});

type Props = {
  /** Edit this customer. Leave out to create a new one. */
  customer?: CustomerResponse;
  onSaved: (customer: CustomerResponse) => void;
  onCancel: () => void;
  /** Spec 010 R5: "Use existing" on the duplicate-mobile prompt. */
  onUseExisting?: (customer: CustomerResponse) => void;
};

export default function CustomerForm({ customer, onSaved, onCancel, onUseExisting }: Props) {
  const editing = !!customer;
  const [v, setV] = useState<Values>(customer ? fromCustomer(customer) : blank);
  const [reason, setReason] = useState("");
  const [removeAadhaar, setRemoveAadhaar] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sameMobile, setSameMobile] = useState<CustomerResponse[] | null>(null);
  // One id per form: a double click or a retry after a flaky connection cannot create two customers (R7).
  const clientId = useRef(newId());

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const err = (k: string) => errors[k];

  const payload = useMemo(() => {
    const body: Record<string, unknown> = { ...v };
    if (editing) {
      if (removeAadhaar) body.aadhaar = null;
      else if (!v.aadhaar.trim()) delete body.aadhaar;
      if (reason.trim()) body.reason = reason.trim();
    } else {
      body.id = clientId.current;
    }
    return body;
  }, [v, editing, removeAadhaar, reason]);

  async function save() {
    setBusy(true);
    setFormError(null);
    try {
      const res = editing ? await updateCustomer(customer!.id, payload) : await createCustomer(payload);
      onSaved(res.customer);
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "validation") {
        const issues = (e.body as unknown as { issues: { field: string; message: string }[] }).issues;
        setErrors(Object.fromEntries(issues.map((i) => [i.field, i.message])));
      } else {
        setFormError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    // Same rules as the server, so the message appears under the field before anything is sent.
    const check = createCustomerSchema.safeParse({ ...payload, id: undefined });
    if (!check.success) {
      setErrors(Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});

    // R5: if this mobile already belongs to someone else, show them first.
    const mobileChanged = !editing || cleanMobile(v.mobile) !== customer!.mobile;
    const mobile = check.data.mobile;
    if (mobile && mobileChanged) {
      setBusy(true);
      try {
        const found = await searchCustomers(mobile);
        const same = found.items.filter((c) => c.id !== customer?.id && (c.mobile === mobile || c.altMobile === mobile));
        if (same.length > 0) {
          setSameMobile(same);
          return;
        }
      } catch (e2) {
        setFormError(e2 instanceof ApiError ? e2.message : "Something went wrong. Please try again.");
        return;
      } finally {
        setBusy(false);
      }
    }
    await save();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {sameMobile && (
        <Alert kind="info">
          <p className="font-medium">This mobile number already belongs to:</p>
          <ul className="my-2 list-disc pl-5">
            {sameMobile.map((c) => (
              <li key={c.id}>
                {c.customerNo} {c.name}
                {c.city ? `, ${c.city}` : ""}
                {onUseExisting && (
                  <button type="button" className="ml-2 underline" onClick={() => onUseExisting(c)}>
                    Use existing
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
              {editing ? "Save anyway" : "Save as new anyway"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setSameMobile(null)}>
              Back
            </button>
          </div>
        </Alert>
      )}

      <Field label="Name *" error={err("name")}>
        <input className={inputClass} value={v.name} onChange={set("name")} autoFocus autoComplete="off" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile" error={err("mobile")} hint="10 digits. +91 and spaces are fine.">
          <input className={inputClass} value={v.mobile} onChange={set("mobile")} inputMode="tel" autoComplete="off" />
        </Field>
        <Field label="Alternate mobile" error={err("altMobile")}>
          <input className={inputClass} value={v.altMobile} onChange={set("altMobile")} inputMode="tel" autoComplete="off" />
        </Field>
      </div>
      <Field label="Address" error={err("address")}>
        <textarea className={inputClass} rows={2} value={v.address} onChange={set("address")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" error={err("city")}>
          <input className={inputClass} value={v.city} onChange={set("city")} />
        </Field>
        <Field label="PIN code" error={err("pincode")}>
          <input className={inputClass} value={v.pincode} onChange={set("pincode")} inputMode="numeric" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PAN" error={err("pan")} hint="Example: ABCDE1234F">
          <input className={`${inputClass} uppercase`} value={v.pan} onChange={set("pan")} autoComplete="off" />
        </Field>
        <Field
          label="Aadhaar"
          error={err("aadhaar")}
          hint={editing && customer!.aadhaarMasked ? `Saved: ${customer!.aadhaarMasked}. Leave blank to keep it.` : "12 digits. Only if needed."}
        >
          <input className={inputClass} value={v.aadhaar} onChange={set("aadhaar")} inputMode="numeric" autoComplete="off" disabled={removeAadhaar} />
        </Field>
      </div>
      {editing && customer!.aadhaarMasked && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={removeAadhaar} onChange={(e) => setRemoveAadhaar(e.target.checked)} />
          Remove the saved Aadhaar number
        </label>
      )}
      <Field label="Notes" error={err("notes")}>
        <textarea className={inputClass} rows={2} value={v.notes} onChange={set("notes")} />
      </Field>
      {editing && (
        <Field label="Reason for this change (optional)">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
        </Field>
      )}

      {formError && <Alert>{formError}</Alert>}

      <div className="flex gap-2 justify-end">
        <button type="button" className={btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? "Saving..." : editing ? "Save changes" : "Save customer"}
        </button>
      </div>
    </form>
  );
}
