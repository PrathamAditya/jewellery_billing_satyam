import { Hono } from "hono";
import { financialYearOf } from "@jewellery/calc";
import {
  indiaDate,
  newId,
  nameSearchKey,
  paymentRemarksSchema,
  refundRequestSchema,
  paymentRequestSchema,
  reverseAllocationSchema,
  voidPaymentSchema,
  type PaymentAllocationResponse,
  type PaymentKind,
  type PaymentListResponse,
  type PaymentMode,
  type PaymentRequest,
  type PaymentResponse,
  type PaymentSaveResponse,
  type PaymentSummary,
  type PaymentWarning,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { classifyReplay } from "../db/idempotency";
import { revisionStatement } from "../db/revisions";
import { readJson, validationBody } from "../http";
import { settingsSnapshot } from "../settings/routes";

export const paymentRoutes = new Hono<AppEnv>();
export const allocationRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;

type DbPayment = {
  id: string;
  created_at: string;
  created_by: string;
  kind: PaymentKind;
  receipt_no: string | null;
  receipt_date: string;
  customer_id: string | null;
  payer_name: string;
  payer_mobile: string | null;
  payer_pan: string | null;
  payer_address: string | null;
  mode: PaymentMode;
  reference: string | null;
  amount_paise: number;
  remarks: string | null;
  input_json: string;
  advance_summary_json: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

type DbAllocation = {
  id: string;
  invoice_id: string | null;
  invoice_no: string | null;
  amount_paise: number;
  reversed_at: string | null;
};

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
const guardCodeRefund = (e: unknown) => (e instanceof Error && /exceeds_payment/.test(e.message) ? "exceeds_payment" : null);
void guardCodeRefund;
/** A guard in the database (migration 0013) refused the allocation. */
const guardCode = (e: unknown): "exceeds_due" | "exceeds_payment" | null => {
  const m = e instanceof Error ? e.message : "";
  if (/exceeds_due/.test(m)) return "exceeds_due";
  if (/exceeds_payment/.test(m)) return "exceeds_payment";
  return null;
};

async function allocationsOf(db: D1Database, paymentId: string): Promise<DbAllocation[]> {
  return (
    await db
      .prepare(
        `SELECT a.id, a.invoice_id, i.invoice_no, a.amount_paise, a.reversed_at
         FROM payment_allocations a LEFT JOIN invoices i ON i.id = a.invoice_id
         WHERE a.payment_id = ?1 ORDER BY a.created_at, a.id`,
      )
      .bind(paymentId)
      .all<DbAllocation>()
  ).results;
}

const allocatedNow = (allocs: { amount_paise: number; reversed_at: string | null }[]) =>
  allocs.filter((a) => !a.reversed_at).reduce((s, a) => s + a.amount_paise, 0);

/** Money handed back on refunds that are still live (spec 016 R8). */
export async function refundedOf(db: D1Database, paymentId: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment_refunds WHERE payment_id = ?1 AND reversed_at IS NULL").bind(paymentId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Money received for an invoice: its live allocations (spec 015 M4). */
export async function receivedFor(db: D1Database, invoiceId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment_allocations WHERE invoice_id = ?1 AND reversed_at IS NULL")
    .bind(invoiceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Remaining money of a customer across live payments (their advance held, spec 015 M5). */
export async function advanceHeld(db: D1Database, customerId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_paise - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0) - COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id = p.id AND r.reversed_at IS NULL), 0)), 0) AS n
       FROM payments p WHERE p.customer_id = ?1 AND p.voided_at IS NULL`,
    )
    .bind(customerId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Open invoices of a customer, oldest first (FIFO, spec 015 R3). */
async function openInvoices(db: D1Database, customerId: string) {
  return (
    await db
      .prepare(
        `SELECT i.id, i.invoice_no, i.invoice_date, i.payable_paise,
                i.payable_paise - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.invoice_id = i.id AND a.reversed_at IS NULL), 0) AS due
         FROM invoices i WHERE i.customer_id = ?1 AND i.voided_at IS NULL
         ORDER BY i.invoice_date, i.created_at, i.id`,
      )
      .bind(customerId)
      .all<{ id: string; invoice_no: string; invoice_date: string; payable_paise: number; due: number }>()
  ).results.filter((r) => r.due > 0);
}

function toResponse(p: DbPayment, allocs: DbAllocation[], refunded = 0): PaymentResponse {
  const allocated = allocatedNow(allocs) + refunded;
  return {
    id: p.id,
    kind: p.kind,
    receiptNo: p.receipt_no,
    receiptDate: p.receipt_date,
    customerId: p.customer_id,
    payer: { name: p.payer_name, mobile: p.payer_mobile, pan: p.payer_pan, address: p.payer_address },
    mode: p.mode,
    reference: p.reference,
    amountPaise: p.amount_paise,
    // A voided payment has no money left on it (its allocations are reversed).
    remainingPaise: p.voided_at ? 0 : p.amount_paise - allocated,
    remarks: p.remarks,
    voided: p.voided_at !== null,
    voidReason: p.void_reason,
    allocations: allocs.map<PaymentAllocationResponse>((a) => ({
      id: a.id,
      invoiceId: a.invoice_id,
      invoiceNo: a.invoice_no,
      amountPaise: a.amount_paise,
      reversed: a.reversed_at !== null,
      reversedAt: a.reversed_at,
    })),
    advanceSummary: p.advance_summary_json ? (JSON.parse(p.advance_summary_json) as PaymentResponse["advanceSummary"]) : null,
    createdAt: p.created_at,
    createdBy: p.created_by,
  };
}

async function loadPayment(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM payments WHERE id = ?1").bind(id).first<DbPayment>();
  if (!row) return null;
  return { row, allocs: await allocationsOf(db, id), refunded: await refundedOf(db, id) };
}

/** The payment as it was asked for. A safe retry with the same id and content returns the first result (R4). */
const canonical = (b: PaymentRequest) =>
  JSON.stringify({
    date: b.date,
    customerId: b.customerId ?? null,
    mode: b.mode,
    reference: b.reference ?? null,
    amountPaise: b.amountPaise,
    purpose: b.purpose,
    oldReference: b.oldReference ?? null,
    orderId: b.orderId ?? null,
    invoiceId: b.invoiceId ?? null,
    allocation: b.allocation,
    remarks: b.remarks ?? null,
  });

type Plan = { kind: PaymentKind; allocations: { invoiceId: string; amountPaise: number }[]; customerId: string | null; payer: { name: string; mobile: string | null; pan: string | null; address: string | null }; orderId: string | null };

/** Works out who is paid and which invoices are paid, or says why not (R2 to R4). */
async function plan(db: D1Database, b: PaymentRequest): Promise<{ ok: true; plan: Plan } | { ok: false; status: 400 | 409; body: unknown }> {
  if (b.purpose === "at_sale") {
    if (!b.invoiceId) return { ok: false, status: 400, body: { error: "validation", issues: [{ field: "invoiceId", message: "Choose the invoice" }] } };
    const inv = await db
      .prepare("SELECT id, customer_id, customer_name, customer_mobile, customer_pan, customer_address, payable_paise, voided_at FROM invoices WHERE id = ?1")
      .bind(b.invoiceId)
      .first<{ id: string; customer_id: string | null; customer_name: string; customer_mobile: string | null; customer_pan: string | null; customer_address: string | null; payable_paise: number; voided_at: string | null }>();
    if (!inv) return { ok: false, status: 400, body: { error: "invoice_not_found", message: "That invoice does not exist" } };
    if (inv.voided_at) return { ok: false, status: 409, body: { error: "invoice_voided", message: "That invoice is voided" } };
    if (b.customerId && b.customerId !== inv.customer_id) return { ok: false, status: 400, body: { error: "customer_mismatch", message: "That invoice belongs to another customer" } };
    const due = inv.payable_paise - (await receivedFor(db, inv.id));
    if (b.amountPaise > due) return { ok: false, status: 409, body: { error: "exceeds_due", message: `The invoice only owes ₹${(due / 100).toFixed(2)}`, dueAmountPaise: due } };
    return {
      ok: true,
      plan: {
        kind: "at_sale",
        orderId: null,
        customerId: inv.customer_id,
        payer: { name: inv.customer_name, mobile: inv.customer_mobile, pan: inv.customer_pan, address: inv.customer_address },
        allocations: [{ invoiceId: inv.id, amountPaise: b.amountPaise }],
      },
    };
  }

  if (!b.customerId) return { ok: false, status: 400, body: { error: "validation", issues: [{ field: "customerId", message: "Choose the customer" }] } };
  const cust = await db.prepare("SELECT id, name, mobile, pan, address, voided_at FROM customers WHERE id = ?1").bind(b.customerId).first<{ id: string; name: string; mobile: string | null; pan: string | null; address: string | null; voided_at: string | null }>();
  if (!cust) return { ok: false, status: 400, body: { error: "customer_not_found", message: "That customer does not exist" } };
  if (cust.voided_at) return { ok: false, status: 409, body: { error: "customer_voided", message: "That customer is voided" } };
  const payer = { name: cust.name, mobile: cust.mobile, pan: cust.pan, address: cust.address };

  // Spec 016 R5: an advance may belong to an order. The order must be open and belong to this customer.
  let orderId: string | null = null;
  if (b.orderId) {
    const order = await db.prepare("SELECT customer_id, status FROM orders WHERE id = ?1").bind(b.orderId).first<{ customer_id: string; status: string }>();
    if (!order) return { ok: false, status: 400, body: { error: "order_not_found", message: "That order does not exist" } };
    if (order.customer_id !== cust.id) return { ok: false, status: 400, body: { error: "order_customer_mismatch", message: "That order belongs to another customer" } };
    if (order.status !== "open") return { ok: false, status: 409, body: { error: "order_not_open", message: "That order is closed or cancelled. Take the advance on a new order." } };
    orderId = b.orderId;
  }
  if (b.purpose === "opening_advance") return { ok: true, plan: { kind: "opening_advance", customerId: cust.id, payer, allocations: [], orderId } };
  if (b.purpose === "advance") return { ok: true, plan: { kind: "advance", customerId: cust.id, payer, allocations: [], orderId } };

  // against_invoices
  const open = await openInvoices(db, cust.id);
  if (b.allocation === "auto") {
    let left = b.amountPaise;
    const allocations: { invoiceId: string; amountPaise: number }[] = [];
    for (const inv of open) {
      if (left <= 0) break;
      const take = Math.min(left, inv.due);
      allocations.push({ invoiceId: inv.id, amountPaise: take });
      left -= take;
    }
    return { ok: true, plan: { kind: "invoice_payment", customerId: cust.id, payer, allocations, orderId: null } };
  }

  const seen = new Set<string>();
  const total = b.allocation.reduce((s, a) => s + a.amountPaise, 0);
  if (total > b.amountPaise) return { ok: false, status: 400, body: { error: "allocation_exceeds_amount", message: "The amounts allocated add up to more than the payment" } };
  for (const a of b.allocation) {
    if (seen.has(a.invoiceId)) return { ok: false, status: 400, body: { error: "validation", message: "Each invoice can be listed once" } };
    seen.add(a.invoiceId);
    const match = open.find((o) => o.id === a.invoiceId);
    if (!match) {
      const exists = await db.prepare("SELECT customer_id, voided_at FROM invoices WHERE id = ?1").bind(a.invoiceId).first<{ customer_id: string | null; voided_at: string | null }>();
      if (!exists) return { ok: false, status: 400, body: { error: "invoice_not_found", message: "That invoice does not exist" } };
      if (exists.voided_at) return { ok: false, status: 409, body: { error: "invoice_voided", message: "That invoice is voided" } };
      if (exists.customer_id !== cust.id) return { ok: false, status: 400, body: { error: "customer_mismatch", message: "That invoice belongs to another customer" } };
      return { ok: false, status: 409, body: { error: "exceeds_due", message: "That invoice is already paid" } };
    }
    if (a.amountPaise > match.due) {
      return { ok: false, status: 409, body: { error: "exceeds_due", message: `${match.invoice_no} only owes ₹${(match.due / 100).toFixed(2)}`, dueAmountPaise: match.due } };
    }
  }
  return { ok: true, plan: { kind: "invoice_payment", customerId: cust.id, payer, allocations: b.allocation, orderId: null } };
}

// ---- create (R2, R5, R6) ----
paymentRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = paymentRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;
  if ((b.purpose === "advance" || b.purpose === "opening_advance") && !user.permissions.includes("advances.create")) {
    return c.json({ error: "forbidden", message: "You do not have permission to take advances", permission: "advances.create" }, 403);
  }
  const today = indiaDate(c.get("now"));
  if (b.date > today) return c.json({ error: "future_date", message: "A payment cannot be dated in the future" }, 400);

  const id = b.id ?? newId();
  const replay = classifyReplay(await db.prepare("SELECT * FROM payments WHERE id = ?1").bind(id).first<DbPayment>(), (row) => row.input_json === canonical(b));
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different payment" }, 409);
  if (replay.kind === "replay") return c.json<PaymentSaveResponse>({ payment: toResponse(replay.row, await allocationsOf(db, id), await refundedOf(db, id)), warnings: [] });

  const planned = await plan(db, b);
  if (!planned.ok) return c.json(planned.body, planned.status);
  const pl = planned.plan;

  const allocated = pl.allocations.reduce((s, a) => s + a.amountPaise, 0);
  // Spec 016 R3: opening advances from old booklets are not new receipts, so they get no PAY- number.
  const numbered = pl.kind !== "at_sale" && pl.kind !== "opening_advance";
  const reference = b.purpose === "opening_advance" ? (b.oldReference ?? b.reference ?? null) : b.reference;
  const fy = numbered ? financialYearOf(b.date) : "";
  const previous = pl.customerId && pl.kind !== "at_sale" ? await advanceHeld(db, pl.customerId) : 0;
  const thisRemaining = b.amountPaise - allocated;
  const advanceSummary =
    pl.kind === "at_sale" ? null : { previousRemainingPaise: previous, thisRemainingPaise: thisRemaining, totalAvailablePaise: previous + thisRemaining };

  const settings = await settingsSnapshot(db);
  const warnings: PaymentWarning[] = [];
  if (b.mode === "cash" && b.amountPaise >= settings.limits.cashWarningPaise) {
    warnings.push({ code: "cash_limit", limitPaise: settings.limits.cashWarningPaise });
  }

  const now = new Date().toISOString();
  const statements = [];
  if (numbered) {
    statements.push(
      db.prepare(`INSERT INTO number_series (series, fy, last_no) VALUES ('PAY', ?1, 1) ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`).bind(fy),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO payments (id, created_at, created_by, updated_at, updated_by, kind, receipt_no, fy, serial, receipt_date, customer_id,
           payer_name, payer_mobile, payer_pan, payer_address, mode, reference, amount_paise, remarks, input_json, advance_summary_json, header_json, order_id)
         VALUES (?1, ?2, ?3, ?2, ?3, ?4,
           ${numbered ? `'PAY-' || printf('%04d', (SELECT last_no FROM number_series WHERE series = 'PAY' AND fy = ?5))` : "NULL"},
           ?5, ${numbered ? `(SELECT last_no FROM number_series WHERE series = 'PAY' AND fy = ?5)` : "NULL"},
           ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
      )
      .bind(
        id, now, user.id, pl.kind, fy, b.date, pl.customerId, pl.payer.name, pl.payer.mobile, pl.payer.pan, pl.payer.address,
        b.mode, reference, b.amountPaise, b.remarks, canonical(b), advanceSummary ? JSON.stringify(advanceSummary) : null,
        JSON.stringify({ business: settings.business, bank: settings.bank, texts: settings.texts, numbering: settings.numbering, print: settings.print, logo: settings.logo }),
        pl.orderId,
      ),
  );
  for (const a of pl.allocations) {
    statements.push(
      db
        .prepare(`INSERT INTO payment_allocations (id, payment_id, invoice_id, opening_balance_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)`)
        .bind(newId(), id, a.invoiceId, a.amountPaise, now, user.id),
    );
  }
  statements.push(
    auditStatement(db, {
      actor: user.id,
      action: "payment_create",
      entity: "payment",
      entityId: id,
      detail: { kind: pl.kind, mode: b.mode, amountPaise: b.amountPaise, allocated: pl.allocations.length },
    }),
  );

  try {
    await db.batch(statements);
  } catch (e) {
    if (isUniqueError(e)) {
      const again = classifyReplay(await db.prepare("SELECT * FROM payments WHERE id = ?1").bind(id).first<DbPayment>(), (row) => row.input_json === canonical(b));
      if (again.kind === "replay") return c.json<PaymentSaveResponse>({ payment: toResponse(again.row, await allocationsOf(db, id), await refundedOf(db, id)), warnings: [] });
      return c.json({ error: "id_conflict", message: "This id is already used by a different payment" }, 409);
    }
    const g = guardCode(e);
    if (g) return c.json({ error: g, message: g === "exceeds_due" ? "An invoice would be paid more than it owes. Check the amounts." : "The amounts allocated are more than the payment." }, 409);
    throw e;
  }
  const saved = await loadPayment(db, id);
  return c.json<PaymentSaveResponse>({ payment: toResponse(saved!.row, saved!.allocs, saved!.refunded), warnings }, 201);
});

// ---- search (R9) ----
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

paymentRoutes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const customerId = c.req.query("customerId");
  const mode = c.req.query("mode");
  const kind = c.req.query("kind");
  const status = c.req.query("status");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  if ((from && !isDate(from)) || (to && !isDate(to))) return c.json({ error: "invalid_date" }, 400);

  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `?${args.length}`);
  if (q) {
    where.push(`(p.receipt_no LIKE ${add(`%${escapeLike(q.toUpperCase())}%`)} ESCAPE '\\' OR p.payer_name LIKE ${add(`%${escapeLike(nameSearchKey(q))}%`)} ESCAPE '\\' OR p.reference LIKE ${add(`%${escapeLike(q)}%`)} ESCAPE '\\')`);
  }
  if (customerId) where.push(`p.customer_id = ${add(customerId)}`);
  if (mode) where.push(`p.mode = ${add(mode)}`);
  if (kind) where.push(`p.kind = ${add(kind)}`);
  if (status === "active") where.push("p.voided_at IS NULL");
  if (status === "voided") where.push("p.voided_at IS NOT NULL");
  if (from) where.push(`p.receipt_date >= ${add(from)}`);
  if (to) where.push(`p.receipt_date <= ${add(to)}`);

  const rows = (
    await c.env.DB.prepare(
      `SELECT p.*, CASE WHEN p.voided_at IS NULL THEN p.amount_paise - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0) - COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id = p.id AND r.reversed_at IS NULL), 0) ELSE 0 END AS remaining_paise
       FROM payments p ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY p.receipt_date DESC, p.created_at DESC, p.id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    )
      .bind(...args)
      .all<DbPayment & { remaining_paise: number }>()
  ).results;
  const body: PaymentListResponse = {
    items: rows.slice(0, PAGE_SIZE).map<PaymentSummary>((r) => ({
      id: r.id,
      kind: r.kind,
      receiptNo: r.receipt_no,
      receiptDate: r.receipt_date,
      payerName: r.payer_name,
      mode: r.mode,
      amountPaise: r.amount_paise,
      remainingPaise: r.remaining_paise,
      voided: r.voided_at !== null,
    })),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
  return c.json(body);
});

paymentRoutes.get("/:id", async (c) => {
  const found = await loadPayment(c.env.DB, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  return c.json(toResponse(found.row, found.allocs, found.refunded));
});

/** Remarks are the only thing that can change on a payment (R11). */
paymentRoutes.patch("/:id", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = paymentRemarksSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const found = await loadPayment(db, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  const next = parsed.data.remarks || null;
  if (next === found.row.remarks) return c.json(toResponse(found.row, found.allocs, found.refunded));
  await db.batch([
    revisionStatement(db, { entity: "payment", entityId: found.row.id, snapshot: found.row, reason: "remarks changed", actor: user.id }),
    db.prepare("UPDATE payments SET remarks = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1").bind(found.row.id, next, new Date().toISOString(), user.id),
    auditStatement(db, { actor: user.id, action: "payment_remarks", entity: "payment", entityId: found.row.id }),
  ]);
  const saved = await loadPayment(db, found.row.id);
  return c.json(toResponse(saved!.row, saved!.allocs, saved!.refunded));
});

/** Spec 015 R8, M7: voiding reverses the allocations in the same batch. Old gold receipts are voided with their receipt. */
paymentRoutes.post("/:id/void", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = voidPaymentSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const found = await loadPayment(db, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  if (found.row.voided_at) return c.json({ error: "already_voided", message: "This payment is already voided" }, 409);
  if ((await refundedOf(db, found.row.id)) > 0) {
    return c.json({ error: "has_refunds", message: "This payment has refunds. Reverse the refunds first." }, 409);
  }
  if (found.row.kind === "old_gold") {
    return c.json({ error: "old_gold_payment", message: "This payment came from an old gold receipt. Void the old gold receipt instead." }, 409);
  }
  const now = new Date().toISOString();
  const live = found.allocs.filter((a) => !a.reversed_at);
  const statements = [
    db.prepare("UPDATE payments SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1").bind(found.row.id, now, user.id, parsed.data.reason),
    ...live.map((a) => db.prepare("UPDATE payment_allocations SET reversed_at = ?2, reversed_by = ?3, reverse_reason = ?4 WHERE id = ?1").bind(a.id, now, user.id, `payment ${found.row.receipt_no ?? found.row.id} voided`)),
    auditStatement(db, { actor: user.id, action: "payment_void", entity: "payment", entityId: found.row.id, detail: { reason: parsed.data.reason, reversedAllocations: live.length } }),
  ];
  await db.batch(statements);
  const saved = await loadPayment(db, found.row.id);
  return c.json(toResponse(saved!.row, saved!.allocs, saved!.refunded));
});

/** Spec 016 R8: pay money back from an advance. Refunds are never deleted; they are reversed. */
paymentRoutes.post("/:id/refunds", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = refundRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;
  const found = await loadPayment(db, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  if (found.row.voided_at) return c.json({ error: "payment_voided", message: "This payment is voided" }, 409);
  const remaining = found.row.amount_paise - allocatedNow(found.allocs) - found.refunded;
  if (b.amountPaise > remaining) return c.json({ error: "exceeds_remaining", message: `Only ₹${(remaining / 100).toFixed(2)} is left on this payment`, remainingPaise: remaining }, 400);
  if (b.date > indiaDate(c.get("now"))) return c.json({ error: "future_date", message: "A refund cannot be dated in the future" }, 400);
  const id = b.id ?? newId();
  const existing = await db.prepare("SELECT payment_id, amount_paise FROM payment_refunds WHERE id = ?1").bind(id).first<{ payment_id: string; amount_paise: number }>();
  if (existing) {
    if (existing.payment_id === found.row.id && existing.amount_paise === b.amountPaise) return c.json(toResponse(found.row, found.allocs, found.refunded));
    return c.json({ error: "id_conflict", message: "This id is already used by a different refund" }, 409);
  }
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO payment_refunds (id, payment_id, amount_paise, mode, reference, refund_date, remarks, created_at, created_by, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?8, ?9)`)
        .bind(id, found.row.id, b.amountPaise, b.mode, b.reference ?? null, b.date, b.remarks ?? null, new Date().toISOString(), user.id),
      auditStatement(db, { actor: user.id, action: "payment_refund", entity: "payment", entityId: found.row.id, detail: { amountPaise: b.amountPaise, mode: b.mode } }),
    ]);
  } catch (e) {
    if (guardCode(e) || guardCodeRefund(e)) return c.json({ error: "exceeds_remaining", message: "A refund is more than this payment still holds." }, 409);
    throw e;
  }
  const saved = await loadPayment(db, found.row.id);
  return c.json(toResponse(saved!.row, saved!.allocs, saved!.refunded), 201);
});

/** Spec 015 R7: one allocation is undone; the money goes back to the payment's remaining. */
allocationRoutes.post("/:id/reverse", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = reverseAllocationSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const alloc = await db.prepare("SELECT id, payment_id, reversed_at FROM payment_allocations WHERE id = ?1").bind(c.req.param("id")).first<{ id: string; payment_id: string; reversed_at: string | null }>();
  if (!alloc) return c.json({ error: "not_found" }, 404);
  if (alloc.reversed_at) return c.json({ error: "already_reversed", message: "This allocation is already reversed" }, 409);
  const payment = await db.prepare("SELECT voided_at FROM payments WHERE id = ?1").bind(alloc.payment_id).first<{ voided_at: string | null }>();
  if (payment?.voided_at) return c.json({ error: "payment_voided", message: "This payment is voided" }, 409);
  await db.batch([
    db.prepare("UPDATE payment_allocations SET reversed_at = ?2, reversed_by = ?3, reverse_reason = ?4 WHERE id = ?1").bind(alloc.id, new Date().toISOString(), user.id, parsed.data.reason),
    auditStatement(db, { actor: user.id, action: "allocation_reverse", entity: "payment", entityId: alloc.payment_id, detail: { allocation: alloc.id, reason: parsed.data.reason } }),
  ]);
  const saved = await loadPayment(db, alloc.payment_id);
  return c.json(toResponse(saved!.row, saved!.allocs, saved!.refunded));
});
