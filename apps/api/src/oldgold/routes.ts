import { Hono } from "hono";
import { financialYearOf, calculateOldGold } from "@jewellery/calc";
import {
  OLD_GOLD_STATUS,
  OLD_GOLD_TREATMENT_LABEL,
  indiaDate,
  newId,
  nameSearchKey,
  oldGoldRequestSchema,
  voidOldGoldSchema,
  type OldGoldListResponse,
  type OldGoldRequest,
  type OldGoldResponse,
  type OldGoldRowResponse,
  type OldGoldSummary,
  type OldGoldTreatment,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { classifyReplay } from "../db/idempotency";
import { printedNumberSql, printedNumberValues } from "../db/numbering";
import { readJson, validationBody } from "../http";
import { advanceHeld, refundedOf } from "../payments/routes";
import { settingsSnapshot } from "../settings/routes";
import { settledOn } from "../creditNotes/money";

export const oldGoldRoutes = new Hono<AppEnv>();
const PAGE_SIZE = 20;

type DbReceipt = {
  header_json: string | null;
  id: string;
  created_at: string;
  created_by: string;
  receipt_no: string;
  receipt_date: string;
  customer_id: string;
  payer_name: string;
  payer_mobile: string | null;
  payer_pan: string | null;
  payer_address: string | null;
  treatment: OldGoldTreatment;
  invoice_id: string | null;
  order_id: string | null;
  direct_paise: number;
  advance_paise: number;
  invoice_adjust_paise: number;
  original_paise: number;
  round_off_paise: number;
  final_paise: number;
  settlement_note: string;
  input_json: string;
  payment_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
const guardCode = (e: unknown) => (e instanceof Error && /exceeds_due|exceeds_payment/.exec(e.message)?.[0]) || null;

/** Spec 018 R5, R7: how the money is split, and the note that prints on the receipt. */
export function partsFor(req: OldGoldRequest, final: number): { ok: true; direct: number; advance: number; inv: number } | { ok: false; message: string } {
  if (req.treatment === "direct_payment") return { ok: true, direct: final, advance: 0, inv: 0 };
  if (req.treatment === "advance") return { ok: true, direct: 0, advance: final, inv: 0 };
  if (req.treatment === "invoice_adjustment") return { ok: true, direct: 0, advance: 0, inv: final };
  const sum = req.directPaise + req.advancePaise + req.invoiceAdjustPaise;
  if (sum !== final) {
    const diff = final - sum;
    return { ok: false, message: `The three parts must add up to ₹${(final / 100).toFixed(2)}. They are ₹${Math.abs(diff / 100).toFixed(2)} ${diff > 0 ? "short" : "over"}.` };
  }
  return { ok: true, direct: req.directPaise, advance: req.advancePaise, inv: req.invoiceAdjustPaise };
}

/** Spec 018 R7: the note printed on the receipt, from the settlement that was chosen. */
function settlementNote(treatment: OldGoldTreatment): string {
  if (treatment === "direct_payment") return "Old gold purchased from the customer. The value is paid to the customer directly.";
  if (treatment === "advance") return "Old gold purchased from the customer. The receipt value is recorded as customer advance and linked to the Order ID shown above.";
  if (treatment === "invoice_adjustment") return "Old gold purchased from the customer. The value is adjusted against the invoice shown on the settlement page.";
  return "Old gold purchased from the customer. The value is split between direct payment, customer advance and an invoice adjustment.";
}

async function viewOf(db: D1Database, r: DbReceipt): Promise<OldGoldResponse> {
  const lines = (
    await db.prepare("SELECT * FROM old_gold_lines WHERE ogp_id = ?1 ORDER BY line_no").bind(r.id).all<{ line_no: number; description: string; gross_mg: number; less_mg: number; net_mg: number; karat: string; purity_bps: number; rate_paise_per_kg: number; amount_paise: number }>()
  ).results;
  const payouts = (await db.prepare("SELECT id, mode, reference, amount_paise, paid_date, voided_at FROM old_gold_payouts WHERE ogp_id = ?1 ORDER BY created_at").bind(r.id).all<{ id: string; mode: string; reference: string | null; amount_paise: number; paid_date: string; voided_at: string | null }>()).results;
  let payment: OldGoldResponse["payment"] = null;
  if (r.payment_id) {
    const p = await db
      .prepare(
        `SELECT p.id, p.receipt_no, p.amount_paise - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0) - COALESCE((SELECT SUM(x.amount_paise) FROM payment_refunds x WHERE x.payment_id = p.id AND x.reversed_at IS NULL), 0) AS remaining
         FROM payments p WHERE p.id = ?1`,
      )
      .bind(r.payment_id)
      .first<{ id: string; receipt_no: string | null; remaining: number }>();
    if (p) payment = { id: p.id, receiptNo: p.receipt_no, remainingPaise: r.voided_at ? 0 : p.remaining };
  }
  const method: OldGoldResponse["settlementMethod"] = r.advance_paise + r.invoice_adjust_paise > 0 ? "Ledger Adjustment" : "Direct Payment";
  return {
    id: r.id,
    receiptNo: r.receipt_no,
    receiptDate: r.receipt_date,
    customerId: r.customer_id,
    payer: { name: r.payer_name, mobile: r.payer_mobile, pan: r.payer_pan, address: r.payer_address },
    treatment: r.treatment,
    treatmentLabel: OLD_GOLD_TREATMENT_LABEL[r.treatment],
    status: OLD_GOLD_STATUS[r.treatment],
    settlementMethod: method,
    settlementNote: r.settlement_note || settlementNote(r.treatment),
    invoiceId: r.invoice_id,
    orderId: r.order_id,
    rows: lines.map<OldGoldRowResponse>((l) => ({ lineNo: l.line_no, description: l.description, grossMg: l.gross_mg, lessMg: l.less_mg, netMg: l.net_mg, karat: l.karat, purityBps: l.purity_bps, rateKgPaise: l.rate_paise_per_kg, amountPaise: l.amount_paise })),
    originalPaise: r.original_paise,
    roundOffPaise: r.round_off_paise,
    finalPaise: r.final_paise,
    parts: { directPaise: r.direct_paise, advancePaise: r.advance_paise, invoiceAdjustPaise: r.invoice_adjust_paise },
    payment,
    payouts: payouts.map((p) => ({ id: p.id, mode: p.mode, reference: p.reference, amountPaise: p.amount_paise, paidDate: p.paid_date, voided: p.voided_at !== null })),
    voided: r.voided_at !== null,
    voidReason: r.void_reason,
    createdAt: r.created_at,
    createdBy: r.created_by,
    header: r.header_json ? (JSON.parse(r.header_json) as Record<string, unknown>) : null,
  };
}

async function loadReceipt(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM old_gold_purchases WHERE id = ?1").bind(id).first<DbReceipt>();
}

/** Canonical form of a request, for the safe-retry check (same id and content gives the same receipt). */
const canonical = (b: OldGoldRequest) => JSON.stringify({ ...b, id: undefined });

oldGoldRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = oldGoldRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;
  if (b.date > indiaDate(c.get("now"))) return c.json({ error: "future_date", message: "A receipt cannot be dated in the future" }, 400);

  const id = b.id ?? newId();
  const replay = classifyReplay(await loadReceipt(db, id), (row) => row.input_json === canonical(b));
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different receipt" }, 409);
  if (replay.kind === "replay") return c.json(await viewOf(db, replay.row), 200);

  // Rows: net weight and the calculation (spec 018 R2 to R4)
  const rowErrors: { field: string; message: string }[] = [];
  b.rows.forEach((r, i) => {
    if (r.lessMg >= r.grossMg) rowErrors.push({ field: `rows.${i + 1}.lessMg`, message: `Row ${i + 1}: less cannot be the same as or more than gross` });
  });
  if (rowErrors.length) return c.json({ error: "validation", issues: rowErrors }, 400);
  const calc = calculateOldGold(b.rows.map((r) => ({ netMg: r.grossMg - r.lessMg, purityBps: r.purityBps, rateKgPaise: r.rateKgPaise })));
  if (!calc.ok) return c.json({ error: "validation", issues: [{ field: "rows", message: calc.error }] }, 400);
  const final = calc.result.finalPaise;

  const parts = partsFor(b, final);
  if (!parts.ok) return c.json({ error: "parts_mismatch", message: parts.message, finalPaise: final }, 400);
  const { direct, advance, inv } = parts;
  if (direct > 0 && !b.payoutMode) return c.json({ error: "validation", issues: [{ field: "payoutMode", message: "Choose how the money is paid to the customer" }] }, 400);
  if (inv > 0 && !b.invoiceId) return c.json({ error: "validation", issues: [{ field: "invoiceId", message: "Choose the invoice the old gold is used on" }] }, 400);

  const cust = await db.prepare("SELECT id, name, mobile, pan, address, voided_at FROM customers WHERE id = ?1").bind(b.customerId).first<{ id: string; name: string; mobile: string | null; pan: string | null; address: string | null; voided_at: string | null }>();
  if (!cust) return c.json({ error: "customer_not_found", message: "That customer does not exist" }, 400);
  if (cust.voided_at) return c.json({ error: "customer_voided", message: "That customer is voided" }, 409);

  if (inv > 0) {
    const iv = await db.prepare("SELECT invoice_no, customer_id, payable_paise, voided_at FROM invoices WHERE id = ?1").bind(b.invoiceId).first<{ invoice_no: string; customer_id: string | null; payable_paise: number; voided_at: string | null }>();
    if (!iv) return c.json({ error: "invoice_not_found", message: "That invoice does not exist" }, 400);
    if (iv.voided_at) return c.json({ error: "invoice_voided", message: "That invoice is voided" }, 409);
    if (iv.customer_id !== cust.id) return c.json({ error: "customer_mismatch", message: "That invoice belongs to another customer" }, 400);
    // Spec 019d R16: credit applications also settle the bill.
    const due = iv.payable_paise - (await settledOn(db, b.invoiceId!));
    if (inv > due) return c.json({ error: "exceeds_due", message: `${iv.invoice_no} only owes ₹${(due / 100).toFixed(2)}`, dueAmountPaise: due }, 409);
  }
  if (advance > 0 && b.orderId) {
    const order = await db.prepare("SELECT customer_id, status FROM orders WHERE id = ?1").bind(b.orderId).first<{ customer_id: string; status: string }>();
    if (!order) return c.json({ error: "order_not_found", message: "That order does not exist" }, 400);
    if (order.customer_id !== cust.id) return c.json({ error: "order_customer_mismatch", message: "That order belongs to another customer" }, 400);
    if (order.status !== "open") return c.json({ error: "order_not_open", message: "That order is closed or cancelled" }, 409);
  }

  const settings = await settingsSnapshot(db);
  const fy = financialYearOf(b.date);
  const previous = advance + inv > 0 ? await advanceHeld(db, cust.id) : 0;
  const paymentId = advance + inv > 0 ? newId() : null;
  const now = new Date().toISOString();
  const statements = [];
  const note = settlementNote(b.treatment);

  // Receipt columns and values are built from one list, so the placeholders always match.
  const receiptCols: [string, unknown][] = [
    ["id", id], ["created_at", now], ["created_by", user.id], ["updated_at", now], ["updated_by", user.id],
    ["fy", fy], ["receipt_date", b.date], ["customer_id", cust.id], ["payer_name", cust.name], ["payer_mobile", cust.mobile],
    ["payer_pan", cust.pan], ["payer_address", cust.address], ["treatment", b.treatment],
    ["invoice_id", inv > 0 ? b.invoiceId : null], ["order_id", advance > 0 ? b.orderId ?? null : null],
    ["direct_paise", direct], ["advance_paise", advance], ["invoice_adjust_paise", inv],
    ["original_paise", calc.result.originalPaise], ["round_off_paise", calc.result.roundOffPaise], ["final_paise", final],
    ["settlement_note", note], ["remarks", b.remarks], ["input_json", canonical(b)],
    ["header_json", JSON.stringify({ business: settings.business, bank: settings.bank, texts: settings.texts, numbering: settings.numbering, print: settings.print, logo: settings.logo })],
    ["payment_id", paymentId],
  ];
  // receipt_no is assigned by the database from the counter in the same batch (a failed save never uses a number).
  const receiptValues = receiptCols.map((_, i) => `?${i + 1}`);
  const ogpFormat = printedNumberValues(settings.numbering, "OGP", fy);
  const ogpAt = [1, 2, 3].map((i) => `?${receiptCols.length + i}`) as [string, string, string];
  statements.push(db.prepare(`INSERT INTO number_series (series, fy, last_no) VALUES ('OGP', ?1, 1) ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`).bind(fy));
  if (paymentId) statements.push(db.prepare(`INSERT INTO number_series (series, fy, last_no) VALUES ('PAY', ?1, 1) ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`).bind(fy));
  statements.push(
    db
      .prepare(
        `INSERT INTO old_gold_purchases (${[...receiptCols.map(([c]) => c), "receipt_no", "serial"].join(", ")})
         VALUES (${receiptValues.join(", ")}, ${printedNumberSql("(SELECT last_no FROM number_series WHERE series = 'OGP' AND fy = ?6)", ogpAt)},
                 (SELECT last_no FROM number_series WHERE series = 'OGP' AND fy = ?6))`,
      )
      .bind(...receiptCols.map(([, v]) => v), ...ogpFormat),
  );

  if (paymentId) {
    const payCols: [string, unknown][] = [
      ["id", paymentId], ["created_at", now], ["created_by", user.id], ["updated_at", now], ["updated_by", user.id],
      ["kind", "old_gold"], ["fy", fy], ["receipt_date", b.date], ["customer_id", cust.id], ["payer_name", cust.name],
      ["payer_mobile", cust.mobile], ["payer_pan", cust.pan], ["payer_address", cust.address], ["mode", "old_gold"],
      ["reference", null], ["amount_paise", advance + inv], ["order_id", advance > 0 ? b.orderId ?? null : null],
      ["source_ogp_id", id], ["input_json", "{}"],
      ["advance_summary_json", JSON.stringify({ previousRemainingPaise: previous, thisRemainingPaise: advance, totalAvailablePaise: previous + advance })],
      // Same full bundle as the old gold receipt, so the PAY receipt prints with the same details and copy labels (spec 003 R5).
      ["header_json", JSON.stringify({ business: settings.business, bank: settings.bank, texts: settings.texts, numbering: settings.numbering, print: settings.print, logo: settings.logo })],
    ];
    const payAt = [1, 2, 3].map((i) => `?${payCols.length + i}`) as [string, string, string];
    statements.push(
      db
        .prepare(
          `INSERT INTO payments (${[...payCols.map(([c]) => c), "receipt_no", "serial"].join(", ")})
           VALUES (${payCols.map((_, i) => `?${i + 1}`).join(", ")}, ${printedNumberSql("(SELECT last_no FROM number_series WHERE series = 'PAY' AND fy = ?7)", payAt)},
                   (SELECT last_no FROM number_series WHERE series = 'PAY' AND fy = ?7))`,
        )
        .bind(...payCols.map(([, v]) => v), ...printedNumberValues(settings.numbering, "PAY", fy)),
    );
    if (inv > 0) {
      statements.push(db.prepare("INSERT INTO payment_allocations (id, payment_id, invoice_id, opening_balance_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)").bind(newId(), paymentId, b.invoiceId, inv, now, user.id));
    }
  }
  for (const [i, r] of b.rows.entries()) {
    statements.push(
      db
        .prepare("INSERT INTO old_gold_lines (id, ogp_id, line_no, description, gross_mg, less_mg, net_mg, karat, purity_bps, rate_paise_per_kg, amount_paise) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
        .bind(newId(), id, i + 1, r.description, r.grossMg, r.lessMg, r.grossMg - r.lessMg, r.karat, r.purityBps, r.rateKgPaise, calc.result.rows[i]!.amountPaise),
    );
  }
  if (direct > 0) {
    statements.push(
      db.prepare("INSERT INTO old_gold_payouts (id, ogp_id, mode, reference, amount_paise, paid_date, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(newId(), id, b.payoutMode!, b.payoutReference ?? null, direct, b.date, now, user.id),
    );
  }
  statements.push(auditStatement(db, { actor: user.id, action: "old_gold_create", entity: "old_gold", entityId: id, detail: { treatment: b.treatment, finalPaise: final } }));

  try {
    await db.batch(statements);
  } catch (e) {
    if (isUniqueError(e)) {
      const again = classifyReplay(await loadReceipt(db, id), (row) => row.input_json === canonical(b));
      if (again.kind === "replay") return c.json(await viewOf(db, again.row), 200);
      return c.json({ error: "id_conflict", message: "This id is already used by a different receipt" }, 409);
    }
    const g = guardCode(e);
    if (g) return c.json({ error: g, message: "The amount is more than the invoice still owes. Check the amounts." }, 409);
    throw e;
  }
  return c.json(await viewOf(db, (await loadReceipt(db, id))!), 201);
});

oldGoldRoutes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const customerId = c.req.query("customerId");
  const status = c.req.query("status");
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `?${args.length}`);
  if (q) where.push(`(o.receipt_no LIKE ${add(`%${q.toUpperCase().replace(/[\\%_]/g, "\\$&")}%`)} ESCAPE '\\' OR o.payer_name LIKE ${add(`%${nameSearchKey(q).replace(/[\\%_]/g, "\\$&")}%`)} ESCAPE '\\')`);
  if (customerId) where.push(`o.customer_id = ${add(customerId)}`);
  if (status === "active") where.push("o.voided_at IS NULL");
  if (status === "voided") where.push("o.voided_at IS NOT NULL");
  const rows = (
    await c.env.DB.prepare(`SELECT o.* FROM old_gold_purchases o ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY o.receipt_date DESC, o.created_at DESC, o.id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`)
      .bind(...args)
      .all<DbReceipt>()
  ).results;
  const body: OldGoldListResponse = {
    items: rows.slice(0, PAGE_SIZE).map<OldGoldSummary>((r) => ({ id: r.id, receiptNo: r.receipt_no, receiptDate: r.receipt_date, customerName: r.payer_name, finalPaise: r.final_paise, treatment: r.treatment, voided: r.voided_at !== null })),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
  return c.json(body);
});

oldGoldRoutes.get("/:id", async (c) => {
  const r = await loadReceipt(c.env.DB, c.req.param("id"));
  if (!r) return c.json({ error: "not_found" }, 404);
  return c.json(await viewOf(c.env.DB, r));
});

/** Spec 018 R9: voiding reverses the money the receipt created. Refused if that money was used elsewhere. */
oldGoldRoutes.post("/:id/void", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = voidOldGoldSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const r = await loadReceipt(db, c.req.param("id"));
  if (!r) return c.json({ error: "not_found" }, 404);
  if (r.voided_at) return c.json({ error: "already_voided", message: "This receipt is already voided" }, 409);
  // Spec 019d R9, R14: a receipt that a live credit note links to is voided only after that credit note.
  const linkedNote = await db.prepare("SELECT cn_no FROM credit_notes WHERE ogp_id = ?1 AND voided_at IS NULL").bind(r.id).first<{ cn_no: string }>();
  if (linkedNote) return c.json({ error: "linked_to_credit_note", message: `Credit note ${linkedNote.cn_no} uses this receipt. Void it first.` }, 409);
  const now = new Date().toISOString();
  const statements = [];
  if (r.payment_id) {
    const used = (await db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payment_allocations WHERE payment_id = ?1 AND reversed_at IS NULL").bind(r.payment_id).first<{ n: number }>())?.n ?? 0;
    const refunded = await refundedOf(db, r.payment_id);
    if (refunded > 0 || used > r.invoice_adjust_paise) {
      return c.json({ error: "used_elsewhere", message: "The advance from this receipt has been used or refunded. Reverse that first." }, 409);
    }
    statements.push(db.prepare("UPDATE payments SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1").bind(r.payment_id, now, user.id, `old gold ${r.receipt_no} voided`));
    statements.push(db.prepare("UPDATE payment_allocations SET reversed_at = ?2, reversed_by = ?3, reverse_reason = ?4 WHERE payment_id = ?1 AND reversed_at IS NULL").bind(r.payment_id, now, user.id, `old gold ${r.receipt_no} voided`));
  }
  statements.push(db.prepare("UPDATE old_gold_payouts SET voided_at = ?2, voided_by = ?3 WHERE ogp_id = ?1 AND voided_at IS NULL").bind(r.id, now, user.id));
  statements.push(db.prepare("UPDATE old_gold_purchases SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1").bind(r.id, now, user.id, parsed.data.reason));
  statements.push(auditStatement(db, { actor: user.id, action: "old_gold_void", entity: "old_gold", entityId: r.id, detail: { reason: parsed.data.reason } }));
  await db.batch(statements);
  return c.json(await viewOf(db, (await loadReceipt(db, r.id))!));
});

