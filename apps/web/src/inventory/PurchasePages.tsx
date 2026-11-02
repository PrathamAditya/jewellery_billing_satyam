import { useEffect, useState, type FormEvent } from "react";
import {
  DEFAULT_LOCATION_ID,
  PURCHASE_TYPES,
  PURCHASE_TYPE_LABEL,
  PURITIES,
  formatMoney,
  formatWeightGrams,
  indiaDate,
  newId,
  parseRupeesToPaise,
  parseWeightGrams,
  type BulkItemResponse,
  type InventoryItemType,
  type PurchaseDetail,
  type PurchaseLineKind,
  type PurchaseLineView,
  type PurchaseListItem,
  type PurchaseType,
  type RawStockRow,
  type StockLocation,
} from "@jewellery/shared";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { niceDate } from "../rates/api";
import { navigate } from "../router";
import { createPurchase, getPurchase, getRawStock, listBulk, listLocations, listPurchases, listTypes, voidPurchase } from "./api";
import { purityLabel } from "./labels";

/** Spec 022 section 4: the purchases list with the raw stock, the new purchase form, and the purchase page. */

const KIND_LABEL: Record<PurchaseLineKind, string> = { item: "Item", bulk: "Bulk item", raw_metal: "Raw metal", metal_used: "Metal given to karigar" };
/** Spec 022 PU1: the lines each type takes, and the button labels for them. */
const LINE_KINDS: Record<PurchaseType, PurchaseLineKind[]> = { finished: ["item", "bulk"], raw_metal: ["raw_metal"], karigar_made: ["item", "metal_used"] };
const ADD_LABEL: Record<PurchaseLineKind, string> = { item: "Add item", bulk: "Add bulk item", raw_metal: "Add raw metal", metal_used: "Add metal given to karigar" };
const TYPE_HINT: Record<PurchaseType, string> = {
  finished: "Finished jewellery from a wholesaler: each piece as an item with its U No., or bulk pieces counted by quantity.",
  raw_metal: "Raw gold or silver bought: kept as raw stock by metal, purity and place.",
  karigar_made: "Jewellery made by a karigar from the shop's own metal: the pieces become items, and the metal given out comes off raw stock.",
};

type Issue = { field: string; message: string };
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const fieldIssues = (e: unknown): Issue[] => (e instanceof ApiError && Array.isArray((e.body as { issues?: Issue[] }).issues) ? (e.body as { issues: Issue[] }).issues : []);

/** One line as the form holds it (all text, parsed on save). */
type LineForm = {
  key: number;
  kind: PurchaseLineKind;
  typeId: string;
  uNo: string;
  pieces: string;
  metal: "gold" | "silver";
  purity: string;
  weight: string;
  gross: string;
  net: string;
  hsn: string;
  labourNote: string;
  bulkItemId: string;
  quantity: string;
  amount: string;
};

const purityOptions = (metal: "gold" | "silver") => (metal === "silver" ? ["silver"] : PURITIES.filter((p) => p !== "silver"));
let nextKey = 1;
function blankLine(kind: PurchaseLineKind, typeId = ""): LineForm {
  return {
    key: nextKey++,
    kind,
    typeId,
    uNo: "",
    pieces: "1",
    metal: "gold",
    purity: "22K916",
    weight: "",
    gross: "",
    net: "",
    hsn: "7113",
    labourNote: "",
    bulkItemId: "",
    quantity: "1",
    amount: "",
  };
}

// ---- the list (with the raw stock) ----

export function PurchasesListPage() {
  const { can } = useAuth();
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PurchaseListItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawStockRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(cursor: string | null) {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q.trim()) params.set("q", q.trim());
    if (cursor) params.set("cursor", cursor);
    try {
      const r = await listPurchases(`?${params.toString()}`);
      setItems(cursor ? (prev) => [...prev, ...r.items] : r.items);
      setNext(r.nextCursor);
    } catch (e) {
      setErr(errorText(e, "Could not load the purchases. Check the connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(null), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, from, to, q]);

  useEffect(() => {
    getRawStock().then((r) => setRaw(r.items)).catch(() => setRaw([]));
  }, []);

  return (
    <main className="p-3 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <a href="#/inventory" className="text-sm underline">Inventory</a>
          <h1 className="text-xl font-semibold">Purchases</h1>
        </div>
        {can("purchases.edit") && (
          <button className={`${btnPrimary} ${pcOnly}`} onClick={() => navigate("/inventory/purchases/new")}>
            New purchase
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)} aria-label="Purchase type">
          <option value="">All types</option>
          {PURCHASE_TYPES.map((t) => (
            <option key={t} value={t}>
              {PURCHASE_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <input className={inputClass} placeholder="Search supplier" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search supplier" />
      </div>
      {err && <p className="text-red-700 text-sm">{err}</p>}
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 max-md:hidden">Place</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => navigate(`/inventory/purchases/${p.id}`)}>
                <td className="px-3 py-2 font-medium">{p.purchaseNo}</td>
                <td className="px-3 py-2">{niceDate(p.purchaseDate)}</td>
                <td className="px-3 py-2">{p.purchaseTypeLabel}</td>
                <td className="px-3 py-2">{p.supplierName}</td>
                <td className="px-3 py-2 text-right">{p.lineCount}</td>
                <td className="px-3 py-2 max-md:hidden">{p.locationName}</td>
                <td className="px-3 py-2">{p.voided ? <span className="text-red-700">Voided</span> : "Recorded"}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-stone-500">No purchases found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {next && (
        <div className="text-center">
          <button className={btnSecondary} onClick={() => void load(next)} disabled={loading}>
            Load more
          </button>
        </div>
      )}

      <section className="space-y-2" aria-label="Raw stock">
        <h2 className="text-lg font-semibold">Raw stock</h2>
        <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500 border-b border-stone-200">
              <tr>
                <th className="px-3 py-2">Metal</th>
                <th className="px-3 py-2">Purity</th>
                <th className="px-3 py-2">Place</th>
                <th className="px-3 py-2 text-right">Weight</th>
              </tr>
            </thead>
            <tbody>
              {raw.map((r) => (
                <tr key={`${r.metal}-${r.purity}-${r.locationId}`} className="border-t border-stone-100">
                  <td className="px-3 py-2 capitalize">{r.metal}</td>
                  <td className="px-3 py-2">{purityLabel(r.purity)}</td>
                  <td className="px-3 py-2">{r.locationName}</td>
                  <td className="px-3 py-2 text-right">{formatWeightGrams(r.weightMg)} g</td>
                </tr>
              ))}
              {raw.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-stone-500">No raw gold or silver in stock.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

// ---- the new purchase form (PC only) ----

export function NewPurchasePage() {
  const [purchaseType, setPurchaseType] = useState<PurchaseType | "">("");
  const [header, setHeader] = useState({ purchaseDate: indiaDate(), supplierName: "", supplierBillNo: "", karigarName: "", locationId: DEFAULT_LOCATION_ID, remarks: "" });
  const [lines, setLines] = useState<LineForm[]>([]);
  const [types, setTypes] = useState<InventoryItemType[]>([]);
  const [bulk, setBulk] = useState<BulkItemResponse[]>([]);
  const [places, setPlaces] = useState<StockLocation[]>([]);
  const [headerErrors, setHeaderErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => newId());

  useEffect(() => {
    listTypes().then((r) => {
      const active = r.items.filter((t) => t.active);
      setTypes(active);
    });
    listBulk("").then((r) => setBulk(r.items)).catch(() => setBulk([]));
    listLocations().then((r) => setPlaces(r.items.filter((p) => p.active)));
  }, []);

  const setH = (k: keyof typeof header) => (e: { target: { value: string } }) => setHeader((h) => ({ ...h, [k]: e.target.value }));
  const setL = (key: number, patch: Partial<LineForm>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function chooseType(t: PurchaseType) {
    setPurchaseType(t);
    setLines([blankLine(LINE_KINDS[t][0]!, types[0]?.id ?? "")]);
    setLineErrors({});
  }

  function addLine(kind: PurchaseLineKind) {
    setLines((ls) => [...ls, blankLine(kind, types[0]?.id ?? "")]);
  }

  /** Builds the request body, or the messages to show (client checks, same rules as the server). */
  function build(): { body: Record<string, unknown> } | { headerErrors: Record<string, string>; lineErrors: Record<number, string> } {
    const hErr: Record<string, string> = {};
    const lErr: Record<number, string> = {};
    if (!purchaseType) hErr.purchaseType = "Choose the type of purchase first";
    if (!header.purchaseDate) hErr.purchaseDate = "Enter the purchase date";
    if (!header.supplierName.trim()) hErr.supplierName = "Enter the supplier's name";
    if (purchaseType === "karigar_made" && !header.karigarName.trim()) hErr.karigarName = "Enter the karigar's name";
    if (lines.length === 0) hErr.lines = "Add at least one line";
    const out: Record<string, unknown>[] = [];
    lines.forEach((l, i) => {
      let amountPaise: number | null = null;
      if (l.amount.trim()) {
        const a = parseRupeesToPaise(l.amount, "amount");
        if (!a.ok) lErr[i] = a.message;
        else amountPaise = a.value;
      }
      if (l.kind === "item") {
        const gross = parseWeightGrams(l.gross);
        const net = parseWeightGrams(l.net);
        const pieces = Number(l.pieces);
        if (!l.typeId) lErr[i] = "Choose the item type";
        else if (!Number.isInteger(pieces) || pieces < 1 || pieces > 10) lErr[i] = "Pieces: 1 to 10 (a pair is 2)";
        else if (!gross.ok) lErr[i] = gross.message;
        else if (!net.ok) lErr[i] = net.message;
        out.push({
          kind: "item",
          typeId: l.typeId,
          uNo: l.uNo.trim() || null,
          pieces,
          metal: l.metal,
          purity: l.purity,
          grossWeightMg: gross.ok ? gross.mg : 0,
          netWeightMg: net.ok ? net.mg : 0,
          hsn: l.hsn,
          labourNote: l.labourNote.trim() || null,
          amountPaise,
        });
      } else if (l.kind === "bulk") {
        const quantity = Number(l.quantity);
        if (!l.bulkItemId) lErr[i] = "Choose the bulk item";
        else if (!Number.isInteger(quantity) || quantity < 1) lErr[i] = "Quantity must be a whole number, 1 or more";
        out.push({ kind: "bulk", bulkItemId: l.bulkItemId, quantity: Number.isInteger(quantity) ? quantity : 0, amountPaise });
      } else {
        const w = parseWeightGrams(l.weight);
        if (!w.ok) lErr[i] = w.message;
        out.push({ kind: l.kind, metal: l.metal, purity: l.purity, weightMg: w.ok ? w.mg : 0, amountPaise });
      }
    });
    if (Object.keys(hErr).length || Object.keys(lErr).length) return { headerErrors: hErr, lineErrors: lErr };
    return {
      body: {
        id: clientId,
        purchaseType,
        purchaseDate: header.purchaseDate,
        supplierName: header.supplierName.trim(),
        supplierBillNo: header.supplierBillNo.trim() || null,
        karigarName: purchaseType === "karigar_made" ? header.karigarName.trim() : null,
        locationId: header.locationId,
        remarks: header.remarks.trim() || null,
        lines: out,
      },
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const built = build();
    if (!("body" in built)) {
      setHeaderErrors(built.headerErrors);
      setLineErrors(built.lineErrors);
      return;
    }
    setHeaderErrors({});
    setLineErrors({});
    setBusy(true);
    try {
      const r = await createPurchase(built.body);
      navigate(`/inventory/purchases/${r.purchase.id}`);
    } catch (err) {
      const issues = fieldIssues(err);
      if (issues.length) {
        const h: Record<string, string> = {};
        const l: Record<number, string> = {};
        for (const i of issues) {
          const m = /^lines\.(\d+)/.exec(i.field);
          if (m) l[Number(m[1]) - 1] = i.message;
          else h[i.field || "form"] = i.message;
        }
        setHeaderErrors(h);
        setLineErrors(l);
      }
      setFormError(errorText(err, "Could not save the purchase. Check the connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  const lineLabel = (l: LineForm) => KIND_LABEL[l.kind];

  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <h1 className="text-xl font-semibold">New purchase</h1>
      <p className="md:hidden text-sm text-stone-600">Purchases are entered from a PC. On the phone you can look them up.</p>
      <form onSubmit={onSubmit} className={`space-y-4 ${pcOnly}`} aria-label="New purchase">
        {formError && <Alert>{formError}</Alert>}
        <section className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold">1. Type of purchase</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PURCHASE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => chooseType(t)}
                aria-pressed={purchaseType === t}
                className={`text-left border rounded-lg p-3 ${purchaseType === t ? "border-stone-900 bg-stone-50" : "border-stone-300 bg-white"}`}
              >
                <span className="block font-medium">{PURCHASE_TYPE_LABEL[t]}</span>
                <span className="block text-xs text-stone-600 mt-1">{TYPE_HINT[t]}</span>
              </button>
            ))}
          </div>
          {headerErrors.purchaseType && <p className="text-sm text-red-700">{headerErrors.purchaseType}</p>}
        </section>

        {purchaseType && (
          <section className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">2. Who and when</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Purchase date" error={headerErrors.purchaseDate}>
                <input type="date" className={inputClass} value={header.purchaseDate} max={indiaDate()} onChange={setH("purchaseDate")} aria-label="Purchase date" />
              </Field>
              <Field label="Place" hint="Where the stock goes">
                <select className={inputClass} value={header.locationId} onChange={setH("locationId")} aria-label="Place">
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Supplier" error={headerErrors.supplierName}>
                <input className={inputClass} value={header.supplierName} onChange={setH("supplierName")} maxLength={100} aria-label="Supplier" />
              </Field>
              <Field label="Supplier bill number" hint="Optional">
                <input className={inputClass} value={header.supplierBillNo} onChange={setH("supplierBillNo")} maxLength={60} aria-label="Supplier bill number" />
              </Field>
              {purchaseType === "karigar_made" && (
                <Field label="Karigar's name" error={headerErrors.karigarName}>
                  <input className={inputClass} value={header.karigarName} onChange={setH("karigarName")} maxLength={100} aria-label="Karigar name" />
                </Field>
              )}
              <Field label="Remarks" hint="Optional">
                <input className={inputClass} value={header.remarks} onChange={setH("remarks")} maxLength={300} aria-label="Remarks" />
              </Field>
            </div>
          </section>
        )}

        {purchaseType && (
          <section className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">3. Lines</h2>
            {headerErrors.lines && <p className="text-sm text-red-700">{headerErrors.lines}</p>}
            {lines.map((l, i) => (
              <div key={l.key} className="border border-stone-200 rounded-lg p-3 space-y-3" aria-label={`Line ${i + 1}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    Line {i + 1}: {lineLabel(l)}
                  </span>
                  <button type="button" className="text-sm underline" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    Remove line
                  </button>
                </div>
                {l.kind === "item" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Item type">
                      <select className={inputClass} value={l.typeId} onChange={(e) => setL(l.key, { typeId: e.target.value })} aria-label={`Line ${i + 1} item type`}>
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.itemCode})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="U No." hint="Blank for the next number">
                      <input className={inputClass} value={l.uNo} onChange={(e) => setL(l.key, { uNo: e.target.value })} placeholder="Automatic" aria-label={`Line ${i + 1} U No.`} />
                    </Field>
                    <Field label="Pieces" hint="A pair is 2">
                      <input className={inputClass} type="number" min={1} max={10} value={l.pieces} onChange={(e) => setL(l.key, { pieces: e.target.value })} aria-label={`Line ${i + 1} pieces`} />
                    </Field>
                    <Field label="Metal">
                      <select
                        className={inputClass}
                        value={l.metal}
                        onChange={(e) => {
                          const metal = e.target.value as "gold" | "silver";
                          setL(l.key, { metal, purity: metal === "silver" ? "silver" : "22K916" });
                        }}
                        aria-label={`Line ${i + 1} metal`}
                      >
                        <option value="gold">Gold</option>
                        <option value="silver">Silver</option>
                      </select>
                    </Field>
                    <Field label="Purity">
                      <select className={inputClass} value={l.purity} onChange={(e) => setL(l.key, { purity: e.target.value })} aria-label={`Line ${i + 1} purity`}>
                        {purityOptions(l.metal).map((p) => (
                          <option key={p} value={p}>
                            {purityLabel(p)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="HSN">
                      <select className={inputClass} value={l.hsn} onChange={(e) => setL(l.key, { hsn: e.target.value })} aria-label={`Line ${i + 1} HSN`}>
                        <option value="7113">7113 (jewellery)</option>
                        <option value="9988">9988 (job work)</option>
                      </select>
                    </Field>
                    <Field label="Gross weight (g)" hint="Like 12.500">
                      <input className={inputClass} inputMode="decimal" value={l.gross} onChange={(e) => setL(l.key, { gross: e.target.value })} aria-label={`Line ${i + 1} gross weight`} />
                    </Field>
                    <Field label="Net weight (g)" hint="Like 12.000">
                      <input className={inputClass} inputMode="decimal" value={l.net} onChange={(e) => setL(l.key, { net: e.target.value })} aria-label={`Line ${i + 1} net weight`} />
                    </Field>
                    <Field label="Labour note" hint="Optional">
                      <input className={inputClass} value={l.labourNote} onChange={(e) => setL(l.key, { labourNote: e.target.value })} maxLength={200} aria-label={`Line ${i + 1} labour note`} />
                    </Field>
                  </div>
                )}
                {l.kind === "bulk" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Bulk item">
                      <select className={inputClass} value={l.bulkItemId} onChange={(e) => setL(l.key, { bulkItemId: e.target.value })} aria-label={`Line ${i + 1} bulk item`}>
                        <option value="">Choose</option>
                        {bulk.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.unit})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Quantity">
                      <input className={inputClass} type="number" min={1} value={l.quantity} onChange={(e) => setL(l.key, { quantity: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                    </Field>
                  </div>
                )}
                {(l.kind === "raw_metal" || l.kind === "metal_used") && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Metal">
                      <select
                        className={inputClass}
                        value={l.metal}
                        onChange={(e) => {
                          const metal = e.target.value as "gold" | "silver";
                          setL(l.key, { metal, purity: metal === "silver" ? "silver" : "22K916" });
                        }}
                        aria-label={`Line ${i + 1} metal`}
                      >
                        <option value="gold">Gold</option>
                        <option value="silver">Silver</option>
                      </select>
                    </Field>
                    <Field label="Purity">
                      <select className={inputClass} value={l.purity} onChange={(e) => setL(l.key, { purity: e.target.value })} aria-label={`Line ${i + 1} purity`}>
                        {purityOptions(l.metal).map((p) => (
                          <option key={p} value={p}>
                            {purityLabel(p)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Weight (g)" hint="Like 500.000">
                      <input className={inputClass} inputMode="decimal" value={l.weight} onChange={(e) => setL(l.key, { weight: e.target.value })} aria-label={`Line ${i + 1} weight`} />
                    </Field>
                  </div>
                )}
                <Field label="Amount (optional, for the record)" hint="Not used for GST or totals">
                  <input className={`${inputClass} sm:max-w-xs`} inputMode="decimal" value={l.amount} onChange={(e) => setL(l.key, { amount: e.target.value })} aria-label={`Line ${i + 1} amount`} />
                </Field>
                {lineErrors[i] && <p className="text-sm text-red-700">{lineErrors[i]}</p>}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {LINE_KINDS[purchaseType].map((k) => (
                <button key={k} type="button" className={btnSecondary} onClick={() => addLine(k)}>
                  {ADD_LABEL[k]}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="flex gap-2">
          <button className={btnPrimary} disabled={busy || !purchaseType}>
            Save purchase
          </button>
          <a href="#/inventory/purchases" className={btnSecondary}>
            Cancel
          </a>
        </div>
      </form>
    </main>
  );
}

// ---- the purchase page ----

function lineDetail(l: PurchaseLineView) {
  if (l.item) {
    return (
      <>
        <a className="underline font-medium" href={`#/inventory/items/${l.item.id}`}>
          {l.item.uNo}
        </a>{" "}
        {l.item.typeName}, {l.item.statusLabel}
        {l.item.voided ? " (voided)" : ""}
      </>
    );
  }
  if (l.bulk) {
    return (
      <>
        <a className="underline font-medium" href={`#/inventory/bulk/${l.bulk.id}`}>
          {l.bulk.name}
        </a>
        : {l.bulk.quantity} {l.bulk.unit} received, {l.bulk.balanceAtPlace} {l.bulk.unit} at this place now
      </>
    );
  }
  const metal = l.metal === "silver" ? "Silver" : "Gold";
  const what = l.metal === "silver" ? "silver" : `${metal} ${purityLabel(l.purity ?? "")}`;
  return <>{l.kind === "metal_used" ? `${formatWeightGrams(l.weightMg ?? 0)} g of ${what} given to the karigar` : `${formatWeightGrams(l.weightMg ?? 0)} g of ${what} received`}</>;
}

export function PurchasePage({ id }: { id: string }) {
  const { can } = useAuth();
  const [p, setP] = useState<PurchaseDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [voidErr, setVoidErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setP((await getPurchase(id)).purchase);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setErr(errorText(e, "Could not load the purchase. Check the connection and try again."));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onVoid(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setVoidErr("Give a reason for the void");
      return;
    }
    setBusy(true);
    setVoidErr(null);
    try {
      setP((await voidPurchase(id, reason.trim())).purchase);
      setVoiding(false);
      setReason("");
    } catch (e2) {
      setVoidErr(errorText(e2, "Could not void the purchase. Check the connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <main className="p-6 text-stone-600">This purchase was not found. <a className="underline" href="#/inventory/purchases">Back to purchases</a></main>;
  if (err) return <main className="p-6 text-red-700">{err}</main>;
  if (!p) return <main className="p-6 text-stone-500">Loading...</main>;

  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
      <a href="#/inventory/purchases" className="text-sm underline">Purchases</a>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">{p.purchaseNo}</h1>
          <p className="text-sm text-stone-600">{p.purchaseTypeLabel}</p>
        </div>
        {p.voided && <span className="border-2 border-red-700 text-red-700 font-bold px-3 py-1 rounded uppercase tracking-wide">Void</span>}
      </div>
      {p.voided && <Alert kind="info">Voided on {niceDate(p.voidedAt!.slice(0, 10))}: {p.voidReason}</Alert>}
      <section className="bg-white border border-stone-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <Detail label="Date" value={niceDate(p.purchaseDate)} />
        <Detail label="Supplier" value={p.supplierName} />
        <Detail label="Supplier bill number" value={p.supplierBillNo ?? "-"} />
        <Detail label="Place" value={p.locationName} />
        {p.karigarName && <Detail label="Karigar" value={p.karigarName} />}
        {p.remarks && <Detail label="Remarks" value={p.remarks} />}
      </section>
      <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500 border-b border-stone-200">
            <tr>
              <th className="px-3 py-2">Line</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Detail</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.lineNo} className="border-t border-stone-100">
                <td className="px-3 py-2">{l.lineNo}</td>
                <td className="px-3 py-2">{KIND_LABEL[l.kind]}</td>
                <td className="px-3 py-2">{lineDetail(l)}</td>
                <td className="px-3 py-2 text-right">{l.amountPaise === null ? "-" : formatMoney(l.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!p.voided && can("purchases.edit") && (
        <div className={pcOnly}>
          <button className={btnSecondary} onClick={() => setVoiding(true)}>
            Void purchase
          </button>
        </div>
      )}
      {voiding && (
        <Modal title={`Void ${p.purchaseNo}`} onClose={() => setVoiding(false)}>
          <form onSubmit={onVoid} className="space-y-3">
            <p className="text-sm text-stone-600">A void is refused once any of its items is sold or moved on, or its bulk quantity or raw metal is used. Nothing is changed then.</p>
            {voidErr && <Alert>{voidErr}</Alert>}
            <Field label="Reason">
              <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="Void reason" />
            </Field>
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={busy}>
                Void purchase
              </button>
              <button type="button" className={btnSecondary} onClick={() => setVoiding(false)}>
                Keep it
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-stone-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
