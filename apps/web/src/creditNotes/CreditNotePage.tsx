import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { REFUND_MODES, amountInWords, formatMoney, indiaDate, parseRupeesToPaise, type CreditNoteDetail, type RefundMode } from "@jewellery/shared";
import { ApiError, api } from "../api";
import { Alert, Field, Modal, btnPrimary, btnSecondary, inputClass, pcOnly } from "../customers/ui";
import { niceDate } from "../rates/api";
import { navigate } from "../router";
import { applyCreditNote, getCreditNote, payOutCreditNote, reverseApplication, reversePayout, voidCreditNote } from "./api";
import { useAuth } from "../auth";

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Check the connection and try again.");

/** Asks for a reason, then runs the action (spec 019d R13, R14). */
function ReasonDialog({ title, run, onClose, onDone }: { title: string; run: (reason: string) => Promise<CreditNoteDetail>; onClose: () => void; onDone: (n: CreditNoteDetail) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-3 text-sm"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          if (!reason.trim()) return setErr("Please give a reason");
          setBusy(true);
          try {
            onDone(await run(reason.trim()));
          } catch (e2) {
            setErr(messageOf(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        {err && <Alert>{err}</Alert>}
        <Field label="Reason">
          <input className={inputClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>Confirm</button>
        </div>
      </form>
    </Modal>
  );
}

function ApplyDialog({ note, onClose, onDone }: { note: CreditNoteDetail; onClose: () => void; onDone: (n: CreditNoteDetail) => void }) {
  const [bills, setBills] = useState<{ id: string; invoiceNo: string; balanceDuePaise: number }[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!note.customerId) return;
    void api<{ items: { id: string; invoiceNo: string; balanceDuePaise: number; voidedAt: string | null }[] }>(`/api/invoices?customerId=${note.customerId}`)
      .then((r) => setBills(r.items.filter((i) => !i.voidedAt && i.balanceDuePaise > 0)))
      .catch(() => setBills([]));
  }, [note.customerId]);
  return (
    <Modal title={`Apply ${note.cnNo} to a bill`} onClose={onClose}>
      <form
        className="space-y-3 text-sm"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const p = parseRupeesToPaise(amount, "amount");
          if (!p.ok) return setErr(p.message);
          if (!invoiceId) return setErr("Choose the bill");
          setBusy(true);
          try {
            onDone(await applyCreditNote(note.id, invoiceId, p.value));
          } catch (e2) {
            setErr(messageOf(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        {err && <Alert>{err}</Alert>}
        <p>Held credit: <strong>{formatMoney(note.heldPaise)}</strong></p>
        <Field label="Bill of the same customer">
          <select className={inputClass} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">Choose a bill</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>{b.invoiceNo} (due {formatMoney(b.balanceDuePaise)})</option>
            ))}
          </select>
        </Field>
        <Field label="Amount (₹)" hint={`At most ${formatMoney(note.heldPaise)}`}>
          <input className={inputClass} inputMode="decimal" value={amount} placeholder={(note.heldPaise / 100).toFixed(2)} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>Apply</button>
        </div>
      </form>
    </Modal>
  );
}

function PayoutDialog({ note, onClose, onDone }: { note: CreditNoteDetail; onClose: () => void; onDone: (n: CreditNoteDetail) => void }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<RefundMode>("cash");
  const [reference, setReference] = useState("");
  const [paidDate, setPaidDate] = useState(indiaDate());
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Pay back from ${note.cnNo}`} onClose={onClose}>
      <form
        className="space-y-3 text-sm"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const p = parseRupeesToPaise(amount, "amount");
          if (!p.ok) return setErr(p.message);
          setBusy(true);
          try {
            onDone(await payOutCreditNote(note.id, { amountPaise: p.value, mode, reference: reference.trim() || null, paidDate, remarks: remarks.trim() || null }));
          } catch (e2) {
            setErr(messageOf(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        {err && <Alert>{err}</Alert>}
        <p>Held credit: <strong>{formatMoney(note.heldPaise)}</strong></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)">
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Paid on">
            <input type="date" className={inputClass} value={paidDate} max={indiaDate()} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
          <Field label="How">
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as RefundMode)}>
              {REFUND_MODES.map((m) => (
                <option key={m} value={m}>{m.replace("_", " ")}</option>
              ))}
            </select>
          </Field>
          <Field label="Reference (optional)">
            <input className={inputClass} value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <Field label="Remarks (optional)">
          <input className={inputClass} value={remarks} maxLength={300} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy}>Save payout</button>
        </div>
      </form>
    </Modal>
  );
}

/** Spec 019d section 4: one credit note, its lines, what it was applied to, and what was paid back. */
export default function CreditNotePage({ id }: { id: string }) {
  const { can } = useAuth();
  const [note, setNote] = useState<CreditNoteDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "apply" | "payout" | "void" | { reverse: "application" | "payout"; id: string }>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNote(await getCreditNote(id));
      setErr(null);
    } catch (e) {
      setErr(messageOf(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (err && !note) return <main className="p-6 text-stone-700"><p>{err}</p><button className={btnSecondary} onClick={() => navigate("/credit-notes")}>Back</button></main>;
  if (!note) return <main className="p-6 text-stone-700">Loading...</main>;

  const live = !note.voided;
  const done = (n: CreditNoteDetail) => {
    setNote(n);
    setDialog(null);
    setNotice("Saved.");
  };
  return (
    <main className="p-3 sm:p-6 max-w-4xl mx-auto w-full space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">{note.cnNo}</h1>
          <p className="text-sm text-stone-600">
            {note.kindLabel} · {niceDate(note.cnDate)} · against <a className="underline" href={`#/invoices/${note.invoiceId}`}>{note.invoiceNo}</a>
            {note.replacementInvoiceNo && <> · replacement <a className="underline" href={`#/invoices/${note.replacementInvoiceId}`}>{note.replacementInvoiceNo}</a></>}
            {note.ogpNo && <> · old gold <a className="underline" href={`#/old-gold/${note.ogpId}`}>{note.ogpNo}</a></>}
          </p>
          <p className="text-sm mt-1">{note.customer.name}{note.customer.mobile ? ` · ${note.customer.mobile}` : ""}</p>
          {note.voided && <p className="text-red-700 text-sm mt-1">Voided: {note.voidReason}</p>}
        </div>
        <div className={`flex gap-2 ${pcOnly}`}>
          <button className={btnSecondary} onClick={() => navigate(`/print/credit-note/${note.id}`)}>Print</button>
          {can("payments.create") && live && note.heldPaise > 0 && <button className={btnSecondary} onClick={() => setDialog("apply")}>Apply to a bill</button>}
          {can("payments.refund") && live && note.heldPaise > 0 && note.customerId && <button className={btnSecondary} onClick={() => setDialog("payout")}>Pay out</button>}
          {can("payments.void") && live && <button className={btnSecondary} onClick={() => setDialog("void")}>Void</button>}
        </div>
      </div>
      {notice && <Alert kind="ok">{notice}</Alert>}
      {err && <Alert>{err}</Alert>}

      <div className="bg-white border border-stone-200 rounded-xl p-4 flex flex-wrap gap-6 text-sm">
        <span>Credit note <strong>{formatMoney(note.amountPaise)}</strong></span>
        <span>Still held <strong>{formatMoney(note.heldPaise)}</strong></span>
        <span className="text-stone-500">{amountInWords(note.amountPaise)}</span>
      </div>

      <section className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <h2 className="px-4 pt-3 font-medium">Returned lines</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-stone-500">
            <tr>
              <th className="px-4 py-2">#</th>
              <th>Description</th>
              <th>HSN</th>
              <th className="text-right">GST</th>
              <th className="text-right">Taxable</th>
            </tr>
          </thead>
          <tbody>
            {note.lines.map((l) => (
              <tr key={l.lineNo} className="border-t border-stone-100">
                <td className="px-4 py-2">{l.invoiceLineNo}</td>
                <td>{l.description}</td>
                <td>{l.hsn}</td>
                <td className="text-right">{(l.gstRateBps / 100).toFixed(2)}%</td>
                <td className="text-right">{formatMoney(l.taxablePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 text-sm space-y-1 text-right">
          <div>Taxable value {formatMoney(note.taxablePaise)}</div>
          <div>{note.taxMode === "intra" ? `CGST and SGST ${formatMoney(Math.floor(note.taxPaise / 2))} each` : `IGST ${formatMoney(note.taxPaise)}`}</div>
          <div>Round-off {formatMoney(note.roundOffPaise)}</div>
          <div className="font-semibold">Credit note amount {formatMoney(note.amountPaise)}</div>
        </div>
      </section>

      <Section title="Applied to bills" empty="Nothing applied yet.">
        {note.applications.map((a) => (
          <Row key={a.id} left={`${a.invoiceNo} · ${niceDate(a.date)}`} right={formatMoney(a.amountPaise)} muted={a.reversed} note={a.reversed ? `Reversed: ${a.reverseReason}` : undefined}>
            {!a.reversed && live && can("payments.void") && <button className="text-sm underline" onClick={() => setDialog({ reverse: "application", id: a.id })}>Reverse</button>}
          </Row>
        ))}
      </Section>

      <Section title="Paid back" empty="Nothing paid back.">
        {note.payouts.map((p) => (
          <Row key={p.id} left={`${niceDate(p.paidDate)} · ${p.mode.replace("_", " ")}${p.reference ? ` · ${p.reference}` : ""}`} right={formatMoney(p.amountPaise)} muted={p.reversed} note={p.reversed ? `Reversed: ${p.reverseReason}` : p.remarks ?? undefined}>
            {!p.reversed && live && can("payments.refund") && <button className="text-sm underline" onClick={() => setDialog({ reverse: "payout", id: p.id })}>Reverse</button>}
          </Row>
        ))}
      </Section>

      <p className="text-xs text-stone-500">A credit note is never deleted. Its number stays, and a void puts back what it had applied.</p>

      {dialog === "apply" && <ApplyDialog note={note} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "payout" && <PayoutDialog note={note} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "void" && <ReasonDialog title={`Void ${note.cnNo}?`} run={(reason) => voidCreditNote(note.id, reason)} onClose={() => setDialog(null)} onDone={done} />}
      {dialog && typeof dialog === "object" && dialog.reverse === "application" && (
        <ReasonDialog title="Reverse this application?" run={async (reason) => { await reverseApplication(dialog.id, reason); return getCreditNote(note.id); }} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog && typeof dialog === "object" && dialog.reverse === "payout" && (
        <ReasonDialog title="Reverse this payout?" run={(reason) => reversePayout(dialog.id, reason)} onClose={() => setDialog(null)} onDone={done} />
      )}
    </main>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <section className="bg-white border border-stone-200 rounded-xl">
      <h2 className="px-4 pt-3 font-medium">{title}</h2>
      {items.length === 0 ? <p className="px-4 py-3 text-sm text-stone-500">{empty}</p> : <ul className="divide-y divide-stone-100">{children}</ul>}
    </section>
  );
}

function Row({ left, right, note, muted, children }: { left: string; right: string; note?: string; muted?: boolean; children?: ReactNode }) {
  return (
    <li className={`px-4 py-2 flex items-center justify-between gap-3 text-sm ${muted ? "text-stone-400 line-through" : ""}`}>
      <div>
        <div>{left}</div>
        {note && <div className="text-xs text-stone-500 no-underline">{note}</div>}
      </div>
      <div className="flex items-center gap-3">
        <span>{right}</span>
        {children}
      </div>
    </li>
  );
}

