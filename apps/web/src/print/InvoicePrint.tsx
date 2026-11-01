import { Fragment } from "react";
import { amountInWords, formatMoney, formatRoundOffPrint, formatWeightPrint, metalLine, paginate, type InvoiceResponse, type SettlementResponse } from "@jewellery/shared";
import { Brand, Field, money, type Header } from "./common";

/** The calculation stored with the invoice (spec 012 R14). Only the fields printed here. */
export type StoredCalc = {
  taxMode: "intra" | "inter";
  roundOffPaise: number;
  payablePaise: number;
  groups: { gstRateBps: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }[];
};

const percent = (bps: number) => `${bps / 100}%`;

export function niceDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

export type InvoiceSheetsProps = { invoice: InvoiceResponse; settlement: SettlementResponse | null; header: Header; copyLabel: string };

/**
 * One copy of the invoice: the tax invoice front on each page, and the settlement page as the back of the last page (spec 014 R7).
 * Earlier continuation pages get a blank back so the settlement stays on the back of the last sheet.
 */
export function InvoiceSheets({ invoice, settlement, header, copyLabel }: InvoiceSheetsProps) {
  const calc = invoice.calc as StoredCalc;
  const pages = paginate(invoice.lines);
  const last = pages.length - 1;
  return (
    <>
      {pages.map((rows, i) => (
        <Fragment key={i}>
          <FrontPage invoice={invoice} calc={calc} header={header} copyLabel={copyLabel} rows={rows} pageNo={i + 1} isLast={i === last} />
          {i === last ? <SettlementPage invoice={invoice} calc={calc} header={header} settlement={settlement} /> : <div className="page" />}
        </Fragment>
      ))}
    </>
  );
}

type Lines = InvoiceResponse["lines"];

function FrontPage({ invoice, calc, header, copyLabel, rows, pageNo, isLast }: { invoice: InvoiceResponse; calc: StoredCalc; header: Header; copyLabel: string; rows: Lines; pageNo: number; isLast: boolean }) {
  const b = header.business;
  const cityLine = [b.city, b.state, b.pincode].filter(Boolean).join(" ");
  return (
    <div className="page">
      {invoice.voidedAt && <div className="void-stamp">VOID</div>}
      <div className="watermark" />
      <div className="flex justify-between items-start">
        <Brand header={header} />
        <div className="text-right">
          <div className="label">{copyLabel}</div>
          <div className="serif text-[22pt] leading-none mt-1">Tax Invoice</div>
          <div className="text-[7pt] tracking-[0.2em] mt-1" style={{ color: "var(--print-gold)" }}>GST REGISTERED INVOICE</div>
          <div className="label mt-1">Page {pageNo}</div>
        </div>
      </div>
      <div className="text-[7.5pt] mt-2 flex flex-wrap gap-x-4" style={{ color: "#5a4a40" }}>
        {b.addressLines.map((a) => <span key={a}>{a}</span>)}
        {cityLine && <span>{cityLine}</span>}
        {b.gstin && <span>GSTIN {b.gstin}</span>}
        {b.pan && <span>PAN {b.pan}</span>}
        <span>State code {b.stateCode}</span>
        {b.phones.length > 0 && <span>{b.phones.join(" · ")}</span>}
        {b.email && <span>{b.email}</span>}
      </div>
      <div className="rule mt-2" />

      <div className="grid grid-cols-2 mt-2 border border-[var(--print-line)]">
        <div className="p-2 border-r border-[var(--print-line)]">
          <Field label="Invoice number">{invoice.invoiceNo}</Field>
          {invoice.revisionNo > 1 && <div className="text-[7pt] mt-0.5">Revised (version {invoice.revisionNo})</div>}
        </div>
        <div className="p-2"><Field label="Invoice date">{niceDate(invoice.invoiceDate)}</Field></div>
      </div>

      <div className="mt-2 p-2 border border-[var(--print-line)]" style={{ background: "#f7f1e3" }}>
        <div className="flex justify-between">
          <div className="label">Billed to</div>
          <div className="label">Retail buyer / consumer</div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-1">
          <Field label="Name">{invoice.customerName}</Field>
          {invoice.customerMobile && <Field label="Mobile">{invoice.customerMobile}</Field>}
          {invoice.customerPan && <Field label="PAN">{invoice.customerPan}</Field>}
        </div>
        {invoice.customerAddress && <div className="mt-1"><Field label="Address">{invoice.customerAddress}</Field></div>}
      </div>

      <div className="serif text-[12pt] mt-3">Particulars</div>
      <table className="ptable mt-1">
        <thead>
          <tr>
            <th>#</th><th>Description</th><th>HSN/SAC</th><th>Purity</th>
            <th className="r">Gross wt. (g)</th><th className="r">Nett wt. (g)</th><th className="r">Wast./Pol. (g)</th><th className="r">Rate</th><th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.lineNo}>
              <td>{l.lineNo}</td>
              <td><div className="value">{l.description || "Item"}</div><div className="label">{metalLine(l.purity, l.hsn)}</div></td>
              <td>{l.hsn}</td>
              <td>{l.purity}</td>
              <td className="r">{formatWeightPrint(l.grossWeightMg)}</td>
              <td className="r">{formatWeightPrint(l.netWeightMg)}</td>
              <td className="r">{l.polishMg > 0 ? formatWeightPrint(l.polishMg) : "-"}</td>
              <td className="r">{formatMoney(l.displayRatePaisePerGram)}/g</td>
              <td className="r">{money(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {isLast ? (
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <div className="label">Invoice note and tax structure</div>
            <p className="text-[7.5pt] mt-1 leading-snug">{header.texts.invoiceNote}</p>
            <div className="mt-3 pl-2 border-l-2" style={{ borderColor: "var(--print-gold)" }}>
              <div className="label">Amount in words</div>
              <div className="serif text-[10pt] mt-1">{amountInWords(calc.payablePaise)}</div>
            </div>
          </div>
          <div>
            <div className="label mb-1">GST invoice summary</div>
            <table className="ptable">
              <tbody>
                {calc.groups.map((g) => (
                  <Fragment key={g.gstRateBps}>
                    <tr><td>Taxable goods value @ {percent(g.gstRateBps)}</td><td className="r">{money(g.taxablePaise)}</td></tr>
                    {calc.taxMode === "intra" ? (
                      <>
                        <tr><td>CGST @ {percent(g.gstRateBps / 2)}</td><td className="r">{money(g.cgstPaise)}</td></tr>
                        <tr><td>SGST @ {percent(g.gstRateBps / 2)}</td><td className="r">{money(g.sgstPaise)}</td></tr>
                      </>
                    ) : (
                      <tr><td>IGST @ {percent(g.gstRateBps)}</td><td className="r">{money(g.igstPaise)}</td></tr>
                    )}
                  </Fragment>
                ))}
                <tr><td>Round off</td><td className="r">{formatRoundOffPrint(calc.roundOffPaise)}</td></tr>
              </tbody>
            </table>
            <div className="total-box mt-2 flex justify-between items-center">
              <div>
                <div className="label" style={{ color: "#f1e6d2" }}>Total invoice value</div>
                <div className="text-[7pt]">All taxes included</div>
              </div>
              <div className="serif text-[17pt]">{money(calc.payablePaise)}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 text-[8pt] italic" style={{ color: "#7a6a5f" }}>Continued on the next page.</div>
      )}

      <div className="absolute left-[12mm] right-[12mm] bottom-[10mm]">
        {isLast && (
          <p className="text-[7.5pt] mb-2">Settlement details are printed on the reverse side. Quote invoice number {invoice.invoiceNo} for all future payments.</p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="label">Bank and payment details</div>
            <BankLines header={header} />
          </div>
          <div>
            <div className="label">Terms and conditions</div>
            <ol className="text-[7pt] leading-snug list-decimal pl-4">
              {header.texts.invoiceTerms.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </div>
        </div>
        <div className="flex justify-between items-end mt-3 text-[6.5pt]" style={{ color: "#7a6a5f" }}>
          <span>This is a computer-generated tax invoice.</span>
          <span className="label" style={{ color: "var(--print-ink)" }}>Authorised signatory</span>
        </div>
      </div>
    </div>
  );
}

function SettlementPage({ invoice, calc, header, settlement }: { invoice: InvoiceResponse; calc: StoredCalc; header: Header; settlement: SettlementResponse | null }) {
  const lines = settlement?.lines ?? [];
  const received = settlement?.receivedPaise ?? 0;
  const balance = settlement?.balanceDuePaise ?? calc.payablePaise;
  return (
    <div className="page">
      <div className="watermark" />
      <div className="flex justify-between items-start">
        <div>
          <div className="serif text-[20pt] leading-none">Settlement and Payment Record</div>
          <div className="text-[7pt] tracking-[0.2em] mt-1" style={{ color: "var(--print-gold)" }}>REVERSE SIDE · LINKED TO THE TAX INVOICE</div>
        </div>
        <div className="text-right text-[8pt]">
          <div>Invoice no. <strong>{invoice.invoiceNo}</strong></div>
          <div>Invoice date <strong>{niceDate(invoice.invoiceDate)}</strong></div>
          <div>Customer <strong>{invoice.customerName}</strong></div>
        </div>
      </div>
      <div className="rule mt-3" />

      <div className="serif text-[12pt] mt-3">Advance payments</div>
      <div className="label">Received before or against the sale</div>
      <table className="ptable mt-1">
        <thead>
          <tr><th>Date</th><th>Mode</th><th>Reference / transaction no.</th><th>Type</th><th className="r">Amount</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.allocationId}>
              <td>{niceDate(l.date)}</td><td>{l.mode}</td><td>{l.reference}</td><td>{l.type}</td><td className="r">{money(l.amountPaise)}</td>
            </tr>
          ))}
          {lines.length === 0 && <tr><td colSpan={5}>Nothing received yet</td></tr>}
          <tr><td colSpan={4} className="value">Total advance payments</td><td className="r value">{money(received)}</td></tr>
        </tbody>
      </table>
      {settlement?.advanceReference && <p className="text-[8pt] mt-2"><span className="label">Advance reference</span> {settlement.advanceReference}</p>}

      <div className="grid grid-cols-2 gap-4 mt-4">
        <div className="p-3 border border-[var(--print-line)]" style={{ background: "#f7f1e3" }}>
          <div className="label">Settlement note</div>
          <p className="text-[7.5pt] mt-1">{header.texts.settlementNote}</p>
          {(settlement?.autoNote ?? []).map((n) => <p key={n} className="text-[7.5pt] mt-1">{n}</p>)}
          {settlement?.remarks && <p className="text-[7.5pt] mt-2"><span className="label">Remarks</span><br />{settlement.remarks}</p>}
        </div>
        <div>
          <table className="ptable">
            <tbody>
              <tr><td>Invoice value</td><td className="r">{money(calc.payablePaise)}</td></tr>
              <tr><td>Less: advance received</td><td className="r">{money(received)}</td></tr>
            </tbody>
          </table>
          <div className="total-box mt-2 flex justify-between items-center">
            <div className="label" style={{ color: "#f1e6d2" }}>Balance due</div>
            <div className="serif text-[16pt]">{money(balance)}</div>
          </div>
        </div>
      </div>

      <div className="absolute left-[12mm] right-[12mm] bottom-[10mm] flex justify-end">
        <span className="label" style={{ color: "var(--print-ink)" }}>Authorised signatory</span>
      </div>
    </div>
  );
}

function BankLines({ header }: { header: Header }) {
  const bk = header.bank;
  const lines = [
    bk.accountName && `Account name: ${bk.accountName}`,
    bk.bankName && `Bank: ${bk.bankName}`,
    bk.accountNo && `A/C no.: ${bk.accountNo}`,
    bk.ifsc && `IFSC: ${bk.ifsc}`,
    bk.upiId && `UPI ID: ${bk.upiId}`,
  ].filter((l): l is string => Boolean(l));
  if (lines.length === 0) return null;
  return <div className="text-[7.5pt] leading-snug">{lines.map((l) => <div key={l}>{l}</div>)}</div>;
}
