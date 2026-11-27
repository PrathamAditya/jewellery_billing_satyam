import { useEffect, useState } from "react";
import { MODE_LABEL, formatMoney, parseRateInput, type CustomerResponse, type OldGoldResponse, type PaymentKind, type PaymentResponse, type SettlementLine, type SettlementResponse } from "@jewellery/shared";
import CustomerPicker from "../customers/CustomerPicker";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { navigate } from "../router";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { niceDate } from "../rates/api";
import OldGoldAdjustDialog from "../oldgold/OldGoldAdjustDialog";
import ReceiveDialog from "../payments/ReceiveDialog";
import { reverseAllocation } from "../payments/api";
import { customerAdvanceList, getSettlement, saveSettlementRemarks, useAdvances } from "./api";

function kindOf(l: SettlementLine): PaymentKind {
  if (l.kind) return l.kind;
  if (l.type === "Old gold") return "old_gold";
  if (l.type === "Advance" || l.type === "Opening advance") return "advance";
  return "invoice_payment";
}

/** Spec 017: the invoice's money on one page, grouped into Advance, Old Gold, and Payment sections. */
export default function SettlementTab({
  invoice,
  refreshKey = 0,
  defaultInvoicePurpose = "against_invoices",
  onChanged,
}: {
  invoice: { id: string; invoiceNo: string; customerId: string | null; balanceDuePaise: number };
  refreshKey?: number;
  defaultInvoicePurpose?: "at_sale" | "against_invoices";
  onChanged?: () => void;
}) {
  const { can } = useAuth();
  const [s, setS] = useState<SettlementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeLink, setNoticeLink] = useState<{ href: string; label: string } | null>(null);
  const [remarks, setRemarks] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [adjustingOldGold, setAdjustingOldGold] = useState(false);
  const [using, setUsing] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`oldGoldSaved:${invoice.id}`);
      if (!raw) return;
      sessionStorage.removeItem(`oldGoldSaved:${invoice.id}`);
      const saved = JSON.parse(raw) as { id: string; receiptNo: string };
      setNotice(`Old gold receipt ${saved.receiptNo} saved.`);
      setNoticeLink({ href: `#/old-gold/${saved.id}`, label: "Open the receipt" });
    } catch {
      /* the note is only a convenience */
    }
  }, [invoice.id]);

  const load = () => getSettlement(invoice.id).then((r) => (setS(r), setRemarks(r.remarks ?? ""), setError(null))).catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  useEffect(() => void load(), [invoice.id, refreshKey]);

  async function saveRemarks() {
    try {
      setS(await saveSettlementRemarks(invoice.id, remarks.trim() || null));
      setNotice("Remarks saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the remarks");
    }
  }

  async function doReverse() {
    if (!reason.trim()) return setError("Please give a reason");
    try {
      await reverseAllocation(reverseId!, reason.trim());
      setReverseId(null);
      setReason("");
      await load();
      onChanged?.();
      setNotice("Line reversed. The money is back with its advance.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reverse");
    }
  }

  if (!s) return error ? <Alert>{error}</Alert> : <p className="text-stone-500">Loading...</p>;
  const voided = s.invoice.voided;

  const advanceLines = s.lines.filter((l) => {
    const k = kindOf(l);
    return k === "advance" || k === "opening_advance";
  });
  const oldGoldLines = s.lines.filter((l) => kindOf(l) === "old_gold");
  const paymentLines = s.lines.filter((l) => {
    const k = kindOf(l);
    return k === "at_sale" || k === "invoice_payment";
  });

  const renderTable = (title: string, emptyText: string, rows: SettlementLine[], extraCredit = false) => {
    const sub = rows.reduce((n, l) => n + l.amountPaise, 0) + (extraCredit ? s.creditLines.reduce((n, c) => n + c.amountPaise, 0) : 0);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
          {(rows.length > 0 || (extraCredit && s.creditLines.length > 0)) && (
            <span className="text-sm font-medium text-stone-700">{formatMoney(sub)}</span>
          )}
        </div>
        {rows.length === 0 && (!extraCredit || s.creditLines.length === 0) ? (
          <p className="text-sm text-stone-500 bg-white border border-stone-200 rounded-xl px-3 py-2.5">{emptyText}</p>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-left text-stone-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.allocationId} className="border-t border-stone-100">
                    <td className="px-3 py-2 whitespace-nowrap">{niceDate(l.date)}</td>
                    <td className="px-3 py-2">{l.mode}</td>
                    <td className="px-3 py-2">
                      <a className="underline" href={`#/payments/${l.paymentId}`}>{l.reference}</a>
                      {l.fromCustomer && <span className="block text-xs text-stone-500">money of {l.fromCustomer}</span>}
                    </td>
                    <td className="px-3 py-2">{l.type}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(l.amountPaise)}</td>
                    <td className="px-3 py-2 text-right">
                      {can("payments.void") && !voided && (
                        <button className="underline" onClick={() => { setReverseId(l.allocationId); setReason(""); }}>Reverse</button>
                      )}
                    </td>
                  </tr>
                ))}
                {extraCredit && s.creditLines.map((c) => (
                  <tr key={c.applicationId} className="border-t border-stone-100">
                    <td className="px-3 py-2 whitespace-nowrap">{niceDate(c.date)}</td>
                    <td className="px-3 py-2">Credit</td>
                    <td className="px-3 py-2"><a className="underline" href={`#/credit-notes/${c.creditNoteId}`}>{c.creditNoteNo}</a></td>
                    <td className="px-3 py-2">Credit note</td>
                    <td className="px-3 py-2 text-right">{formatMoney(c.amountPaise)}</td>
                    <td className="px-3 py-2 text-right" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert>{error}</Alert>}
      {notice && (
        <Alert kind="ok">
          {notice}
          {noticeLink && <> <a className="underline ml-1" href={noticeLink.href}>{noticeLink.label}</a></>}
        </Alert>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Received against this invoice</h2>
        {renderTable("Advance", "No advance applied.", advanceLines, true)}
        {renderTable("Old Gold", "No old gold adjusted.", oldGoldLines)}
        {renderTable("Payment", "No payment received yet.", paymentLines)}
      </section>

      <dl className="bg-white border border-stone-200 rounded-xl px-4 py-2 grid sm:grid-cols-3 gap-x-6">
        <div className="py-1.5"><dt className="text-sm text-stone-500">Invoice value</dt><dd>{formatMoney(s.payablePaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Less: received</dt><dd>{formatMoney(s.receivedPaise)}</dd></div>
        <div className="py-1.5"><dt className="text-sm text-stone-500">Balance due</dt><dd className="font-semibold text-base">{formatMoney(s.balanceDuePaise)}</dd></div>
      </dl>
      {s.advanceReference && <p className="text-sm"><span className="text-stone-500">Advance reference:</span> {s.advanceReference}</p>}

      {s.autoNote.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm flex flex-col gap-1">
          <h3 className="font-medium">Settlement note</h3>
          {s.autoNote.map((x, i) => <p key={i}>{x}</p>)}
        </section>
      )}

      {!voided && (
        <div className="flex gap-2 flex-wrap">
          {can("payments.create") && s.balanceDuePaise > 0 && <button className={btnPrimary} onClick={() => setReceiving(true)}>Receive payment</button>}
          {can("payments.create") && s.balanceDuePaise > 0 && s.invoice.customerId && <button className={btnSecondary} onClick={() => setUsing(true)}>Use an advance</button>}
          {can("oldgold.create") && s.balanceDuePaise > 0 && s.invoice.customerId && (
            <button className={btnSecondary} onClick={() => setAdjustingOldGold(true)}>Adjust old gold</button>
          )}
          {can("oldgold.create") && s.balanceDuePaise > 0 && s.invoice.customerId && (
            <button className={btnSecondary} onClick={() => { sessionStorage.setItem("oldGoldPrefill", JSON.stringify({ customerId: s.invoice.customerId, invoiceId: invoice.id })); navigate("/old-gold/new"); }}>Add old gold receipt</button>
          )}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Remarks</h3>
        <textarea className={inputClass} rows={3} maxLength={1000} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!can("invoices.edit")} aria-label="Settlement remarks" />
        {can("invoices.edit") && <div><button className={btnSecondary} onClick={() => void saveRemarks()}>Save remarks</button></div>}
      </section>

      {receiving && (
        <ReceiveDialog
          invoice={{ id: invoice.id, invoiceNo: invoice.invoiceNo, balanceDuePaise: s.balanceDuePaise, customerId: s.invoice.customerId }}
          defaultInvoicePurpose={defaultInvoicePurpose}
          onClose={() => setReceiving(false)}
          onSaved={(pid: string) => {
            setReceiving(false);
            setNoticeLink({ href: `#/payments/${pid}`, label: "Open the receipt" });
            void load().then(() => setNotice("Payment saved and added to this invoice."));
            onChanged?.();
          }}
          onAnotherSaved={(saved: PaymentResponse) => {
            setNoticeLink({ href: `#/payments/${saved.id}`, label: "Open the receipt" });
            void load().then(() => setNotice("Payment saved and added to this invoice."));
            onChanged?.();
          }}
        />
      )}
      {adjustingOldGold && s.invoice.customerId && (
        <OldGoldAdjustDialog
          invoice={{ id: invoice.id, invoiceNo: invoice.invoiceNo, customerId: s.invoice.customerId, customerName: s.invoice.customerName, balanceDuePaise: s.balanceDuePaise }}
          onClose={() => setAdjustingOldGold(false)}
          onSaved={(r: OldGoldResponse) => {
            setAdjustingOldGold(false);
            setNoticeLink({ href: `#/old-gold/${r.id}`, label: "Open the receipt" });
            void load().then(() => setNotice(`Old gold receipt ${r.receiptNo} adjusted against this invoice.`));
            onChanged?.();
          }}
        />
      )}
      {using && s.invoice.customerId && (
        <UseAdvanceDialog invoiceId={invoice.id} invoiceNo={invoice.invoiceNo} customerId={s.invoice.customerId} balanceDuePaise={s.balanceDuePaise} onClose={() => setUsing(false)} onDone={() => { setUsing(false); setNoticeLink(null); void load().then(() => setNotice("Advance applied to the invoice.")); onChanged?.(); }} />
      )}
      {reverseId && (
        <Modal title="Reverse this line?" onClose={() => setReverseId(null)}>
          <p className="text-sm text-stone-600">The money goes back to its advance and the invoice owes it again.</p>
          <Field label="Reason *"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="flex gap-2 justify-end"><button className={btnSecondary} onClick={() => setReverseId(null)}>Cancel</button><button className={btnPrimary} onClick={() => void doReverse()}>Reverse</button></div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Spec 017 R7: pick which advances to use and how much of each. Oldest advance is filled first.
 * Feedback point 9: the owner can also choose another customer and use that customer's advance on this invoice.
 */
function UseAdvanceDialog({ invoiceId, invoiceNo, customerId, balanceDuePaise, onClose, onDone }: { invoiceId: string; invoiceNo: string; customerId: string; balanceDuePaise: number; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const [other, setOther] = useState(false);
  const [lender, setLender] = useState<CustomerResponse | null>(null);
  const sourceId = other ? lender?.id ?? null : customerId;
  const [list, setList] = useState<{ paymentId: string; mode?: string; receiptNo: string | null; orderNo: string | null; receiptDate: string; kind: string; remainingPaise: number }[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setList([]);
    setAmounts({});
    if (!sourceId) return;
    customerAdvanceList(sourceId).then((r) => {
      setList(r.items.filter((a) => a.remainingPaise > 0));
      // Fill the oldest first, up to what is owed (the same order the database uses for advances).
      let left = balanceDuePaise;
      const next: Record<string, string> = {};
      for (const a of r.items) {
        const take = Math.min(left, a.remainingPaise);
        if (take > 0) next[a.paymentId] = (take / 100).toFixed(2);
        left -= Math.max(0, take);
      }
      setAmounts(next);
    }).catch((e) => setError(e instanceof Error ? e.message : "Could not load advances"));
  }, [sourceId, balanceDuePaise]);

  async function submit() {
    setError(null);
    const allocations: { paymentId: string; amountPaise: number }[] = [];
    for (const [paymentId, text] of Object.entries(amounts)) {
      if (!text.trim()) continue;
      const p = parseRateInput(text, "kg");
      if (!p.ok) return setError(p.message);
      if (p.paisePerKg > 0) allocations.push({ paymentId, amountPaise: p.paisePerKg });
    }
    if (allocations.length === 0) return setError("Enter an amount for at least one advance");
    setBusy(true);
    try {
      await useAdvances(invoiceId, allocations, other);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply the advance");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Use an advance on ${invoiceNo}`} onClose={onClose}>
      {can("payments.void") && (
        <div className="flex flex-col gap-2 border border-stone-200 rounded-lg p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={other} onChange={(e) => { setOther(e.target.checked); setError(null); }} /> Use another customer's advance
          </label>
          {other && (
            <>
              <p className="text-stone-600">The money is taken from that customer's advance and paid onto this invoice. Both customers' ledgers and this invoice's settlement note show it.</p>
              {lender ? (
                <p>Advance of <strong>{lender.name}</strong> <button className="underline ml-2" onClick={() => setLender(null)}>Change</button></p>
              ) : (
                <CustomerPicker onPick={(c) => (c.id === customerId ? setError("That is this invoice's own customer. Untick the box to use their advance.") : setLender(c))} />
              )}
            </>
          )}
        </div>
      )}
      {!sourceId ? (
        <p className="text-sm text-stone-600">Choose the customer whose advance will be used.</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-stone-600">{other ? "That customer has no advance left." : "This customer has no advance left."}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {list.map((a) => (
            <li key={a.paymentId} className="flex items-center justify-between gap-2">
              <span>{a.receiptNo ?? "Old booklet"}{a.mode && list.filter((x) => x.receiptNo && x.receiptNo === a.receiptNo).length > 1 ? ` (${MODE_LABEL[a.mode as keyof typeof MODE_LABEL] ?? a.mode})` : ""}{a.orderNo ? ` · ${a.orderNo}` : ""} <span className="text-stone-500">· {formatMoney(a.remainingPaise)} left</span></span>
              <input className={`${inputClass} w-32`} value={amounts[a.paymentId] ?? ""} onChange={(e) => setAmounts((p) => ({ ...p, [a.paymentId]: e.target.value }))} aria-label={`Use from ${a.receiptNo ?? "booklet advance"}`} />
            </li>
          ))}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2 justify-end">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={busy || list.length === 0} onClick={() => void submit()}>{busy ? "Applying..." : "Apply"}</button>
      </div>
    </Modal>
  );
}
