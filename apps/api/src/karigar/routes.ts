import { Hono } from "hono";
import type { ZodError } from "zod";
import {
  KARIGAR_ENTRY_KIND_LABEL,
  KARIGAR_PAYMENT_MODE_LABEL,
  karigarCloseSchema,
  karigarCreateSchema,
  karigarIssueSchema,
  karigarJobOpenSchema,
  karigarPayoutSchema,
  karigarReturnSchema,
  newId,
  formatMoney,
  formatWeightGrams,
  type KarigarDetail,
  type KarigarDetailResponse,
  type KarigarEntryKind,
  type KarigarIssueLineInput,
  type KarigarJobDetail,
  type KarigarJobListItem,
  type KarigarJobListResponse,
  type KarigarJobResponse,
  type KarigarJobTotals,
  type KarigarListItem,
  type KarigarListResponse,
  type KarigarMetalBalance,
  type KarigarPaymentMode,
  type KarigarStatementResponse,
  type KarigarStatementRow,
  type InventoryMetal,
} from "@jewellery/shared";
import { allowanceMg, checkPayout, checkWastageAllowance, labourPaise, financialYearOf, type LabourBasis } from "@jewellery/calc";
import type { AppEnv } from "../env";
import { classifyReplay } from "../db/idempotency";
import { readJson } from "../http";
import { loadLocation } from "../inventory/routes";

/**
 * Spec 023: karigar job work. Every save is one D1 batch: the number, the job or lines, the raw metal movements
 * (spec 022 raw stock, through the Karigar place of spec 021b), and the audit row go together, so a refused save
 * writes nothing and uses no number. Balances are never stored; they are sums of the append-only entries.
 */
export const karigarRoutes = new Hono<AppEnv>();

const KARIGAR_PLACE = "loc-karigar";
const PAGE_SIZE = 20;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** K15: the metal a karigar holds, from issue, return, wastage and adjust entries. */
const HOLD_SQL = `SUM(CASE kind WHEN 'issue' THEN weight_mg WHEN 'adjust' THEN COALESCE(weight_mg, 0) WHEN 'return' THEN -weight_mg WHEN 'wastage' THEN -weight_mg ELSE 0 END)`;
/** K16: labour still owed, from labour, payout and adjust entries. */
const PAYABLE_SQL = `SUM(CASE kind WHEN 'labour' THEN amount_paise WHEN 'adjust' THEN COALESCE(amount_paise, 0) WHEN 'payout' THEN -amount_paise ELSE 0 END)`;

type JobRow = {
  id: string;
  created_at: string;
  created_by: string;
  job_no: string;
  fy: string;
  karigar_id: string;
  karigar_name: string;
  job_date: string;
  source_location_id: string;
  source_name: string;
  labour_basis: LabourBasis;
  labour_rate_paise: number;
  wastage_bps: number;
  remarks: string | null;
  status: "open" | "closed";
  closed_at: string | null;
  closed_by: string | null;
  close_remarks: string | null;
};

type EntryRow = {
  id: string;
  karigar_id: string;
  job_id: string | null;
  job_no: string | null;
  kind: KarigarEntryKind;
  entry_date: string;
  at: string;
  part: "finished" | "remainder" | null;
  metal: InventoryMetal | null;
  purity: string | null;
  weight_mg: number | null;
  pieces: number | null;
  tested_purity: string | null;
  rate_paise: number | null;
  amount_paise: number | null;
  payment_mode: KarigarPaymentMode | null;
  reference: string | null;
  reason: string | null;
  batch_id: string | null;
};

/** A karigar as stored (snake_case columns). */
type KarigarDb = { id: string; name: string; phone: string | null; remarks: string | null; created_at: string };

const JOB_SELECT = `SELECT j.id, j.created_at, j.created_by, j.job_no, j.fy, j.karigar_id, k.name AS karigar_name, j.job_date,
    j.source_location_id, l.name AS source_name, j.labour_basis, j.labour_rate_paise, j.wastage_bps, j.remarks, j.status,
    j.closed_at, j.closed_by, j.close_remarks
  FROM karigar_jobs j JOIN karigars k ON k.id = j.karigar_id JOIN stock_locations l ON l.id = j.source_location_id`;

const loadJob = (db: D1Database, id: string) => db.prepare(`${JOB_SELECT} WHERE j.id = ?1`).bind(id).first<JobRow>();
const loadKarigar = (db: D1Database, id: string) => db.prepare("SELECT id, name, phone, remarks, created_at FROM karigars WHERE id = ?1").bind(id).first<KarigarDb>();

/** A validation error with fields like `issues.2.weightMg` (lines numbered from 1, as the screen shows them). */
function karigarValidation(error: ZodError) {
  return {
    error: "validation" as const,
    issues: error.issues.map((i) => ({ field: i.path.map((p) => (typeof p === "number" ? String(p + 1) : String(p))).join("."), message: i.message })),
  };
}

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const dbMessage = (e: unknown) => (e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : "");
const grams = (mg: number) => `${formatWeightGrams(mg)} g`;

/** Metal still held by each karigar, per metal and purity (karigarId null: every karigar). */
async function balancesFor(db: D1Database, karigarId: string | null): Promise<Map<string, KarigarMetalBalance[]>> {
  const rows = (
    await db
      .prepare(
        `SELECT karigar_id, metal, purity, ${HOLD_SQL} AS held FROM karigar_job_entries
         WHERE metal IS NOT NULL AND kind IN ('issue', 'return', 'wastage', 'adjust') AND (?1 IS NULL OR karigar_id = ?1)
         GROUP BY karigar_id, metal, purity ORDER BY metal, purity`,
      )
      .bind(karigarId)
      .all<{ karigar_id: string; metal: InventoryMetal; purity: string; held: number }>()
  ).results;
  const out = new Map<string, KarigarMetalBalance[]>();
  for (const r of rows) {
    if (r.held === 0) continue;
    const list = out.get(r.karigar_id) ?? [];
    list.push({ metal: r.metal, purity: r.purity, heldMg: r.held });
    out.set(r.karigar_id, list);
  }
  return out;
}

/** Labour accrued, paid and still owed per karigar (paise). */
async function labourFor(db: D1Database, karigarId: string | null) {
  const rows = (
    await db
      .prepare(
        `SELECT karigar_id,
           SUM(CASE WHEN kind IN ('labour', 'adjust') THEN COALESCE(amount_paise, 0) ELSE 0 END) AS accrued,
           SUM(CASE WHEN kind = 'payout' THEN amount_paise ELSE 0 END) AS paid,
           ${PAYABLE_SQL} AS payable
         FROM karigar_job_entries WHERE kind IN ('labour', 'payout', 'adjust') AND (?1 IS NULL OR karigar_id = ?1) GROUP BY karigar_id`,
      )
      .bind(karigarId)
      .all<{ karigar_id: string; accrued: number; paid: number; payable: number }>()
  ).results;
  return new Map(rows.map((r) => [r.karigar_id, { accrued: r.accrued, paid: r.paid, payable: r.payable }]));
}

async function karigarDetail(db: D1Database, k: KarigarDb): Promise<KarigarDetail> {
  const balances = (await balancesFor(db, k.id)).get(k.id) ?? [];
  const labour = (await labourFor(db, k.id)).get(k.id) ?? { accrued: 0, paid: 0, payable: 0 };
  return {
    id: k.id,
    name: k.name,
    phone: k.phone,
    remarks: k.remarks,
    createdAt: k.created_at,
    balances,
    labourAccruedPaise: labour.accrued,
    labourPaidPaise: labour.paid,
    labourPayablePaise: labour.payable,
  };
}

/** K17: the karigar's statement with running balances. Read in order, so a job's rows carry the karigar's running figures. */
async function statementFor(db: D1Database, karigarId: string, jobId: string | null): Promise<KarigarStatementRow[]> {
  const entries = (
    await db
      .prepare(
        `SELECT e.id, e.karigar_id, e.job_id, j.job_no, e.kind, e.entry_date, e.at, e.part, e.metal, e.purity, e.weight_mg, e.pieces,
           e.tested_purity, e.rate_paise, e.amount_paise, e.payment_mode, e.reference, e.reason, e.batch_id
         FROM karigar_job_entries e LEFT JOIN karigar_jobs j ON j.id = e.job_id
         WHERE e.karigar_id = ?1 ORDER BY e.entry_date, e.at, e.rowid`,
      )
      .bind(karigarId)
      .all<EntryRow>()
  ).results;
  const held = new Map<string, number>();
  let payable = 0;
  const rows: KarigarStatementRow[] = [];
  for (const e of entries) {
    let heldAfter: number | null = null;
    if (e.metal && e.purity && (e.kind === "issue" || e.kind === "return" || e.kind === "wastage" || e.kind === "adjust")) {
      const key = `${e.metal}|${e.purity}`;
      const w = e.weight_mg ?? 0;
      const change = e.kind === "issue" || e.kind === "adjust" ? w : -w;
      heldAfter = (held.get(key) ?? 0) + change;
      held.set(key, heldAfter);
    }
    if (e.kind === "labour" || e.kind === "adjust") payable += e.amount_paise ?? 0;
    if (e.kind === "payout") payable -= e.amount_paise ?? 0;
    if (jobId !== null && e.job_id !== jobId) continue;
    rows.push({
      id: e.id,
      entryDate: e.entry_date,
      kind: e.kind,
      kindLabel: KARIGAR_ENTRY_KIND_LABEL[e.kind],
      jobId: e.job_id,
      jobNo: e.job_no,
      part: e.part,
      metal: e.metal,
      purity: e.purity,
      weightMg: e.weight_mg,
      pieces: e.pieces,
      testedPurity: e.tested_purity,
      amountPaise: e.amount_paise,
      paymentMode: e.payment_mode,
      paymentModeLabel: e.payment_mode ? KARIGAR_PAYMENT_MODE_LABEL[e.payment_mode] : null,
      reference: e.reference,
      reason: e.reason,
      heldAfterMg: heldAfter,
      labourPayableAfterPaise: payable,
    });
  }
  return rows;
}

async function issuedLines(db: D1Database, jobId: string) {
  return (
    await db
      .prepare(
        `SELECT metal, purity, SUM(weight_mg) AS weight_mg FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'issue' GROUP BY metal, purity ORDER BY metal, purity`,
      )
      .bind(jobId)
      .all<{ metal: InventoryMetal; purity: string; weight_mg: number }>()
  ).results.map((r) => ({ metal: r.metal, purity: r.purity, weightMg: r.weight_mg }));
}

function jobListItem(j: JobRow, issued: KarigarJobListItem["issued"]): KarigarJobListItem {
  return {
    id: j.id,
    jobNo: j.job_no,
    jobDate: j.job_date,
    karigarId: j.karigar_id,
    karigarName: j.karigar_name,
    status: j.status,
    sourceLocationName: j.source_name,
    labourBasis: j.labour_basis,
    labourRatePaise: j.labour_rate_paise,
    wastageBps: j.wastage_bps,
    issued,
  };
}

/** K12 and K5, K11: the totals per metal and purity of one job, from its entries. */
async function jobTotals(db: D1Database, job: JobRow): Promise<{ totals: KarigarJobTotals[]; finishedPieces: number; labourAccruedPaise: number }> {
  const rows = (
    await db
      .prepare(
        `SELECT metal, purity,
           COALESCE(SUM(CASE WHEN kind = 'issue' THEN weight_mg END), 0) AS issued,
           COALESCE(SUM(CASE WHEN kind = 'return' AND part = 'finished' THEN weight_mg END), 0) AS finished,
           COALESCE(SUM(CASE WHEN kind = 'return' AND part = 'remainder' THEN weight_mg END), 0) AS remainder,
           COALESCE(SUM(CASE WHEN kind = 'wastage' THEN weight_mg END), 0) AS wastage,
           ${HOLD_SQL} AS held
         FROM karigar_job_entries WHERE job_id = ?1 AND metal IS NOT NULL GROUP BY metal, purity ORDER BY metal, purity`,
      )
      .bind(job.id)
      .all<{ metal: InventoryMetal; purity: string; issued: number; finished: number; remainder: number; wastage: number; held: number }>()
  ).results;
  const pieces = await db
    .prepare(`SELECT COALESCE(SUM(pieces), 0) AS n FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'return' AND part = 'finished'`)
    .bind(job.id)
    .first<{ n: number }>();
  const labour = await db
    .prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS n FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'labour'`)
    .bind(job.id)
    .first<{ n: number }>();
  return {
    totals: rows.map((r) => ({
      metal: r.metal,
      purity: r.purity,
      issuedMg: r.issued,
      finishedMg: r.finished,
      remainderMg: r.remainder,
      wastageMg: r.wastage,
      heldMg: r.held,
      allowanceMg: allowanceMg(r.issued, job.wastage_bps),
    })),
    finishedPieces: pieces?.n ?? 0,
    labourAccruedPaise: labour?.n ?? 0,
  };
}

async function jobDetail(db: D1Database, job: JobRow): Promise<KarigarJobDetail> {
  const { totals, finishedPieces, labourAccruedPaise } = await jobTotals(db, job);
  return {
    ...jobListItem(job, await issuedLines(db, job.id)),
    remarks: job.remarks,
    closedAt: job.closed_at,
    closedBy: job.closed_by,
    closeRemarks: job.close_remarks,
    totals,
    finishedPieces,
    labourAccruedPaise,
    statement: await statementFor(db, job.karigar_id, job.id),
  };
}

/** Metal of a purity that is issued on a job, with its metal (a return may only name these). */
async function jobPurities(db: D1Database, jobId: string) {
  return new Map((await issuedLines(db, jobId)).map((l) => [l.purity, l.metal]));
}

/** The raw metal a batch takes from a place, per metal and purity, must be in stock there (spec 022 PU14). */
async function rawShortage(db: D1Database, place: string, needs: Map<string, { metal: string; purity: string; mg: number }>, placeName: string) {
  for (const n of needs.values()) {
    const have =
      (
        await db
          .prepare("SELECT COALESCE(SUM(weight_mg), 0) AS w FROM raw_metal_movements WHERE metal = ?1 AND purity = ?2 AND location_id = ?3")
          .bind(n.metal, n.purity, place)
          .first<{ w: number }>()
      )?.w ?? 0;
    if (have < n.mg) {
      return `Only ${grams(have)} of ${n.purity === "silver" ? "silver" : `${n.metal} ${n.purity}`} is in stock at ${placeName}, so ${grams(n.mg)} cannot be issued`;
    }
  }
  return null;
}

function addNeed(needs: Map<string, { metal: string; purity: string; mg: number }>, metal: string, purity: string, mg: number) {
  const key = `${metal}|${purity}`;
  const cur = needs.get(key) ?? { metal, purity, mg: 0 };
  cur.mg += mg;
  needs.set(key, cur);
}

/** K4: the statements of one issue: the source place goes down, the Karigar place goes up, linked to the entry. */
function issueStatements(db: D1Database, p: { jobId: string; entryId: string; at: string; actor: string; source: string; metal: string; purity: string; mg: number }) {
  return [
    db
      .prepare(
        `INSERT INTO raw_metal_movements (id, created_at, created_by, metal, purity, weight_mg, location_id, at, actor, reason, karigar_entry_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?2, ?3, 'Issued on ' || (SELECT job_no FROM karigar_jobs WHERE id = ?8), ?9)`,
      )
      .bind(newId(), p.at, p.actor, p.metal, p.purity, -p.mg, p.source, p.jobId, p.entryId),
    db
      .prepare(
        `INSERT INTO raw_metal_movements (id, created_at, created_by, metal, purity, weight_mg, location_id, at, actor, reason, karigar_entry_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?2, ?3, 'Issued on ' || (SELECT job_no FROM karigar_jobs WHERE id = ?8), ?9)`,
      )
      .bind(newId(), p.at, p.actor, p.metal, p.purity, p.mg, KARIGAR_PLACE, p.jobId, p.entryId),
  ];
}

const issueEntry = (p: { id: string; karigarId: string; jobId: string; date: string; at: string; actor: string; source: string; line: KarigarIssueLineInput; batchId: string | null }) =>
  // The issue row: the metal and purity as issued, from the source place.
  ({
    sql: `INSERT INTO karigar_job_entries (id, created_at, created_by, updated_at, updated_by, karigar_id, job_id, kind, entry_date, at, actor,
            metal, purity, weight_mg, location_id, batch_id)
          VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, 'issue', ?6, ?2, ?3, ?7, ?8, ?9, ?10, ?11)`,
    args: [p.id, p.at, p.actor, p.karigarId, p.jobId, p.date, p.line.metal, p.line.purity, p.line.weightMg, p.source, p.batchId],
  });

// ---- karigars ----

karigarRoutes.get("/karigars", async (c) => {
  const db = c.env.DB;
  const karigars = (await db.prepare("SELECT id, name, phone, remarks, created_at FROM karigars ORDER BY name COLLATE NOCASE, id").all<KarigarDb>()).results;
  const balances = await balancesFor(db, null);
  const labour = await labourFor(db, null);
  const open = new Map(
    (await db.prepare("SELECT karigar_id, COUNT(*) AS n FROM karigar_jobs WHERE status = 'open' GROUP BY karigar_id").all<{ karigar_id: string; n: number }>()).results.map((r) => [r.karigar_id, r.n]),
  );
  const items: KarigarListItem[] = karigars.map((k) => ({
    id: k.id,
    name: k.name,
    phone: k.phone,
    remarks: k.remarks,
    createdAt: k.created_at,
    openJobs: open.get(k.id) ?? 0,
    balances: balances.get(k.id) ?? [],
    labourPayablePaise: labour.get(k.id)?.payable ?? 0,
  }));
  return c.json<KarigarListResponse>({ items });
});

karigarRoutes.post("/karigars", async (c) => {
  const parsed = karigarCreateSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(karigarValidation(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = f.id ?? newId();
  const existing = await loadKarigar(db, id);
  const replay = classifyReplay(existing, (k) => k.name === f.name && k.phone === f.phone && k.remarks === f.remarks);
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different karigar" }, 409);
  if (replay.kind === "replay") return c.json({ karigar: await karigarDetail(db, replay.row) });
  const now = c.get("now").toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO karigars (id, created_at, created_by, updated_at, updated_by, name, phone, remarks) VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, ?6)")
      .bind(id, now, user.id, f.name, f.phone, f.remarks),
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json) VALUES (?1, ?2, ?3, 'karigar_create', 'karigar', ?4, json_object('name', ?5))`)
      .bind(newId(), now, user.id, id, f.name),
  ]);
  return c.json({ karigar: await karigarDetail(db, (await loadKarigar(db, id))!) }, 201);
});

karigarRoutes.get("/karigars/:id", async (c) => {
  const db = c.env.DB;
  const k = await loadKarigar(db, c.req.param("id"));
  if (!k) return c.json({ error: "not_found" }, 404);
  const jobs = await jobsPage(db, { karigarId: k.id, status: "", offset: 0 });
  const response: KarigarDetailResponse = { karigar: await karigarDetail(db, k), jobs: jobs.items, statement: await statementFor(db, k.id, null) };
  return c.json(response);
});

karigarRoutes.get("/karigars/:id/statement", async (c) => {
  const db = c.env.DB;
  const k = await loadKarigar(db, c.req.param("id"));
  if (!k) return c.json({ error: "not_found" }, 404);
  return c.json<KarigarStatementResponse>({ karigar: await karigarDetail(db, k), statement: await statementFor(db, k.id, null) });
});

// K12, K13: a payout to the karigar.
karigarRoutes.post("/karigars/:id/payouts", async (c) => {
  const parsed = karigarPayoutSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(karigarValidation(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const k = await loadKarigar(db, c.req.param("id"));
  if (!k) return c.json({ error: "not_found" }, 404);
  const id = f.id ?? newId();
  const existing = await db
    .prepare("SELECT id, karigar_id, amount_paise, payment_mode, reference, reason, entry_date FROM karigar_job_entries WHERE id = ?1 AND kind = 'payout'")
    .bind(id)
    .first<{ id: string; karigar_id: string; amount_paise: number; payment_mode: string; reference: string | null; reason: string | null; entry_date: string }>();
  const replay = classifyReplay(existing, (p) => p.karigar_id === k.id && p.amount_paise === f.amountPaise && p.payment_mode === f.paymentMode && p.reference === f.reference && p.reason === f.remarks && p.entry_date === f.payoutDate);
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different payment" }, 409);
  if (replay.kind === "replay") return c.json({ karigar: await karigarDetail(db, k), payoutId: id });
  const payable = (await labourFor(db, k.id)).get(k.id)?.payable ?? 0;
  const check = checkPayout({ amountPaise: f.amountPaise, payableBeforePaise: payable });
  if (!check.ok) return c.json({ error: "payout_over_balance", message: `${check.error}. Enter an amount up to ${formatMoney(payable)}.` }, 409);
  const now = c.get("now").toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO karigar_job_entries (id, created_at, created_by, updated_at, updated_by, karigar_id, job_id, kind, entry_date, at, actor,
             amount_paise, payment_mode, reference, reason)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, NULL, 'payout', ?5, ?2, ?3, ?6, ?7, ?8, ?9)`,
        )
        .bind(id, now, user.id, k.id, f.payoutDate, f.amountPaise, f.paymentMode, f.reference, f.remarks),
      db
        .prepare(`INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json) VALUES (?1, ?2, ?3, 'karigar_payout', 'karigar', ?4, json_object('amountPaise', ?5, 'mode', ?6))`)
        .bind(newId(), now, user.id, k.id, f.amountPaise, f.paymentMode),
    ]);
  } catch (e) {
    if (/payout_over_balance/.test(dbMessage(e))) return c.json({ error: "payout_over_balance", message: `The payout is more than the labour owed. Enter an amount up to ${formatMoney(payable)}.` }, 409);
    if (isUniqueError(e)) return c.json({ error: "id_conflict", message: "This id is already used by a different payment" }, 409);
    throw e;
  }
  return c.json({ karigar: await karigarDetail(db, k), payoutId: id }, 201);
});

// ---- jobs ----

async function jobsPage(db: D1Database, q: { karigarId: string; status: string; offset: number }) {
  const rows = (
    await db
      .prepare(
        `${JOB_SELECT} WHERE (?1 = '' OR j.karigar_id = ?1) AND (?2 = '' OR j.status = ?2)
         ORDER BY j.job_date DESC, j.created_at DESC, j.id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${q.offset}`,
      )
      .bind(q.karigarId, q.status)
      .all<JobRow>()
  ).results;
  const items: KarigarJobListItem[] = [];
  for (const j of rows.slice(0, PAGE_SIZE)) items.push(jobListItem(j, await issuedLines(db, j.id)));
  return { items, nextCursor: rows.length > PAGE_SIZE ? String(q.offset + PAGE_SIZE) : null };
}

karigarRoutes.get("/jobs", async (c) => {
  const status = c.req.query("status") ?? "";
  if (status && status !== "open" && status !== "closed") return c.json({ error: "validation", issues: [{ field: "status", message: "Use open or closed" }] }, 400);
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  return c.json<KarigarJobListResponse>(await jobsPage(c.env.DB, { karigarId: c.req.query("karigarId") ?? "", status, offset }));
});

karigarRoutes.get("/jobs/:id", async (c) => {
  const db = c.env.DB;
  const job = await loadJob(db, c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  return c.json<KarigarJobResponse>({ job: await jobDetail(db, job) });
});

// K3, K4: open a job with its issue lines.
karigarRoutes.post("/jobs", async (c) => {
  const parsed = karigarJobOpenSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(karigarValidation(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = f.id ?? newId();
  const existing = await loadJob(db, id);
  if (existing) {
    const lines = (await db.prepare("SELECT metal, purity, weight_mg FROM karigar_job_entries WHERE job_id = ?1 AND kind = 'issue' ORDER BY rowid").bind(id).all<{ metal: string; purity: string; weight_mg: number }>()).results;
    const same =
      existing.karigar_id === f.karigarId &&
      existing.job_date === f.jobDate &&
      existing.source_location_id === f.sourceLocationId &&
      existing.labour_basis === f.labourBasis &&
      existing.labour_rate_paise === f.labourRatePaise &&
      existing.wastage_bps === f.wastageBps &&
      existing.remarks === f.remarks &&
      lines.length === f.issues.length &&
      f.issues.every((l, i) => lines[i]!.metal === l.metal && lines[i]!.purity === l.purity && lines[i]!.weight_mg === l.weightMg);
    const replay = classifyReplay(existing, () => same);
    if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different job" }, 409);
    return c.json<KarigarJobResponse>({ job: await jobDetail(db, existing) });
  }
  let fy: string;
  try {
    fy = financialYearOf(f.jobDate);
  } catch {
    return c.json({ error: "validation", issues: [{ field: "jobDate", message: "That is not a real date. Use the date as 2026-11-02" }] }, 400);
  }
  const karigar = await loadKarigar(db, f.karigarId);
  if (!karigar) return c.json({ error: "validation", issues: [{ field: "karigarId", message: "Choose the karigar from the list" }] }, 400);
  const place = await loadLocation(db, f.sourceLocationId);
  if (!place) return c.json({ error: "validation", issues: [{ field: "sourceLocationId", message: "Choose the place from the list" }] }, 400);
  if (!place.active) return c.json({ error: "location_inactive", message: `${place.name} is not active. Choose another place.` }, 409);

  const needs = new Map<string, { metal: string; purity: string; mg: number }>();
  for (const l of f.issues) addNeed(needs, l.metal, l.purity, l.weightMg);
  const short = await rawShortage(db, f.sourceLocationId, needs, place.name);
  if (short) return c.json({ error: "raw_stock_short", message: short }, 409);

  const now = c.get("now").toISOString();
  const batch: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO number_series (series, fy, last_no) VALUES ('JOB', ?1, 1) ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`).bind(fy),
    db
      .prepare(
        `INSERT INTO karigar_jobs (id, created_at, created_by, updated_at, updated_by, job_no, fy, serial, karigar_id, job_date, source_location_id,
           labour_basis, labour_rate_paise, wastage_bps, remarks, status)
         VALUES (?1, ?2, ?3, ?2, ?3,
           'JOB-' || printf('%04d', (SELECT last_no FROM number_series WHERE series = 'JOB' AND fy = ?4)), ?4,
           (SELECT last_no FROM number_series WHERE series = 'JOB' AND fy = ?4), ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'open')`,
      )
      .bind(id, now, user.id, fy, f.karigarId, f.jobDate, f.sourceLocationId, f.labourBasis, f.labourRatePaise, f.wastageBps, f.remarks),
  ];
  for (const line of f.issues) {
    const entryId = newId();
    const e = issueEntry({ id: entryId, karigarId: f.karigarId, jobId: id, date: f.jobDate, at: now, actor: user.id, source: f.sourceLocationId, line, batchId: id });
    batch.push(db.prepare(e.sql).bind(...e.args));
    batch.push(...issueStatements(db, { jobId: id, entryId, at: now, actor: user.id, source: f.sourceLocationId, metal: line.metal, purity: line.purity, mg: line.weightMg }));
  }
  batch.push(
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json) VALUES (?1, ?2, ?3, 'karigar_job_open', 'karigar_job', ?4, json_object('jobNo', (SELECT job_no FROM karigar_jobs WHERE id = ?4), 'lines', ?5))`)
      .bind(newId(), now, user.id, id, f.issues.length),
  );
  try {
    await db.batch(batch);
  } catch (e) {
    if (/raw_stock_below_zero/.test(dbMessage(e))) return c.json({ error: "raw_stock_short", message: "The raw stock at the place is not enough for this job. Nothing was saved." }, 409);
    if (isUniqueError(e)) {
      const again = await loadJob(db, id);
      if (again) return c.json<KarigarJobResponse>({ job: await jobDetail(db, again) });
      return c.json({ error: "stale", message: "The job number was taken. Save again." }, 409);
    }
    throw e;
  }
  return c.json<KarigarJobResponse>({ job: await jobDetail(db, (await loadJob(db, id))!) }, 201);
});

// K5: more metal to a job that is still open (several deliveries).
karigarRoutes.post("/jobs/:id/issues", async (c) => {
  const parsed = karigarIssueSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(karigarValidation(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const job = await loadJob(db, c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  const batchId = f.id ?? newId();
  const already = await db.prepare("SELECT COUNT(*) AS n FROM karigar_job_entries WHERE batch_id = ?1").bind(batchId).first<{ n: number }>();
  if (already && already.n > 0) return c.json<KarigarJobResponse>({ job: await jobDetail(db, job) });
  if (job.status !== "open") return c.json({ error: "job_closed", message: `${job.job_no} is closed, so no metal can be added to it` }, 409);
  try {
    financialYearOf(f.issueDate);
  } catch {
    return c.json({ error: "validation", issues: [{ field: "issueDate", message: "That is not a real date. Use the date as 2026-11-02" }] }, 400);
  }
  const needs = new Map<string, { metal: string; purity: string; mg: number }>();
  for (const l of f.issues) addNeed(needs, l.metal, l.purity, l.weightMg);
  const short = await rawShortage(db, job.source_location_id, needs, job.source_name);
  if (short) return c.json({ error: "raw_stock_short", message: short }, 409);
  const now = c.get("now").toISOString();
  const batch: D1PreparedStatement[] = [];
  for (const line of f.issues) {
    const entryId = newId();
    const e = issueEntry({ id: entryId, karigarId: job.karigar_id, jobId: job.id, date: f.issueDate, at: now, actor: user.id, source: job.source_location_id, line, batchId });
    batch.push(db.prepare(e.sql).bind(...e.args));
    batch.push(...issueStatements(db, { jobId: job.id, entryId, at: now, actor: user.id, source: job.source_location_id, metal: line.metal, purity: line.purity, mg: line.weightMg }));
  }
  batch.push(
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json) VALUES (?1, ?2, ?3, 'karigar_issue', 'karigar_job', ?4, json_object('lines', ?5))`)
      .bind(newId(), now, user.id, job.id, f.issues.length),
  );
  try {
    await db.batch(batch);
  } catch (e) {
    if (/raw_stock_below_zero/.test(dbMessage(e))) return c.json({ error: "raw_stock_short", message: "The raw stock at the place is not enough for this delivery. Nothing was saved." }, 409);
    if (/job_closed/.test(dbMessage(e))) return c.json({ error: "job_closed", message: `${job.job_no} is closed, so no metal can be added to it` }, 409);
    throw e;
  }
  return c.json<KarigarJobResponse>({ job: await jobDetail(db, (await loadJob(db, job.id))!) }, 201);
});

// K6, K7, K8: record what came back. Finished pieces carry labour; the remainder goes back to the source place.
karigarRoutes.post("/jobs/:id/returns", async (c) => {
  const parsed = karigarReturnSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(karigarValidation(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const job = await loadJob(db, c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  const batchId = f.id ?? newId();
  const already = await db.prepare("SELECT COUNT(*) AS n FROM karigar_job_entries WHERE batch_id = ?1").bind(batchId).first<{ n: number }>();
  if (already && already.n > 0) return c.json<KarigarJobResponse>({ job: await jobDetail(db, job) });
  if (job.status !== "open") return c.json({ error: "job_closed", message: `${job.job_no} is closed, so nothing more can be returned on it` }, 409);
  if (!DATE.test(f.returnDate)) return c.json({ error: "validation", issues: [{ field: "returnDate", message: "Use the date as 2026-11-02" }] }, 400);

  const purities = await jobPurities(db, job.id);
  const held = new Map<string, number>();
  for (const t of (await jobTotals(db, job)).totals) held.set(t.purity, t.heldMg);
  const issues: { field: string; message: string }[] = [];
  const plan: { line: (typeof f.lines)[number]; metal: string; labour: number | null }[] = [];
  for (const [i, l] of f.lines.entries()) {
    const metal = purities.get(l.purity);
    if (!metal) {
      issues.push({ field: `lines.${i + 1}.purity`, message: `${l.purity} is not issued on ${job.job_no}` });
      continue;
    }
    if (l.part === "finished" && l.testedPurity !== l.purity) {
      return c.json(
        { error: "purity_mismatch", message: `Line ${i + 1}: the pieces test ${l.testedPurity}, not ${l.purity}. A purity change is not recorded on a job yet. Nothing was saved.` },
        409,
      );
    }
    const before = held.get(l.purity) ?? 0;
    if (l.weightMg > before) {
      const label = l.purity === "silver" ? "silver" : `${metal} ${l.purity}`;
      return c.json(
        { error: "return_exceeds_holding", message: `Line ${i + 1}: only ${grams(before)} of ${label} is with the karigar on ${job.job_no}. Nothing was saved.` },
        409,
      );
    }
    held.set(l.purity, before - l.weightMg);
    let labour: number | null = null;
    if (l.part === "finished") {
      const r = labourPaise({ basis: job.labour_basis, weightMg: l.weightMg, pieces: l.pieces, ratePaise: job.labour_rate_paise });
      if (!r.ok) return c.json({ error: "validation", issues: [{ field: `lines.${i + 1}.pieces`, message: r.error }] }, 400);
      labour = r.result;
    }
    plan.push({ line: l, metal, labour });
  }
  if (issues.length) return c.json({ error: "validation", issues }, 400);

  const now = c.get("now").toISOString();
  const batch: D1PreparedStatement[] = [];
  for (const p of plan) {
    const l = p.line;
    const entryId = newId();
    const fin = l.part === "finished" ? l : null;
    // Finished metal goes out of the Karigar place (it is jewellery now); the remainder goes out of it and back to the source place.
    const where = fin ? KARIGAR_PLACE : job.source_location_id;
    batch.push(
      db
        .prepare(
          `INSERT INTO karigar_job_entries (id, created_at, created_by, updated_at, updated_by, karigar_id, job_id, kind, entry_date, at, actor,
             part, metal, purity, weight_mg, pieces, tested_purity, location_id, batch_id)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, 'return', ?6, ?2, ?3, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        )
        .bind(entryId, now, user.id, job.karigar_id, job.id, f.returnDate, l.part, p.metal, l.purity, l.weightMg, fin ? fin.pieces : null, fin ? fin.testedPurity : null, where, batchId),
    );
    batch.push(
      db
        .prepare(
          `INSERT INTO raw_metal_movements (id, created_at, created_by, metal, purity, weight_mg, location_id, at, actor, reason, karigar_entry_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?2, ?3, '${fin ? "Finished from" : "Returned from"} ' || (SELECT job_no FROM karigar_jobs WHERE id = ?8), ?9)`,
        )
        .bind(newId(), now, user.id, p.metal, l.purity, -l.weightMg, KARIGAR_PLACE, job.id, entryId),
    );
    if (!fin) {
      batch.push(
        db
          .prepare(
            `INSERT INTO raw_metal_movements (id, created_at, created_by, metal, purity, weight_mg, location_id, at, actor, reason, karigar_entry_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?2, ?3, 'Returned from ' || (SELECT job_no FROM karigar_jobs WHERE id = ?8), ?9)`,
          )
          .bind(newId(), now, user.id, p.metal, l.purity, l.weightMg, job.source_location_id, job.id, entryId),
      );
    }
    if (p.labour !== null) {
      batch.push(
        db
          .prepare(
            `INSERT INTO karigar_job_entries (id, created_at, created_by, updated_at, updated_by, karigar_id, job_id, kind, entry_date, at, actor,
               weight_mg, pieces, basis, rate_paise, amount_paise, location_id, batch_id)
             VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, 'labour', ?6, ?2, ?3, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
          )
          .bind(newId(), now, user.id, job.karigar_id, job.id, f.returnDate, l.weightMg, fin ? fin.pieces : 0, job.labour_basis, job.labour_rate_paise, p.labour, KARIGAR_PLACE, batchId),
      );
    }
  }
  batch.push(
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json) VALUES (?1, ?2, ?3, 'karigar_return', 'karigar_job', ?4, json_object('lines', ?5))`)
      .bind(newId(), now, user.id, job.id, plan.length),
  );
  try {
    await db.batch(batch);
  } catch (e) {
    if (/return_exceeds_holding/.test(dbMessage(e))) return c.json({ error: "return_exceeds_holding", message: "The karigar does not hold that much metal on this job. Nothing was saved." }, 409);
    if (/job_closed/.test(dbMessage(e))) return c.json({ error: "job_closed", message: `${job.job_no} is closed` }, 409);
    throw e;
  }
  return c.json<KarigarJobResponse>({ job: await jobDetail(db, (await loadJob(db, job.id))!) }, 201);
});

// K10: close the job. The metal still held is written off as wastage, but only within the allowance.
karigarRoutes.post("/jobs/:id/close", async (c) => {
  const parsed = karigarCloseSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(karigarValidation(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const job = await loadJob(db, c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  if (job.status !== "open") return c.json({ error: "job_closed", message: `${job.job_no} is already closed` }, 409);
  const { totals } = await jobTotals(db, job);
  const write: { purity: string; metal: string; mg: number }[] = [];
  for (const t of totals) {
    if (t.heldMg === 0) continue;
    const check = checkWastageAllowance({ heldMg: t.heldMg, issuedMg: t.issuedMg, wastageBps: job.wastage_bps });
    if (!check.ok) {
      const label = t.purity === "silver" ? "silver" : `${t.metal} ${t.purity}`;
      return c.json(
        {
          error: "wastage_over_allowance",
          message: `${grams(t.heldMg)} of ${label} is still with the karigar, which is more than the ${grams(t.allowanceMg)} allowed on this job. Record the return first.`,
        },
        409,
      );
    }
    write.push({ purity: t.purity, metal: t.metal, mg: t.heldMg });
  }
  const now = c.get("now").toISOString();
  const batch: D1PreparedStatement[] = [];
  for (const w of write) {
    const entryId = newId();
    batch.push(
      db
        .prepare(
          `INSERT INTO karigar_job_entries (id, created_at, created_by, updated_at, updated_by, karigar_id, job_id, kind, entry_date, at, actor,
             metal, purity, weight_mg, location_id)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, 'wastage', ?6, ?2, ?3, ?7, ?8, ?9, ?10)`,
        )
        .bind(entryId, now, user.id, job.karigar_id, job.id, f.closeDate, w.metal, w.purity, w.mg, KARIGAR_PLACE),
    );
    batch.push(
      db
        .prepare(
          `INSERT INTO raw_metal_movements (id, created_at, created_by, metal, purity, weight_mg, location_id, at, actor, reason, karigar_entry_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?2, ?3, 'Wastage on ' || (SELECT job_no FROM karigar_jobs WHERE id = ?8), ?9)`,
        )
        .bind(newId(), now, user.id, w.metal, w.purity, -w.mg, KARIGAR_PLACE, job.id, entryId),
    );
  }
  batch.push(
    db
      .prepare(
        `UPDATE karigar_jobs SET status = 'closed', closed_at = ?2, closed_by = ?3, close_remarks = ?4, updated_at = ?2, updated_by = ?3
         WHERE id = ?1 AND status = 'open'`,
      )
      .bind(job.id, now, user.id, f.remarks),
  );
  batch.push(
    db
      .prepare(`INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json) VALUES (?1, ?2, ?3, 'karigar_close', 'karigar_job', ?4, json_object('jobNo', ?5, 'wastageLines', ?6))`)
      .bind(newId(), now, user.id, job.id, job.job_no, write.length),
  );
  try {
    await db.batch(batch);
  } catch (e) {
    if (/job_closed|job_locked/.test(dbMessage(e))) return c.json({ error: "job_closed", message: `${job.job_no} is already closed` }, 409);
    throw e;
  }
  return c.json<KarigarJobResponse>({ job: await jobDetail(db, (await loadJob(db, job.id))!) });
});
