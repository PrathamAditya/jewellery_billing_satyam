import { Hono } from "hono";
import {
  newId,
  reconciliationCountsSchema,
  reconciliationLineAddSchema,
  reconciliationOpenSchema,
  type InventoryStatus,
  type BulkUnit,
  type Reconciliation,
  type ReconciliationCloseResponse,
  type ReconciliationDetailResponse,
  type ReconciliationListResponse,
  type ReconciliationLine,
  type ReconciliationReportResponse,
  type ReconciliationStatus,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { readJson, validationBody } from "../http";
import { loadItem } from "./routes";

/**
 * Spec 025: monthly stock reconciliation. Opening stores the system figure per line; counts are saved line by line
 * while open; closing writes the differences as adjustments in one batch and is final.
 */
export const reconciliationRoutes = new Hono<AppEnv>();

/** Spec 025 R12: the hidden place that holds individual items not found at a count (seeded by migration 0030). */
export const MISSING_LOCATION_ID = "loc-missing";

type ReconRow = {
  id: string;
  month: string;
  location_id: string | null;
  location_name: string | null;
  status: ReconciliationStatus;
  opened_at: string;
  opened_by: string;
  closed_at: string | null;
  closed_by: string | null;
  line_count: number;
  counted_count: number;
};

const RECON_SELECT = `SELECT r.id, r.month, r.location_id, l.name AS location_name, r.status, r.opened_at, r.opened_by, r.closed_at, r.closed_by,
  (SELECT COUNT(*) FROM stock_reconciliation_lines x WHERE x.reconciliation_id = r.id) AS line_count,
  (SELECT COUNT(*) FROM stock_reconciliation_lines x WHERE x.reconciliation_id = r.id AND x.counted_quantity IS NOT NULL) AS counted_count
  FROM stock_reconciliations r LEFT JOIN stock_locations l ON l.id = r.location_id`;

const toRecon = (r: ReconRow): Reconciliation => ({
  id: r.id,
  month: r.month,
  locationId: r.location_id,
  locationName: r.location_name ?? "All active places",
  status: r.status,
  openedAt: r.opened_at,
  openedBy: r.opened_by,
  closedAt: r.closed_at,
  closedBy: r.closed_by,
  lineCount: r.line_count,
  countedCount: r.counted_count,
});

const loadRecon = (db: D1Database, id: string) => db.prepare(`${RECON_SELECT} WHERE r.id = ?1`).bind(id).first<ReconRow>();

type LineRow = {
  id: string;
  line_kind: "item" | "bulk";
  inventory_item_id: string | null;
  bulk_item_id: string | null;
  location_id: string;
  system_status: InventoryStatus | null;
  system_quantity: number;
  added_later: number;
  counted_status: "found" | "not_found" | null;
  counted_quantity: number | null;
  note: string | null;
  expected_quantity: number | null;
  difference: number | null;
  adjustment_note: string | null;
  u_no: string | null;
  item_code: string | null;
  serial: number | null;
  type_name: string | null;
  live_status: InventoryStatus | null;
  live_voided: string | null;
  live_location: string | null;
  bulk_name: string | null;
  unit: BulkUnit | null;
  location_name: string;
  live_bulk: number;
};

const LINE_SELECT = `SELECT l.id, l.line_kind, l.inventory_item_id, l.bulk_item_id, l.location_id, l.system_status, l.system_quantity,
  l.added_later, l.counted_status, l.counted_quantity, l.note, l.expected_quantity, l.difference, l.adjustment_note,
  i.u_no, i.item_code, i.serial, t.name AS type_name, i.status AS live_status, i.voided_at AS live_voided, i.location_id AS live_location,
  b.name AS bulk_name, b.unit, loc.name AS location_name,
  COALESCE((SELECT q.quantity FROM bulk_item_location_quantities q WHERE q.bulk_item_id = l.bulk_item_id AND q.location_id = l.location_id), 0) AS live_bulk
  FROM stock_reconciliation_lines l
  LEFT JOIN inventory_items i ON i.id = l.inventory_item_id
  LEFT JOIN inventory_item_types t ON t.id = i.type_id
  LEFT JOIN bulk_items b ON b.id = l.bulk_item_id
  JOIN stock_locations loc ON loc.id = l.location_id`;

/** Spec 025 R4: the figure now: an item is 1 when in stock at the line's place, a bulk item is its balance there. */
const liveOf = (r: LineRow) =>
  r.line_kind === "item" ? (r.live_status === "in_stock" && r.live_voided === null && r.live_location === r.location_id ? 1 : 0) : r.live_bulk;

const toLine = (r: LineRow, closed: boolean): ReconciliationLine => {
  const expected = closed ? (r.expected_quantity ?? liveOf(r)) : liveOf(r);
  const counted = r.counted_quantity;
  const difference = closed ? r.difference : counted === null ? null : counted - expected;
  return {
    id: r.id,
    lineKind: r.line_kind,
    inventoryItemId: r.inventory_item_id,
    uNo: r.u_no,
    typeName: r.type_name,
    bulkItemId: r.bulk_item_id,
    bulkName: r.bulk_name,
    unit: r.unit,
    locationId: r.location_id,
    locationName: r.location_name,
    systemAtOpening: r.system_quantity,
    systemStatus: r.system_status,
    addedLater: r.added_later === 1,
    movedSinceOpening: expected - r.system_quantity,
    expected,
    countedStatus: r.counted_status,
    counted,
    difference,
    note: r.note,
    adjustmentNote: r.adjustment_note,
  };
};

async function loadLines(db: D1Database, id: string): Promise<LineRow[]> {
  return (
    await db
      .prepare(`${LINE_SELECT} WHERE l.reconciliation_id = ?1 ORDER BY loc.name COLLATE NOCASE, l.line_kind, i.item_code, i.serial, b.name COLLATE NOCASE, l.id`)
      .bind(id)
      .all<LineRow>()
  ).results;
}

async function detail(db: D1Database, id: string): Promise<ReconciliationDetailResponse | null> {
  const row = await loadRecon(db, id);
  if (!row) return null;
  const closed = row.status === "closed";
  return { reconciliation: toRecon(row), lines: (await loadLines(db, id)).map((l) => toLine(l, closed)) };
}

const placeInfo = (db: D1Database, id: string) =>
  db.prepare("SELECT name, active, hidden FROM stock_locations WHERE id = ?1").bind(id).first<{ name: string; active: number; hidden: number }>();

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const triggerRefusal = (e: unknown, code: string) => e instanceof Error && new RegExp(code).test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);

// ---- list and read ----

reconciliationRoutes.get("/", async (c) => {
  const month = (c.req.query("month") ?? "").trim();
  const args: unknown[] = [];
  let where = "";
  if (month) {
    args.push(month);
    where = "WHERE r.month = ?1";
  }
  const rows = (await c.env.DB.prepare(`${RECON_SELECT} ${where} ORDER BY r.opened_at DESC, r.id DESC LIMIT 100`).bind(...args).all<ReconRow>()).results;
  return c.json<ReconciliationListResponse>({ items: rows.map(toRecon) });
});

reconciliationRoutes.get("/:id", async (c) => {
  const found = await detail(c.env.DB, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  return c.json<ReconciliationDetailResponse>(found);
});

/** Spec 025 section 3: the differences, the counts and the number of adjustments the close writes. */
reconciliationRoutes.get("/:id/report", async (c) => {
  const db = c.env.DB;
  const row = await loadRecon(db, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const closed = row.status === "closed";
  const lines = (await loadLines(db, row.id)).map((l) => toLine(l, closed));
  const diffs = lines.filter((l) => l.difference !== null && l.difference !== 0);
  const summary = {
    lines: lines.length,
    counted: lines.filter((l) => l.counted !== null).length,
    notCounted: lines.filter((l) => l.counted === null).length,
    adjustments: diffs.length,
    missing: diffs.filter((l) => l.lineKind === "item" && l.difference! < 0).length,
    extra: diffs.filter((l) => l.lineKind === "item" && l.difference! > 0).length,
    bulkUp: diffs.filter((l) => l.lineKind === "bulk" && l.difference! > 0).length,
    bulkDown: diffs.filter((l) => l.lineKind === "bulk" && l.difference! < 0).length,
  };
  return c.json<ReconciliationReportResponse>({ reconciliation: toRecon(row), summary, differences: diffs });
});

// ---- open (spec 025 R1 to R3) ----

reconciliationRoutes.post("/", async (c) => {
  const parsed = reconciliationOpenSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = f.id ?? newId();

  const existing = await db.prepare("SELECT id, month, location_id FROM stock_reconciliations WHERE id = ?1").bind(id).first<{ id: string; month: string; location_id: string | null }>();
  if (existing) {
    if (existing.month !== f.month || existing.location_id !== f.locationId) {
      return c.json({ error: "id_conflict", message: "This id is already used by a different reconciliation" }, 409);
    }
    return c.json<ReconciliationDetailResponse>((await detail(db, id))!);
  }

  if (f.locationId) {
    const place = await placeInfo(db, f.locationId);
    if (!place || place.hidden === 1) return c.json({ error: "validation", issues: [{ field: "locationId", message: "Choose the place from the list" }] }, 400);
    if (place.active !== 1) return c.json({ error: "location_inactive", message: `${place.name} is not active. Choose another place.` }, 409);
  }

  const clash = await db
    .prepare("SELECT id FROM stock_reconciliations WHERE status = 'open' AND month = ?1 AND IFNULL(location_id, '*') = IFNULL(?2, '*')")
    .bind(f.month, f.locationId)
    .first<{ id: string }>();
  if (clash) return c.json({ error: "already_open", message: `A count for ${f.month} at this place is already open`, reconciliationId: clash.id }, 409);

  const now = new Date().toISOString();
  // The scope: one place, or every active place that is not the hidden Missing place (R2, R3). Lines are written in
  // the same batch as the header, from the stock as it is at this moment. ?4 is the place (null for all).
  const scope = "SELECT id FROM stock_locations WHERE active = 1 AND hidden = 0 AND (?4 IS NULL OR id = ?4)";
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO stock_reconciliations (id, created_at, created_by, updated_at, updated_by, month, location_id, status, opened_at, opened_by)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, 'open', ?2, ?3)`,
        )
        .bind(id, now, user.id, f.month, f.locationId),
      db
        .prepare(
          `INSERT INTO stock_reconciliation_lines (id, created_at, created_by, updated_at, updated_by, reconciliation_id, line_kind, inventory_item_id, location_id, system_status, system_quantity)
           SELECT ?1 || ':i:' || i.id, ?2, ?3, ?2, ?3, ?1, 'item', i.id, i.location_id, i.status, 1
           FROM inventory_items i WHERE i.status = 'in_stock' AND i.voided_at IS NULL AND i.location_id IN (${scope})`,
        )
        .bind(id, now, user.id, f.locationId),
      db
        .prepare(
          `INSERT INTO stock_reconciliation_lines (id, created_at, created_by, updated_at, updated_by, reconciliation_id, line_kind, bulk_item_id, location_id, system_quantity)
           SELECT ?1 || ':b:' || b.id || ':' || l.id, ?2, ?3, ?2, ?3, ?1, 'bulk', b.id, l.id,
             COALESCE((SELECT q.quantity FROM bulk_item_location_quantities q WHERE q.bulk_item_id = b.id AND q.location_id = l.id), 0)
           FROM bulk_items b JOIN stock_locations l ON l.id IN (${scope})`,
        )
        .bind(id, now, user.id, f.locationId),
      auditStatement(db, { actor: user.id, action: "stock_reconciliation_open", entity: "stock_reconciliation", entityId: id, detail: { month: f.month, locationId: f.locationId } }),
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    return c.json({ error: "already_open", message: `A count for ${f.month} at this place is already open` }, 409);
  }
  return c.json<ReconciliationDetailResponse>((await detail(db, id))!, 201);
});

// ---- counting (spec 025 R7, R8) ----

reconciliationRoutes.put("/:id/counts", async (c) => {
  const parsed = reconciliationCountsSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await loadRecon(db, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "open") return c.json({ error: "reconciliation_closed", message: "This count is closed and cannot be changed. Open a new count for a correction." }, 409);

  const lines = await loadLines(db, id);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const now = new Date().toISOString();
  const batch: D1PreparedStatement[] = [];
  for (const [i, entry] of parsed.data.lines.entries()) {
    const line = byId.get(entry.id);
    if (!line) return c.json({ error: "validation", issues: [{ field: `lines.${i}.id`, message: "That line is not on this count" }] }, 400);
    let status: "found" | "not_found" | null = null;
    let quantity: number | null = null;
    if (line.line_kind === "item") {
      if (entry.counted === "found" || entry.counted === "not_found") {
        status = entry.counted;
        quantity = entry.counted === "found" ? 1 : 0;
      } else if (entry.counted !== null) {
        return c.json({ error: "validation", issues: [{ field: `lines.${i}.counted`, message: "Mark the item found or not found" }] }, 400);
      }
    } else {
      if (typeof entry.counted === "number") quantity = entry.counted;
      else if (entry.counted !== null) return c.json({ error: "validation", issues: [{ field: `lines.${i}.counted`, message: "Type the quantity counted" }] }, 400);
    }
    batch.push(
      db
        .prepare(
          `UPDATE stock_reconciliation_lines SET counted_status = ?2, counted_quantity = ?3, note = ?4, updated_at = ?5, updated_by = ?6
           WHERE id = ?1 AND reconciliation_id = ?7`,
        )
        .bind(entry.id, status, quantity, entry.note, now, user.id, id),
    );
  }
  batch.push(auditStatement(db, { actor: user.id, action: "stock_reconciliation_counts", entity: "stock_reconciliation", entityId: id, detail: { lines: parsed.data.lines.length } }));
  try {
    await db.batch(batch);
  } catch (e) {
    if (triggerRefusal(e, "reconciliation_closed")) return c.json({ error: "reconciliation_closed", message: "This count was closed just now and cannot be changed." }, 409);
    throw e;
  }
  return c.json<ReconciliationDetailResponse>((await detail(db, id))!);
});

// ---- extra item (spec 025 R6) ----

reconciliationRoutes.post("/:id/lines", async (c) => {
  const parsed = reconciliationLineAddSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await loadRecon(db, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "open") return c.json({ error: "reconciliation_closed", message: "This count is closed. Open a new count to add items." }, 409);
  const item = await loadItem(db, parsed.data.inventoryItemId);
  if (!item) return c.json({ error: "validation", issues: [{ field: "inventoryItemId", message: "Choose the item from the list" }] }, 400);
  if (item.voided_at) return c.json({ error: "item_voided", message: `${item.u_no} is voided, so it cannot be counted` }, 409);
  if (item.status === "written_off") return c.json({ error: "item_not_movable", message: `${item.u_no} is written off. It cannot be found back by a count.` }, 409);
  // The extra line counts at the count's place, or, for a count of all places, at the place the item is in now.
  // Either way the system figure for it is 0, because it was not in stock there at the opening.
  const lineLocation = row.location_id ?? item.location_id;
  const place = await placeInfo(db, lineLocation);
  if (!place || place.hidden === 1 || place.active !== 1) {
    return c.json({ error: "location_inactive", message: `${place?.name ?? "This place"} is not an active place for this count` }, 409);
  }
  const clash = await db.prepare("SELECT id FROM stock_reconciliation_lines WHERE reconciliation_id = ?1 AND inventory_item_id = ?2").bind(id, item.id).first();
  if (clash) return c.json({ error: "already_on_count", message: `${item.u_no} is already on this count` }, 409);

  const lineId = newId();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO stock_reconciliation_lines (id, created_at, created_by, updated_at, updated_by, reconciliation_id, line_kind, inventory_item_id, location_id, system_status, system_quantity, added_later)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, 'item', ?5, ?6, ?7, 0, 1)`,
        )
        .bind(lineId, now, user.id, id, item.id, lineLocation, item.status),
      auditStatement(db, { actor: user.id, action: "stock_reconciliation_line_add", entity: "stock_reconciliation", entityId: id, detail: { line: lineId, uNo: item.u_no } }),
    ]);
  } catch (e) {
    if (isUniqueError(e)) return c.json({ error: "already_on_count", message: `${item.u_no} is already on this count` }, 409);
    if (triggerRefusal(e, "reconciliation_closed")) return c.json({ error: "reconciliation_closed", message: "This count was closed just now." }, 409);
    throw e;
  }
  return c.json<ReconciliationDetailResponse>((await detail(db, id))!, 201);
});

// ---- close (spec 025 R9 to R12) ----

type Adjustment = { statements: D1PreparedStatement[]; ref: string; note: string };

reconciliationRoutes.post("/:id/close", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await loadRecon(db, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "open") return c.json({ error: "already_closed", message: "This count is already closed" }, 409);

  const lines = await loadLines(db, id);
  const uncounted = lines.filter((l) => l.counted_quantity === null).length;
  if (uncounted > 0) {
    return c.json({ error: "lines_not_counted", message: `${uncounted} ${uncounted === 1 ? "line is" : "lines are"} not counted yet. Count every line before closing.`, notCounted: uncounted }, 409);
  }

  const month = row.month;
  const now = new Date().toISOString();
  const batch: D1PreparedStatement[] = [];
  let adjustments = 0;

  for (const l of lines) {
    const expected = liveOf(l);
    const counted = l.counted_quantity!;
    const difference = counted - expected;
    const reason = `Reconciliation ${month}`;
    let ref: string | null = null;
    let adjustmentNote: string | null = null;

    if (difference !== 0) {
      adjustments++;
    }

    if (l.line_kind === "bulk") {
      if (difference !== 0) {
        const movement = newId();
        ref = movement;
        adjustmentNote = `${reason}: counted ${counted}, system ${expected}`;
        batch.push(
          db
            .prepare(
              `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by, location_id)
               SELECT ?1, ?2, 'adjusted', ?3, ?4, ?5, ?6, ?4, ?5, ?7 WHERE (SELECT status FROM stock_reconciliations WHERE id = ?8) = 'open'`,
            )
            .bind(movement, l.bulk_item_id, difference, now, user.id, adjustmentNote, l.location_id, id),
          auditStatement(db, { actor: user.id, action: "stock_reconciliation_adjust", entity: "bulk_item", entityId: l.bulk_item_id!, detail: { reconciliation: id, movement, quantityChange: difference, locationId: l.location_id, reason: adjustmentNote } }),
        );
      }
    } else if (difference === 1) {
      // Found, but the system does not have it here: put it back in stock and at this place (R10, Q197).
      if (l.live_voided !== null || l.live_status === "written_off") {
        return c.json({ error: "item_not_movable", message: `${l.u_no} is ${l.live_voided ? "voided" : "written off"}, so a count cannot bring it back.` }, 409);
      }
      adjustmentNote = `${reason}: found at count`;
      if (l.live_status !== "in_stock") {
        const hist = newId();
        ref = hist;
        batch.push(
          db
            .prepare("UPDATE inventory_items SET status = 'in_stock', updated_at = ?2, updated_by = ?3 WHERE id = ?1 AND status = ?4 AND voided_at IS NULL")
            .bind(l.inventory_item_id, now, user.id, l.live_status),
          db
            .prepare(
              `INSERT INTO inventory_item_history (id, item_id, from_status, to_status, at, actor, reason, created_at, created_by)
               SELECT ?1, ?2, ?3, 'in_stock', ?4, ?5, ?6, ?4, ?5 WHERE (SELECT status FROM inventory_items WHERE id = ?2) = 'in_stock'`,
            )
            .bind(hist, l.inventory_item_id, l.live_status, now, user.id, adjustmentNote),
        );
      }
      if (l.live_location !== l.location_id) {
        const transfer = newId();
        ref = transfer;
        batch.push(...transferStatements(db, transfer, l.inventory_item_id!, l.live_location!, l.location_id, now, user.id, adjustmentNote));
      }
    } else if (difference === -1) {
      // Expected here and not found: it moves to the hidden Missing place (R10, R12, Q192). Its status is kept.
      const transfer = newId();
      ref = transfer;
      adjustmentNote = `${reason}: not found at count`;
      batch.push(...transferStatements(db, transfer, l.inventory_item_id!, l.location_id, MISSING_LOCATION_ID, now, user.id, adjustmentNote));
    }

    batch.push(
      db
        .prepare("UPDATE stock_reconciliation_lines SET expected_quantity = ?2, difference = ?3, adjustment_ref = ?4, adjustment_note = ?5, updated_at = ?6, updated_by = ?7 WHERE id = ?1 AND reconciliation_id = ?8")
        .bind(l.id, expected, difference, ref, adjustmentNote, now, user.id, id),
    );
  }

  batch.push(
    db
      .prepare("UPDATE stock_reconciliations SET status = 'closed', closed_at = ?2, closed_by = ?3, updated_at = ?2, updated_by = ?3 WHERE id = ?1 AND status = 'open'")
      .bind(id, now, user.id),
    auditStatement(db, { actor: user.id, action: "stock_reconciliation_close", entity: "stock_reconciliation", entityId: id, detail: { month, adjustments, locationId: row.location_id } }),
  );

  try {
    const results = await db.batch(batch);
    if (results[results.length - 2]!.meta.changes !== 1) {
      return c.json({ error: "already_closed", message: "This count was closed just now" }, 409);
    }
  } catch (e) {
    if (triggerRefusal(e, "quantity_below_zero")) return c.json({ error: "insufficient_quantity", message: "A bulk count would take the stock below zero. Nothing was closed." }, 409);
    if (triggerRefusal(e, "reconciliation_closed")) return c.json({ error: "already_closed", message: "This count was closed just now" }, 409);
    throw e;
  }
  const after = (await loadRecon(db, id))!;
  return c.json<ReconciliationCloseResponse>({ reconciliation: toRecon(after), adjustments });
});

/** Spec 021b I2 to I4: an item transfer, guarded on the place it is expected at and on its status. */
function transferStatements(db: D1Database, transferId: string, itemId: string, fromId: string, toId: string, now: string, actor: string, reason: string): D1PreparedStatement[] {
  const guard = "EXISTS (SELECT 1 FROM inventory_items WHERE id = ?3 AND location_id = ?4 AND status = 'in_stock' AND voided_at IS NULL)";
  return [
    db
      .prepare(
        `INSERT INTO stock_transfers (id, created_at, created_by, updated_at, updated_by, kind, inventory_item_id, bulk_item_id, quantity, from_location_id, to_location_id, at, actor, reason)
         SELECT ?1, ?2, ?5, ?2, ?5, 'item', ?3, NULL, 1, ?4, ?6, ?2, ?5, ?7 WHERE ${guard}`,
      )
      .bind(transferId, now, itemId, fromId, actor, toId, reason),
    db
      .prepare("UPDATE inventory_items SET location_id = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1 AND location_id = ?5 AND status = 'in_stock' AND voided_at IS NULL AND EXISTS (SELECT 1 FROM stock_transfers WHERE id = ?6)")
      .bind(itemId, toId, now, actor, fromId, transferId),
    auditStatement(db, { actor, action: "stock_transfer", entity: "inventory_item", entityId: itemId, detail: { transfer: transferId, from: fromId, to: toId, reason } }),
  ];
}

