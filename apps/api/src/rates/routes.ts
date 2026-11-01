import { Hono } from "hono";
import {
  RATE_KINDS,
  indiaDate,
  isLargeChange,
  isRateKind,
  isValidBusinessDate,
  newId,
  parseRateInput,
  percentChange,
  saveRateRequestSchema,
  type ApplicableRate,
  type ApplicableRatesResponse,
  type NeedsConfirmationBody,
  type RateHistoryEntry,
  type RateKind,
  type RateRow,
  type RatesByDate,
  type RatesListResponse,
  type SaveRateResponse,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { revisionStatement } from "../db/revisions";
import { readJson, validationBody } from "../http";

export const rateRoutes = new Hono<AppEnv>();

type DbRate = {
  id: string;
  rate_date: string;
  kind: RateKind;
  price_paise_per_kg: number;
  updated_at: string;
  updated_by: string;
  created_at: string;
  created_by: string;
};

const toRow = (r: DbRate): RateRow => ({
  id: r.id,
  date: r.rate_date,
  kind: r.kind,
  pricePaisePerKg: r.price_paise_per_kg,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

const isUniqueError = (e: unknown) =>
  e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);

/** R8: the rate saved for exactly this date, else the latest one before it, else null. */
export async function applicableRate(db: D1Database, kind: RateKind, date: string): Promise<ApplicableRate | null> {
  const row = await db
    .prepare("SELECT rate_date, price_paise_per_kg FROM rates WHERE kind = ?1 AND rate_date <= ?2 ORDER BY rate_date DESC LIMIT 1")
    .bind(kind, date)
    .first<{ rate_date: string; price_paise_per_kg: number }>();
  return row ? { pricePaisePerKg: row.price_paise_per_kg, rateDate: row.rate_date, carriedForward: row.rate_date !== date } : null;
}

rateRoutes.get("/applicable", async (c) => {
  const date = c.req.query("date") ?? indiaDate(c.get("now"));
  if (!isValidBusinessDate(date)) return c.json({ error: "invalid_date", message: "Date must look like 2026-11-01" }, 400);
  const entries = await Promise.all(RATE_KINDS.map(async (k) => [k, await applicableRate(c.env.DB, k, date)] as const));
  const body: ApplicableRatesResponse = { date, rates: Object.fromEntries(entries) as ApplicableRatesResponse["rates"] };
  return c.json(body);
});

rateRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(60, Math.max(1, Number.parseInt(c.req.query("limit") ?? "30", 10) || 30));
  const before = c.req.query("before") ?? "9999-12-31";
  if (!isValidBusinessDate(before) && before !== "9999-12-31") return c.json({ error: "invalid_date" }, 400);

  const dates = (
    await db
      .prepare("SELECT DISTINCT rate_date FROM rates WHERE rate_date < ?1 ORDER BY rate_date DESC LIMIT ?2")
      .bind(before, limit + 1)
      .all<{ rate_date: string }>()
  ).results.map((r) => r.rate_date);
  const page = dates.slice(0, limit);
  const items: RatesByDate[] = [];
  if (page.length) {
    const rows = (
      await db
        .prepare(`SELECT * FROM rates WHERE rate_date >= ?1 AND rate_date <= ?2`)
        .bind(page[page.length - 1], page[0])
        .all<DbRate>()
    ).results;
    for (const date of page) {
      const rates: RatesByDate["rates"] = {};
      for (const r of rows) if (r.rate_date === date) rates[r.kind] = toRow(r);
      items.push({ date, rates });
    }
  }
  const body: RatesListResponse = { items, nextCursor: dates.length > limit ? page[page.length - 1]! : null };
  return c.json(body);
});

rateRoutes.put("/:date/:kind", async (c) => {
  const date = c.req.param("date");
  const kind = c.req.param("kind");
  if (!isValidBusinessDate(date)) return c.json({ error: "invalid_date", message: "Date must look like 2026-11-01" }, 400);
  if (date > indiaDate(c.get("now"))) return c.json({ error: "future_date", message: "A rate cannot be saved for a future date" }, 400); // R6, R7
  if (!isRateKind(kind)) return c.json({ error: "invalid_kind", message: `Rate kind must be one of ${RATE_KINDS.join(", ")}` }, 400);

  const parsedBody = saveRateRequestSchema.safeParse(await readJson(c));
  if (!parsedBody.success) return c.json(validationBody(parsedBody.error), 400);
  const { price, unit, reason, confirmLargeChange } = parsedBody.data;
  const parsedPrice = parseRateInput(price, unit);
  if (!parsedPrice.ok) return c.json({ error: "validation", issues: [{ field: "price", message: parsedPrice.message }] }, 400);
  const next = parsedPrice.paisePerKg;

  const db = c.env.DB;
  const user = c.get("user");
  const now = new Date().toISOString();

  // Two tries: if another save for the same date and kind lands first, the second becomes an edit.
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.prepare("SELECT * FROM rates WHERE rate_date = ?1 AND kind = ?2").bind(date, kind).first<DbRate>();

    if (existing && existing.price_paise_per_kg === next) {
      // R10: same price again changes nothing and writes nothing.
      return c.json<SaveRateResponse>({ rate: toRow(existing), created: false, changed: false });
    }

    // R12: compare with what applies to this date now, before the change.
    const previous = existing ? existing.price_paise_per_kg : (await applicableRate(db, kind, date))?.pricePaisePerKg;
    if (previous && isLargeChange(previous, next) && !confirmLargeChange) {
      const percent = percentChange(previous, next);
      return c.json<NeedsConfirmationBody>(
        {
          error: "needs_confirmation",
          message: `This is ${percent > 0 ? "+" : ""}${percent}% from the previous rate. Please confirm it is not a typing mistake.`,
          previousPaisePerKg: previous,
          newPaisePerKg: next,
          percent,
        },
        409,
      );
    }

    try {
      if (!existing) {
        const id = newId();
        await db.batch([
          db
            .prepare(
              `INSERT INTO rates (id, created_at, created_by, updated_at, updated_by, rate_date, kind, price_paise_per_kg)
               VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, ?6)`,
            )
            .bind(id, now, user.id, date, kind, next),
          auditStatement(db, {
            actor: user.id,
            action: "rate_create",
            entity: "rate",
            entityId: id,
            detail: { kind, date, pricePaisePerKg: next },
          }),
        ]);
        const created = (await db.prepare("SELECT * FROM rates WHERE id = ?1").bind(id).first<DbRate>())!;
        return c.json<SaveRateResponse>({ rate: toRow(created), created: true, changed: true }, 201);
      }

      await db.batch([
        revisionStatement(db, { entity: "rate", entityId: existing.id, snapshot: existing, reason: reason || undefined, actor: user.id }),
        db
          .prepare("UPDATE rates SET price_paise_per_kg = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1")
          .bind(existing.id, next, now, user.id),
        auditStatement(db, {
          actor: user.id,
          action: "rate_update",
          entity: "rate",
          entityId: existing.id,
          detail: { kind, date, fromPaisePerKg: existing.price_paise_per_kg, toPaisePerKg: next, reason: reason || undefined },
        }),
      ]);
      const updated = (await db.prepare("SELECT * FROM rates WHERE id = ?1").bind(existing.id).first<DbRate>())!;
      return c.json<SaveRateResponse>({ rate: toRow(updated), created: false, changed: true });
    } catch (e) {
      if (!(isUniqueError(e) && !existing && attempt === 0)) throw e;
    }
  }
  throw new Error("Could not save the rate");
});

rateRoutes.get("/:date/:kind/history", async (c) => {
  const date = c.req.param("date");
  const kind = c.req.param("kind");
  if (!isValidBusinessDate(date) || !isRateKind(kind)) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB;
  const current = await db.prepare("SELECT * FROM rates WHERE rate_date = ?1 AND kind = ?2").bind(date, kind).first<DbRate>();
  if (!current) return c.json({ error: "not_found" }, 404);

  const revs = (
    await db
      .prepare(
        `SELECT revision_no, snapshot_json, reason, created_at, created_by
         FROM record_revisions WHERE entity = 'rate' AND entity_id = ?1 ORDER BY revision_no`,
      )
      .bind(current.id)
      .all<{ revision_no: number; snapshot_json: string; reason: string | null; created_at: string; created_by: string }>()
  ).results;

  const items: RateHistoryEntry[] = revs
    .map((rev, i) => ({
      revisionNo: rev.revision_no,
      at: rev.created_at,
      by: rev.created_by,
      reason: rev.reason,
      fromPaisePerKg: (JSON.parse(rev.snapshot_json) as DbRate).price_paise_per_kg,
      toPaisePerKg: i + 1 < revs.length ? (JSON.parse(revs[i + 1]!.snapshot_json) as DbRate).price_paise_per_kg : current.price_paise_per_kg,
    }))
    .reverse();
  return c.json({ items });
});
