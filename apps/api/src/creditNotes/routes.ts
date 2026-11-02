import { Hono } from "hono";
import { calculateCreditNote, divRoundHalfUp, financialYearOf, type InvoiceResult } from "@jewellery/calc";
import {
  CREDIT_NOTE_KIND_LABEL,
  creditApplySchema,
  creditNoteRequestSchema,
  creditPayoutSchema,
  creditReasonSchema,
  formatMoney,
  indiaDate,
  newId,
  type CreditApplicationView,
  type CreditNoteDetail,
  type CreditNoteKind,
  type CreditNoteListResponse,
  type CreditNoteSummary,
  type CreditPayoutView,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { printedNumberSql, printedNumberValues } from "../db/numbering";
import { readJson, validationBody } from "../http";
import { settingsSnapshot } from "../settings/routes";
import { balanceDueOn, creditAppliedOn, HELD_SQL, liveCreditTotalOn, returnedTaxableOnLine, settledOn } from "./money";
import { creditNoteStockMovements } from "./stock";

/** Spec 019d: credit notes against an original invoice (returns, exchanges, old gold adjustment). */
export const creditNoteRoutes = new Hono<AppEnv>();
export const creditReversalRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;

type DbInvoice = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  revision_no: number;
  customer_id: string | null;
  customer_name: string;
  customer_mobile: string | null;
  customer_address: string | null;
  customer_pan: string | null;
  tax_mode: "intra" | "inter";
  payable_paise: number;
  calc_json: string;
  voided_at: string | null;
};

type DbNote = {
  id: string;
  created_at: string;
  created_by: string;
  cn_no: string;
  cn_date: string;
  kind: CreditNoteKind;
  invoice_id: string;
  invoice_revision_no: number;
  replacement_invoice_id: string | null;
  ogp_id: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_mobile: string | null;
  customer_address: string | null;
  customer_pan: string | null;
  tax_mode: "intra" | "inter";
  reason: string;
  taxable_paise: number;
  tax_paise: number;
  total_before_round_off_paise: number;
  round_off_paise: number;
  amount_paise: number;
  header_json: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

const loadInvoice = (db: D1Database, id: string) => db.prepare("SELECT * FROM invoices WHERE id = ?1").bind(id).first<DbInvoice>();
const loadNote = (db: D1Database, id: string) => db.prepare("SELECT * FROM credit_notes WHERE id = ?1").bind(id).first<DbNote>();

/** Held amount of one credit note (spec 019d R10). */
async function heldOf(db: D1Database, id: string): Promise<number> {
  const row = await db.prepare(`SELECT ${HELD_SQL} AS n FROM credit_notes c WHERE c.id = ?1`).bind(id).first<{ n: number }>();
  return row?.n ?? 0;
}

async function livePayoutsOf(db: D1Database, id: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM credit_note_payouts WHERE credit_note_id = ?1 AND reversed_at IS NULL").bind(id).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Maps the database's own refusals (triggers and unique indexes) to the codes of this spec. */
function dbRefusal(e: unknown): { error: string; message: string } | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("exceeds_due")) return { error: "exceeds_due", message: "That is more than the bill still owes." };
  if (msg.includes("exceeds_credit")) return { error: "exceeds_credit", message: "That is more than the credit still held." };
  if (msg.includes("exceeds_invoice")) return { error: "exceeds_invoice", message: "That is more than the bill can still credit." };
  if (msg.includes("credit_notes_ogp_unique") || msg.includes("credit_notes.ogp_id")) return { error: "already_linked", message: "That old gold receipt is already linked to a credit note." };
  return null;
}

async function detailOf(db: D1Database, note: DbNote): Promise<CreditNoteDetail> {
  const lines = (
    await db
      .prepare("SELECT line_no, invoice_line_no, description, hsn, gst_rate_bps, taxable_paise, tax_paise FROM credit_note_lines WHERE credit_note_id = ?1 ORDER BY line_no")
      .bind(note.id)
      .all<{ line_no: number; invoice_line_no: number; description: string; hsn: string; gst_rate_bps: number; taxable_paise: number; tax_paise: number }>()
  ).results;
  const apps = (
    await db
      .prepare(
        `SELECT a.id, a.invoice_id, i.invoice_no, a.amount_paise, a.created_at, a.reversed_at, a.reverse_reason
         FROM credit_applications a JOIN invoices i ON i.id = a.invoice_id WHERE a.credit_note_id = ?1 ORDER BY a.created_at, a.id`,
      )
      .bind(note.id)
      .all<{ id: string; invoice_id: string; invoice_no: string; amount_paise: number; created_at: string; reversed_at: string | null; reverse_reason: string | null }>()
  ).results;
  const pays = (
    await db
      .prepare("SELECT id, amount_paise, mode, reference, paid_date, remarks, reversed_at, reverse_reason FROM credit_note_payouts WHERE credit_note_id = ?1 ORDER BY created_at, id")
      .bind(note.id)
      .all<{ id: string; amount_paise: number; mode: CreditPayoutView["mode"]; reference: string | null; paid_date: string; remarks: string | null; reversed_at: string | null; reverse_reason: string | null }>()
  ).results;
  const replacement = note.replacement_invoice_id ? await loadInvoice(db, note.replacement_invoice_id) : null;
  const ogp = note.ogp_id ? await db.prepare("SELECT receipt_no FROM old_gold_purchases WHERE id = ?1").bind(note.ogp_id).first<{ receipt_no: string }>() : null;
  const held = await heldOf(db, note.id);
  return {
    id: note.id,
    cnNo: note.cn_no,
    cnDate: note.cn_date,
    kind: note.kind,
    kindLabel: CREDIT_NOTE_KIND_LABEL[note.kind],
    invoiceId: note.invoice_id,
    invoiceNo: (await loadInvoice(db, note.invoice_id))?.invoice_no ?? "",
    customerId: note.customer_id,
    customerName: note.customer_name,
    amountPaise: note.amount_paise,
    heldPaise: held,
    voided: note.voided_at !== null,
    voidedAt: note.voided_at,
    voidReason: note.void_reason,
    reason: note.reason,
    taxMode: note.tax_mode,
    taxablePaise: note.taxable_paise,
    taxPaise: note.tax_paise,
    totalBeforeRoundOffPaise: note.total_before_round_off_paise,
    roundOffPaise: note.round_off_paise,
    replacementInvoiceId: note.replacement_invoice_id,
    replacementInvoiceNo: replacement?.invoice_no ?? null,
    ogpId: note.ogp_id,
    ogpNo: ogp?.receipt_no ?? null,
    customer: { name: note.customer_name, mobile: note.customer_mobile, address: note.customer_address, pan: note.customer_pan },
    lines: lines.map((l) => ({ lineNo: l.line_no, invoiceLineNo: l.invoice_line_no, description: l.description, hsn: l.hsn, gstRateBps: l.gst_rate_bps, taxablePaise: l.taxable_paise, taxPaise: l.tax_paise })),
    applications: apps.map<CreditApplicationView>((a) => ({ id: a.id, invoiceId: a.invoice_id, invoiceNo: a.invoice_no, amountPaise: a.amount_paise, date: indiaDate(new Date(a.created_at)), reversed: a.reversed_at !== null, reverseReason: a.reverse_reason })),
    payouts: pays.map<CreditPayoutView>((p) => ({ id: p.id, amountPaise: p.amount_paise, mode: p.mode, reference: p.reference, paidDate: p.paid_date, remarks: p.remarks, reversed: p.reversed_at !== null, reverseReason: p.reverse_reason })),
    header: note.header_json ? (JSON.parse(note.header_json) as Record<string, unknown>) : null,
  };
}

function summaryOf(r: {
  id: string; cn_no: string; cn_date: string; kind: CreditNoteKind; invoice_id: string; invoice_no: string; customer_id: string | null; customer_name: string; amount_paise: number; held: number; voided_at: string | null; void_reason: string | null;
}): CreditNoteSummary {
  return {
    id: r.id,
    cnNo: r.cn_no,
    cnDate: r.cn_date,
    kind: r.kind,
    kindLabel: CREDIT_NOTE_KIND_LABEL[r.kind],
    invoiceId: r.invoice_id,
    invoiceNo: r.invoice_no,
    customerId: r.customer_id,
    customerName: r.customer_name,
    amountPaise: r.amount_paise,
    heldPaise: r.voided_at ? 0 : r.held,
    voided: r.voided_at !== null,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
  };
}

/** A safe retry must send the same content (spec 001 R5). */
async function sameRequest(db: D1Database, note: DbNote, body: { invoiceId: string; cnDate: string; kind: string; reason: string; replacementInvoiceId: string | null; ogpId: string | null; lines: { invoiceLineNo: number; taxablePaise: number }[] }): Promise<boolean> {
  if (note.invoice_id !== body.invoiceId || note.cn_date !== body.cnDate || note.kind !== body.kind || note.reason !== body.reason) return false;
  if ((note.replacement_invoice_id ?? null) !== body.replacementInvoiceId || (note.ogp_id ?? null) !== body.ogpId) return false;
  const stored = (
    await db.prepare("SELECT invoice_line_no, taxable_paise FROM credit_note_lines WHERE credit_note_id = ?1 ORDER BY invoice_line_no").bind(note.id).all<{ invoice_line_no: number; taxable_paise: number }>()
  ).results;
  const asked = [...body.lines].sort((a, b) => a.invoiceLineNo - b.invoiceLineNo);
  return stored.length === asked.length && stored.every((s, i) => s.invoice_line_no === asked[i]!.invoiceLineNo && s.taxable_paise === asked[i]!.taxablePaise);
}

// ---- list and read (R20) ----
creditNoteRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").trim();
  const where: string[] = [];
  const binds: (string | number)[] = [];
  const add = (sql: string, ...values: (string | number)[]) => {
    let text = sql;
    for (const v of values) {
      binds.push(v);
      text = text.replace(/\?(?!\d)/, `?${binds.length}`); // only bare placeholders, never the ones already numbered
    }
    where.push(text);
  };
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    add("(c.cn_no LIKE ? ESCAPE '\\' OR c.customer_name LIKE ? ESCAPE '\\' OR i.invoice_no LIKE ? ESCAPE '\\')", like, like, like);
  }
  const invoiceId = c.req.query("invoiceId");
  if (invoiceId) add("c.invoice_id = ?", invoiceId);
  const customerId = c.req.query("customerId");
  if (customerId) add("c.customer_id = ?", customerId);
  const kind = c.req.query("kind");
  if (kind === "credit" || kind === "exchange" || kind === "old_gold") add("c.kind = ?", kind);
  const status = c.req.query("status");
  if (status === "live") add("c.voided_at IS NULL");
  if (status === "voided") add("c.voided_at IS NOT NULL");
  const from = c.req.query("from");
  if (from) add("c.cn_date >= ?", from);
  const to = c.req.query("to");
  if (to) add("c.cn_date <= ?", to);
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  const sql = `SELECT c.id, c.cn_no, c.cn_date, c.kind, c.invoice_id, i.invoice_no, c.customer_id, c.customer_name, c.amount_paise, c.voided_at, c.void_reason,
                 ${HELD_SQL} AS held
               FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY c.cn_date DESC, c.created_at DESC, c.id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const rows = (await db.prepare(sql).bind(...binds).all<Parameters<typeof summaryOf>[0]>()).results;
  const body: CreditNoteListResponse = {
    items: rows.slice(0, PAGE_SIZE).map(summaryOf),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
  return c.json(body);
});

creditNoteRoutes.get("/:id", async (c) => {
  const note = await loadNote(c.env.DB, c.req.param("id"));
  if (!note) return c.json({ error: "not_found" }, 404);
  return c.json(await detailOf(c.env.DB, note));
});

// ---- create (R1 to R9) ----
creditNoteRoutes.post("/", async (c) => {
  const parsed = creditNoteRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const body = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const now = new Date().toISOString();

  if (body.id) {
    const existing = await loadNote(db, body.id);
    if (existing) {
      const same = await sameRequest(db, existing, body);
      if (!same) return c.json({ error: "conflict", message: "This credit note id was already used for different content." }, 409);
      return c.json(await detailOf(db, existing), 200);
    }
  }

  const inv = await loadInvoice(db, body.invoiceId);
  if (!inv) return c.json({ error: "not_found", message: "The invoice was not found." }, 404);
  if (inv.voided_at) return c.json({ error: "invoice_voided", message: "This invoice is voided, so it cannot be credited." }, 409);
  if (body.cnDate > indiaDate(c.get("now"))) return c.json({ error: "future_date", message: "The credit note date cannot be in the future." }, 400);
  if (body.cnDate < inv.invoice_date) return c.json({ error: "date_before_invoice", message: `The credit note cannot be dated before the bill (${inv.invoice_date}).` }, 400);

  // R2: each returned line must exist in the bill's current version and still have that value left.
  const calc = JSON.parse(inv.calc_json) as InvoiceResult;
  const invLines = (
    await db.prepare("SELECT line_no, description, hsn, gst_rate_bps FROM invoice_lines WHERE invoice_id = ?1 AND revision_no = ?2").bind(inv.id, inv.revision_no).all<{ line_no: number; description: string; hsn: string; gst_rate_bps: number }>()
  ).results;
  const byNo = new Map(invLines.map((l) => [l.line_no, l]));
  const priced: { invoiceLineNo: number; taxablePaise: number; gstRateBps: number; description: string; hsn: string }[] = [];
  for (const [i, l] of body.lines.entries()) {
    const calcLine = calc.lines[l.invoiceLineNo - 1];
    const row = byNo.get(l.invoiceLineNo);
    if (!calcLine || !row) return c.json({ error: "unknown_line", message: `Line ${i + 1} is not a line of this bill.` }, 400);
    const left = calcLine.taxablePaise - (await returnedTaxableOnLine(db, inv.id, inv.revision_no, l.invoiceLineNo));
    if (l.taxablePaise > left) return c.json({ error: "exceeds_line", message: `Line ${l.invoiceLineNo} has ${formatMoney(Math.max(0, left))} left to return.` }, 400);
    priced.push({ invoiceLineNo: l.invoiceLineNo, taxablePaise: l.taxablePaise, gstRateBps: calcLine.gstRateBps, description: row.description, hsn: row.hsn });
  }

  // R3: the figures follow the bill's tax rules and round to the rupee.
  const outcome = calculateCreditNote({ taxMode: inv.tax_mode, lines: priced.map((p) => ({ taxablePaise: p.taxablePaise, gstRateBps: p.gstRateBps })) });
  if (!outcome.ok) return c.json({ error: "validation", message: outcome.error }, 400);
  const res = outcome.result;
  const room = inv.payable_paise - (await liveCreditTotalOn(db, inv.id));
  if (res.amountPaise > room) return c.json({ error: "exceeds_invoice", message: `This bill can still credit only ${formatMoney(Math.max(0, room))}.` }, 409);

  // R4, R9: the kind decides where the credit goes.
  let replacement: DbInvoice | null = null;
  if (body.kind === "exchange") {
    replacement = await loadInvoice(db, body.replacementInvoiceId!);
    if (!replacement || replacement.voided_at || replacement.id === inv.id || !inv.customer_id || replacement.customer_id !== inv.customer_id) {
      return c.json({ error: "bad_replacement", message: "The replacement must be another live invoice of the same customer." }, 400);
    }
  }
  if (body.kind === "old_gold") {
    const og = await db
      .prepare("SELECT id, customer_id, invoice_id, treatment, original_paise + round_off_paise AS final_paise, receipt_no, voided_at FROM old_gold_purchases WHERE id = ?1")
      .bind(body.ogpId!)
      .first<{ id: string; customer_id: string; invoice_id: string | null; treatment: string; final_paise: number; receipt_no: string; voided_at: string | null }>();
    if (!og || og.voided_at || og.invoice_id !== inv.id || og.treatment !== "invoice_adjustment" || og.customer_id !== inv.customer_id) {
      return c.json({ error: "bad_old_gold", message: "The old gold receipt must be a live invoice adjustment against this bill, for the same customer." }, 400);
    }
    if (og.final_paise !== res.amountPaise) {
      return c.json({ error: "old_gold_amount", message: `Old gold receipt ${og.receipt_no} is ${formatMoney(og.final_paise)}, but the return is ${formatMoney(res.amountPaise)}.` }, 400);
    }
    const linked = await db.prepare("SELECT id FROM credit_notes WHERE ogp_id = ?1 AND voided_at IS NULL").bind(og.id).first();
    if (linked) return c.json({ error: "already_linked", message: "That old gold receipt is already linked to a credit note." }, 409);
  }

  // R7, R8: apply to the original balance first, then (exchange) the rest to the replacement. Old gold holds nothing.
  let toOriginal = 0;
  let toReplacement = 0;
  if (body.kind !== "old_gold") {
    toOriginal = Math.min(res.amountPaise, await balanceDueOn(db, inv.id));
    if (replacement) toReplacement = Math.min(res.amountPaise - toOriginal, await balanceDueOn(db, replacement.id));
  }
  const held = body.kind === "old_gold" ? 0 : res.amountPaise - toOriginal - toReplacement;
  if (held > 0 && !inv.customer_id) {
    return c.json({ error: "walk_in_credit", message: "This is a walk-in bill with no saved customer. The credit must be used on this bill, so it cannot be larger than what it still owes." }, 400);
  }

  const id = body.id ?? newId();
  const fy = financialYearOf(body.cnDate);
  const header = await settingsSnapshot(db);
  const cnNo = printedNumberValues(header.numbering, "CN", fy);
  const statements = [
    db.prepare(`INSERT INTO number_series (series, fy, last_no) VALUES ('CN', ?1, 1) ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`).bind(fy),
    db
      .prepare(
        `INSERT INTO credit_notes
           (id, created_at, created_by, updated_at, updated_by, cn_no, fy, serial, cn_date, kind, invoice_id, invoice_revision_no,
            replacement_invoice_id, ogp_id, customer_id, customer_name, customer_mobile, customer_address, customer_pan, tax_mode, reason,
            taxable_paise, tax_paise, total_before_round_off_paise, round_off_paise, amount_paise, calc_json, header_json)
         VALUES (?1, ?2, ?3, ?2, ?3,
           ${printedNumberSql("(SELECT last_no FROM number_series WHERE series = 'CN' AND fy = ?4)", ["?5", "?6", "?7"])}, ?4,
           (SELECT last_no FROM number_series WHERE series = 'CN' AND fy = ?4),
           ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)`,
      )
      .bind(
        id, now, user.id, fy, ...cnNo,
        body.cnDate, body.kind, inv.id, inv.revision_no, replacement?.id ?? null, body.ogpId, inv.customer_id, inv.customer_name,
        inv.customer_mobile, inv.customer_address, inv.customer_pan, inv.tax_mode, body.reason,
        res.taxablePaise, res.taxPaise, res.totalBeforeRoundOffPaise, res.roundOffPaise, res.amountPaise, JSON.stringify(res), JSON.stringify(header),
      ),
  ];
  for (const [i, p] of priced.entries()) {
    const taxLine = Number(divRoundHalfUp(BigInt(p.taxablePaise) * BigInt(p.gstRateBps), 10_000n)); // for information only; the totals are authoritative
    statements.push(
      db
        .prepare(
          `INSERT INTO credit_note_lines (id, credit_note_id, line_no, invoice_line_no, description, hsn, gst_rate_bps, taxable_paise, tax_paise, inventory_item_id, created_at, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11)`,
        )
        .bind(newId(), id, i + 1, p.invoiceLineNo, p.description, p.hsn, p.gstRateBps, p.taxablePaise, taxLine, now, user.id),
    );
  }
  creditNoteStockMovements(priced.map(() => ({ inventoryItemId: null }))); // R19: stock is deferred (Q99)
  if (toOriginal > 0) {
    statements.push(db.prepare("INSERT INTO credit_applications (id, credit_note_id, invoice_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(newId(), id, inv.id, toOriginal, now, user.id));
  }
  if (toReplacement > 0) {
    statements.push(db.prepare("INSERT INTO credit_applications (id, credit_note_id, invoice_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(newId(), id, replacement!.id, toReplacement, now, user.id));
  }
  statements.push(
    auditStatement(db, {
      actor: user.id,
      action: "credit_note_create",
      entity: "credit_note",
      entityId: id,
      detail: { kind: body.kind, invoiceId: inv.id, amountPaise: res.amountPaise, appliedPaise: toOriginal, replacementAppliedPaise: toReplacement, heldPaise: held, reason: body.reason },
    }),
  );

  try {
    await db.batch(statements);
  } catch (e) {
    const refusal = dbRefusal(e);
    if (refusal) return c.json(refusal, 409);
    const existing = body.id ? await loadNote(db, body.id) : null;
    if (existing) {
      const same = await sameRequest(db, existing, body);
      return same ? c.json(await detailOf(db, existing), 200) : c.json({ error: "conflict", message: "This credit note id was already used for different content." }, 409);
    }
    throw e;
  }
  const saved = (await loadNote(db, id))!;
  return c.json(await detailOf(db, saved), 201);
});

// ---- apply held credit to another bill (R11) ----
creditNoteRoutes.post("/:id/apply", async (c) => {
  const parsed = creditApplySchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const note = await loadNote(db, c.req.param("id"));
  if (!note) return c.json({ error: "not_found" }, 404);
  if (note.voided_at) return c.json({ error: "voided", message: "This credit note is voided." }, 409);
  const target = await loadInvoice(db, parsed.data.invoiceId);
  if (!target) return c.json({ error: "not_found", message: "The invoice was not found." }, 404);
  if (target.voided_at) return c.json({ error: "invoice_voided", message: "That invoice is voided." }, 409);
  if (!note.customer_id || target.customer_id !== note.customer_id) return c.json({ error: "other_customer", message: "Credit can only be used on the same customer's bills." }, 400);
  const held = await heldOf(db, note.id);
  if (parsed.data.amountPaise > held) return c.json({ error: "validation", message: `Only ${formatMoney(held)} is held on this credit note.` }, 400);
  const due = await balanceDueOn(db, target.id);
  if (parsed.data.amountPaise > due) return c.json({ error: "exceeds_due", message: `That bill still owes only ${formatMoney(due)}.` }, 409);
  const now = new Date().toISOString();
  const appId = newId();
  try {
    await db.batch([
      db.prepare("INSERT INTO credit_applications (id, credit_note_id, invoice_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(appId, note.id, target.id, parsed.data.amountPaise, now, user.id),
      auditStatement(db, { actor: user.id, action: "credit_note_apply", entity: "credit_note", entityId: note.id, detail: { invoiceId: target.id, amountPaise: parsed.data.amountPaise } }),
    ]);
  } catch (e) {
    const refusal = dbRefusal(e);
    if (refusal) return c.json(refusal, 409);
    throw e;
  }
  return c.json(await detailOf(db, (await loadNote(db, note.id))!), 201);
});

// ---- pay back held credit (R12) ----
creditNoteRoutes.post("/:id/payouts", async (c) => {
  const parsed = creditPayoutSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const note = await loadNote(db, c.req.param("id"));
  if (!note) return c.json({ error: "not_found" }, 404);
  if (note.voided_at) return c.json({ error: "voided", message: "This credit note is voided." }, 409);
  if (!note.customer_id) return c.json({ error: "walk_in_credit", message: "A walk-in bill has no customer to pay back." }, 400);
  if (parsed.data.paidDate > indiaDate(c.get("now"))) return c.json({ error: "future_date", message: "The payment date cannot be in the future." }, 400);
  const held = await heldOf(db, note.id);
  if (parsed.data.amountPaise > held) return c.json({ error: "validation", message: `Only ${formatMoney(held)} is held on this credit note.` }, 400);
  const now = new Date().toISOString();
  const payoutId = newId();
  try {
    await db.batch([
      db
        .prepare("INSERT INTO credit_note_payouts (id, credit_note_id, amount_paise, mode, reference, paid_date, remarks, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
        .bind(payoutId, note.id, parsed.data.amountPaise, parsed.data.mode, parsed.data.reference, parsed.data.paidDate, parsed.data.remarks, now, user.id),
      auditStatement(db, { actor: user.id, action: "credit_note_payout", entity: "credit_note", entityId: note.id, detail: { payoutId, amountPaise: parsed.data.amountPaise, mode: parsed.data.mode } }),
    ]);
  } catch (e) {
    const refusal = dbRefusal(e);
    if (refusal) return c.json(refusal, 409);
    throw e;
  }
  return c.json(await detailOf(db, (await loadNote(db, note.id))!), 201);
});

// ---- void (R14) ----
creditNoteRoutes.post("/:id/void", async (c) => {
  const parsed = creditReasonSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const note = await loadNote(db, c.req.param("id"));
  if (!note) return c.json({ error: "not_found" }, 404);
  if (note.voided_at) return c.json({ error: "already_voided", message: "This credit note is already voided." }, 409);
  if ((await livePayoutsOf(db, note.id)) > 0) {
    return c.json({ error: "has_payouts", message: "Money has been paid back on this credit note. Reverse the payout first." }, 409);
  }
  const now = new Date().toISOString();
  const reversedApps = (await db.prepare("SELECT COUNT(*) AS n FROM credit_applications WHERE credit_note_id = ?1 AND reversed_at IS NULL").bind(note.id).first<{ n: number }>())?.n ?? 0;
  await db.batch([
    db
      .prepare("UPDATE credit_applications SET reversed_at = ?2, reversed_by = ?3, reverse_reason = ?4 WHERE credit_note_id = ?1 AND reversed_at IS NULL")
      .bind(note.id, now, user.id, `Credit note voided: ${parsed.data.reason}`),
    db.prepare("UPDATE credit_notes SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1").bind(note.id, now, user.id, parsed.data.reason),
    auditStatement(db, { actor: user.id, action: "credit_note_void", entity: "credit_note", entityId: note.id, detail: { reason: parsed.data.reason, amountPaise: note.amount_paise, reversedApplications: reversedApps } }),
  ]);
  return c.json(await detailOf(db, (await loadNote(db, note.id))!));
});

// ---- reversals (R12, R13) ----
creditReversalRoutes.post("/applications/:id/reverse", async (c) => {
  const parsed = creditReasonSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const app = await db.prepare("SELECT id, credit_note_id, invoice_id, amount_paise, reversed_at FROM credit_applications WHERE id = ?1").bind(c.req.param("id")).first<{ id: string; credit_note_id: string; invoice_id: string; amount_paise: number; reversed_at: string | null }>();
  if (!app) return c.json({ error: "not_found" }, 404);
  if (app.reversed_at) return c.json({ error: "already_reversed", message: "This credit application is already reversed." }, 409);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE credit_applications SET reversed_at = ?2, reversed_by = ?3, reverse_reason = ?4 WHERE id = ?1").bind(app.id, now, user.id, parsed.data.reason),
    auditStatement(db, { actor: user.id, action: "credit_application_reverse", entity: "credit_note", entityId: app.credit_note_id, detail: { applicationId: app.id, invoiceId: app.invoice_id, amountPaise: app.amount_paise, reason: parsed.data.reason } }),
  ]);
  return c.json({ ok: true, invoiceReceivedPaise: await settledOn(db, app.invoice_id), invoiceDuePaise: await balanceDueOn(db, app.invoice_id), creditAppliedPaise: await creditAppliedOn(db, app.invoice_id) });
});

creditReversalRoutes.post("/payouts/:id/reverse", async (c) => {
  const parsed = creditReasonSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const pay = await db.prepare("SELECT id, credit_note_id, amount_paise, reversed_at FROM credit_note_payouts WHERE id = ?1").bind(c.req.param("id")).first<{ id: string; credit_note_id: string; amount_paise: number; reversed_at: string | null }>();
  if (!pay) return c.json({ error: "not_found" }, 404);
  if (pay.reversed_at) return c.json({ error: "already_reversed", message: "This payout is already reversed." }, 409);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE credit_note_payouts SET reversed_at = ?2, reversed_by = ?3, reverse_reason = ?4 WHERE id = ?1").bind(pay.id, now, user.id, parsed.data.reason),
    auditStatement(db, { actor: user.id, action: "credit_note_payout_reverse", entity: "credit_note", entityId: pay.credit_note_id, detail: { payoutId: pay.id, amountPaise: pay.amount_paise, reason: parsed.data.reason } }),
  ]);
  return c.json(await detailOf(db, (await loadNote(db, pay.credit_note_id))!));
});
