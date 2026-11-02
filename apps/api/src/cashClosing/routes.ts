import { Hono } from "hono";
import {
  cashClosingRequestSchema,
  cashDifferencePaise,
  cashNoteRequestSchema,
  expectedCashPaise,
  indiaDate,
  isValidBusinessDate,
  newId,
  type CashClosingDayResponse,
  type CashClosingListResponse,
  type CashClosingRow,
  type CashClosingSaveResponse,
  type CashMovement,
  type CashNote,
  type CashNoteSaveResponse,
  type CashTotals,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { readJson, validationBody } from "../http";

/**
 * Spec 032: daily cash closing. The expected cash is the opening cash plus the cash that moved on the day:
 * cash receipts in, cash refunds out, credit note payouts in cash out, and old gold payouts in cash out.
 * Only mode `cash` counts. Voided and reversed rows do not.
 */
export const cashClosingRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;

type DbClosing = {
  id: string;
  business_date: string;
  opening_paise: number;
  expected_paise: number;
  counted_paise: number;
  difference_paise: number;
  reason: string | null;
  totals_json: string;
  closed_by: string;
  closed_at: string;
  closed_by_name: string | null;
  closed_by_username: string | null;
};

type DbNote = { id: string; business_date: string; note: string; created_at: string; created_by: string; created_by_name: string | null; created_by_username: string | null };

const CLOSING_SELECT = `SELECT c.id, c.business_date, c.opening_paise, c.expected_paise, c.counted_paise, c.difference_paise, c.reason, c.totals_json, c.closed_by, c.closed_at,
  u.display_name AS closed_by_name, u.username AS closed_by_username
  FROM cash_closings c LEFT JOIN users u ON u.id = c.closed_by`;

const nameOf = (display: string | null, username: string | null, id: string) => display || username || id;

function toClosing(r: DbClosing): CashClosingRow {
  return {
    id: r.id,
    date: r.business_date,
    openingPaise: r.opening_paise,
    expectedPaise: r.expected_paise,
    countedPaise: r.counted_paise,
    differencePaise: r.difference_paise,
    reason: r.reason,
    totals: JSON.parse(r.totals_json) as CashTotals,
    closedBy: nameOf(r.closed_by_name, r.closed_by_username, r.closed_by),
    closedAt: r.closed_at,
  };
}

function toNote(r: DbNote): CashNote {
  return { id: r.id, date: r.business_date, note: r.note, createdAt: r.created_at, createdBy: nameOf(r.created_by_name, r.created_by_username, r.created_by) };
}

/** Every cash entry dated `date`, as the drawer sees it now. */
async function movementsOn(db: D1Database, date: string): Promise<CashMovement[]> {
  const [receipts, refunds, credits, goldPaid] = await Promise.all([
    db
      .prepare(
        `SELECT p.receipt_no, p.payer_name, p.amount_paise FROM payments p
         WHERE p.mode = 'cash' AND p.voided_at IS NULL AND p.kind <> 'opening_advance' AND p.receipt_date = ?1
         ORDER BY p.created_at, p.id`,
      )
      .bind(date)
      .all<{ receipt_no: string | null; payer_name: string; amount_paise: number }>(),
    db
      .prepare(
        `SELECT r.amount_paise, p.receipt_no, p.payer_name FROM payment_refunds r JOIN payments p ON p.id = r.payment_id
         WHERE r.mode = 'cash' AND r.reversed_at IS NULL AND r.refund_date = ?1 ORDER BY r.created_at, r.id`,
      )
      .bind(date)
      .all<{ amount_paise: number; receipt_no: string | null; payer_name: string }>(),
    db
      .prepare(
        `SELECT cp.amount_paise, cn.cn_no, cn.customer_name FROM credit_note_payouts cp JOIN credit_notes cn ON cn.id = cp.credit_note_id
         WHERE cp.mode = 'cash' AND cp.reversed_at IS NULL AND cp.paid_date = ?1 ORDER BY cp.created_at, cp.id`,
      )
      .bind(date)
      .all<{ amount_paise: number; cn_no: string; customer_name: string }>(),
    db
      .prepare(
        `SELECT op.amount_paise, o.receipt_no, o.payer_name FROM old_gold_payouts op JOIN old_gold_purchases o ON o.id = op.ogp_id
         WHERE op.mode = 'cash' AND op.voided_at IS NULL AND op.paid_date = ?1 ORDER BY op.created_at, op.id`,
      )
      .bind(date)
      .all<{ amount_paise: number; receipt_no: string; payer_name: string }>(),
  ]);
  return [
    ...receipts.results.map((r) => ({ kind: "receipt" as const, direction: "in" as const, reference: r.receipt_no, party: r.payer_name, date, amountPaise: r.amount_paise })),
    ...refunds.results.map((r) => ({ kind: "refund" as const, direction: "out" as const, reference: r.receipt_no, party: r.payer_name, date, amountPaise: r.amount_paise })),
    ...credits.results.map((r) => ({ kind: "credit_payout" as const, direction: "out" as const, reference: r.cn_no, party: r.customer_name, date, amountPaise: r.amount_paise })),
    ...goldPaid.results.map((r) => ({ kind: "old_gold_payout" as const, direction: "out" as const, reference: r.receipt_no, party: r.payer_name, date, amountPaise: r.amount_paise })),
  ];
}

function totalsOf(list: CashMovement[]): CashTotals {
  const sum = (kind: CashMovement["kind"]) => list.filter((m) => m.kind === kind);
  const of = (kind: CashMovement["kind"]) => ({ paise: sum(kind).reduce((a, m) => a + m.amountPaise, 0), count: sum(kind).length });
  const r = of("receipt"), f = of("refund"), c = of("credit_payout"), g = of("old_gold_payout");
  return {
    receiptsPaise: r.paise,
    receiptsCount: r.count,
    refundsPaise: f.paise,
    refundsCount: f.count,
    creditPayoutsPaise: c.paise,
    creditPayoutsCount: c.count,
    oldGoldPayoutsPaise: g.paise,
    oldGoldPayoutsCount: g.count,
    netPaise: r.paise - f.paise - c.paise - g.paise,
  };
}

async function latestClosing(db: D1Database, before?: string): Promise<{ business_date: string; counted_paise: number } | null> {
  const sql = before
    ? "SELECT business_date, counted_paise FROM cash_closings WHERE business_date < ?1 ORDER BY business_date DESC LIMIT 1"
    : "SELECT business_date, counted_paise FROM cash_closings ORDER BY business_date DESC LIMIT 1";
  const stmt = db.prepare(sql);
  return (before ? await stmt.bind(before).first() : await stmt.first()) as { business_date: string; counted_paise: number } | null;
}

/** The first date after `after` and before `date` that has cash activity. A day cannot be closed past such a day. */
async function earliestActivityBetween(db: D1Database, after: string, date: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MIN(d) AS d FROM (
         SELECT receipt_date AS d FROM payments WHERE mode = 'cash' AND voided_at IS NULL AND kind <> 'opening_advance' AND receipt_date > ?1 AND receipt_date < ?2
         UNION ALL SELECT refund_date FROM payment_refunds WHERE mode = 'cash' AND reversed_at IS NULL AND refund_date > ?1 AND refund_date < ?2
         UNION ALL SELECT paid_date FROM credit_note_payouts WHERE mode = 'cash' AND reversed_at IS NULL AND paid_date > ?1 AND paid_date < ?2
         UNION ALL SELECT paid_date FROM old_gold_payouts WHERE mode = 'cash' AND voided_at IS NULL AND paid_date > ?1 AND paid_date < ?2
       )`,
    )
    .bind(after, date)
    .first<{ d: string | null }>();
  return row?.d ?? null;
}

const badField = (field: string, message: string) => ({ error: "validation" as const, issues: [{ field, message }] });

cashClosingRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const today = indiaDate(c.get("now"));
  const date = c.req.query("date") || today;
  if (!isValidBusinessDate(date)) return c.json({ error: "invalid_date", message: "The date must look like 2026-11-01" }, 400);

  const closingRow = await db.prepare(`${CLOSING_SELECT} WHERE c.business_date = ?1`).bind(date).first<DbClosing>();
  const before = await latestClosing(db, date);
  const latest = await latestClosing(db);
  const movements = await movementsOn(db, date);
  const totals = totalsOf(movements);

  // Opening: the count at the last closing before this day, or typed on the very first closing (0 until typed).
  const closing = closingRow ? toClosing(closingRow) : null;
  const opening = closing
    ? { paise: closing.openingPaise, source: before ? ("carried" as const) : ("typed" as const), fromDate: before?.business_date ?? null }
    : before
      ? { paise: before.counted_paise, source: "carried" as const, fromDate: before.business_date }
      : { paise: 0, source: "typed" as const, fromDate: null };

  const blockedByDate = !closing && latest && date > latest.business_date ? await earliestActivityBetween(db, latest.business_date, date) : null;
  // While an earlier day is open, this day's expected figure would leave that day's cash out, so it is not shown.
  const expectedPaise = closing ? closing.expectedPaise : before && blockedByDate === null ? expectedCashPaise(before.counted_paise, totals.netPaise) : null;
  const currentExpectedPaise = closing ? expectedCashPaise(closing.openingPaise, totals.netPaise) : null;
  const canClose = !closing && date <= today && (!latest || date > latest.business_date) && blockedByDate === null;

  const notes = (
    await db
      .prepare(
        `SELECT n.id, n.business_date, n.note, n.created_at, n.created_by, u.display_name AS created_by_name, u.username AS created_by_username
         FROM cash_closing_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.business_date = ?1 ORDER BY n.created_at, n.id`,
      )
      .bind(date)
      .all<DbNote>()
  ).results.map(toNote);

  const body: CashClosingDayResponse = {
    date,
    opening,
    movements,
    totals,
    expectedPaise,
    closing,
    currentExpectedPaise,
    notes,
    lastClosedDate: latest?.business_date ?? null,
    blockedByDate,
    canClose,
  };
  return c.json(body);
});

cashClosingRoutes.get("/list", async (c) => {
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  const rows = (
    await c.env.DB.prepare(
      `${CLOSING_SELECT} ORDER BY c.business_date DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    ).all<DbClosing>()
  ).results;
  const counts = new Map<string, number>();
  for (const r of (await c.env.DB.prepare("SELECT business_date, COUNT(*) AS n FROM cash_closing_notes GROUP BY business_date").all<{ business_date: string; n: number }>()).results) {
    counts.set(r.business_date, r.n);
  }
  const body: CashClosingListResponse = {
    items: rows.slice(0, PAGE_SIZE).map((r) => ({ ...toClosing(r), noteCount: counts.get(r.business_date) ?? 0 })),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
  return c.json(body);
});

cashClosingRoutes.post("/", async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const parsed = cashClosingRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;
  const today = indiaDate(c.get("now"));
  if (b.date > today) return c.json({ error: "date_in_future", message: "A day cannot be closed before it has ended" }, 400);

  // Safe retry: the same id, date and figures return the first close (spec 001 R5).
  const existing = await db.prepare(`${CLOSING_SELECT} WHERE c.business_date = ?1`).bind(b.date).first<DbClosing>();
  if (existing) {
    if (b.id && existing.id === b.id && existing.counted_paise === b.countedPaise && (existing.reason ?? null) === b.reason) {
      return c.json<CashClosingSaveResponse>({ closing: toClosing(existing) });
    }
    return c.json({ error: "already_closed", message: "This day is already closed. A correction is added as a note on the day." }, 409);
  }

  const latest = await latestClosing(db);
  if (latest && b.date < latest.business_date) {
    return c.json({ error: "date_before_last_closing", message: `${latest.business_date} is already closed. Days are closed in order.`, lastClosedDate: latest.business_date }, 409);
  }
  if (latest && b.openingPaise !== undefined) {
    return c.json(badField("openingPaise", "The opening cash is the count from the last closed day"), 400);
  }
  if (latest) {
    const blocked = await earliestActivityBetween(db, latest.business_date, b.date);
    if (blocked) return c.json({ error: "earlier_day_open", message: `${blocked} has cash entries and is not closed. Close it first.`, blockedByDate: blocked }, 409);
  }

  const movements = await movementsOn(db, b.date);
  const totals = totalsOf(movements);
  const openingPaise = latest ? latest.counted_paise : (b.openingPaise ?? 0);
  const expectedPaise = expectedCashPaise(openingPaise, totals.netPaise);
  const differencePaise = cashDifferencePaise(b.countedPaise, expectedPaise);
  if (differencePaise !== 0 && !b.reason) {
    return c.json(badField("reason", "Say why the cash differs from what was expected"), 400);
  }

  const id = b.id ?? newId();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO cash_closings (id, business_date, opening_paise, expected_paise, counted_paise, difference_paise, reason, totals_json, closed_by, closed_at, created_at, created_by, updated_at, updated_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?9, ?10, ?9)`,
        )
        .bind(id, b.date, openingPaise, expectedPaise, b.countedPaise, differencePaise, b.reason, JSON.stringify(totals), user.id, now),
      auditStatement(db, {
        actor: user.id,
        action: "cash_closed",
        entity: "cash_closing",
        entityId: id,
        detail: { date: b.date, openingPaise, expectedPaise, countedPaise: b.countedPaise, differencePaise, reason: b.reason },
      }),
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE constraint failed")) {
      return c.json({ error: "already_closed", message: "This day is already closed. A correction is added as a note on the day." }, 409);
    }
    throw e;
  }
  const saved = await db.prepare(`${CLOSING_SELECT} WHERE c.id = ?1`).bind(id).first<DbClosing>();
  return c.json<CashClosingSaveResponse>({ closing: toClosing(saved!) }, 201);
});

cashClosingRoutes.post("/:date/notes", async (c) => {
  const user = c.get("user")!;
  const db = c.env.DB;
  const date = c.req.param("date");
  if (!isValidBusinessDate(date)) return c.json({ error: "invalid_date", message: "The date must look like 2026-11-01" }, 400);
  const parsed = cashNoteRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const b = parsed.data;

  if (b.id) {
    const same = await db.prepare("SELECT id, business_date, note FROM cash_closing_notes WHERE id = ?1").bind(b.id).first<{ id: string; business_date: string; note: string }>();
    if (same) {
      if (same.business_date === date && same.note === b.note) {
        const row = await db.prepare("SELECT n.id, n.business_date, n.note, n.created_at, n.created_by, u.display_name AS created_by_name, u.username AS created_by_username FROM cash_closing_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.id = ?1").bind(b.id).first<DbNote>();
        return c.json<CashNoteSaveResponse>({ note: toNote(row!) });
      }
      return c.json({ error: "id_conflict", message: "This id is already used by a different note" }, 409);
    }
  }
  const closed = await db.prepare("SELECT id FROM cash_closings WHERE business_date = ?1").bind(date).first();
  if (!closed) return c.json({ error: "day_not_closed", message: "Only a closed day can have a correction note" }, 409);

  const id = b.id ?? newId();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO cash_closing_notes (id, business_date, note, created_at, created_by, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?5)`,
      )
      .bind(id, date, b.note, now, user.id),
    auditStatement(db, { actor: user.id, action: "cash_closing_note", entity: "cash_closing", entityId: id, detail: { date, note: b.note } }),
  ]);
  const row = await db.prepare("SELECT n.id, n.business_date, n.note, n.created_at, n.created_by, u.display_name AS created_by_name, u.username AS created_by_username FROM cash_closing_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.id = ?1").bind(id).first<DbNote>();
  return c.json<CashNoteSaveResponse>({ note: toNote(row!) }, 201);
});
