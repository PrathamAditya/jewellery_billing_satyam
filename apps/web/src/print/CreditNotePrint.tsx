import { amountInWords, formatMoney, type CreditNoteDetail } from "@jewellery/shared";
import { Brand, Field, type Header } from "./common";

/** Spec 019d section 4: the credit note on one A4 portrait sheet, from the stored data only. */
export function CreditNoteSheet({ note, header }: { note: CreditNoteDetail; header: Header }) {
  const b = header.business;
  const gstLabel = note.taxMode === "intra" ? "CGST and SGST" : "IGST";
  const half = Math.floor(note.taxPaise / 2);
  return (
    <div className="page">
      <Brand header={header} />
      <div className="mt-4 flex justify-between items-start gap-6">
        <div className="text-[9pt] leading-snug">
          <div className="font-semibold">{b.legalName}</div>
          {b.addressLines.map((line) => <div key={line}>{line}</div>)}
          <div>{[b.city, b.state, b.pincode].filter(Boolean).join(", ")}</div>
          {b.gstin && <div>GSTIN {b.gstin}</div>}
        </div>
        <div className="text-right">
          <div className="serif text-[16pt]">CREDIT NOTE</div>
          <div className="text-[9pt]">No. {note.cnNo}</div>
          <div className="text-[9pt]">Date {note.cnDate}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4 text-[9pt]">
        <Field label="Customer">{note.customer.name}</Field>
        <Field label="Against invoice">{`${note.invoiceNo}`}</Field>
        <Field label="Mobile">{note.customer.mobile}</Field>
        <Field label="Address">{note.customer.address}</Field>
        <Field label="PAN">{note.customer.pan}</Field>
        <Field label="Reason">{note.reason}</Field>
      </div>
      <table className="w-full text-[9pt] mt-4 border-collapse">
        <thead>
          <tr className="border-b border-stone-400 text-left">
            <th className="py-1">#</th>
            <th>Description</th>
            <th>HSN</th>
            <th className="text-right">GST</th>
            <th className="text-right">Taxable value</th>
          </tr>
        </thead>
        <tbody>
          {note.lines.map((l) => (
            <tr key={l.lineNo} className="border-b border-stone-200">
              <td className="py-1">{l.lineNo}</td>
              <td>{l.description || "Goods"}</td>
              <td>{l.hsn}</td>
              <td className="text-right">{(l.gstRateBps / 100).toFixed(2)}%</td>
              <td className="text-right">{formatMoney(l.taxablePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 ml-auto w-[80mm] text-[9pt] space-y-1">
        <div className="flex justify-between"><span>Taxable value</span><span>{formatMoney(note.taxablePaise)}</span></div>
        {note.taxMode === "intra" ? (
          <>
            <div className="flex justify-between"><span>CGST</span><span>{formatMoney(half)}</span></div>
            <div className="flex justify-between"><span>SGST</span><span>{formatMoney(note.taxPaise - half)}</span></div>
          </>
        ) : (
          <div className="flex justify-between"><span>{gstLabel}</span><span>{formatMoney(note.taxPaise)}</span></div>
        )}
        <div className="flex justify-between"><span>Round-off</span><span>{formatMoney(note.roundOffPaise)}</span></div>
        <div className="flex justify-between font-semibold border-t border-stone-400 pt-1"><span>Credit amount</span><span>{formatMoney(note.amountPaise)}</span></div>
      </div>
      <p className="mt-3 text-[9pt]">{amountInWords(note.amountPaise)}</p>
      <p className="mt-8 text-[8pt] text-stone-500">Credited against {note.invoiceNo}. Stock is not updated by this note yet.</p>
    </div>
  );
}
