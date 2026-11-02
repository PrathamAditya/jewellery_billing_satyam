import { Fragment, useEffect, useState, type ChangeEvent } from "react";
import type { AuditOptionsResponse, AuditRowResponse } from "@jewellery/shared";
import { useAuth } from "../auth";
import { Alert, btnSecondary, inputClass } from "../customers/ui";
import { auditOptions, listAudit, type AuditFilters } from "./api";

/** Spec 051: read-only history of every change, newest first. Owner only (audit.view). */
const EMPTY: AuditFilters = { from: "", to: "", actor: "", entity: "", action: "" };

const whenText = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default function AuditPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState<AuditFilters>(EMPTY);
  const [rows, setRows] = useState<AuditRowResponse[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [options, setOptions] = useState<AuditOptionsResponse | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!can("audit.view")) return;
    auditOptions().then(setOptions).catch(() => setOptions(null));
  }, [can]);

  // A new filter starts again from the newest row.
  useEffect(() => {
    if (!can("audit.view")) return;
    let stale = false;
    setLoading(true);
    listAudit(filters, null)
      .then((r) => {
        if (stale) return;
        setRows(r.items);
        setNext(r.nextCursor);
        setError(null);
        setOpen(null);
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : "Could not load the audit history"))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [filters, can]);

  if (!can("audit.view")) {
    return <Alert>Only the owner can see the audit history.</Alert>;
  }

  const set = (k: keyof AuditFilters) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const loadMore = () => {
    if (!next) return;
    setLoading(true);
    listAudit(filters, next)
      .then((r) => (setRows((old) => [...old, ...r.items]), setNext(r.nextCursor)))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load more rows"))
      .finally(() => setLoading(false));
  };
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit history</h1>
        <p className="text-sm text-stone-600">Every change made in the system, newest first. This page only reads; nothing here can be edited.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <label className="flex flex-col gap-1 text-sm min-w-0">From<input className={`${inputClass} min-w-0`} type="date" value={filters.from} onChange={set("from")} aria-label="From date" /></label>
        <label className="flex flex-col gap-1 text-sm min-w-0">To<input className={`${inputClass} min-w-0`} type="date" value={filters.to} onChange={set("to")} aria-label="To date" /></label>
        <label className="flex flex-col gap-1 text-sm min-w-0">Who
          <select className={`${inputClass} min-w-0`} value={filters.actor} onChange={set("actor")} aria-label="Who">
            <option value="">Everyone</option>
            {options?.actors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm min-w-0">Record type
          <select className={`${inputClass} min-w-0`} value={filters.entity} onChange={set("entity")} aria-label="Record type">
            <option value="">All</option>
            {options?.entities.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm min-w-0">Action
          <select className={`${inputClass} min-w-0`} value={filters.action} onChange={set("action")} aria-label="Action">
            <option value="">All</option>
            {options?.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      {filtered && (
        <div>
          <button className={btnSecondary} onClick={() => setFilters(EMPTY)}>Clear filters</button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="relative bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[40rem]">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Who</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Record</th>
              <th className="px-3 py-2 font-medium"><span className="sr-only">Detail</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-stone-100">
                  <td className="px-3 py-2 whitespace-nowrap">{whenText(r.at)}</td>
                  <td className="px-3 py-2">{r.actorName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2">{r.entity} <span className="text-stone-500 font-mono text-xs">{r.entityId.slice(0, 8)}</span></td>
                  <td className="px-3 py-2 text-right">
                    {r.detail !== null && (
                      <button className="underline text-stone-700" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? "Hide" : "Detail"}
                      </button>
                    )}
                  </td>
                </tr>
                {open === r.id && (
                  <tr className="bg-stone-50">
                    <td colSpan={5} className="px-3 py-2">
                      <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(r.detail, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-stone-500">{filtered ? "No changes match these filters." : "No changes recorded yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {next && (
        <div>
          <button className={btnSecondary} onClick={loadMore} disabled={loading}>{loading ? "Loading..." : "Load older rows"}</button>
        </div>
      )}
    </div>
  );
}
