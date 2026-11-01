import { Fragment, type ReactNode } from "react";
import { MODE_LABEL, amountInWords, formatMoney, formatRoundOffPrint, formatWeightPrint, type OldGoldResponse, type PaymentResponse } from "@jewellery/shared";
import { Brand, Field, money, type Header } from "./common";
import { niceDate } from "./InvoicePrint";

/** Spec 014 R18: the payment type words printed on the receipt. */
const PAYMENT_TYPE: Record<PaymentResponse["kind"], string> = {
  advance: "Advance Payment",
  invoice_payment: "Payment Against Invoice",
  at_sale: "Payment At Sale",
  opening_advance: "Opening Advance",
  old_gold: "Old Gold",
};

/** Spec 014 R19: rate per gram from the stored rate per kg (paise). */
const ratePerGram = (rateKgPaise: number) => formatMoney(Math.round(rateKgPaise / 1000));

/** Spec 014 R18: payment receipt, A5 landscape. */
export function PaymentReceipt({ p, header, copyLabel }: { p: PaymentResponse; header: Header; copyLabel: string }) {
  const against = p.allocations.map((a) => a.invoiceNo).filter((n): n is string => Boolean(n)).join(", ") || "-";
  const summary = p.advanceSummary;
  return (
    <div className="receipt-a5">
      {p.voided && <div className="void-stamp small">VOID</div>}
      <div className="watermark" />
      <div className="flex justify-between items-start">
        <Brand header={header} />
        <div className="text-right">
          <div className="label">{copyLabel}</div>
          <div className="serif text-[18pt] leading-none mt-1">Payment Receipt</div>
          <div className="text-[6.5pt] tracking-[0.2em] mt-1" style={{ color: "var(--print-gold)" }}>PAYMENT ACKNOWLEDGEMENT</div>
        </div>
      </div>
      <div className="rule mt-2" />

      <div className="grid grid-cols-3 gap-3 mt-2">
        <Field label="Receipt number">{p.receiptNo}</Field>
        <Field label="Receipt date">{niceDate(p.receiptDate)}</Field>
        <Field label="Received from">{p.payer.name}</Field>
        {p.payer.mobile && <Field label="Mobile">{p.payer.mobile}</Field>}
        {p.payer.pan && <Field label="PAN">{p.payer.pan}</Field>}
      </div>

      <table className="ptable mt-3">
        <thead>
          <tr><th>Particular</th><th>Payment mode</th><th>Against</th><th className="r">Amount</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Payment received</td>
            <td>{MODE_LABEL[p.mode]}{p.reference ? ` · ${p.reference}` : ""}</td>
            <td>{against}</td>
            <td className="r">{money(p.amountPaise)}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex justify-between items-end mt-3">
        <div className="total-box">
          <div className="label" style={{ color: "#f1e6d2" }}>Total amount received</div>
          <div className="serif text-[16pt]">{money(p.amountPaise)}</div>
        </div>
        <div className="text-[8pt] max-w-[95mm]">
          <span className="label">Amount in words</span>
          <br />
          {amountInWords(p.amountPaise)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-2 text-[8pt]">
        <div><span className="label">Payment type</span><br />{PAYMENT_TYPE[p.kind]}</div>
        {summary && (
          <div>
            <span className="label">Advance summary</span>
            <div>Previous advance remaining: {money(summary.previousRemainingPaise)}</div>
            <div>This receipt remaining: {money(summary.thisRemainingPaise)}</div>
            <div className="font-semibold">Total available: {money(summary.totalAvailablePaise)}</div>
          </div>
        )}
      </div>
      {p.remarks && <p className="text-[8pt] mt-2"><span className="label">Remarks</span> {p.remarks}</p>}

      <div className="absolute left-[9mm] right-[9mm] bottom-[6mm] flex justify-between text-[6.5pt]" style={{ color: "#7a6a5f" }}>
        <span>{header.texts.receiptFooter}</span>
        <span className="label" style={{ color: "var(--print-ink)" }}>Authorised signatory</span>
      </div>
    </div>
  );
}

/** Spec 014 R19: old gold purchase receipt, A5 landscape. */
export function OldGoldReceipt({ r, header, copyLabel }: { r: OldGoldResponse; header: Header; copyLabel: string }) {
  return (
    <div className="receipt-a5">
      {r.voided && <div className="void-stamp small">VOID</div>}
      <div className="watermark" />
      <div className="flex justify-between items-start">
        <Brand header={header} />
        <div className="text-right">
          <div className="label">{copyLabel}</div>
          <div className="serif text-[18pt] leading-none mt-1">Old Gold Purchase</div>
          <div className="text-[6.5pt] tracking-[0.2em] mt-1" style={{ color: "var(--print-gold)" }}>PURCHASE AND SETTLEMENT RECORD</div>
        </div>
      </div>
      <div className="rule mt-2" />

      <div className="grid grid-cols-3 gap-3 mt-2">
        <Field label="Purchase receipt no.">{r.receiptNo}</Field>
        <Field label="Receipt date">{niceDate(r.receiptDate)}</Field>
        <Field label="Settlement treatment">{r.treatmentLabel}</Field>
        <Field label="Received from">{r.payer.name}</Field>
        {r.payer.mobile && <Field label="Mobile">{r.payer.mobile}</Field>}
        {r.payer.pan && <Field label="PAN">{r.payer.pan}</Field>}
      </div>

      <table className="ptable mt-2">
        <thead>
          <tr>
            <th>S.no.</th><th>Description</th><th className="r">Gross (g)</th><th className="r">Less (g)</th><th className="r">Net (g)</th>
            <th className="r">Purity %</th><th className="r">Rate (₹/g)</th><th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.lineNo}>
              <td>{x.lineNo}</td>
              <td>{x.description}</td>
              <td className="r">{formatWeightPrint(x.grossMg)}</td>
              <td className="r">{formatWeightPrint(x.lessMg)}</td>
              <td className="r">{formatWeightPrint(x.netMg)}</td>
              <td className="r">{(x.purityBps / 100).toFixed(2)}</td>
              <td className="r">{ratePerGram(x.rateKgPaise)}</td>
              <td className="r">{money(x.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-3 gap-3 mt-2 text-[8pt]">
        <div><span className="label">Settlement method</span><br />{r.settlementMethod}</div>
        <div><span className="label">Order / advance reference</span><br />{r.payment?.receiptNo ?? "-"}</div>
        <div><span className="label">Payment status</span><br />{r.status}</div>
      </div>

      <div className="flex justify-between items-end mt-2">
        <div className="text-[8pt]">
          <div>Original amount {money(r.originalPaise)}</div>
          <div>Round off {formatRoundOffPrint(r.roundOffPaise)}</div>
        </div>
        <div className="total-box">
          <div className="label" style={{ color: "#f1e6d2" }}>Final amount</div>
          <div className="serif text-[16pt]">{money(r.finalPaise)}</div>
        </div>
      </div>
      <div className="text-[8pt] mt-2"><span className="label">Amount in words</span> {amountInWords(r.finalPaise)}</div>
      <p className="text-[7.5pt] mt-1">{r.settlementNote}</p>

      <div className="absolute left-[9mm] right-[9mm] bottom-[6mm] flex justify-between text-[6.5pt]" style={{ color: "#7a6a5f" }}>
        <span>{header.texts.oldGoldSlogan}</span>
        <span className="label" style={{ color: "var(--print-ink)" }}>Authorised signatory</span>
      </div>
    </div>
  );
}

/** A5 receipts on A4 paper: one block at the top, or two copies with a dashed cut line between them (spec 014 R6, R8). */
export function ReceiptSheet({ labels, render }: { labels: string[]; render: (label: string) => ReactNode }) {
  return (
    <div className="a4-sheet">
      {labels.map((label, i) => (
        <Fragment key={`${label}-${i}`}>
          {i > 0 && <div className="cut-line" />}
          {render(label)}
        </Fragment>
      ))}
    </div>
  );
}
