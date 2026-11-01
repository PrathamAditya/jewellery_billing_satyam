import { useEffect, useState, type ReactNode } from "react";
import { copyOrder, type InvoiceResponse, type OldGoldResponse, type PaymentResponse, type SettingsSnapshot, type SettlementResponse } from "@jewellery/shared";
import { api, ApiError } from "../api";
import { btnPrimary, btnSecondary, inputClass } from "../customers/ui";
import { navigate } from "../router";
import { InvoiceSheets } from "./InvoicePrint";
import { OldGoldReceipt, PaymentReceipt, ReceiptSheet } from "./ReceiptPrint";
import type { Header } from "./common";
import "./fonts";

/** Spec 014 R1 to R8: the print views. Read-only, except the one audit row for an invoice print. */

type Choice = "first" | "second" | "both";

/** Prints the stored header snapshot (spec 003 R5). Documents from before the snapshot print from the current settings. */
async function headerFor(doc: { header: Record<string, unknown> | null }): Promise<Header> {
  return doc.header ? (doc.header as unknown as Header) : api<SettingsSnapshot>("/api/settings");
}

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "Could not load this document. Check the connection and try again.");

/** Routes: #/print/invoice/:id, #/print/payment/:id, #/print/old-gold/:id */
export function PrintRoute({ path }: { path: string }) {
  const [, kind, id] = path.split("/").filter(Boolean);
  if (kind === "invoice" && id) return <InvoicePrintPage id={id} />;
  if (kind === "payment" && id) return <PaymentPrintPage id={id} />;
  if (kind === "old-gold" && id) return <OldGoldPrintPage id={id} />;
  return <Message text="Nothing to print here." backTo="/" />;
}

function InvoicePrintPage({ id }: { id: string }) {
  const [data, setData] = useState<{ invoice: InvoiceResponse; settlement: SettlementResponse; header: Header } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>("both");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const invoice = await api<InvoiceResponse>(`/api/invoices/${id}`);
        const [settlement, header] = await Promise.all([api<SettlementResponse>(`/api/invoices/${id}/settlement`), headerFor(invoice)]);
        if (alive) setData({ invoice, settlement, header });
      } catch (e) {
        if (alive) setError(messageOf(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <Message text={error} backTo={`/invoices/${id}`} />;
  if (!data) return <Message text="Loading..." />;
  const copies = copyOrder(data.header.texts.copyLabels, choice);
  const print = () => {
    // The audit row is best effort: a failed log never stops the print (spec 014 R1).
    void api(`/api/invoices/${id}/print-event`, { method: "POST", body: { copy: copies.join(" + ") } }).catch(() => undefined);
    window.print();
  };
  return (
    <>
      <Toolbar backTo={`/invoices/${id}`} choice={choice} onChoice={setChoice} labels={data.header.texts.copyLabels} onPrint={print} hint="A4 paper, two-sided, flip on the long edge, scale 100%, margins none." />
      <div className="print-stage">
        {copies.map((label, i) => (
          <InvoiceSheets key={`${label}-${i}`} invoice={data.invoice} settlement={data.settlement} header={data.header} copyLabel={label} />
        ))}
      </div>
    </>
  );
}

function PaymentPrintPage({ id }: { id: string }) {
  const [data, setData] = useState<{ p: PaymentResponse; header: Header } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>("first");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await api<PaymentResponse>(`/api/payments/${id}`);
        const header = await headerFor(p);
        if (alive) setData({ p, header });
      } catch (e) {
        if (alive) setError(messageOf(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <Message text={error} backTo={`/payments/${id}`} />;
  if (!data) return <Message text="Loading..." />;
  if (data.p.kind === "at_sale") {
    return <Message text="This payment was taken at the time of sale. It has no receipt of its own; it is printed on the settlement page of the invoice." backTo={`/payments/${id}`} />;
  }
  const copies = copyOrder(data.header.texts.copyLabels, choice);
  return (
    <>
      <Toolbar backTo={`/payments/${id}`} choice={choice} onChoice={setChoice} labels={data.header.texts.copyLabels} onPrint={() => window.print()} hint="A4 paper, scale 100%, margins none. Two copies share one sheet, cut along the dashed line." />
      <div className="print-stage">
        <ReceiptSheet labels={copies} render={(label) => <PaymentReceipt p={data.p} header={data.header} copyLabel={label} />} />
      </div>
    </>
  );
}

function OldGoldPrintPage({ id }: { id: string }) {
  const [data, setData] = useState<{ r: OldGoldResponse; header: Header } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>("first");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api<OldGoldResponse>(`/api/old-gold/${id}`);
        const header = await headerFor(r);
        if (alive) setData({ r, header });
      } catch (e) {
        if (alive) setError(messageOf(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <Message text={error} backTo={`/old-gold/${id}`} />;
  if (!data) return <Message text="Loading..." />;
  const copies = copyOrder(data.header.texts.copyLabels, choice);
  return (
    <>
      <Toolbar backTo={`/old-gold/${id}`} choice={choice} onChoice={setChoice} labels={data.header.texts.copyLabels} onPrint={() => window.print()} hint="A4 paper, scale 100%, margins none. Two copies share one sheet, cut along the dashed line." />
      <div className="print-stage">
        <ReceiptSheet labels={copies} render={(label) => <OldGoldReceipt r={data.r} header={data.header} copyLabel={label} />} />
      </div>
    </>
  );
}

/** The toolbar is for the screen only: it is hidden when printing (spec 014 R1). */
function Toolbar({ backTo, choice, onChoice, labels, onPrint, hint }: { backTo: string; choice: Choice; onChoice: (c: Choice) => void; labels: string[]; onPrint: () => void; hint: string }) {
  return (
    <div className="print-toolbar no-print">
      <button className={btnSecondary} onClick={() => navigate(backTo)}>Back</button>
      <label className="text-sm flex items-center gap-2">
        Copies
        <select className={inputClass} value={choice} onChange={(e) => onChoice(e.target.value as Choice)}>
          <option value="first">{labels[0] ?? "Shop copy"}</option>
          <option value="second">{labels[1] ?? "Customer copy"}</option>
          <option value="both">Both</option>
        </select>
      </label>
      <button className={btnPrimary} onClick={onPrint}>Print</button>
      <span className="text-xs text-stone-500">{hint}</span>
    </div>
  );
}

function Message({ text, backTo }: { text: string; backTo?: string }): ReactNode {
  return (
    <main className="p-6 text-stone-700">
      <p>{text}</p>
      {backTo && <a href={`#${backTo}`} className="text-sm underline">Back</a>}
    </main>
  );
}
