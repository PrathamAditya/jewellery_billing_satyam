import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InvoiceResponse, SettlementResponse } from "@jewellery/shared";
import { InvoiceSheets } from "./InvoicePrint";
import type { Header } from "./common";

/** Spec 014 section 6, test type 1: the stored figures of the reference invoice print exactly. */

const header = {
  business: {
    legalName: "Baba Jewellers", tagline: "FINE GOLD", addressLines: [], city: "Nadaun", state: "Himachal Pradesh", stateCode: "02",
    pincode: "", gstin: "", pan: "", phones: [], email: "",
  },
  bank: { accountName: "", bankName: "", accountNo: "", ifsc: "", upiId: "" },
  texts: {
    invoiceTerms: ["Goods once sold are not returned."], declaration: "", invoiceNote: "GST note.", settlementNote: "Settlement note.",
    receiptFooter: "Receipt footer.", oldGoldSlogan: "Slogan.", copyLabels: ["SHOP COPY", "CUSTOMER COPY"],
  },
  limits: { cashWarningPaise: 20_000_000 },
  numbering: { prefixes: { INV: "INV", PAY: "PAY", OGP: "OGP", ORD: "ORD", CN: "CN" }, fyInNumber: false, padDigits: 4 },
  print: { showBisLogo: false, showMetalLine: true },
  logo: null,
} as unknown as Header;

function line(lineNo: number, extra: Record<string, unknown> = {}) {
  return {
    lineNo, description: `Item ${lineNo}`, purity: "22K916", hsn: "7113", grossWeightMg: 12345, netWeightMg: 12020, polishMg: 0,
    displayRatePaisePerGram: 1_515_000, amountPaise: 20_031_330, ...extra,
  };
}

/** Taxable ₹2,00,313.30, CGST and SGST ₹3,004.70 each, round-off +₹0.30, total ₹2,06,323.00. */
function invoice(lineCount: number, extra: Record<string, unknown> = {}) {
  return {
    invoiceNo: "INV-0001", invoiceDate: "2026-11-01", revisionNo: 1, voidedAt: null,
    customerName: "Test Customer", customerMobile: null, customerPan: null, customerAddress: null,
    lines: Array.from({ length: lineCount }, (_, i) => line(i + 1)),
    calc: {
      taxMode: "intra", taxablePaise: 20_031_330, taxPaise: 600_940, totalBeforeRoundOffPaise: 20_632_270, roundOffPaise: 30, payablePaise: 20_632_300,
      groups: [{ gstRateBps: 300, taxablePaise: 20_031_330, cgstPaise: 300_470, sgstPaise: 300_470, igstPaise: 0 }],
    },
    ...extra,
  } as unknown as InvoiceResponse;
}

const settlement = {
  invoice: { id: "x", invoiceNo: "INV-0001", invoiceDate: "2026-11-01", customerId: null, customerName: "Test Customer", voided: false },
  payablePaise: 20_632_300, receivedPaise: 1_700_000, balanceDuePaise: 18_932_300, advanceReference: "PAY-0001", autoNote: [], remarks: null,
  lines: [{ allocationId: "a", paymentId: "p", date: "2026-10-30", mode: "Cash", reference: "", type: "Advance", amountPaise: 1_700_000, paymentRemainingPaise: 0, receiptNo: "PAY-0001" }],
} as unknown as SettlementResponse;

const render = (inv: InvoiceResponse, s: SettlementResponse | null = settlement) =>
  renderToStaticMarkup(createElement(InvoiceSheets, { invoice: inv, settlement: s, header, copyLabel: "SHOP COPY" }));
const pageCount = (html: string) => html.split('class="page"').length - 1;

describe("invoice print: reference figures", () => {
  it("prints the GST summary, round-off and total exactly as the reference invoice", () => {
    const html = render(invoice(1));
    for (const text of ["INV-0001", "2,00,313.30", "3,004.70", "+ ₹ 0.30", "2,06,323.00", "Rupees Two Lakh Six Thousand Three Hundred Twenty Three Only.", "CGST @ 1.5%", "SGST @ 1.5%"]) {
      expect(html, text).toContain(text);
    }
  });

  it("prints the settlement on the back: advance received and balance due", () => {
    const html = render(invoice(1));
    expect(html).toContain("Settlement and Payment Record");
    expect(html).toContain("17,000.00");
    expect(html).toContain("1,89,323.00");
    expect(html).toContain("PAY-0001");
  });

  it("never prints internal fields: gold and labour rates are not in the markup", () => {
    const html = render(invoice(1, { lines: [line(1, { goldRatePaisePerKg: 99_999, labourRatePaisePerKg: 77_777 })] }));
    expect(html).not.toMatch(/Labour/i);
    expect(html).not.toContain("999.99");
    expect(html).not.toContain("777.77");
  });

  it("prints the metal line under each item and the VOID stamp only for a voided invoice", () => {
    expect(render(invoice(1))).toContain("Gold");
    expect(render(invoice(1))).not.toContain(">VOID<");
    expect(render(invoice(1, { voidedAt: "2026-11-02T10:00:00Z" }))).toContain(">VOID<");
  });
});

describe("invoice print: pages", () => {
  it("one page of up to 14 lines is a front and the settlement back", () => {
    expect(pageCount(render(invoice(14)))).toBe(2);
  });

  it("15 lines: two fronts, a blank back after the first, and the settlement on the last back", () => {
    const html = render(invoice(15));
    expect(pageCount(html)).toBe(4);
    expect(html).toContain("Continued on the next page.");
    expect(html.indexOf("Settlement and Payment Record")).toBeGreaterThan(html.indexOf("Item 15"));
  });

  it("28 lines: two fronts and the settlement; 29 lines starts a third sheet", () => {
    expect(pageCount(render(invoice(28)))).toBe(4);
    expect(pageCount(render(invoice(29)))).toBe(6);
  });

  it("with no settlement loaded, the back shows nothing received and the full value due", () => {
    const html = render(invoice(1), null);
    expect(html).toContain("Nothing received yet");
    expect(html).toContain("2,06,323.00");
  });
});
