import { useEffect, useState, type ReactNode } from "react";
import { financialYearOf } from "@jewellery/calc";
import {
  formatMoney,
  indiaDate,
  parseRateInput,
  settingsSchemas,
  type SettingsKey,
  type SettingsSnapshot,
} from "@jewellery/shared";
import { ApiError } from "../api";
import { Alert, Field, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { getNumbering, getSettings, putSetting, setNextNumber } from "./api";
import { useAuth } from "../auth";

type Tab = "business" | "bank" | "texts" | "limits" | "numbering" | "logo";
const TABS: { key: Tab; label: string }[] = [
  { key: "business", label: "Business" },
  { key: "bank", label: "Bank" },
  { key: "texts", label: "Texts" },
  { key: "limits", label: "Limits" },
  { key: "numbering", label: "Numbers" },
  { key: "logo", label: "Logo and print" },
];

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const commas = (text: string) => text.split(",").map((l) => l.trim()).filter(Boolean);

/** Saves one key. Shows the server's field messages (400) or a plain sentence otherwise. */
function useSave<K extends SettingsKey>(key: K, onSaved: (v: SettingsSnapshot[K]) => void) {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(value: unknown) {
    setError(null);
    setFieldErrors({});
    setSaved(false);
    const check = settingsSchemas[key].safeParse(value);
    if (!check.success) {
      setFieldErrors(Object.fromEntries(check.error.issues.map((i) => [String(i.path[0] ?? ""), i.message])));
      setError("Check the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      const out = await putSetting(key, check.data as SettingsSnapshot[K]);
      onSaved(out);
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "validation") {
        const issues = (e.body as unknown as { issues: { field: string; message: string }[] }).issues;
        setFieldErrors(Object.fromEntries(issues.map((i) => [i.field, i.message])));
        setError("Check the highlighted fields.");
      } else {
        setError(e instanceof Error ? e.message : "Could not save");
      }
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, error, fieldErrors, saved };
}

function SaveBar({ busy, error, saved, onSave }: { busy: boolean; error: string | null; saved: boolean; onSave: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      {error && <Alert>{error}</Alert>}
      {saved && <Alert kind="ok">Saved. New documents use these details. Documents already issued keep what they were issued with.</Alert>}
      <div>
        <button className={btnPrimary} disabled={busy} onClick={onSave}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function BusinessForm({ s, onSaved }: { s: SettingsSnapshot; onSaved: (s: SettingsSnapshot) => void }) {
  const b = s.business;
  const [v, setV] = useState({
    legalName: b.legalName,
    tagline: b.tagline,
    address: b.addressLines.join("\n"),
    city: b.city,
    state: b.state,
    stateCode: b.stateCode,
    pincode: b.pincode,
    gstin: b.gstin,
    pan: b.pan,
    phones: b.phones.join(", "),
    email: b.email,
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const { save, busy, error, fieldErrors, saved } = useSave("business", (value) => onSaved({ ...s, business: value }));
  const err = (k: string) => fieldErrors[k];
  const payload = () => ({ ...v, addressLines: lines(v.address), phones: commas(v.phones), gstin: v.gstin.trim().toUpperCase(), pan: v.pan.trim().toUpperCase() });
  const submit = () => save(payload());
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Field label="Legal business name *" error={err("legalName")}>
        <input className={inputClass} value={v.legalName} onChange={set("legalName")} />
      </Field>
      <Field label="Tagline under the name" error={err("tagline")} hint="Printed under the name on documents">
        <input className={inputClass} value={v.tagline} onChange={set("tagline")} />
      </Field>
      <Field label="Address (one line per row, up to 3)" error={err("addressLines")}>
        <textarea className={inputClass} rows={3} value={v.address} onChange={set("address")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" error={err("city")}>
          <input className={inputClass} value={v.city} onChange={set("city")} />
        </Field>
        <Field label="State" error={err("state")}>
          <input className={inputClass} value={v.state} onChange={set("state")} />
        </Field>
        <Field label="State code" error={err("stateCode")} hint="02 for Himachal Pradesh">
          <input className={inputClass} value={v.stateCode} onChange={set("stateCode")} inputMode="numeric" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="GSTIN" error={err("gstin")} hint="15 characters. Leave empty if not registered yet.">
          <input className={`${inputClass} uppercase`} value={v.gstin} onChange={set("gstin")} autoComplete="off" />
        </Field>
        <Field label="PAN of the business" error={err("pan")}>
          <input className={`${inputClass} uppercase`} value={v.pan} onChange={set("pan")} autoComplete="off" />
        </Field>
        <Field label="PIN code" error={err("pincode")}>
          <input className={inputClass} value={v.pincode} onChange={set("pincode")} inputMode="numeric" />
        </Field>
        <Field label="Phone numbers (comma separated, up to 3)" error={err("phones")}>
          <input className={inputClass} value={v.phones} onChange={set("phones")} inputMode="tel" />
        </Field>
        <Field label="Email" error={err("email")}>
          <input className={inputClass} value={v.email} onChange={set("email")} inputMode="email" />
        </Field>
      </div>
      <SaveBar busy={busy} error={error} saved={saved} onSave={() => void submit()} />
    </form>
  );
}

function BankForm({ s, onSaved }: { s: SettingsSnapshot; onSaved: (s: SettingsSnapshot) => void }) {
  const [v, setV] = useState({ ...s.bank });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const { save, busy, error, fieldErrors, saved } = useSave("bank", (value) => onSaved({ ...s, bank: value }));
  const payload = () => ({ ...v, ifsc: v.ifsc.trim().toUpperCase(), accountNo: v.accountNo.replace(/\s/g, "") });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-600">Bank details are printed on the invoice (owner answer 15). Type them here only.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account name" error={fieldErrors.accountName}>
          <input className={inputClass} value={v.accountName} onChange={set("accountName")} />
        </Field>
        <Field label="Bank name" error={fieldErrors.bankName}>
          <input className={inputClass} value={v.bankName} onChange={set("bankName")} />
        </Field>
        <Field label="Account number" error={fieldErrors.accountNo}>
          <input className={inputClass} value={v.accountNo} onChange={set("accountNo")} inputMode="numeric" />
        </Field>
        <Field label="IFSC" error={fieldErrors.ifsc}>
          <input className={`${inputClass} uppercase`} value={v.ifsc} onChange={set("ifsc")} />
        </Field>
        <Field label="UPI ID" error={fieldErrors.upiId}>
          <input className={inputClass} value={v.upiId} onChange={set("upiId")} />
        </Field>
      </div>
      <SaveBar busy={busy} error={error} saved={saved} onSave={() => void save(payload())} />
    </div>
  );
}

function TextsForm({ s, onSaved }: { s: SettingsSnapshot; onSaved: (s: SettingsSnapshot) => void }) {
  const t = s.texts;
  const [v, setV] = useState({
    invoiceTerms: t.invoiceTerms.join("\n"),
    declaration: t.declaration,
    invoiceNote: t.invoiceNote,
    settlementNote: t.settlementNote,
    receiptFooter: t.receiptFooter,
    oldGoldSlogan: t.oldGoldSlogan,
    copyLabels: t.copyLabels.join(", "),
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const { save, busy, error, fieldErrors, saved } = useSave("texts", (value) => onSaved({ ...s, texts: value }));
  const payload = () => ({ ...v, invoiceTerms: lines(v.invoiceTerms), copyLabels: commas(v.copyLabels) });
  return (
    <div className="flex flex-col gap-4">
      <Field label="Invoice terms and conditions (one per line, up to 8)" error={fieldErrors.invoiceTerms}>
        <textarea className={inputClass} rows={4} value={v.invoiceTerms} onChange={set("invoiceTerms")} />
      </Field>
      <Field label="Declaration" error={fieldErrors.declaration}>
        <textarea className={inputClass} rows={2} value={v.declaration} onChange={set("declaration")} />
      </Field>
      <Field label="Invoice tax note" error={fieldErrors.invoiceNote}>
        <textarea className={inputClass} rows={2} value={v.invoiceNote} onChange={set("invoiceNote")} />
      </Field>
      <Field label="Settlement page note" error={fieldErrors.settlementNote}>
        <textarea className={inputClass} rows={2} value={v.settlementNote} onChange={set("settlementNote")} />
      </Field>
      <Field label="Receipt footer" error={fieldErrors.receiptFooter}>
        <input className={inputClass} value={v.receiptFooter} onChange={set("receiptFooter")} />
      </Field>
      <Field label="Old gold slogan" error={fieldErrors.oldGoldSlogan}>
        <input className={inputClass} value={v.oldGoldSlogan} onChange={set("oldGoldSlogan")} />
      </Field>
      <Field label="Copy labels (two, comma separated)" error={fieldErrors.copyLabels}>
        <input className={inputClass} value={v.copyLabels} onChange={set("copyLabels")} />
      </Field>
      <SaveBar busy={busy} error={error} saved={saved} onSave={() => void save(payload())} />
    </div>
  );
}

function LimitsForm({ s, onSaved }: { s: SettingsSnapshot; onSaved: (s: SettingsSnapshot) => void }) {
  const [text, setText] = useState(String(s.limits.cashWarningPaise / 100));
  const [localError, setLocalError] = useState<string | null>(null);
  const { save, busy, error, fieldErrors, saved } = useSave("limits", (value) => onSaved({ ...s, limits: value }));
  function submit() {
    const parsed = parseRateInput(text, "kg"); // whole rupees with up to 2 decimals, no floats
    if (!parsed.ok) return setLocalError(parsed.message);
    setLocalError(null);
    void save({ cashWarningPaise: parsed.paisePerKg });
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-600">A cash payment of this amount or more shows a warning. It never blocks the payment (owner answer 24).</p>
      <Field label="Cash warning limit (rupees)" error={localError ?? fieldErrors.cashWarningPaise} hint={`Now: ${formatMoney(s.limits.cashWarningPaise)}`}>
        <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" />
      </Field>
      <SaveBar busy={busy} error={error} saved={saved} onSave={submit} />
    </div>
  );
}

function NumberingForm({ s, onSaved }: { s: SettingsSnapshot; onSaved: (s: SettingsSnapshot) => void }) {
  const n = s.numbering;
  const [v, setV] = useState({ ...n.prefixes, fyInNumber: n.fyInNumber, padDigits: String(n.padDigits) });
  const { save, busy, error, fieldErrors, saved } = useSave("numbering", (value) => onSaved({ ...s, numbering: value }));
  const [counters, setCounters] = useState<{ series: string; fy: string; last_no: number }[]>([]);
  const [series, setSeries] = useState("INV");
  const currentFy = financialYearOf(indiaDate());
  const [fy, setFy] = useState(currentFy);
  const [nextNo, setNextNo] = useState("");
  const [nextMsg, setNextMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    getNumbering().then((r) => setCounters(r.items)).catch(() => setCounters([]));
  }, []);

  async function setNext() {
    setNextMsg(null);
    const number = Number(nextNo);
    if (!/^\d+$/.test(nextNo) || number < 1) return setNextMsg({ kind: "error", text: "Enter a whole number, 1 or more" });
    if (!/^\d{4}-\d{2}$/.test(fy)) return setNextMsg({ kind: "error", text: "Financial year looks like 2026-27" });
    try {
      await setNextNumber(series, fy, number);
      setNextMsg({ kind: "ok", text: `The next ${series} number for ${fy} is ${number}.` });
      setCounters((await getNumbering()).items);
    } catch (e) {
      setNextMsg({ kind: "error", text: e instanceof ApiError ? e.message : "Could not set the number" });
    }
  }

  const prefixRow = (k: "INV" | "PAY" | "OGP" | "ORD" | "CN", label: string) => (
    <Field key={k} label={`${label} prefix`} error={fieldErrors.prefixes}>
      <input className={inputClass} value={v[k]} onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value }))} />
    </Field>
  );
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h3 className="font-semibold">Document number formats</h3>
        <p className="text-sm text-stone-600">Numbers restart each 1 April. Documents already issued keep their numbers.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {prefixRow("INV", "Invoice")}
          {prefixRow("PAY", "Payment receipt")}
          {prefixRow("OGP", "Old gold receipt")}
          {prefixRow("ORD", "Order")}
          {prefixRow("CN", "Credit note")}
          <Field label="Digits in the number" error={fieldErrors.padDigits}>
            <input className={inputClass} value={v.padDigits} onChange={(e) => setV((p) => ({ ...p, padDigits: e.target.value }))} inputMode="numeric" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.fyInNumber} onChange={(e) => setV((p) => ({ ...p, fyInNumber: e.target.checked }))} />
          Show the financial year in the number (INV-2026-27-0001)
        </label>
        <SaveBar
          busy={busy}
          error={error}
          saved={saved}
          onSave={() =>
            void save({
              prefixes: { INV: v.INV, PAY: v.PAY, OGP: v.OGP, ORD: v.ORD, CN: v.CN },
              fyInNumber: v.fyInNumber,
              padDigits: Number(v.padDigits),
            })
          }
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-stone-200 pt-4">
        <h3 className="font-semibold">Last number used this year ({currentFy})</h3>
        {counters.filter((c) => c.series === "C" || c.fy === currentFy).length === 0 ? (
          <p className="text-sm text-stone-500">No numbers used yet this year.</p>
        ) : (
          <ul className="text-sm flex flex-col gap-1">
            {counters.filter((c) => c.series === "C" || c.fy === currentFy).map((c) => (
              <li key={`${c.series}-${c.fy}`}>
                {c.series === "C" ? "Customer numbers" : `${c.series} ${c.fy}`}: {c.last_no}
              </li>
            ))}
          </ul>
        )}
        <h3 className="font-semibold mt-2">Set the next number</h3>
        <p className="text-sm text-stone-600">Use this to continue your paper book. For example, if the last paper invoice was 2761, set the next to 2762.</p>
        <div className="grid gap-3 sm:grid-cols-4 items-end">
          <Field label="Series">
            <select className={inputClass} value={series} onChange={(e) => setSeries(e.target.value)}>
              {["INV", "PAY", "OGP", "ORD", "CN"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Financial year" hint="e.g. 2026-27">
            <input className={inputClass} value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2026-27" />
          </Field>
          <Field label="Next number">
            <input className={inputClass} value={nextNo} onChange={(e) => setNextNo(e.target.value)} inputMode="numeric" />
          </Field>
          <button className={btnSecondary} onClick={() => void setNext()}>
            Set next number
          </button>
        </div>
        {nextMsg && <Alert kind={nextMsg.kind === "ok" ? "ok" : "error"}>{nextMsg.text}</Alert>}
      </section>
    </div>
  );
}

function LogoPrintForm({ s, onSaved }: { s: SettingsSnapshot; onSaved: (s: SettingsSnapshot) => void }) {
  const [logoError, setLogoError] = useState<string | null>(null);
  const [showBis, setShowBis] = useState(s.print.showBisLogo);
  const [showMetal, setShowMetal] = useState(s.print.showMetalLine);
  const { save, busy, error, saved } = useSave("print", (value) => onSaved({ ...s, print: value }));
  const logo = useSave("logo", (value) => onSaved({ ...s, logo: value }));

  async function onFile(file: File | undefined) {
    setLogoError(null);
    if (!file) return;
    const mime = file.type;
    if (!["image/png", "image/jpeg", "image/svg+xml"].includes(mime)) return setLogoError("Use a PNG, JPEG or SVG file");
    if (file.size > 300 * 1024) return setLogoError("The logo must be 300 KB or smaller");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    await logo.save({ mime, dataUrl });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">Logo</h3>
        <p className="text-sm text-stone-600">Optional. Without a logo, documents show a diamond with the initials of the business name.</p>
        {s.logo ? <img src={s.logo.dataUrl} alt="Current logo" className="h-20 object-contain border border-stone-200 rounded p-2 bg-white self-start" /> : <p className="text-sm text-stone-500">No logo uploaded.</p>}
        <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Upload logo" />
        {(logoError || logo.error) && <Alert>{logoError ?? logo.error}</Alert>}
        {logo.saved && <Alert kind="ok">Logo saved.</Alert>}
        {s.logo && (
          <div>
            <button className={btnSecondary} disabled={logo.busy} onClick={() => void logo.save(null)}>
              Remove logo
            </button>
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3 border-t border-stone-200 pt-4">
        <h3 className="font-semibold">Print options</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showBis} onChange={(e) => setShowBis(e.target.checked)} />
          Show the BIS hallmark logo on invoices (optional)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showMetal} onChange={(e) => setShowMetal(e.target.checked)} />
          Show the metal line (Gold or Silver) under each item
        </label>
        <SaveBar busy={busy} error={error} saved={saved} onSave={() => void save({ showBisLogo: showBis, showMetalLine: showMetal })} />
      </section>
    </div>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const canManage = can("settings.manage");
  const [tab, setTab] = useState<Tab>("business");
  const [s, setS] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getSettings().then(setS).catch((e) => setError(e instanceof Error ? e.message : "Could not load settings"));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!s) return <p className="text-stone-500">Loading...</p>;

  const body: Record<Tab, ReactNode> = {
    business: <BusinessForm s={s} onSaved={setS} />,
    bank: <BankForm s={s} onSaved={setS} />,
    texts: <TextsForm s={s} onSaved={setS} />,
    limits: <LimitsForm s={s} onSaved={setS} />,
    numbering: <NumberingForm s={s} onSaved={setS} />,
    logo: <LogoPrintForm s={s} onSaved={setS} />,
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <span className="text-xs text-stone-500 max-md:hidden">Changes apply to new documents only.</span>
        {can("integrity.view") && <a href="#/integrity" className="text-sm underline">Data checks</a>}
      </div>
      <nav className="flex gap-1 flex-wrap border-b border-stone-200" aria-label="Settings tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`px-3 py-2 text-sm border-b-2 ${tab === t.key ? "border-stone-900 font-medium" : "border-transparent text-stone-500"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {!canManage && <Alert kind="info">You can read these settings. Only the owner can change them.</Alert>}
      <fieldset disabled={!canManage} className="bg-white border border-stone-200 rounded-xl p-4 max-md:hidden min-w-0">{body[tab]}</fieldset>
      <div className="md:hidden">
        <Alert kind="info">Settings are changed on the PC. This phone view is read-only.</Alert>
      </div>
    </div>
  );
}
