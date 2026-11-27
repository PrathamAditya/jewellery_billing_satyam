import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MODE_LABEL, amountInWords, formatMoney, formatRoundOffPrint, formatWeightPrint, paginateByUnits, rowUnits, type OldGoldResponse, type PaymentResponse } from "@jewellery/shared";
import { Brand, Field, money, type Header } from "./common";
import { niceDate } from "./InvoicePrint";

/** Spec 014 R18: the payment type words printed on the receipt. */
const PAYMENT_TYPE: Record<PaymentResponse["kind"], string> = {
  advance: "Advance Payment",
  invoice_payment: "Payment Against Invoice",
  at_sale: "Payment At Delivery",
  opening_advance: "Opening Advance",
  old_gold: "Old Gold",
};

/** Spec 014 R19: rate per gram from the stored rate per kg (paise). */
const ratePerGram = (rateKgPaise: number) => formatMoney(Math.round(rateKgPaise / 1000));

/** Spec 014 R18: payment receipt on A5 landscape paper, matching the reference PDF design. */
export function PaymentReceipt({ p, header, copyLabel }: { p: PaymentResponse; header: Header; copyLabel: string }) {
  const against = [...new Set(p.allocations.filter((a) => !a.reversed).map((a) => a.invoiceNo).filter((n): n is string => Boolean(n)))].join(", ") || "-";
  const summary = p.advanceSummary;
  const hasBalanceDue = p.invoiceBalanceDuePaise !== null && p.invoiceBalanceDuePaise !== undefined;
  const isAdvanceReceipt = p.kind === "advance" || p.kind === "opening_advance" || p.kind === "old_gold";
  return (
    <div className="receipt-a5">
      {p.voided && <div className="void-stamp small">VOID</div>}
      <div className="watermark" />
      <div className="receipt-col">
        <div className="receipt-main">
          <div className="flex justify-between items-start">
            <Brand header={header} />
            <div className="text-right">
              <div className="label">{copyLabel}</div>
              <div className="serif text-[18pt] leading-none mt-0.5">Payment Receipt</div>
              <div className="text-[6.5pt] tracking-[0.2em] mt-1" style={{ color: "var(--print-gold)" }}>PAYMENT ACKNOWLEDGEMENT</div>
            </div>
          </div>
          <div className="rule mt-2" />

          <div className="grid grid-cols-2 gap-3 mt-1.5 pb-1.5 border-b border-[var(--print-line)]">
            <Field label="Receipt number">{p.receiptNo}</Field>
            <Field label="Receipt date">{niceDate(p.receiptDate)}</Field>
          </div>

          <div className="mt-1.5 p-2 border border-[var(--print-line)]" style={{ background: "#f7f1e3" }}>
            <div className="flex justify-between items-center">
              <div className="label" style={{ color: "var(--print-gold)" }}>Received from (customer details)</div>
              <div className="label">Payment received</div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div>
                <div className="serif text-[11pt] font-semibold leading-tight">{p.payer.name}</div>
                <div className="text-[7pt] text-stone-600">INDIA</div>
              </div>
              {p.payer.mobile && <Field label="Contact / mobile">{p.payer.mobile}</Field>}
              {p.payer.pan && <Field label="PAN number">{p.payer.pan}</Field>}
            </div>
          </div>

          <div className="flex justify-between items-baseline mt-2">
            <div className="serif text-[11pt] font-semibold">Payment Details</div>
            <div className="label">{isAdvanceReceipt ? "Advance receipt" : "Payment receipt"}</div>
          </div>
          <table className="ptable mt-0.5">
            <thead>
              <tr><th>Particular</th><th>Payment mode</th><th>{isAdvanceReceipt && against === "-" ? "Against order" : "Against"}</th><th className="r">Amount</th></tr>
            </thead>
            <tbody>
              {p.modeLines.map((l, i) => (
                <tr key={l.id}>
                  <td>{p.modeLines.length > 1 ? `Payment received (${i + 1} of ${p.modeLines.length})` : "Payment received"}</td>
                  <td>
                    <span className="font-semibold">{MODE_LABEL[l.mode]}</span>
                    {l.voided && p.modeLines.length > 1 ? " · VOID" : ""}
                    {l.reference && <div className="text-[7pt] text-stone-600">Txn: {l.reference}</div>}
                  </td>
                  <td>{i === 0 ? against : ""}</td>
                  <td className="r font-semibold">{money(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 p-2 border border-[var(--print-gold)] rounded" style={{ background: "#f7f1e3" }}>
            <div className="flex justify-between items-center gap-3">
              <div>
                <div className="label" style={{ color: "var(--print-burgundy)" }}>Total amount received</div>
                <div className="serif text-[15pt] font-bold leading-tight" style={{ color: "var(--print-burgundy)" }}>{money(p.amountPaise)}</div>
              </div>
              {hasBalanceDue && (
                <div className="total-box text-right">
                  <div className="label" style={{ color: "#f1e6d2" }}>Balance due</div>
                  <div className="serif text-[14pt] leading-tight">{money(p.invoiceBalanceDuePaise!)}</div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-1.5 px-2 py-1 border border-[var(--print-line)] text-[7.5pt]">
            <span className="label">Amount in words</span>{" "}
            <span className="italic ml-1">{amountInWords(p.amountPaise)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-1.5 text-[7.5pt]">
            <div>
              <span className="label">Payment type</span>
              <div className="font-semibold">{PAYMENT_TYPE[p.kind]}</div>
            </div>
            {summary && (isAdvanceReceipt || summary.thisRemainingPaise > 0) && (
              <div>
                <span className="label">Advance summary</span>
                <div>Previous advance remaining: {money(summary.previousRemainingPaise)}</div>
                <div>This receipt remaining: {money(summary.thisRemainingPaise)}</div>
                <div className="font-semibold">Total available: {money(summary.totalAvailablePaise)}</div>
              </div>
            )}
          </div>
          {p.remarks && (
            <div className="mt-1.5 px-2 py-1 border border-[var(--print-line)] text-[7.5pt]" style={{ background: "#f7f1e3" }}>
              <span className="label">Remarks</span> {p.remarks}
            </div>
          )}
        </div>
        <div className="receipt-foot flex justify-between items-end text-[6.5pt]" style={{ color: "#7a6a5f" }}>
          <span>{header.texts.receiptFooter}</span>
          <span className="label sign-line" style={{ color: "var(--print-ink)" }}>Authorised signatory</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Spec 014 R19: old gold purchase receipt on A5 landscape paper, matching the reference PDF design.
 * Feedback point 12 allows up to 50 rows across as many A5 sheets as needed.
 */
type OldGoldRows = OldGoldResponse["rows"];

function OldGoldBlock({ r, header, copyLabel, rows, partNo, partCount, isLast }: { r: OldGoldResponse; header: Header; copyLabel: string; rows: OldGoldRows; partNo: number; partCount: number; isLast: boolean }) {
  const refParts = [r.invoiceNo, r.payment?.receiptNo].filter(Boolean);
  const refText = refParts.join(" · ") || "-";
  const hasBalanceDue = r.invoiceBalanceDuePaise !== null && r.invoiceBalanceDuePaise !== undefined;
  return (
    <div className="receipt-a5">
      {r.voided && <div className="void-stamp small">VOID</div>}
      <div className="watermark" />
      <div className="receipt-col">
        <div className="receipt-main" data-receipt-main data-receipt-last={isLast ? "1" : "0"}>
          <div className="flex justify-between items-start">
            <Brand header={header} />
            <div className="text-right">
              <div className="label">{copyLabel}{partCount > 1 ? ` · Sheet ${partNo} of ${partCount}` : ""}</div>
              <div className="serif text-[18pt] leading-none mt-0.5">Old Gold Purchase</div>
              <div className="text-[6.5pt] tracking-[0.2em] mt-1" style={{ color: "var(--print-gold)" }}>PURCHASE &amp; SETTLEMENT RECORD</div>
            </div>
          </div>
          <div className="rule mt-2" />

          <div className="grid grid-cols-3 gap-3 mt-1.5 pb-1 border-b border-[var(--print-line)]">
            <Field label="Purchase receipt no.">{r.receiptNo}</Field>
            <Field label="Receipt date">{niceDate(r.receiptDate)}</Field>
            <Field label="Settlement treatment">{r.treatmentLabel}</Field>
          </div>

          <div className="mt-1.5 p-2 border border-[var(--print-line)]" style={{ background: "#f7f1e3" }}>
            <div className="flex justify-between items-center">
              <div className="label" style={{ color: "var(--print-gold)" }}>Received from (customer details)</div>
              <div className="label">Old gold seller</div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div>
                <div className="serif text-[11pt] font-semibold leading-tight">{r.payer.name}</div>
                <div className="text-[7pt] text-stone-600">INDIA</div>
              </div>
              {r.payer.mobile && <Field label="Contact / mobile">{r.payer.mobile}</Field>}
              {r.payer.pan && <Field label="PAN number">{r.payer.pan}</Field>}
            </div>
          </div>

          <div className="serif text-[11pt] font-semibold mt-1.5">Old Gold Details</div>
          <table className="ptable mt-0.5">
            <thead>
              <tr>
                <th>S.no.</th><th>Description</th><th className="r">Gross wt. (gm)</th><th className="r">Less (gm)</th><th className="r">Net wt. (gm)</th>
                <th className="r">Purity (%)</th><th className="r">Rate (₹/gm)</th><th className="r">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.lineNo}>
                  <td>{x.lineNo}</td>
                  <td style={{ whiteSpace: "pre-line" }}>{x.description}</td>
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

          {isLast ? (
            <>
              <div className="grid grid-cols-3 gap-3 mt-1.5 text-[7.5pt]">
                <div><span className="label">Settlement method</span><br /><strong>{r.settlementMethod}</strong></div>
                <div><span className="label">{r.invoiceNo ? "Invoice / advance ref." : "Order / advance reference"}</span><br /><strong>{refText}</strong></div>
                <div><span className="label">Payment status</span><br /><strong>{r.status}</strong></div>
              </div>

              <div className="mt-1.5 p-1.5 border border-[var(--print-gold)] rounded">
                <div className="label mb-1">Amount summary</div>
                <div className={`grid gap-2 ${hasBalanceDue ? "grid-cols-4" : "grid-cols-3"}`}>
                  <div className="border border-[var(--print-line)] px-2 py-1 rounded-sm" style={{ background: "#f7f1e3" }}>
                    <div className="label">Original amount</div>
                    <div className="text-[9pt] font-semibold">{money(r.originalPaise)}</div>
                  </div>
                  <div className="border border-[var(--print-line)] px-2 py-1 rounded-sm" style={{ background: "#f7f1e3" }}>
                    <div className="label">Round off</div>
                    <div className="text-[9pt] font-semibold">{formatRoundOffPrint(r.roundOffPaise)}</div>
                  </div>
                  <div className="total-box flex flex-col justify-center">
                    <div className="label" style={{ color: "#f1e6d2" }}>Final amount</div>
                    <div className="serif text-[13pt] leading-tight">{money(r.finalPaise)}</div>
                  </div>
                  {hasBalanceDue && (
                    <div className="border border-[var(--print-burgundy)] px-2 py-1 rounded-sm flex flex-col justify-center" style={{ background: "#f7f1e3" }}>
                      <div className="label" style={{ color: "var(--print-burgundy)" }}>Balance due</div>
                      <div className="serif text-[12pt] font-bold leading-tight" style={{ color: "var(--print-burgundy)" }}>{money(r.invoiceBalanceDuePaise!)}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-1 px-2 py-1 border border-[var(--print-line)] text-[7.5pt]">
                <span className="label">Amount in words</span>{" "}
                <span className="italic ml-1">{amountInWords(r.finalPaise)}</span>
              </div>
              <div className="mt-1 px-2 py-1 border border-[var(--print-line)] text-[7pt]" style={{ background: "#f7f1e3" }}>
                <span className="label">Settlement note</span> {r.settlementNote}
              </div>
            </>
          ) : (
            <div className="mt-2 text-[8pt] italic" style={{ color: "#7a6a5f" }}>Continued on the next sheet.</div>
          )}
        </div>
        <div className="receipt-foot flex justify-between items-end text-[6.5pt]" style={{ color: "#7a6a5f" }}>
          <span>This is a computer-generated old gold purchase record.</span>
          <span className="tracking-[0.14em] uppercase">{header.texts.oldGoldSlogan}</span>
          <span className="label sign-line" style={{ color: "var(--print-ink)" }}>Authorised signatory</span>
        </div>
      </div>
    </div>
  );
}

/** The old gold receipt as printed: one A5 landscape page per sheet/copy. */
export function OldGoldSheets({ r, header, labels }: { r: OldGoldResponse; header: Header; labels: string[] }) {
  // The starting room is a guess. After layout, a block whose content does not fit gives up one unit and the rows are placed again.
  const [caps, setCaps] = useState({ cont: 8, last: 3 });
  const pages = paginateByUnits(r.rows, (x) => rowUnits(x.description, 30), caps.cont, caps.last);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const mains = root.current?.querySelectorAll<HTMLElement>("[data-receipt-main]");
    if (!mains) return;
    let last = false;
    let cont = false;
    mains.forEach((m) => {
      if (m.scrollHeight > m.clientHeight + 1) (m.dataset.receiptLast === "1" ? (last = true) : (cont = true));
    });
    if (last || cont) setCaps((c) => ({ cont: cont ? Math.max(1, c.cont - 1) : c.cont, last: last ? Math.max(1, c.last - 1) : c.last }));
  }, [caps, r, header]);

  const blocks = labels.flatMap((label) =>
    pages.map((rows, i) => <OldGoldBlock key={`${label}-${i}`} r={r} header={header} copyLabel={label} rows={rows} partNo={i + 1} partCount={pages.length} isLast={i === pages.length - 1} />),
  );
  return (
    <div ref={root} style={{ display: "contents" }}>
      {blocks}
    </div>
  );
}

/** A5 receipts: each copy renders on its own A5 landscape page. */
export function ReceiptSheet({ labels, render }: { labels: string[]; render: (label: string) => ReactNode }) {
  return (
    <>
      {labels.map((label, i) => (
        <Fragment key={`${label}-${i}`}>{render(label)}</Fragment>
      ))}
    </>
  );
}
