import { useEffect, useState, type FormEvent } from "react";
import {
  DEFAULT_LOCATION_ID,
  KARIGAR_GOLD_PURITIES,
  KARIGAR_PAYMENT_MODES,
  KARIGAR_PAYMENT_MODE_LABEL,
  KARIGAR_WASTAGE_BPS_DEFAULT,
  formatMoney,
  formatWeightGrams,
  indiaDate,
  newId,
  parsePercentToBps,
  parseRupeesToPaise,
  parseWeightGrams,
  type KarigarDetail,
  type KarigarJobDetail,
  type KarigarJobListItem,
  type KarigarListItem,
  type KarigarMetalBalance,
  type KarigarStatementRow,
  type StockLocation,
} from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { niceDate } from "../rates/api";
import { navigate } from "../router";
import { listLocations } from "../inventory/api";
import { purityLabel } from "../inventory/labels";
import * as K from "./api";

/** Spec 023: karigar list and page (balances, statement, payout), the new job form and the job page. Phone: read only. */

type Issue = { field: string; message: string };
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const fieldIssues = (e: unknown): Issue[] => (e instanceof ApiError && Array.isArray((e.body as { issues?: Issue[] }).issues) ? (e.body as { issues: Issue[] }).issues : []);
const grams = (mg: number) => `${formatWeightGrams(mg)} g`;
const dateText = (d: string) => niceDate(d);
const purityOf = (metal: string, purity: string) => (metal === "silver" ? "Silver" : purityLabel(purity));

/** The metal still with a karigar, as one line per purity. */
function balanceLines(balances: KarigarMetalBalance[]) {
  if (balances.length === 0) return <span className="text-stone-500">None with the karigar</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {balances.map((b) => (
        <li key={`${b.metal}-${b.purity}`}>
          {purityOf(b.metal, b.purity)}: <span className="tabular-nums">{grams(b.heldMg)}</span>
        </li>
      ))}
    </ul>
  );
}

const PURITY_OPTIONS = [...KARIGAR_GOLD_PURITIES, "silver"] as const;

// ---- list ----

export function KarigarListPage() {
  const { can } = useAuth();
  const [items, setItems] = useState<KarigarListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    K.listKarigars()
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e, "Could not load the karigars.")));
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Karigars</h1>
        {can("karigar.edit") && (
          <button className={`${btnPrimary} ${pcOnly}`} onClick={() => setAdding(true)}>
            New karigar
          </button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {items === null && !error && <p className="text-stone-500">Loading...</p>}
      {items?.length === 0 && <p className="text-stone-600">No karigars yet.</p>}
      {items && items.length > 0 && (
        <div className="overflow-x-auto bg-white border border-stone-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-600">
              <tr>
                <th className="px-3 py-2">Karigar</th>
                <th className="px-3 py-2">With the karigar</th>
                <th className="px-3 py-2 text-right">Labour owed</th>
                <th className="px-3 py-2 text-right">Open jobs</th>
              </tr>
            </thead>
            <tbody>
              {items.map((k) => (
                <tr key={k.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2">
                    <a href={`#/karigar/${k.id}`} className="underline">
                      {k.name}
                    </a>
                    {k.phone && <div className="text-xs text-stone-500">{k.phone}</div>}
                  </td>
                  <td className="px-3 py-2">{balanceLines(k.balances)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(k.labourPayablePaise)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.openJobs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <NewKarigarModal onClose={() => setAdding(false)} onSaved={(id) => navigate(`/karigar/${id}`)} />}
    </section>
  );
}

function NewKarigarModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [remarks, setRemarks] = useState("");
  const [clientId] = useState(() => newId());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});
    try {
      const r = await K.createKarigar({ id: clientId, name: name.trim(), phone: phone.trim() || null, remarks: remarks.trim() || null });
      onSaved(r.karigar.id);
    } catch (err) {
      const issues = fieldIssues(err);
      if (issues.length) setErrors(Object.fromEntries(issues.map((i) => [i.field, i.message])));
      else setFormError(errorText(err, "Could not save the karigar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New karigar" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <Field label="Name" error={errors.name}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label="Karigar name" />
        </Field>
        <Field label="Phone (optional)" error={errors.phone}>
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Karigar phone" inputMode="tel" />
        </Field>
        <Field label="Remarks (optional)" error={errors.remarks}>
          <input className={inputClass} value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-label="Karigar remarks" />
        </Field>
        {formError && <Alert>{formError}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={busy}>
            Save karigar
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- karigar page ----

function statementTable(rows: KarigarStatementRow[]) {
  if (rows.length === 0) return <p className="text-stone-500">No entries yet.</p>;
  return (
    <div className="overflow-x-auto bg-white border border-stone-200 rounded-xl">
      <table className="w-full text-sm">
        <thead className="text-left text-stone-600">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Entry</th>
            <th className="px-3 py-2">Job</th>
            <th className="px-3 py-2">Metal</th>
            <th className="px-3 py-2 text-right">Weight</th>
            <th className="px-3 py-2 text-right">Pieces</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-right">Held after</th>
            <th className="px-3 py-2 text-right">Labour owed after</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-stone-100">
              <td className="px-3 py-2 whitespace-nowrap">{dateText(r.entryDate)}</td>
              <td className="px-3 py-2">
                {r.kindLabel}
                {r.part && <span className="text-stone-500"> ({r.part === "finished" ? "pieces" : "remainder"})</span>}
                {r.paymentModeLabel && <div className="text-xs text-stone-500">{r.paymentModeLabel}{r.reference ? ` ${r.reference}` : ""}</div>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{r.jobId ? <a className="underline" href={`#/karigar/jobs/${r.jobId}`}>{r.jobNo}</a> : "-"}</td>
              <td className="px-3 py-2">{r.metal && r.purity ? purityOf(r.metal, r.purity) : "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.weightMg !== null ? grams(r.weightMg) : "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.pieces ?? "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.amountPaise !== null ? formatMoney(r.amountPaise) : "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.heldAfterMg !== null ? grams(r.heldAfterMg) : "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.labourPayableAfterPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KarigarPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [data, setData] = useState<{ karigar: KarigarDetail; jobs: KarigarJobListItem[]; statement: KarigarStatementRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    K.getKarigar(id)
      .then((r) => setData(r))
      .catch((e) => setError(errorText(e, "Could not load this karigar.")));
  }, [id, reload]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-stone-500">Loading...</p>;
  const k = data.karigar;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <a href="#/karigar" className="text-sm underline text-stone-600">
            Karigars
          </a>
          <h1 className="text-2xl font-semibold">{k.name}</h1>
          {k.phone && <p className="text-stone-600">{k.phone}</p>}
          {k.remarks && <p className="text-stone-600 text-sm">{k.remarks}</p>}
        </div>
        {can("karigar.edit") && (
          <button className={`${btnPrimary} ${pcOnly}`} onClick={() => navigate(`/karigar/jobs/new?karigar=${k.id}`)}>
            New job
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="font-semibold mb-2">Metal with the karigar</h2>
          {balanceLines(k.balances)}
        </div>
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="font-semibold mb-2">Labour</h2>
          <p className="text-2xl tabular-nums">{formatMoney(k.labourPayablePaise)} owed</p>
          <p className="text-sm text-stone-600">
            Labour {formatMoney(k.labourAccruedPaise)}, paid {formatMoney(k.labourPaidPaise)}
          </p>
        </div>
      </div>

      {can("karigar.edit") && (
        <PayoutForm karigarId={k.id} payable={k.labourPayablePaise} onDone={() => setReload((n) => n + 1)} />
      )}

      <h2 className="text-lg font-semibold">Jobs</h2>
      {data.jobs.length === 0 ? (
        <p className="text-stone-500">No jobs yet.</p>
      ) : (
        <div className="overflow-x-auto bg-white border border-stone-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-600">
              <tr>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Metal issued</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id} className="border-t border-stone-100">
                  <td className="px-3 py-2">
                    <a href={`#/karigar/jobs/${j.id}`} className="underline">
                      {j.jobNo}
                    </a>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{dateText(j.jobDate)}</td>
                  <td className="px-3 py-2">{j.status === "open" ? "Open" : "Closed"}</td>
                  <td className="px-3 py-2">
                    {j.issued.map((l) => `${purityOf(l.metal, l.purity)} ${grams(l.weightMg)}`).join(", ") || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-lg font-semibold">Statement</h2>
      {statementTable(data.statement)}
    </section>
  );
}

function PayoutForm({ karigarId, payable, onDone }: { karigarId: string; payable: number; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof KARIGAR_PAYMENT_MODES)[number]>("cash");
  const [reference, setReference] = useState("");
  const [payoutDate, setPayoutDate] = useState(indiaDate());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    const parsed = parseRupeesToPaise(amount, "amount");
    if (!parsed.ok) return setErrors({ amountPaise: parsed.message });
    setBusy(true);
    try {
      await K.payKarigar(karigarId, { id: newId(), payoutDate, amountPaise: parsed.value, paymentMode: mode, reference: reference.trim() || null, remarks: null });
      setAmount("");
      setReference("");
      onDone();
    } catch (err) {
      const issues = fieldIssues(err);
      if (issues.length) setErrors(Object.fromEntries(issues.map((i) => [i.field, i.message])));
      else setFormError(errorText(err, "Could not record the payment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${pcOnly} bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3`} onSubmit={onSubmit} noValidate aria-label="Pay the karigar">
      <h2 className="font-semibold">Pay the karigar</h2>
      <p className="text-sm text-stone-600">Up to {formatMoney(payable)} can be paid now.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Amount (₹)" error={errors.amountPaise}>
          <input className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Payment amount" inputMode="decimal" />
        </Field>
        <Field label="Mode">
          <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as (typeof KARIGAR_PAYMENT_MODES)[number])} aria-label="Payment mode">
            {KARIGAR_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {KARIGAR_PAYMENT_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference (optional)" error={errors.reference}>
          <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />
        </Field>
        <Field label="Date" error={errors.payoutDate}>
          <input className={inputClass} value={payoutDate} onChange={(e) => setPayoutDate(e.target.value)} aria-label="Payment date" />
        </Field>
      </div>
      {formError && <Alert>{formError}</Alert>}
      <div>
        <button className={btnPrimary} disabled={busy}>
          Record payment
        </button>
      </div>
    </form>
  );
}

// ---- new job ----

type IssueLine = { key: number; metal: "gold" | "silver"; purity: string; weight: string };
type ReturnLine = { key: number; part: "finished" | "remainder"; purity: string; weight: string; pieces: string; tested: string };
let lineKey = 0;
const nextKey = () => ++lineKey;

export function NewJobPage() {
  const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const [karigars, setKarigars] = useState<KarigarListItem[]>([]);
  const [places, setPlaces] = useState<StockLocation[]>([]);
  const [karigarId, setKarigarId] = useState(query.get("karigar") ?? "");
  const [jobDate, setJobDate] = useState(indiaDate());
  const [sourceLocationId, setSourceLocationId] = useState(DEFAULT_LOCATION_ID);
  const [labourBasis, setLabourBasis] = useState<"gram" | "piece">("gram");
  const [labourRate, setLabourRate] = useState("");
  const [wastage, setWastage] = useState((KARIGAR_WASTAGE_BPS_DEFAULT / 100).toFixed(2));
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<IssueLine[]>([{ key: nextKey(), metal: "gold", purity: "22K916", weight: "" }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => newId());

  useEffect(() => {
    K.listKarigars().then((r) => setKarigars(r.items));
    listLocations().then((r) => setPlaces(r.items.filter((p) => p.active)));
  }, []);

  function updateLine(key: number, patch: Partial<IssueLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const nextErr: Record<string, string> = {};
    const nextLineErr: Record<number, string> = {};
    if (!karigarId) nextErr.karigarId = "Choose the karigar";
    const rate = parseRupeesToPaise(labourRate, "labour rate");
    if (!rate.ok) nextErr.labourRatePaise = rate.message;
    const bps = parsePercentToBps(wastage);
    if (!bps.ok) nextErr.wastageBps = bps.message;
    const issues = lines.map((l, i) => {
      const w = parseWeightGrams(l.weight);
      if (!w.ok) nextLineErr[i] = w.message;
      return { metal: l.metal, purity: l.metal === "silver" ? "silver" : l.purity, weightMg: w.ok ? w.mg : 0 };
    });
    setErrors(nextErr);
    setLineErrors(nextLineErr);
    if (Object.keys(nextErr).length || Object.keys(nextLineErr).length || !rate.ok || !bps.ok) return;
    setBusy(true);
    try {
      const r = await K.openJob({
        id: clientId,
        karigarId,
        jobDate,
        sourceLocationId,
        labourBasis,
        labourRatePaise: rate.ok ? rate.value : 0,
        wastageBps: bps.ok ? bps.value : 0,
        remarks: remarks.trim() || null,
        issues,
      });
      navigate(`/karigar/jobs/${r.job.id}`);
    } catch (err) {
      const list = fieldIssues(err);
      if (list.length) {
        const h: Record<string, string> = {};
        const l: Record<number, string> = {};
        for (const i of list) {
          const m = /^issues\.(\d+)/.exec(i.field);
          if (m) l[Number(m[1]) - 1] = i.message;
          else h[i.field || "form"] = i.message;
        }
        setErrors(h);
        setLineErrors(l);
      } else setFormError(errorText(err, "Could not open the job."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <a href="#/karigar" className="text-sm underline text-stone-600">
        Karigars
      </a>
      <h1 className="text-2xl font-semibold">New job</h1>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Karigar" error={errors.karigarId}>
            <select className={inputClass} value={karigarId} onChange={(e) => setKarigarId(e.target.value)} aria-label="Karigar">
              <option value="">Choose the karigar</option>
              {karigars.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Job date" error={errors.jobDate}>
            <input className={inputClass} value={jobDate} onChange={(e) => setJobDate(e.target.value)} aria-label="Job date" />
          </Field>
          <Field label="Metal given from" error={errors.sourceLocationId} hint="The place the shop takes the metal from, and returns the remainder to.">
            <select className={inputClass} value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)} aria-label="Metal given from">
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Labour is charged" error={errors.labourBasis}>
            <select className={inputClass} value={labourBasis} onChange={(e) => setLabourBasis(e.target.value as "gram" | "piece")} aria-label="Labour basis">
              <option value="gram">Per gram of finished weight</option>
              <option value="piece">Per piece</option>
            </select>
          </Field>
          <Field label={labourBasis === "gram" ? "Labour per gram (₹)" : "Labour per piece (₹)"} error={errors.labourRatePaise}>
            <input className={inputClass} value={labourRate} onChange={(e) => setLabourRate(e.target.value)} aria-label="Labour rate" inputMode="decimal" />
          </Field>
          <Field label="Wastage allowance (%)" error={errors.wastageBps} hint="Metal not returned above this share of the issued metal is refused at close.">
            <input className={inputClass} value={wastage} onChange={(e) => setWastage(e.target.value)} aria-label="Wastage allowance" inputMode="decimal" />
          </Field>
          <Field label="Remarks (optional)" error={errors.remarks}>
            <input className={inputClass} value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-label="Job remarks" />
          </Field>
        </div>

        <h2 className="font-semibold">Metal issued</h2>
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-2 sm:grid-cols-[8rem_10rem_10rem_auto] items-end">
            <Field label={`Line ${i + 1} metal`}>
              <select
                className={inputClass}
                value={l.metal}
                onChange={(e) => updateLine(l.key, { metal: e.target.value as "gold" | "silver", purity: e.target.value === "silver" ? "silver" : "22K916" })}
                aria-label={`Line ${i + 1} metal`}
              >
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
              </select>
            </Field>
            <Field label={`Line ${i + 1} purity`}>
              <select className={inputClass} value={l.purity} disabled={l.metal === "silver"} onChange={(e) => updateLine(l.key, { purity: e.target.value })} aria-label={`Line ${i + 1} purity`}>
                {l.metal === "silver" ? (
                  <option value="silver">Silver</option>
                ) : (
                  PURITY_OPTIONS.filter((p) => p !== "silver").map((p) => (
                    <option key={p} value={p}>
                      {purityLabel(p)}
                    </option>
                  ))
                )}
              </select>
            </Field>
            <Field label={`Line ${i + 1} weight (g)`} error={lineErrors[i]}>
              <input className={inputClass} value={l.weight} onChange={(e) => updateLine(l.key, { weight: e.target.value })} aria-label={`Line ${i + 1} weight`} inputMode="decimal" />
            </Field>
            <button type="button" className={`${btnSecondary} ${lines.length === 1 ? "invisible" : ""}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length === 1}>
              Remove
            </button>
          </div>
        ))}
        {lines.length < 10 && (
          <div>
            <button type="button" className={btnSecondary} onClick={() => setLines((ls) => [...ls, { key: nextKey(), metal: "gold", purity: "22K916", weight: "" }])}>
              Add metal line
            </button>
          </div>
        )}
        {formError && <Alert>{formError}</Alert>}
        <div className="flex justify-end">
          <button className={btnPrimary} disabled={busy}>
            Open job
          </button>
        </div>
      </form>
    </section>
  );
}

// ---- job page ----

export function JobPage({ id }: { id: string }) {
  const { can } = useAuth();
  const [job, setJob] = useState<KarigarJobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    K.getJob(id)
      .then((r) => setJob(r.job))
      .catch((e) => setError(errorText(e, "Could not load this job.")));
  }, [id, reload]);

  if (error) return <Alert>{error}</Alert>;
  if (!job) return <p className="text-stone-500">Loading...</p>;
  const open = job.status === "open";
  const canEdit = can("karigar.edit") && open;

  return (
    <section className="flex flex-col gap-5">
      <div>
        <a href={`#/karigar/${job.karigarId}`} className="text-sm underline text-stone-600">
          {job.karigarName}
        </a>
        <h1 className="text-2xl font-semibold">{job.jobNo}</h1>
        <p className="text-stone-600 text-sm">
          {dateText(job.jobDate)} · {open ? "Open" : "Closed"} · from {job.sourceLocationName} · labour{" "}
          {job.labourBasis === "gram" ? "per gram" : "per piece"} {formatMoney(job.labourRatePaise)} · wastage allowance {(job.wastageBps / 100).toFixed(2)}%
        </p>
        {job.remarks && <p className="text-sm text-stone-600">{job.remarks}</p>}
      </div>

      <div className="overflow-x-auto bg-white border border-stone-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-600">
            <tr>
              <th className="px-3 py-2">Metal</th>
              <th className="px-3 py-2 text-right">Issued</th>
              <th className="px-3 py-2 text-right">Back, finished</th>
              <th className="px-3 py-2 text-right">Back, remainder</th>
              <th className="px-3 py-2 text-right">Wastage</th>
              <th className="px-3 py-2 text-right">Still with karigar</th>
              <th className="px-3 py-2 text-right">Allowed</th>
            </tr>
          </thead>
          <tbody>
            {job.totals.map((t) => (
              <tr key={`${t.metal}-${t.purity}`} className="border-t border-stone-100">
                <td className="px-3 py-2">{purityOf(t.metal, t.purity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{grams(t.issuedMg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{grams(t.finishedMg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{grams(t.remainderMg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{grams(t.wastageMg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{grams(t.heldMg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{grams(t.allowanceMg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-stone-600">
        Finished pieces back: {job.finishedPieces} · labour on this job {formatMoney(job.labourAccruedPaise)}
      </p>

      {canEdit && <IssueForm jobId={job.id} onDone={() => setReload((n) => n + 1)} />}
      {canEdit && <ReturnForm job={job} onDone={() => setReload((n) => n + 1)} />}
      {canEdit && <CloseForm jobId={job.id} totals={job.totals} onDone={() => setReload((n) => n + 1)} />}
      {!open && (
        <Alert kind="info">
          This job is closed{job.closeRemarks ? `: ${job.closeRemarks}` : ""}. A closed job is never edited.
        </Alert>
      )}

      <h2 className="text-lg font-semibold">Statement</h2>
      {statementTable(job.statement)}
    </section>
  );
}

function IssueForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [lines, setLines] = useState<IssueLine[]>([{ key: nextKey(), metal: "gold", purity: "22K916", weight: "" }]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => newId());

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: Record<number, string> = {};
    const issues = lines.map((l, i) => {
      const w = parseWeightGrams(l.weight);
      if (!w.ok) next[i] = w.message;
      return { metal: l.metal, purity: l.metal === "silver" ? "silver" : l.purity, weightMg: w.ok ? w.mg : 0 };
    });
    setLineErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await K.addIssue(jobId, { id: clientId, issueDate: indiaDate(), remarks: null, issues });
      onDone();
    } catch (err) {
      setFormError(errorText(err, "Could not add the metal."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${pcOnly} bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3`} onSubmit={onSubmit} noValidate aria-label="Add metal">
      <h2 className="font-semibold">Add metal (another delivery)</h2>
      {lines.map((l, i) => (
        <div key={l.key} className="grid gap-2 sm:grid-cols-[8rem_10rem_10rem] items-end">
          <Field label={`Line ${i + 1} metal`}>
            <select className={inputClass} value={l.metal} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, metal: e.target.value as "gold" | "silver", purity: e.target.value === "silver" ? "silver" : "22K916" } : x)))} aria-label={`Add line ${i + 1} metal`}>
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
            </select>
          </Field>
          <Field label={`Line ${i + 1} purity`}>
            <select className={inputClass} value={l.purity} disabled={l.metal === "silver"} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, purity: e.target.value } : x)))} aria-label={`Add line ${i + 1} purity`}>
              {l.metal === "silver" ? <option value="silver">Silver</option> : KARIGAR_GOLD_PURITIES.map((p) => <option key={p} value={p}>{purityLabel(p)}</option>)}
            </select>
          </Field>
          <Field label={`Line ${i + 1} weight (g)`} error={lineErrors[i]}>
            <input className={inputClass} value={l.weight} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, weight: e.target.value } : x)))} aria-label={`Add line ${i + 1} weight`} inputMode="decimal" />
          </Field>
        </div>
      ))}
      {formError && <Alert>{formError}</Alert>}
      <div>
        <button className={btnSecondary} disabled={busy}>
          Add metal
        </button>
      </div>
    </form>
  );
}

function ReturnForm({ job, onDone }: { job: KarigarJobDetail; onDone: () => void }) {
  const purities = job.totals.map((t) => ({ metal: t.metal, purity: t.purity, held: t.heldMg }));
  const first = purities[0];
  const [lines, setLines] = useState<ReturnLine[]>([{ key: nextKey(), part: "finished", purity: first?.purity ?? "22K916", weight: "", pieces: "", tested: first?.purity ?? "22K916" }]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => newId());

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: Record<number, string> = {};
    const built = lines.map((l, i) => {
      const w = parseWeightGrams(l.weight);
      if (!w.ok) next[i] = w.message;
      if (l.part === "finished") {
        const pieces = Number(l.pieces);
        if (!Number.isInteger(pieces) || pieces < 1) next[i] = "Enter the number of pieces (1 or more)";
        return { part: "finished" as const, purity: l.purity, weightMg: w.ok ? w.mg : 0, pieces: Number.isInteger(pieces) ? pieces : 0, testedPurity: l.tested };
      }
      return { part: "remainder" as const, purity: l.purity, weightMg: w.ok ? w.mg : 0 };
    });
    setLineErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await K.recordReturn(job.id, { id: clientId, returnDate: indiaDate(), remarks: null, lines: built });
      setLines([{ key: nextKey(), part: "finished", purity: first?.purity ?? "22K916", weight: "", pieces: "", tested: first?.purity ?? "22K916" }]);
      onDone();
    } catch (err) {
      const issues = fieldIssues(err);
      if (issues.length) {
        const l: Record<number, string> = {};
        for (const i of issues) {
          const m = /^lines\.(\d+)/.exec(i.field);
          if (m) l[Number(m[1]) - 1] = i.message;
        }
        setLineErrors(l);
        if (!Object.keys(l).length) setFormError(issues[0]?.message ?? "Could not record the return.");
      } else setFormError(errorText(err, "Could not record the return."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${pcOnly} bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3`} onSubmit={onSubmit} noValidate aria-label="Record return">
      <h2 className="font-semibold">Record a return</h2>
      <p className="text-sm text-stone-600">Finished pieces carry labour. The remainder is metal given back unused. Pieces must test at the purity of their line.</p>
      {lines.map((l, i) => (
        <div key={l.key} className="grid gap-2 sm:grid-cols-[8rem_9rem_9rem_7rem_9rem] items-end">
          <Field label={`Line ${i + 1} kind`}>
            <select className={inputClass} value={l.part} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, part: e.target.value as "finished" | "remainder" } : x)))} aria-label={`Return line ${i + 1} kind`}>
              <option value="finished">Finished pieces</option>
              <option value="remainder">Remainder metal</option>
            </select>
          </Field>
          <Field label={`Line ${i + 1} purity`}>
            <select className={inputClass} value={l.purity} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, purity: e.target.value, tested: e.target.value } : x)))} aria-label={`Return line ${i + 1} purity`}>
              {purities.map((p) => (
                <option key={`${p.metal}-${p.purity}`} value={p.purity}>
                  {purityOf(p.metal, p.purity)} (held {grams(p.held)})
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Line ${i + 1} weight (g)`} error={lineErrors[i]}>
            <input className={inputClass} value={l.weight} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, weight: e.target.value } : x)))} aria-label={`Return line ${i + 1} weight`} inputMode="decimal" />
          </Field>
          {l.part === "finished" ? (
            <Field label={`Line ${i + 1} pieces`}>
              <input className={inputClass} value={l.pieces} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, pieces: e.target.value } : x)))} aria-label={`Return line ${i + 1} pieces`} inputMode="numeric" />
            </Field>
          ) : (
            <span />
          )}
          {l.part === "finished" ? (
            <Field label={`Line ${i + 1} tested`}>
              <select className={inputClass} value={l.tested} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, tested: e.target.value } : x)))} aria-label={`Return line ${i + 1} tested purity`}>
                {purities.map((p) => (
                  <option key={`t-${p.purity}`} value={p.purity}>
                    {purityLabel(p.purity)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <span />
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} onClick={() => setLines((ls) => [...ls, { key: nextKey(), part: "remainder", purity: first?.purity ?? "22K916", weight: "", pieces: "", tested: first?.purity ?? "22K916" }])}>
          Add line
        </button>
      </div>
      {formError && <Alert>{formError}</Alert>}
      <div>
        <button className={btnPrimary} disabled={busy}>
          Record return
        </button>
      </div>
    </form>
  );
}

function CloseForm({ jobId, totals, onDone }: { jobId: string; totals: KarigarJobDetail["totals"]; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const held = totals.filter((t) => t.heldMg > 0);

  async function close() {
    setBusy(true);
    setError(null);
    try {
      await K.closeJob(jobId, { closeDate: indiaDate(), remarks: null });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not close the job."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className={`${pcOnly} bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3`}>
      <h2 className="font-semibold">Close the job</h2>
      {!confirming ? (
        <div>
          <button className={btnSecondary} onClick={() => setConfirming(true)}>
            Close job
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {held.length === 0
              ? "Nothing is still with the karigar. The job closes with no wastage."
              : `The metal still with the karigar is written off as wastage: ${held.map((t) => `${purityOf(t.metal, t.purity)} ${grams(t.heldMg)}`).join(", ")}. This is refused if it is more than the allowance.`}
          </p>
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={close} disabled={busy}>
              Confirm close
            </button>
            <button className={btnSecondary} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
