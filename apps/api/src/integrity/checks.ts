import { roundOffPaise } from "@jewellery/calc";
import {
  INTEGRITY_PROBLEM_LIMIT,
  formatMoney,
  type IntegrityCheckResult,
  type IntegrityProblem,
  type IntegrityResponse,
} from "@jewellery/shared";
import { customerBalances, ledgerOf, ledgerTotals } from "../ledger/routes";

/** Spec 052: the data integrity checks. Read-only: every check only selects rows and returns problems. */

type Problem = IntegrityProblem;
export type IntegrityCheck = { id: string; title: string; description: string; run: (db: D1Database) => Promise<Problem[]> };

const invoiceLink = (id: string) => `#/invoices/${id}`;
const paymentLink = (id: string) => `#/payments/${id}`;
const problem = (recordId: string, kind: string, label: string, detail: string, link: string | null = null): Problem => ({ recordId, kind, label, detail, link });
const rows = async <T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T[]> => (await db.prepare(sql).bind(...args).all<T>()).results;

/** The calculation as stored in calc_json (spec 012: the InvoiceResult). */
type CalcLine = { pricingMode?: string; stoneAmountPaise?: number };
type Calc = { payablePaise: number; taxablePaise: number; taxPaise: number; totalBeforeRoundOffPaise: number; roundOffPaise: number; totalValuePaise: number; lines?: CalcLine[] };
function parseCalc(text: string): Calc | null {
  try {
    const v = JSON.parse(text) as Calc;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** I5: stored payable equals the stored calculation, and the rounding follows spec 012 R12. */
async function invoiceTotals(db: D1Database): Promise<Problem[]> {
  const invoices = await rows<{ id: string; invoice_no: string; revision_no: number; rate_status: string; taxable_paise: number; tax_paise: number; total_before_round_off_paise: number; round_off_paise: number; payable_paise: number; calc_json: string }>(
    db,
    "SELECT id, invoice_no, revision_no, rate_status, taxable_paise, tax_paise, total_before_round_off_paise, round_off_paise, payable_paise, calc_json FROM invoices",
  );
  const lineSums = new Map<string, number>();
  for (const r of await rows<{ invoice_id: string; total: number }>(db, "SELECT l.invoice_id, SUM(l.amount_paise) AS total FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id AND i.revision_no = l.revision_no GROUP BY l.invoice_id")) {
    lineSums.set(r.invoice_id, r.total);
  }
  const out: Problem[] = [];
  for (const i of invoices) {
    if (i.rate_status === "pending") continue;
    const calc = parseCalc(i.calc_json);
    if (!calc) {
      out.push(problem(i.id, "invoice", i.invoice_no, "The stored calculation cannot be read.", invoiceLink(i.id)));
      continue;
    }
    const msgs: string[] = [];
    if (calc.payablePaise !== i.payable_paise) msgs.push(`payable ${formatMoney(i.payable_paise)} differs from the calculation ${formatMoney(calc.payablePaise)}`);
    if (i.total_before_round_off_paise !== i.taxable_paise + i.tax_paise) msgs.push("total before round-off is not taxable plus tax");
    let expectedPayable = i.payable_paise;
    try {
      expectedPayable = roundOffPaise(i.total_before_round_off_paise);
    } catch {
      msgs.push("total before round-off is not a valid amount");
    }
    if (expectedPayable !== i.payable_paise) msgs.push("payable is not the total rounded to the rupee");
    if (i.round_off_paise !== i.payable_paise - i.total_before_round_off_paise) msgs.push("round-off does not equal payable less the total");
    const lineTotal = lineSums.get(i.id) ?? 0;
    if (lineTotal !== calc.totalValuePaise) msgs.push(`line amounts ${formatMoney(lineTotal)} differ from the calculated total value ${formatMoney(calc.totalValuePaise)}`);
    if (msgs.length) out.push(problem(i.id, "invoice", i.invoice_no, msgs.join("; ") + ".", invoiceLink(i.id)));
  }
  return out;
}

/** I6: each line's amount is gold + labour + stone; combined lines carry only the typed total (Q183). */
async function invoiceLinesCheck(db: D1Database): Promise<Problem[]> {
  const lines = await rows<{ invoice_id: string; invoice_no: string; line_no: number; gold_amount_paise: number; labour_amount_paise: number; amount_paise: number; calc_json: string }>(
    db,
    `SELECT l.invoice_id, i.invoice_no, l.line_no, l.gold_amount_paise, l.labour_amount_paise, l.amount_paise, i.calc_json
     FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id AND i.revision_no = l.revision_no`,
  );
  const out: Problem[] = [];
  for (const l of lines) {
    const calc = parseCalc(l.calc_json);
    const cl = calc?.lines?.[l.line_no - 1];
    if (!cl) {
      out.push(problem(l.invoice_id, "invoice", l.invoice_no, `Line ${l.line_no} has no matching line in the stored calculation.`, invoiceLink(l.invoice_id)));
      continue;
    }
    if (cl.pricingMode === "combined") {
      if (l.gold_amount_paise !== 0 || l.labour_amount_paise !== 0 || !(l.amount_paise > 0)) {
        out.push(problem(l.invoice_id, "invoice", l.invoice_no, `Line ${l.line_no} is a typed total but has a gold or labour split, or no amount.`, invoiceLink(l.invoice_id)));
      }
      continue;
    }
    const stone = cl.stoneAmountPaise ?? 0;
    const parts = l.gold_amount_paise + l.labour_amount_paise + stone;
    if (parts !== l.amount_paise) {
      out.push(problem(l.invoice_id, "invoice", l.invoice_no, `Line ${l.line_no}: amount ${formatMoney(l.amount_paise)} is not gold ${formatMoney(l.gold_amount_paise)} + labour ${formatMoney(l.labour_amount_paise)} + stone ${formatMoney(stone)}.`, invoiceLink(l.invoice_id)));
    }
  }
  return out;
}

/** I7: received (allocations plus credit applications) is never more than the payable, so the balance due is never negative. */
async function invoiceBalance(db: D1Database): Promise<Problem[]> {
  const invoices = await rows<{ id: string; invoice_no: string; payable_paise: number; received: number; credited: number }>(
    db,
    `SELECT i.id, i.invoice_no, i.payable_paise,
       COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.invoice_id = i.id AND a.reversed_at IS NULL), 0) AS received,
       COALESCE((SELECT SUM(x.amount_paise) FROM credit_applications x WHERE x.invoice_id = i.id AND x.reversed_at IS NULL), 0) AS credited
     FROM invoices i`,
  );
  return invoices
    .filter((i) => i.received + i.credited > i.payable_paise)
    .map((i) => problem(i.id, "invoice", i.invoice_no, `Received ${formatMoney(i.received)} and credit ${formatMoney(i.credited)} together are more than the payable ${formatMoney(i.payable_paise)}.`, invoiceLink(i.id)));
}

/** I8: for each payment, allocations + refunds + remaining = amount, and remaining is never negative (spec 015 M2). */
async function paymentBalance(db: D1Database): Promise<Problem[]> {
  const payments = await rows<{ id: string; receipt_no: string | null; amount_paise: number; allocated: number; refunded: number }>(
    db,
    `SELECT p.id, p.receipt_no, p.amount_paise,
       COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0) AS allocated,
       COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id = p.id AND r.reversed_at IS NULL), 0) AS refunded
     FROM payments p`,
  );
  const out: Problem[] = [];
  for (const p of payments) {
    const label = p.receipt_no ?? "Payment at sale";
    const remaining = p.amount_paise - p.allocated - p.refunded;
    if (remaining < 0) {
      out.push(problem(p.id, "payment", label, `Allocations ${formatMoney(p.allocated)} and refunds ${formatMoney(p.refunded)} are more than the amount ${formatMoney(p.amount_paise)}.`, paymentLink(p.id)));
    } else if (p.allocated + p.refunded + remaining !== p.amount_paise) {
      out.push(problem(p.id, "payment", label, "Allocations, refunds and remaining do not add up to the amount.", paymentLink(p.id)));
    }
  }
  return out;
}

/** I9: every allocation and refund points to records that exist. */
async function linksExist(db: D1Database): Promise<Problem[]> {
  const out: Problem[] = [];
  const allocs = await rows<{ id: string; payment_id: string; invoice_id: string | null; opening_balance_id: string | null; missing: string | null }>(
    db,
    `SELECT a.id, a.payment_id, a.invoice_id, a.opening_balance_id,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = a.payment_id) THEN 'payment'
         WHEN a.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = a.invoice_id) THEN 'invoice'
         WHEN a.opening_balance_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM opening_balances o WHERE o.id = a.opening_balance_id) THEN 'opening balance'
       END AS missing
     FROM payment_allocations a`,
  );
  for (const a of allocs.filter((x) => x.missing)) out.push(problem(a.id, "allocation", "Allocation", `The allocation points to a ${a.missing} that does not exist.`, a.payment_id ? paymentLink(a.payment_id) : null));
  for (const r of await rows<{ id: string; payment_id: string }>(db, "SELECT r.id, r.payment_id FROM payment_refunds r WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = r.payment_id)")) {
    out.push(problem(r.id, "refund", "Refund", "The refund points to a payment that does not exist."));
  }
  for (const c of await rows<{ id: string; invoice_id: string }>(db, "SELECT x.id, x.invoice_id FROM credit_applications x WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = x.invoice_id) OR NOT EXISTS (SELECT 1 FROM credit_notes n WHERE n.id = x.credit_note_id)")) {
    out.push(problem(c.id, "credit_application", "Credit application", "The credit application points to an invoice or credit note that does not exist."));
  }
  return out;
}

/** I10: document numbers per series and year: unique, the trailing digits match the serial, and the counter is not behind. */
const NUMBERED = [
  { series: "INV", sql: "SELECT id, invoice_no AS number, fy, serial FROM invoices", kind: "invoice", link: invoiceLink },
  { series: "PAY", sql: "SELECT id, receipt_no AS number, fy, serial FROM payments WHERE receipt_no IS NOT NULL", kind: "payment", link: paymentLink },
  { series: "OGP", sql: "SELECT id, receipt_no AS number, fy, serial FROM old_gold_purchases", kind: "old_gold", link: null },
  { series: "ORD", sql: "SELECT id, order_no AS number, fy, serial FROM orders", kind: "order", link: null },
  { series: "CN", sql: "SELECT id, cn_no AS number, fy, serial FROM credit_notes", kind: "credit_note", link: null },
  { series: "PUR", sql: "SELECT id, purchase_no AS number, fy, serial FROM purchases", kind: "purchase", link: null },
];
async function numberSeries(db: D1Database): Promise<Problem[]> {
  const counters = new Map<string, number>();
  for (const c of await rows<{ series: string; fy: string; last_no: number }>(db, "SELECT series, fy, last_no FROM number_series")) counters.set(`${c.series}|${c.fy}`, c.last_no);
  const out: Problem[] = [];
  for (const s of NUMBERED) {
    const docs = await rows<{ id: string; number: string; fy: string; serial: number }>(db, s.sql);
    const seenNumber = new Set<string>();
    const seenSerial = new Set<string>();
    const top = new Map<string, { id: string; number: string; serial: number }>();
    for (const d of docs) {
      const key = `${d.fy}|${d.number}`;
      const serialKey = `${d.fy}|${d.serial}`;
      const m = /(\d+)$/.exec(d.number);
      if (!m || Number(m[1]) !== d.serial) out.push(problem(d.id, s.kind, d.number, `The number ${d.number} does not match its serial ${d.serial}.`, s.link?.(d.id) ?? null));
      if (seenNumber.has(key)) out.push(problem(d.id, s.kind, d.number, `The number ${d.number} is used more than once in ${d.fy}.`, s.link?.(d.id) ?? null));
      if (seenSerial.has(serialKey)) out.push(problem(d.id, s.kind, d.number, `The serial ${d.serial} is used more than once in ${d.fy}.`, s.link?.(d.id) ?? null));
      seenNumber.add(key);
      seenSerial.add(serialKey);
      const cur = top.get(d.fy);
      if (!cur || d.serial > cur.serial) top.set(d.fy, { id: d.id, number: d.number, serial: d.serial });
    }
    for (const [fy, t] of top) {
      const counter = counters.get(`${s.series}|${fy}`) ?? 0;
      if (counter < t.serial) out.push(problem(t.id, s.kind, t.number, `The ${s.series} counter for ${fy} is ${counter}, but ${t.serial} has been issued.`, s.link?.(t.id) ?? null));
    }
  }
  return out;
}

/** I11: customer numbers are C followed by at least 4 digits, unique, and the counter is not behind (Q188). */
async function customerNumbers(db: D1Database): Promise<Problem[]> {
  const customers = await rows<{ id: string; customer_no: string; name: string }>(db, "SELECT id, customer_no, name FROM customers");
  const counter = (await rows<{ last_no: number }>(db, "SELECT last_no FROM number_series WHERE series = 'C' AND fy = 'all'"))[0]?.last_no ?? 0;
  const out: Problem[] = [];
  const seen = new Set<string>();
  let top: { id: string; n: number; no: string } | null = null;
  for (const c of customers) {
    const m = /^C(\d{4,})$/.exec(c.customer_no);
    if (!m) {
      out.push(problem(c.id, "customer", c.customer_no, `Customer number ${c.customer_no} is not in the form C0001.`, null));
      continue;
    }
    if (seen.has(c.customer_no)) out.push(problem(c.id, "customer", c.customer_no, `Customer number ${c.customer_no} is used more than once.`, null));
    seen.add(c.customer_no);
    const n = Number(m[1]);
    if (!top || n > top.n) top = { id: c.id, n, no: c.customer_no };
  }
  if (top && counter < top.n) out.push(problem(top.id, "customer", top.no, `The customer counter is ${counter}, but ${top.no} has been issued.`, null));
  return out;
}

/** I12: the event ledger agrees with the customer balances, and the ledger summary agrees with the ledger. */
async function ledgerTotalsCheck(db: D1Database): Promise<Problem[]> {
  const out: Problem[] = [];
  let sumOut = 0;
  let sumAdv = 0;
  let withOut = 0;
  for (const b of await customerBalances(db)) {
    const l = await ledgerOf(db, b.customer_id, null);
    if (!l) {
      out.push(problem(b.customer_id, "customer", b.customer_name, "The customer's ledger cannot be read."));
      continue;
    }
    if (l.outstandingPaise !== b.outstanding || l.advanceHeldPaise !== b.advance) {
      out.push(problem(b.customer_id, "customer", b.customer_name, `The ledger shows ${formatMoney(l.outstandingPaise)} owed and ${formatMoney(l.advanceHeldPaise)} advance, but the balances show ${formatMoney(b.outstanding)} and ${formatMoney(b.advance)}.`, `#/customers/${b.customer_id}`));
    }
    if (l.outstandingPaise > 0) {
      sumOut += l.outstandingPaise;
      withOut++;
    }
    sumAdv += Math.max(0, l.advanceHeldPaise);
  }
  const summary = await ledgerTotals(db);
  if (summary.totalOutstandingPaise !== sumOut || summary.totalAdvanceHeldPaise !== sumAdv || summary.customersWithOutstanding !== withOut) {
    out.push(problem("ledger-summary", "ledger_summary", "Ledger summary", `The summary shows ${formatMoney(summary.totalOutstandingPaise)} owed and ${formatMoney(summary.totalAdvanceHeldPaise)} advance; the customers add up to ${formatMoney(sumOut)} and ${formatMoney(sumAdv)}.`));
  }
  return out;
}

/** I13: no voided record still holds a live allocation, credit application, refund or payout. */
async function voidedLinks(db: D1Database): Promise<Problem[]> {
  const out: Problem[] = [];
  const checks: { sql: string; kind: string; link: ((id: string) => string) | null; what: string }[] = [
    { sql: "SELECT i.id, i.invoice_no AS label, COUNT(a.id) AS n FROM invoices i JOIN payment_allocations a ON a.invoice_id = i.id AND a.reversed_at IS NULL WHERE i.voided_at IS NOT NULL GROUP BY i.id", kind: "invoice", link: invoiceLink, what: "live payment allocation" },
    { sql: "SELECT i.id, i.invoice_no AS label, COUNT(x.id) AS n FROM invoices i JOIN credit_applications x ON x.invoice_id = i.id AND x.reversed_at IS NULL WHERE i.voided_at IS NOT NULL GROUP BY i.id", kind: "invoice", link: invoiceLink, what: "live credit application" },
    { sql: "SELECT p.id, p.receipt_no AS label, COUNT(a.id) AS n FROM payments p JOIN payment_allocations a ON a.payment_id = p.id AND a.reversed_at IS NULL WHERE p.voided_at IS NOT NULL GROUP BY p.id", kind: "payment", link: paymentLink, what: "live allocation" },
    { sql: "SELECT p.id, p.receipt_no AS label, COUNT(r.id) AS n FROM payments p JOIN payment_refunds r ON r.payment_id = p.id AND r.reversed_at IS NULL WHERE p.voided_at IS NOT NULL GROUP BY p.id", kind: "payment", link: paymentLink, what: "live refund" },
    { sql: "SELECT o.id, o.reference AS label, COUNT(a.id) AS n FROM opening_balances o JOIN payment_allocations a ON a.opening_balance_id = o.id AND a.reversed_at IS NULL WHERE o.voided_at IS NOT NULL GROUP BY o.id", kind: "opening_balance", link: null, what: "live allocation" },
    { sql: "SELECT c.id, c.cn_no AS label, (SELECT COUNT(*) FROM credit_applications x WHERE x.credit_note_id = c.id AND x.reversed_at IS NULL) + (SELECT COUNT(*) FROM credit_note_payouts y WHERE y.credit_note_id = c.id AND y.reversed_at IS NULL) AS n FROM credit_notes c WHERE c.voided_at IS NOT NULL", kind: "credit_note", link: null, what: "live application or payout" },
  ];
  for (const c of checks) {
    for (const r of await rows<{ id: string; label: string | null; n: number }>(db, c.sql)) {
      if (r.n > 0) out.push(problem(r.id, c.kind, r.label ?? c.kind, `This ${c.kind.replace("_", " ")} is voided but still has ${r.n} ${c.what}${r.n === 1 ? "" : "s"}.`, c.link?.(r.id) ?? null));
    }
  }
  return out;
}

/** I14: every payment has a payment_create row and every invoice an invoice_create (or pending) row (CLAUDE.md rule 11). */
async function auditRows(db: D1Database): Promise<Problem[]> {
  const out: Problem[] = [];
  for (const p of await rows<{ id: string; receipt_no: string | null }>(db, "SELECT p.id, p.receipt_no FROM payments p WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity = 'payment' AND a.entity_id = p.id AND a.action = 'payment_create')")) {
    out.push(problem(p.id, "payment", p.receipt_no ?? "Payment at sale", "No payment_create audit row for this payment.", paymentLink(p.id)));
  }
  for (const i of await rows<{ id: string; invoice_no: string }>(db, "SELECT i.id, i.invoice_no FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity = 'invoice' AND a.entity_id = i.id AND a.action IN ('invoice_create', 'invoice_pending_create'))")) {
    out.push(problem(i.id, "invoice", i.invoice_no, "No invoice_create audit row for this invoice.", invoiceLink(i.id)));
  }
  return out;
}

/** The checks, in the order the screen and the command line show them. The API, the screen and the CLI use this one list. */
export const INTEGRITY_CHECKS: IntegrityCheck[] = [
  { id: "invoice_totals", title: "Invoice totals", description: "Each invoice's payable matches its stored calculation, and the rounding follows the rule.", run: invoiceTotals },
  { id: "invoice_lines", title: "Invoice lines", description: "Each line's amount is gold plus labour plus stone.", run: invoiceLinesCheck },
  { id: "invoice_balance", title: "Invoice balances", description: "Received (payments and credit) is never more than the payable, so no balance is negative.", run: invoiceBalance },
  { id: "payment_balance", title: "Payment balances", description: "For each payment, allocations plus refunds plus remaining equal the amount, and remaining is never negative.", run: paymentBalance },
  { id: "links_exist", title: "Links between records", description: "Every allocation, refund and credit application points to a record that exists.", run: linksExist },
  { id: "number_series", title: "Document numbers", description: "Numbers are unique within each year, match their serial, and the counters are not behind.", run: numberSeries },
  { id: "customer_numbers", title: "Customer numbers", description: "Customer numbers are C0001 style, unique, and the counter is not behind.", run: customerNumbers },
  { id: "ledger_totals", title: "Ledger and balances", description: "The ledger for each customer agrees with the customer balances, and the ledger summary agrees with the customers.", run: ledgerTotalsCheck },
  { id: "voided_links", title: "Voided records", description: "No voided invoice, payment, opening balance or credit note still holds a live allocation, credit, refund or payout.", run: voidedLinks },
  { id: "audit_rows", title: "Audit trail", description: "Every payment and invoice has its creation audit row.", run: auditRows },
];

/** Runs every check. A check that throws is reported as a failure, never hidden. */
export async function runIntegrityChecks(db: D1Database, now: Date): Promise<IntegrityResponse> {
  const checks: IntegrityCheckResult[] = [];
  for (const c of INTEGRITY_CHECKS) {
    let problems: Problem[];
    try {
      problems = await c.run(db);
    } catch (e) {
      problems = [problem("-", "check", c.title, `The check could not run: ${e instanceof Error ? e.message : String(e)}`)];
    }
    checks.push({
      id: c.id,
      title: c.title,
      description: c.description,
      status: problems.length ? "fail" : "ok",
      count: problems.length,
      problems: problems.slice(0, INTEGRITY_PROBLEM_LIMIT),
      truncated: problems.length > INTEGRITY_PROBLEM_LIMIT,
    });
  }
  const failed = checks.filter((c) => c.status === "fail").length;
  return { ranAt: now.toISOString(), ok: failed === 0, passed: checks.length - failed, failed, checks };
}
