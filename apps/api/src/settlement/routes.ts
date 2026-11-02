import { Hono } from "hono";
import {
  KIND_LABEL,
  MODE_LABEL,
  advanceAllocationsSchema,
  formatMoney,
  newId,
  settlementRemarksSchema,
  type PaymentKind,
  type PaymentMode,
  type SettlementCreditLine,
  type SettlementLine,
  type SettlementResponse,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { revisionStatement } from "../db/revisions";
import { readJson, validationBody } from "../http";
import { receivedFor, refundedOf } from "../payments/routes";
import { indiaDate } from "@jewellery/shared";
import { HELD_SQL } from "../creditNotes/money";

export const settlementRoutes = new Hono<AppEnv>();

/** Kinds that can pay an invoice from money already held (spec 016 R4). At-sale money is never reused. */
const USABLE_KINDS = ["advance", "opening_advance", "old_gold", "invoice_payment"] as const;

const TYPE_LABEL: Record<PaymentKind, string> = KIND_LABEL;

export async function settlementOf(db: D1Database, invoiceId: string): Promise<SettlementResponse | null> {
  const inv = await db
    .prepare("SELECT id, invoice_no, invoice_date, customer_id, customer_name, payable_paise, voided_at FROM invoices WHERE id = ?1")
    .bind(invoiceId)
    .first<{ id: string; invoice_no: string; invoice_date: string; customer_id: string | null; customer_name: string; payable_paise: number; voided_at: string | null }>();
  if (!inv) return null;
  const rows = (
    await db
      .prepare(
        `SELECT a.id AS allocation_id, a.payment_id, a.amount_paise, p.kind, p.mode, p.reference, p.receipt_no, p.receipt_date, p.source_ogp_id,
                p.amount_paise - COALESCE((SELECT SUM(x.amount_paise) FROM payment_allocations x WHERE x.payment_id = p.id AND x.reversed_at IS NULL), 0)
                  - COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id = p.id AND r.reversed_at IS NULL), 0) AS remaining,
                o.receipt_no AS ogp_no
         FROM payment_allocations a
         JOIN payments p ON p.id = a.payment_id
         LEFT JOIN old_gold_purchases o ON o.id = p.source_ogp_id
         WHERE a.invoice_id = ?1 AND a.reversed_at IS NULL
         ORDER BY p.receipt_date, a.created_at, a.id`,
      )
      .bind(invoiceId)
      .all<{ allocation_id: string; payment_id: string; amount_paise: number; kind: PaymentKind; mode: PaymentMode; reference: string | null; receipt_no: string | null; receipt_date: string; source_ogp_id: string | null; remaining: number; ogp_no: string | null }>()
  ).results;

  const lines: SettlementLine[] = rows.map((r) => ({
    allocationId: r.allocation_id,
    paymentId: r.payment_id,
    date: r.receipt_date,
    mode: MODE_LABEL[r.mode],
    reference: r.receipt_no ?? r.reference ?? "-",
    type: TYPE_LABEL[r.kind],
    amountPaise: r.amount_paise,
    paymentRemainingPaise: r.remaining,
    receiptNo: r.receipt_no,
  }));

  // Spec 017 R5: deterministic sentences for advance and old gold lines (not for at-sale or later payments).
  const autoNote: string[] = [];
  for (const r of rows) {
    const pay = r.receipt_no ?? "payment";
    if (r.kind === "old_gold") {
      autoNote.push(`Old gold ${r.ogp_no ?? ""} adjusted through ${pay}: ${formatMoney(r.amount_paise)}. Remaining in ${pay}: ${formatMoney(r.remaining)}.`.replace("  ", " "));
    } else if (r.kind === "advance" || r.kind === "opening_advance") {
      autoNote.push(`Advance ${pay} used: ${formatMoney(r.amount_paise)}. Remaining in ${pay}: ${formatMoney(r.remaining)}.`);
    }
  }

  // Spec 019d R17: credit applied to this bill, and one auto-note sentence each.
  const creditRows = (
    await db
      .prepare(
        `SELECT a.id AS application_id, a.amount_paise, a.created_at, c.id AS note_id, c.cn_no, ${HELD_SQL} AS held
         FROM credit_applications a JOIN credit_notes c ON c.id = a.credit_note_id
         WHERE a.invoice_id = ?1 AND a.reversed_at IS NULL ORDER BY a.created_at, a.id`,
      )
      .bind(invoiceId)
      .all<{ application_id: string; amount_paise: number; created_at: string; note_id: string; cn_no: string; held: number }>()
  ).results;
  const creditLines: SettlementCreditLine[] = creditRows.map((r) => ({
    applicationId: r.application_id,
    creditNoteId: r.note_id,
    creditNoteNo: r.cn_no,
    date: indiaDate(new Date(r.created_at)),
    amountPaise: r.amount_paise,
  }));
  for (const r of creditRows) {
    autoNote.push(`Credit note ${r.cn_no} applied: ${formatMoney(r.amount_paise)}. Credit still held in ${r.cn_no}: ${formatMoney(r.held)}.`);
  }

  const received = lines.reduce((s, l) => s + l.amountPaise, 0) + creditLines.reduce((s, l) => s + l.amountPaise, 0);
  const remarks = (await db.prepare("SELECT remarks FROM invoice_settlements WHERE invoice_id = ?1").bind(invoiceId).first<{ remarks: string | null }>())?.remarks ?? null;
  return {
    invoice: { id: inv.id, invoiceNo: inv.invoice_no, invoiceDate: inv.invoice_date, customerId: inv.customer_id, customerName: inv.customer_name, voided: inv.voided_at !== null },
    payablePaise: inv.payable_paise,
    receivedPaise: received,
    balanceDuePaise: Math.max(0, inv.payable_paise - received),
    advanceReference: lines.map((l) => l.receiptNo).filter(Boolean).join(", "),
    autoNote,
    remarks,
    lines,
    creditLines,
  };
}

settlementRoutes.get("/:id/settlement", async (c) => {
  const s = await settlementOf(c.env.DB, c.req.param("id"));
  if (!s) return c.json({ error: "not_found" }, 404);
  return c.json(s);
});

/** Spec 017 R6: remarks are free text, kept with a revision and an audit row. */
settlementRoutes.put("/:id/settlement", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = settlementRemarksSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const inv = await db.prepare("SELECT id FROM invoices WHERE id = ?1").bind(c.req.param("id")).first<{ id: string }>();
  if (!inv) return c.json({ error: "not_found" }, 404);
  const now = new Date().toISOString();
  const old = await db.prepare("SELECT remarks FROM invoice_settlements WHERE invoice_id = ?1").bind(inv.id).first<{ remarks: string | null }>();
  if ((old?.remarks ?? null) === parsed.data.remarks) return c.json(await settlementOf(db, inv.id));
  const statements = [];
  if (old) statements.push(revisionStatement(db, { entity: "settlement", entityId: inv.id, snapshot: old, reason: "remarks changed", actor: user.id }));
  statements.push(
    db
      .prepare(
        `INSERT INTO invoice_settlements (invoice_id, remarks, created_at, created_by, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?3, ?4)
         ON CONFLICT (invoice_id) DO UPDATE SET remarks = excluded.remarks, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(inv.id, parsed.data.remarks, now, user.id),
    auditStatement(db, { actor: user.id, action: "settlement_remarks", entity: "invoice", entityId: inv.id }),
  );
  await db.batch(statements);
  return c.json(await settlementOf(db, inv.id));
});

/**
 * Spec 017 R7: use money already held (advances, opening advances, old gold, later payments) on this invoice.
 * All-or-nothing: every check runs first, then the allocations are written in one batch.
 */
settlementRoutes.post("/:id/advance-allocations", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = advanceAllocationsSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const inv = await db.prepare("SELECT id, customer_id, payable_paise, voided_at, rate_status FROM invoices WHERE id = ?1").bind(c.req.param("id")).first<{ id: string; customer_id: string | null; payable_paise: number; voided_at: string | null; rate_status: string }>();
  if (!inv) return c.json({ error: "not_found" }, 404);
  if (inv.voided_at) return c.json({ error: "invoice_voided", message: "A voided invoice cannot be paid" }, 409);
  // Spec 019c R6: a sale whose rate is not fixed has no amount due yet.
  if (inv.rate_status === "pending") return c.json({ error: "rate_pending", message: "The rate of this sale is not fixed yet. Fix the rate first." }, 409);

  const due = inv.payable_paise - (await receivedFor(db, inv.id));
  const requested = parsed.data.allocations;
  const total = requested.reduce((s, a) => s + a.amountPaise, 0);
  if (total > due) return c.json({ error: "exceeds_due", message: `The invoice only owes ₹${(due / 100).toFixed(2)}`, dueAmountPaise: due }, 409);

  const perPayment = new Map<string, number>();
  for (const a of requested) perPayment.set(a.paymentId, (perPayment.get(a.paymentId) ?? 0) + a.amountPaise);
  if (perPayment.size !== requested.length) return c.json({ error: "validation", message: "Each advance can be listed once" }, 400);

  for (const [paymentId, amount] of perPayment) {
    const p = await db.prepare("SELECT customer_id, kind, voided_at, amount_paise FROM payments WHERE id = ?1").bind(paymentId).first<{ customer_id: string | null; kind: string; voided_at: string | null; amount_paise: number }>();
    if (!p) return c.json({ error: "payment_not_found", message: "One of the advances does not exist" }, 400);
    if (p.customer_id !== inv.customer_id) return c.json({ error: "customer_mismatch", message: "That advance belongs to another customer" }, 400);
    if (p.voided_at) return c.json({ error: "payment_voided", message: "That advance is voided" }, 409);
    if (!(USABLE_KINDS as readonly string[]).includes(p.kind)) return c.json({ error: "kind_not_usable", message: `${KIND_LABEL[p.kind as PaymentKind] ?? p.kind} money cannot be used on an invoice` }, 400);
    const remaining = p.amount_paise - (await db.prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM payment_allocations WHERE payment_id = ?1 AND reversed_at IS NULL").bind(paymentId).first<{ n: number }>())!.n - (await refundedOf(db, paymentId));
    if (amount > remaining) {
      return c.json({ error: "exceeds_remaining", message: `Only ${formatMoney(remaining)} is left on that advance`, remainingPaise: remaining }, 409);
    }
  }

  const now = new Date().toISOString();
  try {
    await db.batch([
      ...requested.map((a) =>
        db
          .prepare("INSERT INTO payment_allocations (id, payment_id, invoice_id, opening_balance_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)")
          .bind(newId(), a.paymentId, inv.id, a.amountPaise, now, user.id),
      ),
      auditStatement(db, { actor: user.id, action: "advance_applied", entity: "invoice", entityId: inv.id, detail: { totalPaise: total, payments: requested.length } }),
    ]);
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/exceeds_due/.test(m)) return c.json({ error: "exceeds_due", message: "The invoice would be paid more than it owes." }, 409);
    if (/exceeds_payment/.test(m)) return c.json({ error: "exceeds_remaining", message: "An advance would be used for more than it holds." }, 409);
    throw e;
  }
  return c.json(await settlementOf(db, inv.id));
});

