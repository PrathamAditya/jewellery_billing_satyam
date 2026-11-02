import { type InvoiceResult } from "@jewellery/calc";
import { KIND_LABEL, MODE_LABEL, REPORT_LABEL, financialYearRange, type PaymentKind, type PaymentMode, type ReportKind, type ReportQuery } from "@jewellery/shared";
import { customerBalances } from "../ledger/routes";
import { displayDate, type Cell, type ReportTable } from "./table";

/**
 * Spec 031: the four reports as tables, read from stored rows only. Voided invoices and voided payments
 * are excluded from totals, pending-rate sales are not invoices yet and are left out of the sales register
 * and the GST summary, and money is read from the figures stored at save time (spec 013 R6).
 */

const money = (paise: number): Cell => ({ paise });

type SalesRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_name: string;
  taxable_paise: number;
  payable_paise: number;
  calc_json: string;
  settled: number;
};

/** The sales of a period (fixed invoices, not voided), with what has been settled on each (payments and credit notes). */
async function salesIn(db: D1Database, from: string, to: string): Promise<SalesRow[]> {
  return (
    await db
      .prepare(
        `SELECT i.id, i.invoice_no, i.invoice_date, i.customer_name, i.taxable_paise, i.payable_paise, i.calc_json,
           COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.invoice_id = i.id AND a.reversed_at IS NULL), 0)
         + COALESCE((SELECT SUM(x.amount_paise) FROM credit_applications x WHERE x.invoice_id = i.id AND x.reversed_at IS NULL), 0) AS settled
         FROM invoices i
         WHERE i.rate_status = 'fixed' AND i.voided_at IS NULL AND i.invoice_date BETWEEN ?1 AND ?2
         ORDER BY i.invoice_date, i.invoice_no`,
      )
      .bind(from, to)
      .all<SalesRow>()
  ).results;
}

type TaxGroup = { gstRateBps: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };

/** The stored tax groups of one invoice (spec 013 R6: from calc_json, never recalculated). */
export function groupsOf(calcJson: string): TaxGroup[] {
  return ((JSON.parse(calcJson) as Partial<InvoiceResult>).groups ?? []) as TaxGroup[];
}

function periodText(q: ReportQuery): { from: string; to: string; text: string; slug: string } {
  if (q.fy !== undefined) {
    const { from, to } = financialYearRange(q.fy);
    return { from, to, text: `${displayDate(from)} to ${displayDate(to)} (FY ${q.fy})`, slug: `FY${q.fy}` };
  }
  return { from: q.from!, to: q.to!, text: `${displayDate(q.from!)} to ${displayDate(q.to!)}`, slug: `${q.from}_to_${q.to}` };
}

async function salesRegister(db: D1Database, q: ReportQuery): Promise<ReportTable> {
  const p = periodText(q);
  const rows = await salesIn(db, p.from, p.to);
  const body: Cell[][] = [];
  const sum = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, paid: 0, balance: 0 };
  for (const r of rows) {
    const g = groupsOf(r.calc_json);
    const cgst = g.reduce((s, x) => s + x.cgstPaise, 0);
    const sgst = g.reduce((s, x) => s + x.sgstPaise, 0);
    const igst = g.reduce((s, x) => s + x.igstPaise, 0);
    const balance = Math.max(0, r.payable_paise - r.settled);
    sum.taxable += r.taxable_paise;
    sum.cgst += cgst;
    sum.sgst += sgst;
    sum.igst += igst;
    sum.total += r.payable_paise;
    sum.paid += r.settled;
    sum.balance += balance;
    body.push([r.invoice_no, displayDate(r.invoice_date), r.customer_name, money(r.taxable_paise), money(cgst), money(sgst), money(igst), money(r.payable_paise), money(r.settled), money(balance)]);
  }
  return {
    sheetName: REPORT_LABEL["sales-register"],
    title: REPORT_LABEL["sales-register"],
    subtitle: p.text,
    columns: [
      { label: "Invoice no", align: "left", width: 22 },
      { label: "Date", align: "left", width: 12 },
      { label: "Customer", align: "left", width: 26 },
      { label: "Taxable value (Rs)", align: "right", width: 14 },
      { label: "CGST (Rs)", align: "right", width: 11 },
      { label: "SGST (Rs)", align: "right", width: 11 },
      { label: "IGST (Rs)", align: "right", width: 11 },
      { label: "Total (Rs)", align: "right", width: 14 },
      { label: "Paid (Rs)", align: "right", width: 13 },
      { label: "Balance (Rs)", align: "right", width: 13 },
    ],
    rows: body,
    totals: ["Total", `${rows.length} invoices`, "", money(sum.taxable), money(sum.cgst), money(sum.sgst), money(sum.igst), money(sum.total), money(sum.paid), money(sum.balance)],
    notes: [
      "Voided invoices and pending-rate sales are not included. Paid includes credit notes applied to the invoice.",
      "Total is the stored payable, after round-off. CGST and SGST are for intra-state sales, IGST for inter-state.",
    ],
    fileName: `sales-register_${p.slug}`,
  };
}

async function gstSummary(db: D1Database, q: ReportQuery): Promise<ReportTable> {
  const p = periodText(q);
  const rows = await salesIn(db, p.from, p.to);
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const r of rows) {
    for (const g of groupsOf(r.calc_json)) {
      const cur = byRate.get(g.gstRateBps) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      cur.taxable += g.taxablePaise;
      cur.cgst += g.cgstPaise;
      cur.sgst += g.sgstPaise;
      cur.igst += g.igstPaise;
      byRate.set(g.gstRateBps, cur);
    }
  }
  const rates = [...byRate.keys()].sort((a, b) => a - b);
  const body: Cell[][] = rates.map((bps) => {
    const v = byRate.get(bps)!;
    return [`${bps / 100}%`, money(v.taxable), money(v.cgst), money(v.sgst), money(v.igst), money(v.cgst + v.sgst + v.igst)];
  });
  const t = rates.reduce(
    (s, bps) => {
      const v = byRate.get(bps)!;
      return { taxable: s.taxable + v.taxable, cgst: s.cgst + v.cgst, sgst: s.sgst + v.sgst, igst: s.igst + v.igst };
    },
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
  );
  return {
    sheetName: REPORT_LABEL["gst-summary"],
    title: REPORT_LABEL["gst-summary"],
    subtitle: p.text,
    columns: [
      { label: "GST rate", align: "left", width: 12 },
      { label: "Taxable value (Rs)", align: "right", width: 18 },
      { label: "CGST (Rs)", align: "right", width: 16 },
      { label: "SGST (Rs)", align: "right", width: 16 },
      { label: "IGST (Rs)", align: "right", width: 16 },
      { label: "Total GST (Rs)", align: "right", width: 18 },
    ],
    rows: body,
    totals: ["Total", money(t.taxable), money(t.cgst), money(t.sgst), money(t.igst), money(t.cgst + t.sgst + t.igst)],
    notes: ["Sales of the period, from the stored tax of each invoice. Voided invoices and pending-rate sales are not included.", "Credit notes are not deducted here."],
    fileName: `gst-summary_${p.slug}`,
  };
}

type PaymentRow = {
  id: string;
  kind: PaymentKind;
  receipt_no: string | null;
  receipt_date: string;
  payer_name: string;
  mode: PaymentMode;
  reference: string | null;
  amount_paise: number;
  voided_at: string | null;
  allocated: number;
  refunded: number;
};

async function paymentsRegister(db: D1Database, q: ReportQuery): Promise<ReportTable> {
  const p = periodText(q);
  const rows = (
    await db
      .prepare(
        `SELECT p.id, p.kind, p.receipt_no, p.receipt_date, p.payer_name, p.mode, p.reference, p.amount_paise, p.voided_at,
           COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0) AS allocated,
           COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id = p.id AND r.reversed_at IS NULL), 0) AS refunded
         FROM payments p WHERE p.receipt_date BETWEEN ?1 AND ?2 ORDER BY p.receipt_date, p.created_at, p.id`,
      )
      .bind(p.from, p.to)
      .all<PaymentRow>()
  ).results;
  const sum = { amount: 0, used: 0, refunded: 0, left: 0 };
  const body: Cell[][] = rows.map((r) => {
    const live = r.voided_at === null;
    const left = live ? r.amount_paise - r.allocated - r.refunded : 0;
    if (live) {
      sum.amount += r.amount_paise;
      sum.used += r.allocated;
      sum.refunded += r.refunded;
      sum.left += left;
    }
    return [
      r.receipt_no ?? "-",
      displayDate(r.receipt_date),
      r.payer_name,
      KIND_LABEL[r.kind],
      MODE_LABEL[r.mode],
      r.reference ?? "",
      money(r.amount_paise),
      money(live ? r.allocated : 0),
      money(live ? r.refunded : 0),
      money(left),
      live ? "Live" : "Voided",
    ];
  });
  return {
    sheetName: REPORT_LABEL["payments-register"],
    title: REPORT_LABEL["payments-register"],
    subtitle: p.text,
    columns: [
      { label: "Receipt no", align: "left", width: 13 },
      { label: "Date", align: "left", width: 11 },
      { label: "Payer", align: "left", width: 22 },
      { label: "Type", align: "left", width: 14 },
      { label: "Mode", align: "left", width: 10 },
      { label: "Reference", align: "left", width: 14 },
      { label: "Amount (Rs)", align: "right", width: 13 },
      { label: "Used on bills (Rs)", align: "right", width: 13 },
      { label: "Handed back (Rs)", align: "right", width: 13 },
      { label: "Left as advance (Rs)", align: "right", width: 14 },
      { label: "Status", align: "left", width: 8 },
    ],
    rows: body,
    totals: ["Total", `${rows.filter((r) => r.voided_at === null).length} live`, "", "", "", "", money(sum.amount), money(sum.used), money(sum.refunded), money(sum.left), ""],
    notes: ["Voided payments stay listed, marked Voided, and are not in the totals. A payment at the time of sale has no receipt number."],
    fileName: `payments-register_${p.slug}`,
  };
}

async function outstanding(db: D1Database, today: string): Promise<ReportTable> {
  const mobiles = new Map(
    (await db.prepare("SELECT id, mobile FROM customers").all<{ id: string; mobile: string | null }>()).results.map((r) => [r.id, r.mobile]),
  );
  const rows = (await customerBalances(db))
    .filter((r) => r.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding || a.customer_name.localeCompare(b.customer_name));
  const sum = { out: 0, adv: 0 };
  const body: Cell[][] = rows.map((r) => {
    sum.out += r.outstanding;
    sum.adv += Math.max(0, r.advance);
    return [r.customer_name, mobiles.get(r.customer_id) ?? "", money(r.outstanding), money(Math.max(0, r.advance))];
  });
  return {
    sheetName: REPORT_LABEL.outstanding,
    title: REPORT_LABEL.outstanding,
    subtitle: `As on ${displayDate(today)}`,
    columns: [
      { label: "Customer", align: "left", width: 34 },
      { label: "Mobile", align: "left", width: 14 },
      { label: "Outstanding (Rs)", align: "right", width: 18 },
      { label: "Advance held (Rs)", align: "right", width: 18 },
    ],
    rows: body,
    totals: [`Total: ${rows.length} customers`, "", money(sum.out), money(sum.adv)],
    notes: ["Current balances, so the date range does not apply. Pending-rate sales add nothing until their rate is fixed."],
    fileName: `outstanding_${today}`,
  };
}

/** Builds the table of one report. `today` is the business date of the request. */
export async function buildReport(db: D1Database, kind: ReportKind, q: ReportQuery, today: string): Promise<ReportTable> {
  if (kind === "sales-register") return salesRegister(db, q);
  if (kind === "payments-register") return paymentsRegister(db, q);
  if (kind === "gst-summary") return gstSummary(db, q);
  return outstanding(db, today);
}
