import { Hono } from "hono";
import { financialYearOf } from "@jewellery/calc";
import {
  cancelOrderSchema,
  createOrderSchema,
  indiaDate,
  newId,
  nameSearchKey,
  refundRequestSchema,
  reverseRefundSchema,
  type CustomerAdvanceRow,
  type OrderListResponse,
  type OrderResponse,
  type OrderStatus,
  type RefundMode,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { classifyReplay } from "../db/idempotency";
import { printedNumberSql, printedNumberValues } from "../db/numbering";
import { readJson, validationBody } from "../http";
import { refundedOf } from "../payments/routes";
import { settingsSnapshot } from "../settings/routes";

export const orderRoutes = new Hono<AppEnv>();
export const refundRoutes = new Hono<AppEnv>();
const PAGE_SIZE = 20;

type DbOrder = {
  id: string;
  created_at: string;
  created_by: string;
  order_no: string;
  customer_id: string;
  description: string;
  expected_date: string | null;
  status: OrderStatus;
  remarks: string | null;
  cancel_resolution: string | null;
};

type AdvanceRow = {
  id: string;
  receipt_no: string | null;
  receipt_date: string;
  kind: string;
  amount_paise: number;
  remaining_paise: number;
  voided_at: string | null;
  order_no: string | null;
  customer_id: string | null;
};

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
const guardCode = (e: unknown) => (e instanceof Error && /exceeds_payment/.test(e.message) ? "exceeds_payment" : null);

/** Remaining money of each payment, from live allocations and refunds (spec 015 M2, spec 016 R8). */
const REMAINING_SQL = `p.amount_paise - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0) - COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id = p.id AND r.reversed_at IS NULL), 0)`;

async function advancesOfOrder(db: D1Database, orderId: string): Promise<AdvanceRow[]> {
  return (
    await db
      .prepare(
        `SELECT p.id, p.receipt_no, p.receipt_date, p.kind, p.amount_paise, ${REMAINING_SQL} AS remaining_paise, p.voided_at, NULL AS order_no, p.customer_id
         FROM payments p WHERE p.order_id = ?1 ORDER BY p.receipt_date, p.created_at, p.id`,
      )
      .bind(orderId)
      .all<AdvanceRow>()
  ).results;
}

async function orderView(db: D1Database, o: DbOrder): Promise<OrderResponse> {
  const cust = await db.prepare("SELECT name FROM customers WHERE id = ?1").bind(o.customer_id).first<{ name: string }>();
  const advances = await advancesOfOrder(db, o.id);
  const refunds = (
    await db
      .prepare(
        `SELECT r.id, r.payment_id, p.receipt_no, r.amount_paise, r.mode, r.refund_date, r.reversed_at
         FROM payment_refunds r JOIN payments p ON p.id = r.payment_id WHERE p.order_id = ?1 ORDER BY r.created_at, r.id`,
      )
      .bind(o.id)
      .all<{ id: string; payment_id: string; receipt_no: string | null; amount_paise: number; mode: RefundMode; refund_date: string; reversed_at: string | null }>()
  ).results;
  const history = (
    await db
      .prepare(
        `SELECT at, actor, action FROM audit_log
         WHERE (entity = 'order' AND entity_id = ?1)
            OR (entity = 'payment' AND entity_id IN (SELECT id FROM payments WHERE order_id = ?1))
         ORDER BY at, id`,
      )
      .bind(o.id)
      .all<{ at: string; actor: string; action: string }>()
  ).results;
  return {
    id: o.id,
    orderNo: o.order_no,
    customerId: o.customer_id,
    customerName: cust?.name ?? "",
    description: o.description,
    expectedDate: o.expected_date,
    status: o.status,
    remarks: o.remarks,
    cancelResolution: o.cancel_resolution,
    createdAt: o.created_at,
    createdBy: o.created_by,
    remainingPaise: advances.filter((a) => !a.voided_at).reduce((s, a) => s + Math.max(0, a.remaining_paise), 0),
    advances: advances.map((a) => ({ id: a.id, receiptNo: a.receipt_no, receiptDate: a.receipt_date, amountPaise: a.amount_paise, remainingPaise: a.voided_at ? 0 : a.remaining_paise, kind: a.kind })),
    refunds: refunds.map((r) => ({ id: r.id, paymentId: r.payment_id, receiptNo: r.receipt_no, amountPaise: r.amount_paise, mode: r.mode, refundDate: r.refund_date, reversed: r.reversed_at !== null })),
    history: history.map((h) => ({ at: h.at, by: h.actor, action: h.action.replace(/_/g, " ") })),
  };
}

async function loadOrder(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first<DbOrder>();
}

// ---- create and list (R1) ----
orderRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = createOrderSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;
  const id = b.id ?? newId();
  const canonical = JSON.stringify({ customerId: b.customerId, description: b.description ?? "", expectedDate: b.expectedDate ?? null, remarks: b.remarks ?? null });
  const existing = await loadOrder(db, id);
  const replay = classifyReplay(existing, (row) => JSON.stringify({ customerId: row.customer_id, description: row.description, expectedDate: row.expected_date, remarks: row.remarks }) === canonical);
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different order" }, 409);
  if (replay.kind === "replay") return c.json(await orderView(db, replay.row), 200);

  const cust = await db.prepare("SELECT id, name, voided_at FROM customers WHERE id = ?1").bind(b.customerId).first<{ id: string; name: string; voided_at: string | null }>();
  if (!cust) return c.json({ error: "customer_not_found", message: "That customer does not exist" }, 400);
  if (cust.voided_at) return c.json({ error: "customer_voided", message: "That customer is voided" }, 409);

  const today = indiaDate(c.get("now"));
  const fy = financialYearOf(today);
  const now = new Date().toISOString();
  const settings = await settingsSnapshot(db);
  try {
    await db.batch([
      db.prepare(`INSERT INTO number_series (series, fy, last_no) VALUES ('ORD', ?1, 1) ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`).bind(fy),
      db
        .prepare(
          `INSERT INTO orders (id, created_at, created_by, updated_at, updated_by, order_no, fy, serial, customer_id, description, expected_date, status, remarks, header_json)
           VALUES (?1, ?2, ?3, ?2, ?3, ${printedNumberSql("(SELECT last_no FROM number_series WHERE series = 'ORD' AND fy = ?4)", ["?10", "?11", "?12"])}, ?4,
                   (SELECT last_no FROM number_series WHERE series = 'ORD' AND fy = ?4), ?5, ?6, ?7, 'open', ?8, ?9)`,
        )
        .bind(id, now, user.id, fy, b.customerId, b.description ?? "", b.expectedDate ?? null, b.remarks ?? null, JSON.stringify({ business: settings.business, bank: settings.bank, texts: settings.texts, numbering: settings.numbering, print: settings.print, logo: settings.logo }), ...printedNumberValues(settings.numbering, "ORD", fy)),
      auditStatement(db, { actor: user.id, action: "order_create", entity: "order", entityId: id, detail: { customerId: b.customerId } }),
    ]);
  } catch (e) {
    if (isUniqueError(e)) {
      const again = await loadOrder(db, id);
      if (again) return c.json(await orderView(db, again), 200);
    }
    throw e;
  }
  return c.json(await orderView(db, (await loadOrder(db, id))!), 201);
});

orderRoutes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const status = c.req.query("status");
  const customerId = c.req.query("customerId");
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `?${args.length}`);
  if (q) where.push(`(o.order_no LIKE ${add(`%${q.toUpperCase().replace(/[\\%_]/g, "\\$&")}%`)} ESCAPE '\\' OR cu.name_search LIKE ${add(`%${nameSearchKey(q).replace(/[\\%_]/g, "\\$&")}%`)} ESCAPE '\\')`);
  if (customerId) where.push(`o.customer_id = ${add(customerId)}`);
  if (status) where.push(`o.status = ${add(status)}`);
  const rows = (
    await c.env.DB.prepare(
      `SELECT o.id, o.order_no, cu.name AS customer_name, o.description, o.status, o.created_at,
              COALESCE((SELECT SUM(${REMAINING_SQL}) FROM payments p WHERE p.order_id = o.id AND p.voided_at IS NULL), 0) AS remaining_paise
       FROM orders o JOIN customers cu ON cu.id = o.customer_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY o.created_at DESC, o.id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    )
      .bind(...args)
      .all<{ id: string; order_no: string; customer_name: string; description: string; status: OrderStatus; created_at: string; remaining_paise: number }>()
  ).results;
  const body: OrderListResponse = {
    items: rows.slice(0, PAGE_SIZE).map((r) => ({ id: r.id, orderNo: r.order_no, customerName: r.customer_name, description: r.description, status: r.status, remainingPaise: r.remaining_paise, createdAt: r.created_at })),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
  return c.json(body);
});

orderRoutes.get("/:id", async (c) => {
  const o = await loadOrder(c.env.DB, c.req.param("id"));
  if (!o) return c.json({ error: "not_found" }, 404);
  return c.json(await orderView(c.env.DB, o));
});

/** Spec 016 R6: closing keeps every advance where it is. */
orderRoutes.post("/:id/close", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const o = await loadOrder(db, c.req.param("id"));
  if (!o) return c.json({ error: "not_found" }, 404);
  if (o.status !== "open") return c.json({ error: "order_not_open", message: "Only an open order can be closed" }, 409);
  await db.batch([
    db.prepare("UPDATE orders SET status = 'closed', closed_at = ?2, updated_at = ?2, updated_by = ?3 WHERE id = ?1").bind(o.id, new Date().toISOString(), user.id),
    auditStatement(db, { actor: user.id, action: "order_close", entity: "order", entityId: o.id }),
  ]);
  return c.json(await orderView(db, (await loadOrder(db, o.id))!));
});

/**
 * Spec 016 R7: cancel an order. `transfer` keeps the money as customer advance. `refund` pays it back,
 * oldest advance first, as refund rows; anything not refunded stays as advance.
 */
orderRoutes.post("/:id/cancel", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = cancelOrderSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;
  const o = await loadOrder(db, c.req.param("id"));
  if (!o) return c.json({ error: "not_found" }, 404);
  if (o.status === "cancelled") return c.json({ error: "already_cancelled", message: "This order is already cancelled" }, 409);

  const now = new Date().toISOString();
  const statements = [];
  if (b.resolution === "refund") {
    const advances = (await advancesOfOrder(db, o.id)).filter((a) => !a.voided_at && a.remaining_paise > 0);
    const total = advances.reduce((s, a) => s + a.remaining_paise, 0);
    if (total === 0) return c.json({ error: "nothing_to_refund", message: "No advance is left on this order" }, 400);
    const amount = b.refundAmountPaise ?? total;
    if (amount > total) return c.json({ error: "exceeds_remaining", message: "The refund is more than the advance left on this order", remainingPaise: total }, 400);
    const date = b.refundDate ?? indiaDate(c.get("now"));
    if (date > indiaDate(c.get("now"))) return c.json({ error: "future_date", message: "A refund cannot be dated in the future" }, 400);
    let left = amount;
    for (const a of advances) {
      if (left <= 0) break;
      const take = Math.min(left, a.remaining_paise);
      statements.push(
        db
          .prepare(`INSERT INTO payment_refunds (id, payment_id, amount_paise, mode, reference, refund_date, remarks, created_at, created_by, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?8, ?9)`)
          .bind(newId(), a.id, take, b.refundMode!, b.refundReference ?? null, date, b.remarks ?? null, now, user.id),
      );
      left -= take;
    }
    statements.push(auditStatement(db, { actor: user.id, action: "order_refund", entity: "order", entityId: o.id, detail: { amountPaise: amount, mode: b.refundMode } }));
  }
  statements.push(
    db.prepare("UPDATE orders SET status = 'cancelled', cancel_resolution = ?2, cancelled_at = ?3, updated_at = ?3, updated_by = ?4 WHERE id = ?1").bind(o.id, b.resolution, now, user.id),
    auditStatement(db, { actor: user.id, action: "order_cancel", entity: "order", entityId: o.id, detail: { resolution: b.resolution } }),
  );
  try {
    await db.batch(statements);
  } catch (e) {
    if (guardCode(e)) return c.json({ error: "exceeds_remaining", message: "A refund is more than an advance still holds." }, 409);
    throw e;
  }
  return c.json(await orderView(db, (await loadOrder(db, o.id))!));
});

// ---- refunds (R8) ----

refundRoutes.post("/:id/reverse", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = reverseRefundSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const r = await db.prepare("SELECT r.id, r.payment_id, r.reversed_at, p.voided_at FROM payment_refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = ?1").bind(c.req.param("id")).first<{ id: string; payment_id: string; reversed_at: string | null; voided_at: string | null }>();
  if (!r) return c.json({ error: "not_found" }, 404);
  if (r.reversed_at) return c.json({ error: "already_reversed", message: "This refund is already reversed" }, 409);
  if (r.voided_at) return c.json({ error: "payment_voided", message: "The payment is voided" }, 409);
  await db.batch([
    db.prepare("UPDATE payment_refunds SET reversed_at = ?2, reversed_by = ?3, reverse_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1").bind(r.id, new Date().toISOString(), user.id, parsed.data.reason),
    auditStatement(db, { actor: user.id, action: "refund_reverse", entity: "payment", entityId: r.payment_id, detail: { refund: r.id, reason: parsed.data.reason } }),
  ]);
  return c.json({ ok: true, refundedPaise: await refundedOf(db, r.payment_id) });
});


/** Spec 016 R10: the advances a customer still has, with their order and remaining money. */
export async function customerAdvances(db: D1Database, customerId: string): Promise<CustomerAdvanceRow[]> {
  return (
    await db
      .prepare(
        `SELECT p.id, p.receipt_no, p.receipt_date, p.kind, p.amount_paise, ${REMAINING_SQL} AS remaining_paise, p.voided_at, o.order_no, p.customer_id
         FROM payments p LEFT JOIN orders o ON o.id = p.order_id
         WHERE p.customer_id = ?1 AND p.voided_at IS NULL ORDER BY p.receipt_date, p.created_at, p.id`,
      )
      .bind(customerId)
      .all<AdvanceRow>()
  ).results
    .filter((r) => r.remaining_paise > 0)
    .map((r) => ({ paymentId: r.id, receiptNo: r.receipt_no, orderNo: r.order_no, receiptDate: r.receipt_date, kind: r.kind, amountPaise: r.amount_paise, remainingPaise: r.remaining_paise }));
}
