import type { InvoiceLineInput } from "@jewellery/calc";
import {
  PURITY_RATE_KIND,
  formatWeightGrams,
  paisePerKgToInput,
  parseRateInput,
  parseWeightGrams,
  type InvoiceLineResponse,
  type Purity,
} from "@jewellery/shared";

/** What the owner typed on one row, as text (spec 012 R2, spec 013 R8). */
export type LineText = {
  description: string;
  purity: Purity;
  hsn: string;
  gross: string;
  net: string;
  polish: string;
  gold: string;
  labour: string;
  gst: string;
};

export const blankLine = (purity: Purity = "other"): LineText => ({ description: "", purity, hsn: "7113", gross: "", net: "", polish: "", gold: "", labour: "", gst: "3" });

/** The client's real invoice (docs/client-invoice-reference.md), for comparing with the paper bill. */
export const BABA_EXAMPLE: LineText = { description: "Silver Ornament", purity: "silver", hsn: "7113", gross: "9.800", net: "9.800", polish: "", gold: "285.72", labour: "", gst: "3" };

export type Parsed = {
  input: (InvoiceLineInput & { purity: Purity }) | null;
  fieldErrors: Partial<Record<keyof LineText, string>>;
};

/** Turns what was typed on one row into calculator input, or says which box is wrong. */
export function parseLine(t: LineText): Parsed {
  const fieldErrors: Parsed["fieldErrors"] = {};
  const net = parseWeightGrams(t.net);
  if (!net.ok) fieldErrors.net = net.message;
  // Gross is optional: blank means "same as net".
  const gross = t.gross.trim() === "" ? net : parseWeightGrams(t.gross);
  if (!gross.ok) fieldErrors.gross = gross.message;
  const polish = t.polish.trim() === "" ? ({ ok: true, mg: 0 } as const) : parseWeightGrams(t.polish);
  if (!polish.ok) fieldErrors.polish = polish.message;
  const gold = parseRateInput(t.gold, "gram");
  if (!gold.ok) fieldErrors.gold = gold.message;
  const labourIsZero = t.labour.trim() === "" || /^[₹\s,.0]*$/.test(t.labour);
  const labour = labourIsZero ? ({ ok: true, paisePerKg: 0 } as const) : parseRateInput(t.labour, "gram");
  if (!labour.ok) fieldErrors.labour = labour.message;
  const gstText = t.gst.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(gstText)) fieldErrors.gst = "GST % like 3 or 1.5";

  if (Object.keys(fieldErrors).length) return { input: null, fieldErrors };
  return {
    fieldErrors,
    input: {
      description: t.description,
      purity: t.purity,
      hsn: t.hsn.trim(),
      grossWeightMg: (gross as { mg: number }).mg,
      netWeightMg: (net as { mg: number }).mg,
      polishMg: (polish as { mg: number }).mg,
      goldRatePaisePerKg: (gold as { paisePerKg: number }).paisePerKg,
      labourRatePaisePerKg: (labour as { paisePerKg: number }).paisePerKg,
      gstRateBps: Math.round(Number(gstText) * 100),
    },
  };
}

/** A row counts once anything other than the default HSN, purity and GST has been typed. */
export const isTouched = (t: LineText) =>
  t.description.trim() !== "" || t.gross.trim() !== "" || t.net.trim() !== "" || t.polish.trim() !== "" || t.gold.trim() !== "" || t.labour.trim() !== "";

/** A saved line back into the text boxes, for editing. Exact in both directions. */
export const lineTextFromSaved = (l: InvoiceLineResponse): LineText => ({
  description: l.description,
  purity: l.purity,
  hsn: l.hsn,
  gross: formatWeightGrams(l.grossWeightMg),
  net: formatWeightGrams(l.netWeightMg),
  polish: l.polishMg ? formatWeightGrams(l.polishMg) : "",
  gold: paisePerKgToInput(l.goldRatePaisePerKg, "gram"),
  labour: l.labourRatePaisePerKg ? paisePerKgToInput(l.labourRatePaisePerKg, "gram") : "",
  gst: String(l.gstRateBps / 100),
});

export const rateKindFor = (p: Purity) => PURITY_RATE_KIND[p];
