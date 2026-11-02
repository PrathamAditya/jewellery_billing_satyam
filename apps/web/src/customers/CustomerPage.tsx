import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CustomerHistoryEntry, CustomerResponse } from "@jewellery/shared";
import { navigate } from "../router";
import { ApiError } from "../api";
import { getCustomer, getHistory, restoreCustomer, revealAadhaar, voidCustomer } from "./api";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "./ui";
import { useAuth } from "../auth";
import LedgerTab from "../ledger/LedgerTab";

type Tab = "details" | "history" | "ledger";

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  mobile: "Mobile",
  altMobile: "Alternate mobile",
  address: "Address",
  city: "City",
  pincode: "PIN code",
  pan: "PAN",
  aadhaar: "Aadhaar",
  notes: "Notes",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

function Details({ c }: { c: CustomerResponse }) {
  const { can } = useAuth();
  const [aadhaar, setAadhaar] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function show() {
    setErr(null);
    try {
      setAadhaar((await revealAadhaar(c.id)).aadhaar.replace(/(\d{4})(?=\d)/g, "$1 "));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not show the number");
    }
  }

  const row = (label: string, value: string | null) => (
    <div className="grid sm:grid-cols-[10rem_1fr] gap-1 py-2 border-b border-stone-100">
      <dt className="text-stone-500 text-sm">{label}</dt>
      <dd className="whitespace-pre-line break-words">{value || <span className="text-stone-400">-</span>}</dd>
    </div>
  );

  return (
    <dl className="bg-white border border-stone-200 rounded-xl px-4 py-2">
      {row("Customer no.", c.customerNo)}
      {row("Name", c.name)}
      {row("Mobile", c.mobile)}
      {row("Alternate mobile", c.altMobile)}
      {row("Address", c.address)}
      {row("City", c.city)}
      {row("PIN code", c.pincode)}
      {row("PAN", c.pan)}
      <div className="grid sm:grid-cols-[10rem_1fr] gap-1 py-2 border-b border-stone-100">
        <dt className="text-stone-500 text-sm">Aadhaar</dt>
        <dd>
          {c.aadhaarMasked ? (
            <span className="flex items-center gap-3 flex-wrap">
              <span className="font-mono">{aadhaar ?? c.aadhaarMasked}</span>
              {aadhaar ? (
                <button className="text-sm underline" onClick={() => setAadhaar(null)}>
                  Hide
                </button>
              ) : can("customers.edit") ? (
                // The reveal API needs customers.edit (spec 010 R14), so a viewer is not offered it.
                <button className="text-sm underline" onClick={() => void show()}>
                  Show
                </button>
              ) : null}
              {err && <span className="text-sm text-red-700">{err}</span>}
            </span>
          ) : (
            <span className="text-stone-400">-</span>
          )}
        </dd>
      </div>
      {row("Notes", c.notes)}
      {row("Added", when(c.createdAt))}
      {row("Last changed", when(c.updatedAt))}
    </dl>
  );
}

function History({ id }: { id: string }) {
  const [items, setItems] = useState<CustomerHistoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getHistory(id)
      .then((r) => setItems(r.items))
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load history"));
  }, [id]);

  if (err) return <Alert>{err}</Alert>;
  if (!items) return <p className="text-sm text-stone-500">Loading...</p>;
  if (items.length === 0) return <p className="text-stone-500">No changes yet. This customer has never been edited.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((h) => (
        <li key={h.revisionNo} className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="text-sm text-stone-500">
            {when(h.at)}, change {h.revisionNo}
            {h.reason ? ` - "${h.reason}"` : ""}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {h.changes.map((ch) => (
              <li key={ch.field}>
                <span className="font-medium">{FIELD_LABEL[ch.field] ?? ch.field}:</span>{" "}
                <span className="text-stone-500 line-through">{ch.from ?? "(empty)"}</span> to <span>{ch.to ?? "(empty)"}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function VoidDialog({ c, onClose, onDone }: { c: CustomerResponse; onClose: () => void; onDone: (c: CustomerResponse) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setErr("Please give a reason");
    setBusy(true);
    try {
      onDone(await voidCustomer(c.id, reason.trim()));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Something went wrong");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Void ${c.name}?`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-stone-600">A voided customer is hidden from search but never deleted. You can restore them later.</p>
        <Field label="Reason *">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            Void customer
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function CustomerPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [c, setC] = useState<CustomerResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("details");
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    getCustomer(id)
      .then(setC)
      .catch((e) => setErr(e instanceof ApiError && e.status === 404 ? "Customer not found." : e instanceof Error ? e.message : "Could not load customer"));
  }, [id]);
  useEffect(load, [load]);

  async function restore() {
    setNotice(null);
    try {
      setC(await restoreCustomer(id));
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Could not restore");
    }
  }

  if (err) return <Alert>{err}</Alert>;
  if (!c) return <p className="text-stone-500">Loading...</p>;

  const tabBtn = (t: Tab, label: string) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`px-3 py-2 text-sm border-b-2 ${tab === t ? "border-stone-900 font-medium" : "border-transparent text-stone-500"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <a href="#/customers" className="text-sm text-stone-600 underline">
        All customers
      </a>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <p className="text-stone-500 text-sm">
            {c.customerNo}
            {c.voidedAt && <span className="ml-2 text-red-700">voided: {c.voidReason}</span>}
          </p>
        </div>
        <div className={`flex gap-2 ${pcOnly}`}>
          {c.voidedAt ? (
            can("customers.void") && (
              <button className={btnPrimary} onClick={() => void restore()}>
                Restore
              </button>
            )
          ) : (
            <>
              {can("customers.edit") && (
                <button className={btnPrimary} onClick={() => navigate(`/customers/${c.id}/edit`)}>
                  Edit
                </button>
              )}
              {can("customers.void") && (
                <button className={btnSecondary} onClick={() => setVoiding(true)}>
                  Void
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {notice && <Alert>{notice}</Alert>}

      <div className="flex gap-1 border-b border-stone-200">
        {tabBtn("details", "Details")}
        {tabBtn("history", "History")}
        {tabBtn("ledger", "Ledger")}
      </div>

      {tab === "details" && <Details c={c} />}
      {tab === "history" && <History id={c.id} />}
      {tab === "ledger" && <LedgerTab customerId={c.id} customerName={c.name} />}

      {voiding && (
        <VoidDialog
          c={c}
          onClose={() => setVoiding(false)}
          onDone={(v) => {
            setC(v);
            setVoiding(false);
          }}
        />
      )}
    </div>
  );
}
