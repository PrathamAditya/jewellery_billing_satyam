import type { InvoiceLineInput, PricingMode } from "@jewellery/calc";
import { polishWeightMg } from "@jewellery/calc";
import {
  PURITY_RATE_KIND,
  formatWeightGrams,
  paiseToRupeeText,
  paisePerKgToInput,
  parseRateInput,
  parseRupeesToPaise,
  parseWeightGrams,
  type InvoiceLineResponse,
  type Purity,
} from "@jewellery/shared";

/** What the owner typed on one row, as text (spec 012 R2, spec 013 R8, spec 012c R1). */
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
  /** Spec 012c R1: by weight (default), with a stone, or one combined total. */
  pricing: PricingMode;
  stoneWeight: string;
  stoneAmount: string;
  total: string;
  /** Spec 021: the optional stock of the line. "none" (default), one individual item by U No., or one bulk item with a quantity. */
  stockKind: "none" | "item" | "bulk";
  stockUNo: string;
  bulkItemId: string;
  bulkQty: string;
};

export const blankLine = (purity: Purity = "other"): LineText => ({
  description: "",
  purity,
  hsn: "7113",
  gross: "",
  net: "",
  polish: "",
  gold: "",
  labour: "",
  gst: "3",
  pricing: "weight",
  stoneWeight: "",
  stoneAmount: "",
  total: "",
  stockKind: "none",
  stockUNo: "",
  bulkItemId: "",
  bulkQty: "",
});

/** The client's real invoice (docs/client-invoice-reference.md), for comparing with the paper bill. */
export const BABA_EXAMPLE: LineText = { ...blankLine("silver"), description: "Silver Ornament", gross: "9.800", net: "9.800", gold: "285.72" };

/** Spec 021: the stock link of a line, as the server takes it (null when none). */
export type StockFields = { stockUNo: string | null; bulkItemId: string | null; bulkQuantity: number | null };

export type Parsed = {
  input: (InvoiceLineInput & { purity: Purity } & StockFields) | null;
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
  const polishText = t.polish.trim() === "" ? "0" : t.polish.trim().replace(/%/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(polishText) || Number(polishText) > 100) fieldErrors.polish = "Polish must be 0% to 100% (up to 2 decimals)";
  const polishBps = Math.round(Number(polishText) * 100);

  // Spec 012c R1: a combined line has no rates; a separate line adds a typed stone amount.
  const combined = t.pricing === "combined";
  const separate = t.pricing === "separate";
  let gold = { ok: true, paisePerKg: 0 } as { ok: true; paisePerKg: number } | { ok: false; message: string };
  let labour = { ok: true, paisePerKg: 0 } as { ok: true; paisePerKg: number } | { ok: false; message: string };
  if (!combined) {
    gold = parseRateInput(t.gold, "gram");
    if (!gold.ok) fieldErrors.gold = gold.message;
    const labourIsZero = t.labour.trim() === "" || /^[₹\s,.0]*$/.test(t.labour);
    labour = labourIsZero ? { ok: true, paisePerKg: 0 } : parseRateInput(t.labour, "gram");
    if (!labour.ok) fieldErrors.labour = labour.message;
  }
  let stoneWeightMg = 0;
  let stoneAmountPaise = 0;
  if (separate) {
    if (t.stoneWeight.trim() !== "") {
      const sw = parseWeightGrams(t.stoneWeight);
      if (!sw.ok) fieldErrors.stoneWeight = sw.message;
      else stoneWeightMg = sw.mg;
    }
    const sa = parseRupeesToPaise(t.stoneAmount, "stone amount");
    if (!sa.ok) fieldErrors.stoneAmount = sa.message;
    else stoneAmountPaise = sa.value;
  }
  let totalAmountPaise = 0;
  if (combined) {
    const tot = parseRupeesToPaise(t.total, "total");
    if (!tot.ok) fieldErrors.total = tot.message;
    else totalAmountPaise = tot.value;
  }

  // Spec 021 S2, S1: one individual item by U No., or one bulk item with a quantity of 1 or more.
  const stock: StockFields = { stockUNo: null, bulkItemId: null, bulkQuantity: null };
  if (t.stockKind === "item") {
    const u = t.stockUNo.trim().toUpperCase();
    if (!u) fieldErrors.stockUNo = "Type the U No., like RING01";
    else stock.stockUNo = u;
  }
  if (t.stockKind === "bulk") {
    const q = t.bulkQty.trim();
    if (!t.bulkItemId) fieldErrors.bulkItemId = "Choose the bulk item";
    if (!/^\d+$/.test(q) || Number(q) < 1) fieldErrors.bulkQty = "Enter a whole number, 1 or more";
    else stock.bulkQuantity = Number(q);
    if (t.bulkItemId) stock.bulkItemId = t.bulkItemId;
  }

  if (Object.keys(fieldErrors).length) return { input: null, fieldErrors };
  const netMg = (net as { mg: number }).mg;
  return {
    fieldErrors,
    input: {
      description: t.description,
      purity: t.purity,
      hsn: t.hsn.trim(),
      grossWeightMg: (gross as { mg: number }).mg,
      netWeightMg: netMg,
      polishMg: combined ? 0 : polishWeightMg(netMg, polishBps),
      goldRatePaisePerKg: (gold as { paisePerKg: number }).paisePerKg,
      labourRatePaisePerKg: (labour as { paisePerKg: number }).paisePerKg,
      gstRateBps: t.hsn.trim() === "9988" ? 500 : 300,
      pricingMode: t.pricing,
      stoneWeightMg: separate ? stoneWeightMg : undefined,
      stoneAmountPaise: separate ? stoneAmountPaise : undefined,
      totalAmountPaise: combined ? totalAmountPaise : undefined,
      ...stock,
    },
  };
}

/** A row counts once anything other than the default HSN, purity and GST has been typed. */
export const isTouched = (t: LineText) =>
  t.description.trim() !== "" ||
  t.gross.trim() !== "" ||
  t.net.trim() !== "" ||
  t.polish.trim() !== "" ||
  t.gold.trim() !== "" ||
  t.labour.trim() !== "" ||
  t.stoneWeight.trim() !== "" ||
  t.stoneAmount.trim() !== "" ||
  t.total.trim() !== "" ||
  t.pricing !== "weight" ||
  t.stockKind !== "none";

/** A saved line back into the text boxes, for editing. Exact in both directions. */
export const lineTextFromSaved = (l: InvoiceLineResponse): LineText => {
  const pricing = l.pricingMode ?? "weight";
  return {
    description: l.description,
    purity: l.purity,
    hsn: l.hsn,
    gross: formatWeightGrams(l.grossWeightMg),
    net: formatWeightGrams(l.netWeightMg),
    polish: l.polishBps ? String(l.polishBps / 100) : "",
    gold: pricing === "combined" ? "" : paisePerKgToInput(l.goldRatePaisePerKg, "gram"),
    labour: pricing === "combined" || !l.labourRatePaisePerKg ? "" : paisePerKgToInput(l.labourRatePaisePerKg, "gram"),
    gst: String(l.gstRateBps / 100),
    pricing,
    stoneWeight: pricing === "separate" && l.stoneWeightMg ? formatWeightGrams(l.stoneWeightMg) : "",
    stoneAmount: pricing === "separate" ? paiseToRupeeText(l.stoneAmountPaise ?? 0) : "",
    total: pricing === "combined" ? paiseToRupeeText(l.totalAmountPaise ?? 0) : "",
    stockKind: l.bulkItemId ? "bulk" : l.stockUNo ? "item" : "none",
    stockUNo: l.stockUNo ?? "",
    bulkItemId: l.bulkItemId ?? "",
    bulkQty: l.bulkQuantity ? String(l.bulkQuantity) : "",
  };
};

export const rateKindFor = (p: Purity) => PURITY_RATE_KIND[p];

/** Spec 019c: a row of a sale whose rate is fixed later. Weights, purity and labour only; HSN is always 7113. */
export type PendingParsed = {
  input: { description: string; purity: Purity; hsn: string; grossWeightMg: number; netWeightMg: number; polishBps: number; labourRatePaisePerKg: number } | null;
  fieldErrors: Partial<Record<keyof LineText, string>>;
};

export function parsePendingLine(t: LineText): PendingParsed {
  const fieldErrors: PendingParsed["fieldErrors"] = {};
  const net = parseWeightGrams(t.net);
  if (!net.ok) fieldErrors.net = net.message;
  const gross = t.gross.trim() === "" ? net : parseWeightGrams(t.gross);
  if (!gross.ok) fieldErrors.gross = gross.message;
  const polishText = t.polish.trim() === "" ? "0" : t.polish.trim().replace(/%/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(polishText) || Number(polishText) > 100) fieldErrors.polish = "Polish must be 0% to 100% (up to 2 decimals)";
  const labourIsZero = t.labour.trim() === "" || /^[₹\s,.0]*$/.test(t.labour);
  const labour = labourIsZero ? { ok: true as const, paisePerKg: 0 } : parseRateInput(t.labour, "gram");
  if (!labour.ok) fieldErrors.labour = labour.message;
  if (Object.keys(fieldErrors).length) return { input: null, fieldErrors };
  return {
    fieldErrors,
    input: {
      description: t.description,
      purity: t.purity,
      hsn: "7113",
      grossWeightMg: (gross as { mg: number }).mg,
      netWeightMg: (net as { mg: number }).mg,
      polishBps: Math.round(Number(polishText) * 100),
      labourRatePaisePerKg: labour.ok ? labour.paisePerKg : 0,
    },
  };
}
