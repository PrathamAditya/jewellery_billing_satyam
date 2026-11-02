import { Hono } from "hono";
import { calculateInvoice, divRoundHalfUp, fixPendingRate, polishWeightMg, validatePendingLines, type InvoiceResult, type PendingSaleInput } from "@jewellery/calc";
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
  type DiscountsBody,
  PURITY_RATE_KIND,
  fixRateRequestSchema,
  pendingInvoiceRequestSchema,
  type PendingInvoiceRequest,
  type Purity,
} from "@jewellery/shared";
import { financialYearOf } from "@jewellery/calc";
import { settingsSnapshot } from "../settings/routes";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { printedNumberSql, printedNumberValues } from "../db/numbering";
import { classifyReplay } from "../db/idempotency";
import { revisionStatement } from "../db/revisions";
import { readJson, validationBody } from "../http";
import { applicableRate } from "../rates/routes";
import { paymentStatusOf } from "@jewellery/shared";
import { liveCreditTotalOn } from "../creditNotes/money";

export const invoiceRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;

type DbInvoice = {
  id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  invoice_no: string;
  fy: string;
  serial: number;
  header_json: string | null;
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
  /** Spec 012c: the discounts as entered ('{}' when none) and their total. Old rows predate them. */
  discount_json?: string;
  discount_paise?: number;
  /** Spec 019c: "pending" until the rate is fixed. Rows from before migration 0020 read as fixed. */
  rate_status?: "fixed" | "pending";
  rate_fixed_on?: string | null;
};

type DbLine = {
  pricing_mode?: "weight" | "separate" | "combined";
  stone_weight_mg?: number;
  stone_amount_paise?: number;
  total_amount_paise?: number;
  discount_paise?: number;
  taxable_paise?: number;
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

const toSummary = (r: DbInvoice, received = 0): InvoiceSummary => {
  const pending = (r.rate_status ?? "fixed") === "pending";
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    invoiceDate: r.invoice_date,
    customerName: r.customer_name,
    customerMobile: r.customer_mobile,
    // Spec 019c R3: a pending sale stores 0 and it is not an amount. Read it with rateStatus.
    payablePaise: r.payable_paise,
    revisionNo: r.revision_no,
    voidedAt: r.voided_at,
    receivedPaise: received,
    balanceDuePaise: pending ? 0 : Math.max(0, r.payable_paise - received),
    paymentStatus: paymentStatusOf(r.payable_paise, received, r.voided_at !== null, pending),
    rateStatus: pending ? "pending" : "fixed",
    rateFixedOn: r.rate_fixed_on ?? null,
    pendingWeightMg: 0,
    pendingHeldPaise: 0,
  };
};

/** Spec 019c R13: the weight and the held money of a pending sale, read from its live lines and payments. */
async function pendingFigures(db: D1Database, r: DbInvoice): Promise<{ pendingWeightMg: number; pendingHeldPaise: number }> {
  if ((r.rate_status ?? "fixed") !== "pending") return { pendingWeightMg: 0, pendingHeldPaise: 0 };
  const w = await db.prepare("SELECT COALESCE(SUM(chargeable_weight_mg), 0) AS n FROM invoice_lines WHERE invoice_id = ?1 AND revision_no = ?2").bind(r.id, r.revision_no).first<{ n: number }>();
  const h = await db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_paise - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0)
                 - COALESCE((SELECT SUM(x.amount_paise) FROM payment_refunds x WHERE x.payment_id = p.id AND x.reversed_at IS NULL), 0)), 0) AS n
       FROM payments p WHERE p.pending_invoice_id = ?1 AND p.voided_at IS NULL`,
    )
    .bind(r.id)
    .first<{ n: number }>();
  return { pendingWeightMg: w?.n ?? 0, pendingHeldPaise: h?.n ?? 0 };
}

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
  // Spec 012c R8. Old rows read as a plain weight line: no stone, no discount, taxable = amount.
  pricingMode: l.pricing_mode ?? "weight",
  stoneWeightMg: l.stone_weight_mg ?? 0,
  stoneAmountPaise: l.stone_amount_paise ?? 0,
  totalAmountPaise: l.total_amount_paise ?? 0,
  discountPaise: l.discount_paise ?? 0,
  taxablePaise: l.taxable_paise ?? l.amount_paise,
});

/** Spec 012c R9: the discounts as entered; null when there are none. */
function parseDiscounts(json: string | undefined): DiscountsBody | null {
  if (!json) return null;
  const d = JSON.parse(json) as DiscountsBody;
  return Object.keys(d).length ? d : null;
}

/** Everything shown comes from the stored columns, never from a fresh calculation (spec 013 R6). */
const toResponse = (r: DbInvoice, lines: DbLine[], isEarlierVersion: boolean, received = 0): InvoiceResponse => ({
  ...toSummary(r, received),
  /** The business header saved with the invoice (spec 003 R5). Printing uses this, never the current settings. */
  header: r.header_json ? (JSON.parse(r.header_json) as Record<string, unknown>) : null,
  customerId: r.customer_id,
  customerAddress: r.customer_address,
  customerPan: r.customer_pan,
  taxMode: r.tax_mode,
  reverseCharge: r.reverse_charge === 1,
  remarks: r.remarks,
  rates: JSON.parse(r.rates_json) as InvoiceResponse["rates"],
  discounts: parseDiscounts(r.discount_json),
  discountPaise: r.discount_paise ?? 0,
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
    discounts: b.discounts ?? null,
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
      pricingMode: l.pricingMode ?? "weight",
      stoneWeightMg: l.stoneWeightMg ?? 0,
      stoneAmountPaise: l.stoneAmountPaise ?? 0,
      totalAmountPaise: l.totalAmountPaise ?? 0,
    })),
  };
}

type Canon = ReturnType<typeof canonicalInput>;

/** Spec 012c: versions saved before the pricing and discount fields existed read as plain weight lines with no discounts. */
const LINE_DEFAULTS = { pricingMode: "weight", stoneWeightMg: 0, stoneAmountPaise: 0, totalAmountPaise: 0 } as const;
function normalizedCanon(c: Canon): Canon {
  return { ...c, discounts: c.discounts ?? null, lines: c.lines.map((l) => ({ ...LINE_DEFAULTS, ...l })) } as Canon;
}

/** Names of the parts that differ between two saved versions (for audit rows and history). */
function changedParts(a0: Canon, b0: Canon): string[] {
  const a = normalizedCanon(a0);
  const b = normalizedCanon(b0);
  const out: string[] = [];
  if (a.invoiceDate !== b.invoiceDate) out.push("date");
  if (a.customerId !== b.customerId || a.customerName !== b.customerName || a.customerMobile !== b.customerMobile || a.customerAddress !== b.customerAddress || a.customerPan !== b.customerPan) out.push("customer");
  if (a.taxMode !== b.taxMode) out.push("taxMode");
  if (a.reverseCharge !== b.reverseCharge) out.push("reverseCharge");
  if (a.remarks !== b.remarks) out.push("remarks");
  if (JSON.stringify(a.lines) !== JSON.stringify(b.lines)) out.push("lines");
  if (JSON.stringify(a.discounts) !== JSON.stringify(b.discounts)) out.push("discounts");
  return out;
}

/** Spec 019c R5: payments taken against a pending sale that are still live (their remaining money is held). */
async function heldForSale(db: D1Database, invoiceId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM payments WHERE pending_invoice_id = ?1 AND voided_at IS NULL").bind(invoiceId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Money received per invoice (spec 015 R12), one query for a whole page. */
async function receivedMap(db: D1Database, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const marks = ids.map((_, i) => `?${i + 1}`).join(", ");
  const rows = (
    await db
      // Spec 019d R16: credit applications count as settled money on the bill, next to payment allocations.
      .prepare(
        `SELECT i.id AS invoice_id,
                COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.invoice_id = i.id AND a.reversed_at IS NULL), 0)
              + COALESCE((SELECT SUM(x.amount_paise) FROM credit_applications x WHERE x.invoice_id = i.id AND x.reversed_at IS NULL), 0) AS n
         FROM invoices i WHERE i.id IN (${marks})`,
      )
      .bind(...ids)
      .all<{ invoice_id: string; n: number }>()
  ).results;
  for (const r of rows) out.set(r.invoice_id, r.n);
  return out;
}

async function receivedOf(db: D1Database, id: string): Promise<number> {
  return (await receivedMap(db, [id])).get(id) ?? 0;
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
    discounts: body.discounts,
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
   labour_amount_paise, amount_paise, display_rate_paise_per_gram,
   pricing_mode, stone_weight_mg, stone_amount_paise, total_amount_paise, discount_paise, taxable_paise)
  VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)`;

function lineStatements(db: D1Database, invoiceId: string, revisionNo: number, body: InvoiceRequest, result: InvoiceResult) {
  return body.lines.map((l, i) => {
    const r = result.lines[i]!;
    // Spec 012c R1: the stone and total fields only mean something for their own pricing mode.
    const mode = l.pricingMode ?? "weight";
    return db
      .prepare(INSERT_LINE)
      .bind(
        newId(), invoiceId, revisionNo, i + 1, l.description, l.purity, l.hsn.trim(), l.grossWeightMg, l.netWeightMg, polishWeightMg(l.netWeightMg, l.polishBps), l.polishBps,
        l.goldRatePaisePerKg, l.labourRatePaisePerKg, l.hsn.trim() === "9988" ? 500 : 300, r.chargeableWeightMg, r.goldAmountPaise, r.labourAmountPaise, r.amountPaise, r.displayRatePaisePerGram,
        mode, mode === "separate" ? (l.stoneWeightMg ?? 0) : 0, r.stoneAmountPaise, mode === "combined" ? (l.totalAmountPaise ?? 0) : 0, r.discountPaise, r.taxablePaise,
      );
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
  const rateStatus = c.req.query("rateStatus");
  if (rateStatus && rateStatus !== "pending" && rateStatus !== "fixed") return c.json({ error: "invalid_rate_status" }, 400);

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
  const customerId = c.req.query("customerId");
  if (customerId) where.push(`customer_id = ${add(customerId)}`);
  if (status === "active") where.push("voided_at IS NULL");
  if (status === "voided") where.push("voided_at IS NOT NULL");
  // Spec 019c R13: the pending-rate list.
  if (rateStatus) where.push(`rate_status = ${add(rateStatus)}`);
  if (from) where.push(`invoice_date >= ${add(from)}`);
  if (to) where.push(`invoice_date <= ${add(to)}`);

  const sql = `SELECT * FROM invoices ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY invoice_date DESC, created_at DESC, id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const rows = (await c.env.DB.prepare(sql).bind(...args).all<DbInvoice>()).results;
  const page = rows.slice(0, PAGE_SIZE);
  const received = await receivedMap(c.env.DB, page.map((r) => r.id));
  const body: InvoiceListResponse = {
    items: await Promise.all(page.map(async (r) => ({ ...toSummary(r, received.get(r.id) ?? 0), ...(await pendingFigures(c.env.DB, r)) }))),
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
  const header = await settingsSnapshot(db);
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
             (id, created_at, created_by, updated_at, updated_by, invoice_no, fy, serial, header_json, invoice_date, customer_id, customer_name,
              customer_name_search, customer_mobile, customer_address, customer_pan, tax_mode, reverse_charge, remarks,
              rates_json, input_json, taxable_paise, tax_paise, total_before_round_off_paise, round_off_paise,
              payable_paise, calc_json, discount_json, discount_paise, revision_no)
           VALUES (?1, ?2, ?3, ?2, ?3,
              ${printedNumberSql("(SELECT last_no FROM number_series WHERE series = 'INV' AND fy = ?4)", ["?24", "?25", "?26"])}, ?4,
              (SELECT last_no FROM number_series WHERE series = 'INV' AND fy = ?4), ?5,
              ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?27, ?28, 1)`,
        )
        .bind(
          id, now, user.id, fy, JSON.stringify(header), body.invoiceDate, body.customerId ?? null, body.customerName, nameSearchKey(body.customerName),
          body.customerMobile, body.customerAddress, body.customerPan, body.taxMode, body.reverseCharge ? 1 : 0, body.remarks,
          JSON.stringify(rates), JSON.stringify(canon), result.taxablePaise, result.taxPaise, result.totalBeforeRoundOffPaise,
          result.roundOffPaise, result.payablePaise, JSON.stringify(result), ...printedNumberValues(header.numbering, "INV", fy),
          JSON.stringify(body.discounts ?? {}), result.discountPaise,
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
  if (wanted === undefined || Number(wanted) === row.revision_no) {
    return c.json({ ...toResponse(row, await loadLines(db, row.id, row.revision_no), false, await receivedOf(db, row.id)), ...(await pendingFigures(db, row)) });
  }

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

// ---- print event (spec 014 R1): printing is read-only; the one write is this audit row ----
invoiceRoutes.post("/:id/print-event", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await loadRow(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const body = (await readJson(c)) as { copy?: unknown } | undefined;
  const copy = typeof body?.copy === "string" ? body.copy.trim().slice(0, 40) : "";
  await auditStatement(db, { actor: user.id, action: "invoice_print", entity: "invoice", entityId: row.id, detail: { copy, revision: row.revision_no } }).run();
  return c.json({ ok: true });
});

// ---- edit (R10, R11) ----
invoiceRoutes.put("/:id", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await loadRow(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "invoice_voided", message: "A voided invoice cannot be edited" }, 409);
  // Spec 019c R10: a sale with its rate still to be fixed is changed by fixing the rate, not by an edit.
  if (row.rate_status === "pending") return c.json({ error: "rate_pending", message: "The rate of this sale is not fixed yet. Fix the rate first." }, 409);

  const p = await prepare(c, await readJson(c), true);
  if (!p.ok) return c.json(p.body, p.status);
  const { body, canon, result, rates } = p;
  const stale = { error: "stale_revision", message: "This invoice was changed. Reload it and try again." };
  if (body.expectedRevision !== row.revision_no) return c.json(stale, 409);

  // Spec 015 M8: an edit cannot make the bill smaller than what has already been received.
  // Spec 019d R15: and not below the live credit notes on the bill.
  if (result.payablePaise < (await liveCreditTotalOn(db, row.id))) {
    return c.json({ error: "payable_below_received", message: "Credit notes are already recorded on this bill for more than the new total.", receivedPaise: await liveCreditTotalOn(db, row.id) }, 409);
  }
  if (result.payablePaise < (await receivedOf(db, row.id))) {
    return c.json({ error: "payable_below_received", message: "Payments are already recorded above the new total. Reverse them first.", receivedPaise: await receivedOf(db, row.id) }, 409);
  }

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
             total_before_round_off_paise = ?18, round_off_paise = ?19, payable_paise = ?20, calc_json = ?21, revision_no = ?22,
             discount_json = ?24, discount_paise = ?25
           WHERE id = ?1 AND revision_no = ?23`,
        )
        .bind(
          row.id, now, user.id, body.invoiceDate, body.customerId ?? null, body.customerName, nameSearchKey(body.customerName),
          body.customerMobile, body.customerAddress, body.customerPan, body.taxMode, body.reverseCharge ? 1 : 0, body.remarks,
          JSON.stringify(rates), JSON.stringify(canon), result.taxablePaise, result.taxPaise, result.totalBeforeRoundOffPaise,
          result.roundOffPaise, result.payablePaise, JSON.stringify(result), next, row.revision_no, JSON.stringify(body.discounts ?? {}), result.discountPaise,
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
  return c.json(toResponse(saved, await loadLines(db, row.id, next), false, await receivedOf(db, row.id)));
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
  // Spec 019d R15: a bill with a live credit note cannot be voided (checked first: credit is also "received").
  if ((await liveCreditTotalOn(db, row.id)) > 0) {
    return c.json({ error: "has_credit_notes", message: "This invoice has credit notes against it. Void them first." }, 409);
  }
  if ((await receivedOf(db, row.id)) > 0) {
    return c.json({ error: "has_payments", message: "This invoice has payments recorded against it. Reverse them first." }, 409);
  }
  // Spec 019c R7: money paid against a sale whose rate is not fixed yet blocks the void (Q97).
  if (row.rate_status === "pending" && (await heldForSale(db, row.id)) > 0) {
    return c.json({ error: "has_payments", message: "Money has been paid against this sale. Fix the rate first, then correct the sale." }, 409);
  }
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

// ---- spec 019c: credit sales with the rate fixed later ----

/** Spec 019c: the saved content of a pending sale. Same keys and order as canonicalInput, with gold rates 0 (not fixed yet). */
function pendingCanon(b: PendingInvoiceRequest) {
  return {
    invoiceDate: b.invoiceDate,
    customerId: b.customerId,
    customerName: b.customerName,
    customerMobile: b.customerMobile,
    customerAddress: b.customerAddress,
    customerPan: b.customerPan,
    taxMode: b.taxMode,
    reverseCharge: b.reverseCharge ?? false,
    remarks: b.remarks,
    discounts: null,
    lines: b.lines.map((l) => ({
      description: l.description,
      purity: l.purity,
      hsn: l.hsn,
      grossWeightMg: l.grossWeightMg,
      netWeightMg: l.netWeightMg,
      polishBps: l.polishBps,
      goldRatePaisePerKg: 0,
      labourRatePaisePerKg: l.labourRatePaisePerKg,
      pricingMode: "weight",
      stoneWeightMg: 0,
      stoneAmountPaise: 0,
      totalAmountPaise: 0,
    })),
  };
}

const INSERT_PENDING_LINE = `INSERT INTO invoice_lines
  (id, invoice_id, revision_no, line_no, description, purity, hsn, gross_weight_mg, net_weight_mg, polish_mg, polish_bps,
   gold_rate_paise_per_kg, labour_rate_paise_per_kg, gst_rate_bps, chargeable_weight_mg, gold_amount_paise,
   labour_amount_paise, amount_paise, display_rate_paise_per_gram, pricing_mode, stone_weight_mg, stone_amount_paise,
   total_amount_paise, discount_paise, taxable_paise)
  VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)`;

/** Spec 019c R3: the lines of a pending sale are stored with the weights and labour, and no amounts. */
const pendingLineStatement = (db: D1Database, invoiceId: string, revisionNo: number, lineNo: number, l: { description: string; purity: string; hsn: string; grossWeightMg: number; netWeightMg: number; polishMg: number; polishBps: number; labourRatePaisePerKg: number }, chargeable: number) =>
  db
    .prepare(INSERT_PENDING_LINE)
    .bind(newId(), invoiceId, revisionNo, lineNo, l.description, l.purity, l.hsn, l.grossWeightMg, l.netWeightMg, l.polishMg, l.polishBps, 0, l.labourRatePaisePerKg, 300, chargeable, 0, 0, 0, 0, "weight", 0, 0, 0, 0, 0);


// ---- create a pending sale (spec 019c R1 to R4) ----
invoiceRoutes.post("/pending", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = pendingInvoiceRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    const body = validationBody(parsed.error);
    body.issues = parsed.error.issues.map((i) => ({
      field: i.path.length > 1 && i.path[0] === "lines" ? `lines.${Number(i.path[1]) + 1}.${String(i.path[2] ?? "")}` : String(i.path[0] ?? ""),
      message: i.message,
    }));
    return c.json(body, 400);
  }
  const b = parsed.data;
  if (b.invoiceDate > indiaDate(c.get("now"))) return c.json({ error: "future_date", message: "An invoice cannot be dated in the future" }, 400);
  const cust = await db.prepare("SELECT id, voided_at FROM customers WHERE id = ?1").bind(b.customerId).first<{ id: string; voided_at: string | null }>();
  if (!cust) return c.json({ error: "customer_not_found", message: "That customer does not exist" }, 400);
  if (cust.voided_at) return c.json({ error: "customer_voided", message: "That customer is voided. Restore them first." }, 409);

  const polished = b.lines.map((l) => ({ ...l, hsn: l.hsn.trim(), polishMg: polishWeightMg(l.netWeightMg, l.polishBps) }));
  const errors = validatePendingLines({
    taxMode: b.taxMode,
    lines: polished.map((l) => ({ hsn: l.hsn, grossWeightMg: l.grossWeightMg, netWeightMg: l.netWeightMg, polishMg: l.polishMg, labourRatePaisePerKg: l.labourRatePaisePerKg })),
  });
  if (errors.length) return c.json({ error: "calculation", errors }, 400);

  const id = b.id ?? newId();
  const canon = pendingCanon(b);
  const replay = classifyReplay(await loadRow(db, id), (row) => row.input_json === JSON.stringify(canon));
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different invoice" }, 409);
  if (replay.kind === "replay") return c.json(toResponse(replay.row, await loadLines(db, id, replay.row.revision_no), false));

  const fy = financialYearOf(b.invoiceDate);
  const header = await settingsSnapshot(db);
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT INTO number_series (series, fy, last_no) VALUES ('INV', ?1, 1) ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`).bind(fy),
      db
        .prepare(
          `INSERT INTO invoices
             (id, created_at, created_by, updated_at, updated_by, invoice_no, fy, serial, header_json, invoice_date, customer_id, customer_name,
              customer_name_search, customer_mobile, customer_address, customer_pan, tax_mode, reverse_charge, remarks,
              rates_json, input_json, taxable_paise, tax_paise, total_before_round_off_paise, round_off_paise,
              payable_paise, calc_json, discount_json, discount_paise, revision_no, rate_status)
           VALUES (?1, ?2, ?3, ?2, ?3,
              ${printedNumberSql("(SELECT last_no FROM number_series WHERE series = 'INV' AND fy = ?4)", ["?17", "?18", "?19"])}, ?4,
              (SELECT last_no FROM number_series WHERE series = 'INV' AND fy = ?4), ?5,
              ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, '{}', ?16, 0, 0, 0, 0, 0, '{}', '{}', 0, 1, 'pending')`,
        )
        .bind(
          id, now, user.id, fy, JSON.stringify(header), b.invoiceDate, b.customerId, b.customerName, nameSearchKey(b.customerName),
          b.customerMobile, b.customerAddress, b.customerPan, b.taxMode, b.reverseCharge ? 1 : 0, b.remarks, JSON.stringify(canon),
          ...printedNumberValues(header.numbering, "INV", fy),
        ),
      ...polished.map((l, i) => pendingLineStatement(db, id, 1, i + 1, l, l.netWeightMg + l.polishMg)),
      auditStatement(db, { actor: user.id, action: "invoice_pending_create", entity: "invoice", entityId: id, detail: { lines: b.lines.length, rateStatus: "pending" } }),
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

// ---- fix the rate of a pending sale (spec 019c R8 to R11) ----
invoiceRoutes.post("/:id/fix-rate", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const parsed = fixRateRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;
  const row = await loadRow(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "invoice_voided", message: "A voided invoice cannot be changed" }, 409);
  if ((row.rate_status ?? "fixed") !== "pending") {
    return c.json({ error: "already_fixed", message: "The rate of this sale is already fixed. Correct it by editing the invoice." }, 409);
  }
  if (b.expectedRevision !== row.revision_no) return c.json({ error: "stale_revision", message: "This invoice was changed. Reload it and try again." }, 409);

  const today = indiaDate(c.get("now"));
  const rateDate = b.rateDate ?? today;
  if (rateDate > today) return c.json({ error: "future_date", message: "The rate date cannot be in the future" }, 400);
  if (rateDate < row.invoice_date) return c.json({ error: "rate_date_before_sale", message: "The rate date cannot be before the sale date" }, 400);

  const lines = await loadLines(db, row.id, row.revision_no);
  const typed = new Map<number, number>();
  for (const t of b.typedRates ?? []) {
    if (!lines.some((l) => l.line_no === t.lineNo)) return c.json({ error: "validation", issues: [{ field: "typedRates", message: `Line ${t.lineNo} is not on this sale` }] }, 400);
    typed.set(t.lineNo, t.goldRatePaisePerKg);
  }

  // Spec 019c Q90: a typed rate wins; otherwise the applicable rate of the purity on the rate date (spec 011 R8).
  const goldRates: number[] = [];
  const missing: number[] = [];
  for (const l of lines) {
    const t = typed.get(l.line_no);
    if (t !== undefined) {
      goldRates.push(t);
      continue;
    }
    const kind = PURITY_RATE_KIND[l.purity as Purity];
    const applicable = kind ? await applicableRate(db, kind, rateDate) : null;
    if (!applicable) {
      missing.push(l.line_no);
      goldRates.push(0);
    } else goldRates.push(applicable.pricePaisePerKg);
  }
  if (missing.length) {
    return c.json({ error: "rate_missing", message: `There is no saved rate for line ${missing.join(", ")} on ${rateDate}. Type the rate for that line.`, lines: missing }, 400);
  }

  const input: PendingSaleInput = {
    taxMode: row.tax_mode,
    lines: lines.map((l) => ({ hsn: l.hsn, grossWeightMg: l.gross_weight_mg, netWeightMg: l.net_weight_mg, polishMg: l.polish_mg, labourRatePaisePerKg: l.labour_rate_paise_per_kg })),
  };
  const outcome = fixPendingRate(input, goldRates);
  if (!outcome.ok) return c.json({ error: "calculation", errors: outcome.errors }, 400);
  const result = outcome.result;

  const rates = Object.fromEntries(await Promise.all(RATE_KINDS.map(async (k) => [k, await applicableRate(db, k, rateDate)] as const))) as ApplicableRatesResponse["rates"];
  const oldCanon = JSON.parse(row.input_json) as { lines: Record<string, unknown>[] } & Record<string, unknown>;
  const canon = { ...oldCanon, lines: oldCanon.lines.map((l, i) => ({ ...l, goldRatePaisePerKg: goldRates[i] })) };

  // Spec 019c R8: the money already paid against this sale is applied now, oldest receipt first, up to the payable.
  const held = (
    await db
      .prepare(
        `SELECT p.id, p.amount_paise - COALESCE((SELECT SUM(a.amount_paise) FROM payment_allocations a WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0)
                - COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.payment_id = p.id AND r.reversed_at IS NULL), 0) AS remaining
         FROM payments p WHERE p.pending_invoice_id = ?1 AND p.voided_at IS NULL ORDER BY p.receipt_date, p.created_at, p.id`,
      )
      .bind(row.id)
      .all<{ id: string; remaining: number }>()
  ).results;
  let left = result.payablePaise;
  const applied: { paymentId: string; amount: number }[] = [];
  for (const h of held) {
    if (left <= 0) break;
    const take = Math.min(h.remaining, left);
    if (take > 0) {
      applied.push({ paymentId: h.id, amount: take });
      left -= take;
    }
  }
  const appliedTotal = result.payablePaise - left;

  const next = row.revision_no + 1;
  const now = new Date().toISOString();
  try {
    await db.batch([
      revisionStatement(db, { entity: "invoice", entityId: row.id, snapshot: row, reason: b.reason || "rate fixed", actor: user.id }),
      db
        .prepare(
          `UPDATE invoices SET updated_at = ?2, updated_by = ?3, rates_json = ?4, input_json = ?5, taxable_paise = ?6, tax_paise = ?7,
             total_before_round_off_paise = ?8, round_off_paise = ?9, payable_paise = ?10, calc_json = ?11, revision_no = ?12,
             rate_status = 'fixed', rate_fixed_on = ?13
           WHERE id = ?1 AND revision_no = ?14`,
        )
        .bind(row.id, now, user.id, JSON.stringify(rates), JSON.stringify(canon), result.taxablePaise, result.taxPaise, result.totalBeforeRoundOffPaise, result.roundOffPaise, result.payablePaise, JSON.stringify(result), next, rateDate, row.revision_no),
      ...lines.map((l, i) => {
        const r = result.lines[i]!;
        return db
          .prepare(INSERT_LINE)
          .bind(
            newId(), row.id, next, l.line_no, l.description, l.purity, l.hsn, l.gross_weight_mg, l.net_weight_mg, l.polish_mg, l.polish_bps,
            goldRates[i], l.labour_rate_paise_per_kg, 300, r.chargeableWeightMg, r.goldAmountPaise, r.labourAmountPaise, r.amountPaise, r.displayRatePaisePerGram,
            "weight", 0, 0, 0, 0, r.taxablePaise,
          );
      }),
      ...applied.map((a) =>
        db
          .prepare("INSERT INTO payment_allocations (id, payment_id, invoice_id, opening_balance_id, amount_paise, created_at, created_by) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)")
          .bind(newId(), a.paymentId, row.id, a.amount, now, user.id),
      ),
      auditStatement(db, {
        actor: user.id,
        action: "invoice_rate_fixed",
        entity: "invoice",
        entityId: row.id,
        detail: { fromRevision: row.revision_no, toRevision: next, rateDate, payablePaise: result.payablePaise, appliedPaise: appliedTotal, payments: applied.length, reason: b.reason || undefined },
      }),
    ]);
  } catch (e) {
    if (isUniqueError(e)) return c.json({ error: "stale_revision", message: "This invoice was changed. Reload it and try again." }, 409);
    const m = e instanceof Error ? e.message : "";
    if (/exceeds_due|exceeds_payment/.test(m)) return c.json({ error: "exceeds_due", message: "The money paid is more than the new amount allows. Reload and try again." }, 409);
    throw e;
  }
  const saved = (await loadRow(db, row.id))!;
  return c.json(toResponse(saved, await loadLines(db, row.id, next), false, await receivedOf(db, row.id)));
});
