import { Hono } from "hono";
import { calculateInvoice, divRoundHalfUp, polishWeightMg, type InvoiceResult } from "@jewellery/calc";
import {
  RATE_KINDS,
  cleanMobile,
  indiaDate,
  invoiceRequestSchema,
  nameSearchKey,
  newId,
  voidInvoiceSchema,
  type ApplicableRatesResponse,
  type InvoiceHistoryEntry,
  type InvoiceLineResponse,
  type InvoiceListResponse,
  type InvoiceRequest,
  type InvoiceResponse,
  type InvoiceSummary,
} from "@jewellery/shared";
import { financialYearOf } from "@jewellery/calc";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { classifyReplay } from "../db/idempotency";
import { revisionStatement } from "../db/revisions";
import { readJson, validationBody } from "../http";
import { applicableRate } from "../rates/routes";

export const invoiceRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;

type DbInvoice = {
  id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  invoice_no: string;
  invoice_date: string;
  customer_id: string | null;
  customer_name: string;
  customer_name_search: string;
  customer_mobile: string | null;
  customer_address: string | null;
  customer_pan: string | null;
  tax_mode: "intra" | "inter";
  reverse_charge: number;
  remarks: string | null;
  rates_json: string;
  input_json: string;
  taxable_paise: number;
  tax_paise: number;
  total_before_round_off_paise: number;
  round_off_paise: number;
  payable_paise: number;
  calc_json: string;
  revision_no: number;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

type DbLine = {
  line_no: number;
  description: string;
  purity: InvoiceLineResponse["purity"];
  hsn: string;
  gross_weight_mg: number;
  net_weight_mg: number;
  polish_mg: number;
  polish_bps: number;
  gold_rate_paise_per_kg: number;
  labour_rate_paise_per_kg: number;
  gst_rate_bps: number;
  chargeable_weight_mg: number;
  gold_amount_paise: number;
  labour_amount_paise: number;
  amount_paise: number;
  display_rate_paise_per_gram: number;
};

const isUniqueError = (e: unknown) =>
  e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);

const toSummary = (r: DbInvoice): InvoiceSummary => ({
  id: r.id,
  invoiceNo: r.invoice_no,
  invoiceDate: r.invoice_date,
  customerName: r.customer_name,
  customerMobile: r.customer_mobile,
  payablePaise: r.payable_paise,
  revisionNo: r.revision_no,
  voidedAt: r.voided_at,
});

const toLine = (l: DbLine): InvoiceLineResponse => ({
  lineNo: l.line_no,
  description: l.description,
  purity: l.purity,
  hsn: l.hsn as "7113" | "9988",
  grossWeightMg: l.gross_weight_mg,
  netWeightMg: l.net_weight_mg,
  polishMg: l.polish_mg,
  polishBps: l.polish_bps,
  goldRatePaisePerKg: l.gold_rate_paise_per_kg,
  labourRatePaisePerKg: l.labour_rate_paise_per_kg,
  gstRateBps: l.gst_rate_bps,
  chargeableWeightMg: l.chargeable_weight_mg,
  goldAmountPaise: l.gold_amount_paise,
  labourAmountPaise: l.labour_amount_paise,
  amountPaise: l.amount_paise,
  displayRatePaisePerGram: l.display_rate_paise_per_gram,
});

/** Everything shown comes from the stored columns, never from a fresh calculation (spec 013 R6). */
const toResponse = (r: DbInvoice, lines: DbLine[], isEarlierVersion: boolean): InvoiceResponse => ({
  ...toSummary(r),
  customerId: r.customer_id,
  customerAddress: r.customer_address,
  customerPan: r.customer_pan,
  taxMode: r.tax_mode,
  reverseCharge: r.reverse_charge === 1,
  remarks: r.remarks,
  rates: JSON.parse(r.rates_json) as InvoiceResponse["rates"],
  lines: lines.map(toLine),
  calc: JSON.parse(r.calc_json) as unknown,
  createdAt: r.created_at,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
  voidReason: r.void_reason,
  isEarlierVersion,
});

/** The saved content in a fixed key order, so "same content" is a plain string comparison (R9, R10). */
function canonicalInput(b: InvoiceRequest) {
  return {
    invoiceDate: b.invoiceDate,
    customerId: b.customerId ?? null,
    customerName: b.customerName,
    customerMobile: b.customerMobile,
    customerAddress: b.customerAddress,
    customerPan: b.customerPan,
    taxMode: b.taxMode,
    reverseCharge: b.reverseCharge ?? false,
    remarks: b.remarks,
    lines: b.lines.map((l) => ({
      description: l.description,
      purity: l.purity,
      hsn: l.hsn,
      grossWeightMg: l.grossWeightMg,
      netWeightMg: l.netWeightMg,
      polishBps: l.polishBps,
      goldRatePaisePerKg: l.goldRatePaisePerKg,
      labourRatePaisePerKg: l.labourRatePaisePerKg,
      gstRateBps: l.gstRateBps,
    })),
  };
}

type Canon = ReturnType<typeof canonicalInput>;

/** Names of the parts that differ between two saved versions (for audit rows and history). */
function changedParts(a: Canon, b: Canon): string[] {
  const out: string[] = [];
  if (a.invoiceDate !== b.invoiceDate) out.push("date");
  if (a.customerId !== b.customerId || a.customerName !== b.customerName || a.customerMobile !== b.customerMobile || a.customerAddress !== b.customerAddress || a.customerPan !== b.customerPan) out.push("customer");
  if (a.taxMode !== b.taxMode) out.push("taxMode");
  if (a.reverseCharge !== b.reverseCharge) out.push("reverseCharge");
  if (a.remarks !== b.remarks) out.push("remarks");
  if (JSON.stringify(a.lines) !== JSON.stringify(b.lines)) out.push("lines");
  return out;
}

async function loadRow(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM invoices WHERE id = ?1").bind(id).first<DbInvoice>();
}
async function loadLines(db: D1Database, id: string, revisionNo: number) {
  return (await db.prepare("SELECT * FROM invoice_lines WHERE invoice_id = ?1 AND revision_no = ?2 ORDER BY line_no").bind(id, revisionNo).all<DbLine>()).results;
}

type Prepared =
  | { ok: false; status: 400 | 409; body: unknown }
  | { ok: true; body: InvoiceRequest; canon: Canon; result: InvoiceResult; rates: ApplicableRatesResponse["rates"] };

/** Validation, date and customer checks, the server's own calculation, and the rate record (R2, R4, R5, R7). */
async function prepare(c: { env: AppEnv["Bindings"]; get: (k: "now") => Date }, raw: unknown, forEdit: boolean): Promise<Prepared> {
  // Temporary compatibility for pre-012b clients: old payloads carried a fixed
  // polish weight. New screens always send polishBps.
  const compatibleRaw = raw && typeof raw === "object" && Array.isArray((raw as { lines?: unknown[] }).lines)
    ? { ...(raw as Record<string, unknown>), lines: (raw as { lines: unknown[] }).lines.map((line) => {
        if (!line || typeof line !== "object") return line;
        const l = line as Record<string, unknown>;
        if (l.polishBps !== undefined || typeof l.polishMg !== "number" || typeof l.netWeightMg !== "number" || l.netWeightMg <= 0) return l;
        return { ...l, polishBps: Number(divRoundHalfUp(BigInt(l.polishMg) * 10_000n, BigInt(l.netWeightMg))) };
      }) }
    : raw;
  const parsed = invoiceRequestSchema.safeParse(compatibleRaw);
  if (!parsed.success) {
    const body = validationBody(parsed.error);
    // Name the line for line-level problems: issues come back with a path like ["lines", 1, "netWeightMg"].
    body.issues = parsed.error.issues.map((i) => ({
      field: i.path.length > 1 && i.path[0] === "lines" ? `lines.${Number(i.path[1]) + 1}.${String(i.path[2] ?? "")}` : String(i.path[0] ?? ""),
      message: i.message,
    }));
    return { ok: false, status: 400, body };
  }
  const body = parsed.data;
  if (forEdit && body.expectedRevision === undefined) {
    return { ok: false, status: 400, body: { error: "validation", issues: [{ field: "expectedRevision", message: "expectedRevision is required to edit" }] } };
  }
  if (body.invoiceDate > indiaDate(c.get("now"))) {
    return { ok: false, status: 400, body: { error: "future_date", message: "An invoice cannot be dated in the future" } };
  }
  if (body.customerId) {
    const cust = await c.env.DB.prepare("SELECT id, voided_at FROM customers WHERE id = ?1").bind(body.customerId).first<{ id: string; voided_at: string | null }>();
    if (!cust) return { ok: false, status: 400, body: { error: "customer_not_found", message: "That customer does not exist" } };
    if (cust.voided_at) return { ok: false, status: 409, body: { error: "customer_voided", message: "That customer is voided. Restore them or type a walk-in name." } };
  }

  const outcome = calculateInvoice({
    taxMode: body.taxMode,
    lines: body.lines.map((l) => ({ ...l, hsn: l.hsn.trim(), polishMg: polishWeightMg(l.netWeightMg, l.polishBps), gstRateBps: l.hsn.trim() === "9988" ? 500 : 300 })),
  });
  if (!outcome.ok) return { ok: false, status: 400, body: { error: "calculation", errors: outcome.errors } };

  const entries = await Promise.all(RATE_KINDS.map(async (k) => [k, await applicableRate(c.env.DB, k, body.invoiceDate)] as const));
  const rates = Object.fromEntries(entries) as ApplicableRatesResponse["rates"];
  return { ok: true, body, canon: canonicalInput(body), result: outcome.result, rates };
}

const INSERT_LINE = `INSERT INTO invoice_lines
  (id, invoice_id, revision_no, line_no, description, purity, hsn, gross_weight_mg, net_weight_mg, polish_mg, polish_bps,
   gold_rate_paise_per_kg, labour_rate_paise_per_kg, gst_rate_bps, chargeable_weight_mg, gold_amount_paise,
   labour_amount_paise, amount_paise, display_rate_paise_per_gram)
  VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)`;

function lineStatements(db: D1Database, invoiceId: string, revisionNo: number, body: InvoiceRequest, result: InvoiceResult) {
  return body.lines.map((l, i) => {
    const r = result.lines[i]!;
    return db
      .prepare(INSERT_LINE)
      .bind(newId(), invoiceId, revisionNo, i + 1, l.description, l.purity, l.hsn.trim(), l.grossWeightMg, l.netWeightMg, polishWeightMg(l.netWeightMg, l.polishBps), l.polishBps, l.goldRatePaisePerKg, l.labourRatePaisePerKg, l.hsn.trim() === "9988" ? 500 : 300, r.chargeableWeightMg, r.goldAmountPaise, r.labourAmountPaise, r.amountPaise, r.displayRatePaisePerGram);
  });
}

// ---- search (R15) ----
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

invoiceRoutes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const status = c.req.query("status");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  if ((from && !isDate(from)) || (to && !isDate(to))) return c.json({ error: "invalid_date" }, 400);
  if (status && status !== "active" && status !== "voided") return c.json({ error: "invalid_status" }, 400);

  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `?${args.length}`);

  if (q) {
    const ors = [`invoice_no LIKE ${add(`%${escapeLike(q.toUpperCase())}%`)} ESCAPE '\\'`, `customer_name_search LIKE ${add(`%${escapeLike(nameSearchKey(q))}%`)} ESCAPE '\\'`];
    if (/^[\d\s+\-().]+$/.test(q)) {
      const digits = cleanMobile(q) ?? q.replace(/\D/g, "");
      if (digits.length >= 3) ors.push(`customer_mobile LIKE ${add(`%${escapeLike(digits)}%`)} ESCAPE '\\'`);
    }
    where.push(`(${ors.join(" OR ")})`);
  }
  if (status === "active") where.push("voided_at IS NULL");
  if (status === "voided") where.push("voided_at IS NOT NULL");
  if (from) where.push(`invoice_date >= ${add(from)}`);
  if (to) where.push(`invoice_date <= ${add(to)}`);

  const sql = `SELECT * FROM invoices ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY invoice_date DESC, created_at DESC, id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const rows = (await c.env.DB.prepare(sql).bind(...args).all<DbInvoice>()).results;
  const body: InvoiceListResponse = {
    items: rows.slice(0, PAGE_SIZE).map(toSummary),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
  return c.json(body);
});

// ---- create (R1 to R9) ----
invoiceRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const p = await prepare(c, await readJson(c), false);
  if (!p.ok) return c.json(p.body, p.status);
  const { body, canon, result, rates } = p;
  const id = body.id ?? newId();

  const replay = classifyReplay(await loadRow(db, id), (row) => row.input_json === JSON.stringify(canon));
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different invoice" }, 409);
  if (replay.kind === "replay") return c.json(toResponse(replay.row, await loadLines(db, id, replay.row.revision_no), false));

  const fy = financialYearOf(body.invoiceDate);
  const now = new Date().toISOString();
  try {
    await db.batch([
      // R3: allocated in the same atomic batch as the insert, so a failed save never uses up a number.
      db
        .prepare(
          `INSERT INTO number_series (series, fy, last_no) VALUES ('INV', ?1, 1)
           ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`,
        )
        .bind(fy),
      db
        .prepare(
          `INSERT INTO invoices
             (id, created_at, created_by, updated_at, updated_by, invoice_no, invoice_date, customer_id, customer_name,
              customer_name_search, customer_mobile, customer_address, customer_pan, tax_mode, reverse_charge, remarks,
              rates_json, input_json, taxable_paise, tax_paise, total_before_round_off_paise, round_off_paise,
              payable_paise, calc_json, revision_no)
           VALUES (?1, ?2, ?3, ?2, ?3,
              'INV/' || ?4 || '/' || printf('%04d', (SELECT last_no FROM number_series WHERE series = 'INV' AND fy = ?4)),
              ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, 1)`,
        )
        .bind(
          id, now, user.id, fy, body.invoiceDate, body.customerId ?? null, body.customerName, nameSearchKey(body.customerName),
          body.customerMobile, body.customerAddress, body.customerPan, body.taxMode, body.reverseCharge ? 1 : 0, body.remarks,
          JSON.stringify(rates), JSON.stringify(canon), result.taxablePaise, result.taxPaise, result.totalBeforeRoundOffPaise,
          result.roundOffPaise, result.payablePaise, JSON.stringify(result),
        ),
      ...lineStatements(db, id, 1, body, result),
      auditStatement(db, {
        actor: user.id,
        action: "invoice_create",
        entity: "invoice",
        entityId: id,
        detail: { payablePaise: result.payablePaise, lines: body.lines.length },
      }),
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    const again = classifyReplay(await loadRow(db, id), (row) => row.input_json === JSON.stringify(canon));
    if (again.kind === "replay") return c.json(toResponse(again.row, await loadLines(db, id, again.row.revision_no), false));
    if (again.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different invoice" }, 409);
    throw e;
  }
  const row = (await loadRow(db, id))!;
  return c.json(toResponse(row, await loadLines(db, id, 1), false), 201);
});

// ---- read ----
invoiceRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const row = await loadRow(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const wanted = c.req.query("revision");
  if (wanted === undefined || Number(wanted) === row.revision_no) return c.json(toResponse(row, await loadLines(db, row.id, row.revision_no), false));

  const n = Number(wanted);
  if (!Number.isInteger(n) || n < 1 || n > row.revision_no) return c.json({ error: "not_found" }, 404);
  const snap = await db
    .prepare("SELECT snapshot_json FROM record_revisions WHERE entity = 'invoice' AND entity_id = ?1 AND revision_no = ?2")
    .bind(row.id, n)
    .first<{ snapshot_json: string }>();
  if (!snap) return c.json({ error: "not_found" }, 404);
  const old = JSON.parse(snap.snapshot_json) as DbInvoice;
  // The void mark belongs to the invoice as a whole, so it shows on every version.
  return c.json(toResponse({ ...old, voided_at: row.voided_at, voided_by: row.voided_by, void_reason: row.void_reason }, await loadLines(db, row.id, n), true));
});

// ---- edit (R10, R11) ----
invoiceRoutes.put("/:id", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await loadRow(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "invoice_voided", message: "A voided invoice cannot be edited" }, 409);

  const p = await prepare(c, await readJson(c), true);
  if (!p.ok) return c.json(p.body, p.status);
  const { body, canon, result, rates } = p;
  const stale = { error: "stale_revision", message: "This invoice was changed. Reload it and try again." };
  if (body.expectedRevision !== row.revision_no) return c.json(stale, 409);

  const old = JSON.parse(row.input_json) as Canon;
  const changed = changedParts(old, canon);
  if (changed.length === 0) return c.json(toResponse(row, await loadLines(db, row.id, row.revision_no), false)); // nothing changed: no revision, no audit

  const next = row.revision_no + 1;
  const now = new Date().toISOString();
  try {
    await db.batch([
      revisionStatement(db, { entity: "invoice", entityId: row.id, snapshot: row, reason: body.reason || undefined, actor: user.id }),
      db
        .prepare(
          `UPDATE invoices SET updated_at = ?2, updated_by = ?3, invoice_date = ?4, customer_id = ?5, customer_name = ?6,
             customer_name_search = ?7, customer_mobile = ?8, customer_address = ?9, customer_pan = ?10, tax_mode = ?11,
             reverse_charge = ?12, remarks = ?13, rates_json = ?14, input_json = ?15, taxable_paise = ?16, tax_paise = ?17,
             total_before_round_off_paise = ?18, round_off_paise = ?19, payable_paise = ?20, calc_json = ?21, revision_no = ?22
           WHERE id = ?1 AND revision_no = ?23`,
        )
        .bind(
          row.id, now, user.id, body.invoiceDate, body.customerId ?? null, body.customerName, nameSearchKey(body.customerName),
          body.customerMobile, body.customerAddress, body.customerPan, body.taxMode, body.reverseCharge ? 1 : 0, body.remarks,
          JSON.stringify(rates), JSON.stringify(canon), result.taxablePaise, result.taxPaise, result.totalBeforeRoundOffPaise,
          result.roundOffPaise, result.payablePaise, JSON.stringify(result), next, row.revision_no,
        ),
      ...lineStatements(db, row.id, next, body, result),
      auditStatement(db, {
        actor: user.id,
        action: "invoice_update",
        entity: "invoice",
        entityId: row.id,
        detail: { fromRevision: row.revision_no, toRevision: next, changed, fromPayablePaise: row.payable_paise, toPayablePaise: result.payablePaise, reason: body.reason || undefined },
      }),
    ]);
  } catch (e) {
    if (isUniqueError(e)) return c.json(stale, 409); // another device saved the same revision first
    throw e;
  }
  const saved = (await loadRow(db, row.id))!;
  return c.json(toResponse(saved, await loadLines(db, row.id, next), false));
});

// ---- history (R12) ----
invoiceRoutes.get("/:id/history", async (c) => {
  const db = c.env.DB;
  const current = await loadRow(db, c.req.param("id"));
  if (!current) return c.json({ error: "not_found" }, 404);
  const revs = (
    await db
      .prepare("SELECT revision_no, snapshot_json, reason, created_at, created_by FROM record_revisions WHERE entity = 'invoice' AND entity_id = ?1 ORDER BY revision_no")
      .bind(current.id)
      .all<{ revision_no: number; snapshot_json: string; reason: string | null; created_at: string; created_by: string }>()
  ).results;

  const items: InvoiceHistoryEntry[] = revs
    .map((rev, i) => {
      const before = JSON.parse(rev.snapshot_json) as DbInvoice;
      const after = i + 1 < revs.length ? (JSON.parse(revs[i + 1]!.snapshot_json) as DbInvoice) : current;
      return {
        revisionNo: rev.revision_no,
        at: rev.created_at,
        by: rev.created_by,
        reason: rev.reason,
        fromPayablePaise: before.payable_paise,
        toPayablePaise: after.payable_paise,
        changes: changedParts(JSON.parse(before.input_json) as Canon, JSON.parse(after.input_json) as Canon),
      };
    })
    .reverse();
  return c.json({ items });
});

// ---- void (R13) ----
invoiceRoutes.post("/:id/void", async (c) => {
  const parsed = voidInvoiceSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const row = await loadRow(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "already_voided" }, 409);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE invoices SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1")
      .bind(row.id, now, user.id, parsed.data.reason),
    auditStatement(db, { actor: user.id, action: "invoice_void", entity: "invoice", entityId: row.id, detail: { reason: parsed.data.reason, payablePaise: row.payable_paise } }),
  ]);
  const saved = (await loadRow(db, row.id))!;
  return c.json(toResponse(saved, await loadLines(db, row.id, saved.revision_no), false));
});
