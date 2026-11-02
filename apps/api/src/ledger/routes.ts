import { Hono } from "hono";
import {
  formatMoney,
  indiaDate,
  newId,
  openingBalanceSchema,
  type LedgerEntry,
  type LedgerResponse,
  type LedgerSummary,
  type OutstandingRow,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { readJson, validationBody } from "../http";
import { openItems, refundedOf } from "../payments/routes";
import { HELD_SQL } from "../creditNotes/money";

export const openingRoutes = new Hono<AppEnv>();
export const ledgerRoutes = new Hono<AppEnv>();

/** Spec 019 R1, R3: opening receivables and old advances, entered once with a date and an optional reference. */
openingRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = openingBalanceSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;
  if (b.asOfDate > indiaDate(c.get("now"))) return c.json({ error: "future_date", message: "An opening balance cannot be dated in the future" }, 400);
  const cust = await db.prepare("SELECT id, voided_at FROM customers WHERE id = ?1").bind(b.customerId).first<{ id: string; voided_at: string | null }>();
  if (!cust) return c.json({ error: "customer_not_found", message: "That customer does not exist" }, 400);
  if (cust.voided_at) return c.json({ error: "customer_voided", message: "That customer is voided" }, 409);
  const id = b.id ?? newId();
  const existing = await db.prepare("SELECT customer_id, amount_paise, as_of_date FROM opening_balances WHERE id = ?1").bind(id).first<{ customer_id: string; amount_paise: number; as_of_date: string }>();
  if (existing) {
    const same = existing.customer_id === b.customerId && existing.amount_paise === b.amountPaise && existing.as_of_date === b.asOfDate;
    return same ? c.json({ id }, 200) : c.json({ error: "id_conflict", message: "This id is already used by a different balance" }, 409);
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO opening_balances (id, created_at, created_by, updated_at, updated_by, customer_id, amount_paise, as_of_date, reference, remarks) VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(id, now, user.id, b.customerId, b.amountPaise, b.asOfDate, b.reference, b.remarks),
    auditStatement(db, { actor: user.id, action: "opening_balance_create", entity: "opening_balance", entityId: id, detail: { customerId: b.customerId, amountPaise: b.amountPaise } }),
  ]);
  return c.json({ id }, 201);
});

openingRoutes.get("/", async (c) => {
  const customerId = c.req.query("customerId");
  if (!customerId) return c.json({ error: "validation", message: "Choose the customer" }, 400);
  const rows = (
    await c.env.DB.prepare("SELECT * FROM opening_balances WHERE customer_id = ?1 ORDER BY as_of_date DESC, created_at DESC").bind(customerId).all<{ id: string; amount_paise: number; as_of_date: string; reference: string | null; remarks: string | null; voided_at: string | null; void_reason: string | null }>()
  ).results;
  return c.json({
    items: rows.map((r) => ({ id: r.id, amountPaise: r.amount_paise, asOfDate: r.as_of_date, reference: r.reference, remarks: r.remarks, voided: r.voided_at !== null, voidReason: r.void_reason })),
  });
});

openingRoutes.post("/:id/void", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const b = (await readJson(c)) as { reason?: string } | undefined;
  const reason = (b?.reason ?? "").trim();
  if (!reason) return c.json({ error: "validation", issues: [{ field: "reason", message: "Please give a reason" }] }, 400);
  const row = await db.prepare("SELECT voided_at FROM opening_balances WHERE id = ?1").bind(c.req.param("id")).first<{ voided_at: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "already_voided", message: "This balance is already voided" }, 409);
  const used = await db.prepare("SELECT COUNT(*) AS n FROM payment_allocations WHERE opening_balance_id = ?1 AND reversed_at IS NULL").bind(c.req.param("id")).first<{ n: number }>();
  if ((used?.n ?? 0) > 0) return c.json({ error: "has_payments", message: "Money has been received against this balance. Reverse it first." }, 409);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE opening_balances SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1").bind(c.req.param("id"), now, user.id, reason),
    auditStatement(db, { actor: user.id, action: "opening_balance_void", entity: "opening_balance", entityId: c.req.param("id"), detail: { reason } }),
  ]);
  return c.json({ ok: true });
});

/** One event that changes what the customer owes (outstanding) or what the shop holds (advance). */
/** Spec 019d R18: `cr` is the change to credit held (credit notes not yet used or paid back). */
type Event = { date: string; ts: string; order: number; type: string; reference: string | null; description: string; out: number; adv: number; cr?: number };

/**
 * Spec 019 R4: the customer's ledger from stored rows only. Every line is a change to outstanding or to advance held,
 * so the last running balance always equals the current totals (R5).
 */
export async function ledgerOf(db: D1Database, customerId: string, from: string | null): Promise<LedgerResponse | null> {
  const cust = await db.prepare("SELECT id, name FROM customers WHERE id = ?1").bind(customerId).first<{ id: string; name: string }>();
  if (!cust) return null;
  const events: Event[] = [];
  const ist = (iso: string) => indiaDate(new Date(iso));

  const invoices = (await db.prepare("SELECT id, invoice_no, invoice_date, created_at, payable_paise, voided_at FROM invoices WHERE customer_id = ?1").bind(customerId).all<{ id: string; invoice_no: string; invoice_date: string; created_at: string; payable_paise: number; voided_at: string | null }>()).results;
  for (const i of invoices) {
    events.push({ date: i.invoice_date, ts: i.created_at, order: 0, type: "Invoice", reference: i.invoice_no, description: `Invoice ${i.invoice_no}`, out: i.payable_paise, adv: 0 });
    if (i.voided_at) events.push({ date: ist(i.voided_at), ts: i.voided_at, order: 5, type: "Invoice voided", reference: i.invoice_no, description: `Invoice ${i.invoice_no} voided`, out: -i.payable_paise, adv: 0 });
  }
  const openings = (await db.prepare("SELECT id, reference, as_of_date, created_at, amount_paise, voided_at FROM opening_balances WHERE customer_id = ?1").bind(customerId).all<{ id: string; reference: string | null; as_of_date: string; created_at: string; amount_paise: number; voided_at: string | null }>()).results;
  for (const o of openings) {
    events.push({ date: o.as_of_date, ts: o.created_at, order: 0, type: "Opening balance", reference: o.reference, description: "Opening balance (from the old system)", out: o.amount_paise, adv: 0 });
    if (o.voided_at) events.push({ date: ist(o.voided_at), ts: o.voided_at, order: 5, type: "Opening balance voided", reference: o.reference, description: "Opening balance voided", out: -o.amount_paise, adv: 0 });
  }
  const payments = (await db.prepare("SELECT id, receipt_no, receipt_date, created_at, amount_paise, mode, voided_at, void_reason FROM payments WHERE customer_id = ?1").bind(customerId).all<{ id: string; receipt_no: string | null; receipt_date: string; created_at: string; amount_paise: number; mode: string; voided_at: string | null; void_reason: string | null }>()).results;
  const pname = (p: { receipt_no: string | null }) => p.receipt_no ?? "payment at sale";
  for (const p of payments) {
    events.push({ date: p.receipt_date, ts: p.created_at, order: 1, type: "Received", reference: p.receipt_no, description: `Received ${pname(p)} (${p.mode})`, out: 0, adv: p.amount_paise });
    if (p.voided_at) events.push({ date: ist(p.voided_at), ts: p.voided_at, order: 5, type: "Payment voided", reference: p.receipt_no, description: `${pname(p)} voided`, out: 0, adv: -p.amount_paise });
  }
  const allocs = (await db.prepare(
    `SELECT a.id, a.amount_paise, a.invoice_id, a.opening_balance_id, a.created_at, a.reversed_at, p.receipt_no, i.invoice_no
     FROM payment_allocations a JOIN payments p ON p.id = a.payment_id LEFT JOIN invoices i ON i.id = a.invoice_id WHERE p.customer_id = ?1`,
  ).bind(customerId).all<{ id: string; amount_paise: number; invoice_id: string | null; opening_balance_id: string | null; created_at: string; reversed_at: string | null; receipt_no: string | null; invoice_no: string | null }>()).results;
  for (const a of allocs) {
    const target = a.invoice_no ?? (a.opening_balance_id ? "opening balance" : "invoice");
    events.push({ date: ist(a.created_at), ts: a.created_at, order: 2, type: `Applied to ${a.invoice_no ? "invoice" : "balance"}`, reference: a.receipt_no, description: `${a.receipt_no ?? "Payment"} applied to ${target}`, out: -a.amount_paise, adv: -a.amount_paise });
    if (a.reversed_at) events.push({ date: ist(a.reversed_at), ts: a.reversed_at, order: 4, type: "Allocation reversed", reference: a.receipt_no, description: `${a.receipt_no ?? "Payment"} from ${target} reversed`, out: a.amount_paise, adv: a.amount_paise });
  }
  const refunds = (await db.prepare(
    `SELECT r.amount_paise, r.refund_date, r.created_at, r.reversed_at, r.mode, p.receipt_no FROM payment_refunds r JOIN payments p ON p.id = r.payment_id WHERE p.customer_id = ?1`,
  ).bind(customerId).all<{ amount_paise: number; refund_date: string; created_at: string; reversed_at: string | null; mode: string; receipt_no: string | null }>()).results;
  for (const r of refunds) {
    events.push({ date: r.refund_date, ts: r.created_at, order: 3, type: "Refund", reference: r.receipt_no, description: `Refund from ${r.receipt_no ?? "advance"} (${r.mode.replace("_", " ")})`, out: 0, adv: -r.amount_paise });
    if (r.reversed_at) events.push({ date: ist(r.reversed_at), ts: r.reversed_at, order: 4, type: "Refund reversed", reference: r.receipt_no, description: `Refund from ${r.receipt_no ?? "advance"} reversed`, out: 0, adv: r.amount_paise });
  }
  const og = (await db.prepare("SELECT receipt_no, receipt_date, created_at, final_paise FROM old_gold_purchases WHERE customer_id = ?1 AND voided_at IS NULL").bind(customerId).all<{ receipt_no: string; receipt_date: string; created_at: string; final_paise: number }>()).results;
  for (const g of og) events.push({ date: g.receipt_date, ts: g.created_at, order: 6, type: "Old gold purchase", reference: g.receipt_no, description: `${g.receipt_no} for ${formatMoney(g.final_paise)} (its money is on its advance or payout line)`, out: 0, adv: 0 });

  // Spec 019d R18: credit notes. Issue adds the whole amount to credit held; each application moves money
  // from held to the bill; a payout moves money out of held; voiding adds back what reversing the
  // applications restored, then removes the whole amount.
  const notes = (await db.prepare("SELECT id, cn_no, cn_date, created_at, amount_paise, voided_at FROM credit_notes WHERE customer_id = ?1").bind(customerId).all<{ id: string; cn_no: string; cn_date: string; created_at: string; amount_paise: number; voided_at: string | null }>()).results;
  for (const n of notes) {
    events.push({ date: n.cn_date, ts: n.created_at, order: 0, type: "Credit note", reference: n.cn_no, description: `Credit note ${n.cn_no} issued`, out: 0, adv: 0, cr: n.amount_paise });
    if (n.voided_at) events.push({ date: ist(n.voided_at), ts: n.voided_at, order: 5, type: "Credit note voided", reference: n.cn_no, description: `Credit note ${n.cn_no} voided`, out: 0, adv: 0, cr: -n.amount_paise });
  }
  const credApps = (await db.prepare(
    `SELECT a.amount_paise, a.created_at, a.reversed_at, c.cn_no, i.invoice_no FROM credit_applications a
     JOIN credit_notes c ON c.id = a.credit_note_id JOIN invoices i ON i.id = a.invoice_id WHERE c.customer_id = ?1`,
  ).bind(customerId).all<{ amount_paise: number; created_at: string; reversed_at: string | null; cn_no: string; invoice_no: string }>()).results;
  for (const a of credApps) {
    events.push({ date: ist(a.created_at), ts: a.created_at, order: 2, type: "Credit applied", reference: a.cn_no, description: `Credit ${a.cn_no} applied to invoice ${a.invoice_no}`, out: -a.amount_paise, adv: 0, cr: -a.amount_paise });
    if (a.reversed_at) events.push({ date: ist(a.reversed_at), ts: a.reversed_at, order: 4, type: "Credit application reversed", reference: a.cn_no, description: `Credit ${a.cn_no} from invoice ${a.invoice_no} reversed`, out: a.amount_paise, adv: 0, cr: a.amount_paise });
  }
  const credPays = (await db.prepare(
    `SELECT p.amount_paise, p.paid_date, p.created_at, p.reversed_at, p.mode, c.cn_no FROM credit_note_payouts p JOIN credit_notes c ON c.id = p.credit_note_id WHERE c.customer_id = ?1`,
  ).bind(customerId).all<{ amount_paise: number; paid_date: string; created_at: string; reversed_at: string | null; mode: string; cn_no: string }>()).results;
  for (const p of credPays) {
    events.push({ date: p.paid_date, ts: p.created_at, order: 3, type: "Credit paid out", reference: p.cn_no, description: `Paid out from ${p.cn_no} (${p.mode.replace("_", " ")})`, out: 0, adv: 0, cr: -p.amount_paise });
    if (p.reversed_at) events.push({ date: ist(p.reversed_at), ts: p.reversed_at, order: 4, type: "Credit payout reversed", reference: p.cn_no, description: `Payout from ${p.cn_no} reversed`, out: 0, adv: 0, cr: p.amount_paise });
  }

  events.sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order || x.ts.localeCompare(y.ts));

  let out = 0;
  let adv = 0;
  let cr = 0;
  const entries: LedgerEntry[] = [];
  let broughtOut = 0;
  let broughtAdv = 0;
  let broughtCr = 0;
  for (const e of events) {
    if (from && e.date < from) {
      out += e.out;
      adv += e.adv;
      cr += e.cr ?? 0;
      broughtOut = out;
      broughtAdv = adv;
      broughtCr = cr;
      continue;
    }
    if (from && entries.length === 0) {
      entries.push({ date: from, type: "Brought forward", reference: null, description: "Balance brought forward", debitPaise: 0, creditPaise: 0, outstandingAfterPaise: broughtOut, advanceAfterPaise: broughtAdv, creditAfterPaise: broughtCr });
    }
    out += e.out;
    adv += e.adv;
    cr += e.cr ?? 0;
    entries.push({
      date: e.date,
      type: e.type,
      reference: e.reference,
      description: e.description,
      debitPaise: Math.max(e.out, 0),
      creditPaise: Math.max(-e.out, 0) + Math.max(e.adv, 0),
      outstandingAfterPaise: out,
      advanceAfterPaise: adv,
      creditAfterPaise: cr,
    });
  }
  if (from && entries.length === 0) {
    entries.push({ date: from, type: "Brought forward", reference: null, description: "Balance brought forward", debitPaise: 0, creditPaise: 0, outstandingAfterPaise: broughtOut, advanceAfterPaise: broughtAdv, creditAfterPaise: broughtCr });
  }
  const held = (await db.prepare(`SELECT COALESCE(SUM(${HELD_SQL}), 0) AS n FROM credit_notes c WHERE c.customer_id = ?1 AND c.voided_at IS NULL`).bind(customerId).first<{ n: number }>())?.n ?? 0;
  return { customerId, customerName: cust.name, from, outstandingPaise: out, advanceHeldPaise: adv, creditHeldPaise: held, netPaise: out - adv - held, entries };
}

ledgerRoutes.get("/customers/:id/ledger", async (c) => {
  const from = c.req.query("from") ?? null;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return c.json({ error: "invalid_date" }, 400);
  const l = await ledgerOf(c.env.DB, c.req.param("id"), from);
  if (!l) return c.json({ error: "not_found" }, 404);
  return c.json(l);
});

/** Spec 019 R5 (per customer): outstanding and advance held, the same figures the ledger ends on. */
const TOTALS_SQL = `SELECT c.id AS customer_id, c.name AS customer_name,
  COALESCE((SELECT SUM(i.payable_paise) FROM invoices i WHERE i.customer_id = c.id AND i.voided_at IS NULL), 0)
  + COALESCE((SELECT SUM(o.amount_paise) FROM opening_balances o WHERE o.customer_id = c.id AND o.voided_at IS NULL), 0)
  - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE p.customer_id = c.id AND a.reversed_at IS NULL), 0)
  - COALESCE((SELECT SUM(x.amount_paise) FROM credit_applications x JOIN credit_notes n ON n.id = x.credit_note_id WHERE n.customer_id = c.id AND x.reversed_at IS NULL), 0) AS outstanding,
  COALESCE((SELECT SUM(p.amount_paise - COALESCE((SELECT SUM(x.amount_paise) FROM payment_allocations x WHERE x.payment_id = p.id AND x.reversed_at IS NULL), 0) - COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id = p.id AND r.reversed_at IS NULL), 0))
            FROM payments p WHERE p.customer_id = c.id AND p.voided_at IS NULL), 0) AS advance
  FROM customers c`;

async function oldestUnpaid(db: D1Database, customerId: string): Promise<string | null> {
  const items = await openItems(db, customerId);
  return items[0]?.d ?? null;
}

ledgerRoutes.get("/ledger/summary", async (c) => {
  const rows = (await c.env.DB.prepare(TOTALS_SQL).all<{ customer_id: string; customer_name: string; outstanding: number; advance: number }>()).results;
  const withOut = rows.filter((r) => r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
  const top: OutstandingRow[] = [];
  for (const r of withOut.slice(0, 10)) {
    top.push({ customerId: r.customer_id, customerName: r.customer_name, outstandingPaise: r.outstanding, advanceHeldPaise: r.advance, oldestUnpaidDate: await oldestUnpaid(c.env.DB, r.customer_id) });
  }
  const body: LedgerSummary = {
    totalOutstandingPaise: withOut.reduce((s, r) => s + r.outstanding, 0),
    totalAdvanceHeldPaise: rows.reduce((s, r) => s + Math.max(0, r.advance), 0),
    customersWithOutstanding: withOut.length,
    top,
  };
  return c.json(body);
});

/** Spec 019 R7: customers who owe money, largest first, with the oldest unpaid date. */
ledgerRoutes.get("/ledger/outstanding", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  const rows = (await c.env.DB.prepare(TOTALS_SQL).all<{ customer_id: string; customer_name: string; outstanding: number; advance: number }>()).results
    .filter((r) => r.outstanding > 0 && (!q || r.customer_name.toLowerCase().includes(q)))
    .sort((a, b) => b.outstanding - a.outstanding || a.customer_name.localeCompare(b.customer_name));
  const page = rows.slice(offset, offset + 20);
  const items: OutstandingRow[] = [];
  for (const r of page) items.push({ customerId: r.customer_id, customerName: r.customer_name, outstandingPaise: r.outstanding, advanceHeldPaise: r.advance, oldestUnpaidDate: await oldestUnpaid(c.env.DB, r.customer_id) });
  return c.json({ items, nextCursor: rows.length > offset + 20 ? String(offset + 20) : null });
});
