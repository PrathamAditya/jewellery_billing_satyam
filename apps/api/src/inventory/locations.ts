import { Hono } from "hono";
import {
  DEFAULT_LOCATION_ID,
  INVENTORY_STATUS_LABEL,
  newId,
  stockLocationCreateSchema,
  stockLocationUpdateSchema,
  stockTransferSchema,
  type LocationStockResponse,
  type StockLocation,
  type StockLocationListResponse,
  type StockLocationSaveResponse,
  type StockTransfer,
  type StockTransferInput,
  type StockTransferListResponse,
  type StockTransferSaveResponse,
  type InventoryStatus,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { classifyReplay } from "../db/idempotency";
import { readJson, validationBody } from "../http";
import { loadItem, loadLocation } from "./routes";

/** Spec 021b: stock places, moves of items and bulk quantities between them, and the transfer history. */
export const locationRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;

type LocationRow = { id: string; name: string; active: number };
type TransferRow = {
  id: string;
  kind: "item" | "bulk";
  inventory_item_id: string | null;
  bulk_item_id: string | null;
  quantity: number;
  from_location_id: string;
  to_location_id: string;
  at: string;
  actor: string;
  reason: string | null;
  u_no: string | null;
  bulk_name: string | null;
  from_name: string;
  to_name: string;
};

const toLocation = (r: LocationRow): StockLocation => ({ id: r.id, name: r.name, active: r.active === 1, isDefault: r.id === DEFAULT_LOCATION_ID });
const toTransfer = (r: TransferRow): StockTransfer => ({
  id: r.id,
  kind: r.kind,
  inventoryItemId: r.inventory_item_id,
  uNo: r.u_no,
  bulkItemId: r.bulk_item_id,
  bulkItemName: r.bulk_name,
  quantity: r.quantity,
  fromLocationId: r.from_location_id,
  fromLocationName: r.from_name,
  toLocationId: r.to_location_id,
  toLocationName: r.to_name,
  at: r.at,
  actor: r.actor,
  reason: r.reason,
});

const TRANSFER_SELECT = `SELECT t.id, t.kind, t.inventory_item_id, t.bulk_item_id, t.quantity, t.from_location_id, t.to_location_id,
    t.at, t.actor, t.reason, i.u_no AS u_no, b.name AS bulk_name, fl.name AS from_name, tl.name AS to_name
  FROM stock_transfers t
  LEFT JOIN inventory_items i ON i.id = t.inventory_item_id
  LEFT JOIN bulk_items b ON b.id = t.bulk_item_id
  JOIN stock_locations fl ON fl.id = t.from_location_id
  JOIN stock_locations tl ON tl.id = t.to_location_id`;

const loadTransfer = (db: D1Database, id: string) => db.prepare(`${TRANSFER_SELECT} WHERE t.id = ?1`).bind(id).first<TransferRow>();
const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const isBelowZero = (e: unknown) => e instanceof Error && /quantity_below_zero/.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const balanceAt = async (db: D1Database, bulkId: string, locationId: string) =>
  (await db.prepare("SELECT quantity FROM bulk_item_location_quantities WHERE bulk_item_id = ?1 AND location_id = ?2").bind(bulkId, locationId).first<{ quantity: number }>())?.quantity ?? 0;

// ---- places (spec 021b L1 to L5) ----

locationRoutes.get("/locations", async (c) => {
  // Spec 025 R12: the hidden Missing place is not listed; it is reached through the reconciliation only.
  const rows = (await c.env.DB.prepare("SELECT id, name, active FROM stock_locations WHERE hidden = 0 ORDER BY active DESC, name COLLATE NOCASE").all<LocationRow>()).results;
  return c.json<StockLocationListResponse>({ items: rows.map(toLocation) });
});

locationRoutes.post("/locations", async (c) => {
  const parsed = stockLocationCreateSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = f.id ?? newId();

  const sameContent = (row: LocationRow) => row.name === f.name;
  const replay = classifyReplay(await loadLocation(db, id), sameContent);
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different place" }, 409);
  if (replay.kind === "replay") return c.json<StockLocationSaveResponse>({ location: toLocation(replay.row) });

  const clash = await db.prepare("SELECT id FROM stock_locations WHERE name = ?1 COLLATE NOCASE").bind(f.name).first();
  if (clash) return c.json({ error: "duplicate_name", message: `There is already a place called ${f.name}` }, 409);

  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO stock_locations (id, created_at, created_by, updated_at, updated_by, name, active) VALUES (?1, ?2, ?3, ?2, ?3, ?4, 1)`)
        .bind(id, now, user.id, f.name),
      auditStatement(db, { actor: user.id, action: "stock_location_create", entity: "stock_location", entityId: id, detail: { name: f.name } }),
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    const again = classifyReplay(await loadLocation(db, id), sameContent);
    if (again.kind === "replay") return c.json<StockLocationSaveResponse>({ location: toLocation(again.row) });
    return c.json({ error: "duplicate_name", message: `There is already a place called ${f.name}` }, 409);
  }
  return c.json<StockLocationSaveResponse>({ location: toLocation((await loadLocation(db, id))!) }, 201);
});

locationRoutes.patch("/locations/:id", async (c) => {
  const parsed = stockLocationUpdateSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await loadLocation(db, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const system = await db.prepare("SELECT hidden FROM stock_locations WHERE id = ?1").bind(id).first<{ hidden: number }>();
  if (system?.hidden === 1) return c.json({ error: "system_locked", message: "This place is kept by the system and cannot be changed" }, 409);
  const { name, active } = parsed.data;

  if (name !== undefined) {
    const clash = await db.prepare("SELECT id FROM stock_locations WHERE name = ?1 COLLATE NOCASE AND id <> ?2").bind(name, id).first();
    if (clash) return c.json({ error: "duplicate_name", message: `There is already a place called ${name}` }, 409);
  }
  if (active === false) {
    // L3: the Showroom stays active.
    if (id === DEFAULT_LOCATION_ID) return c.json({ error: "showroom_locked", message: "The Showroom is the default place and cannot be made inactive" }, 409);
    // L5: stock still there would vanish from the place lists, so move it out first. Sold items are not held here.
    const items = await db
      .prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE location_id = ?1 AND voided_at IS NULL AND status <> 'sold'")
      .bind(id)
      .first<{ n: number }>();
    const bulk = await db.prepare("SELECT COUNT(*) AS n FROM bulk_item_location_quantities WHERE location_id = ?1 AND quantity <> 0").bind(id).first<{ n: number }>();
    if ((items?.n ?? 0) + (bulk?.n ?? 0) > 0) {
      return c.json({ error: "location_has_stock", message: `${row.name} still holds stock. Move it to another place first.` }, 409);
    }
  }
  const nextName = name ?? row.name;
  const nextActive = active ?? row.active === 1;
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE stock_locations SET name = ?2, active = ?3, updated_at = ?4, updated_by = ?5 WHERE id = ?1")
      .bind(id, nextName, nextActive ? 1 : 0, now, user.id),
    auditStatement(db, {
      actor: user.id,
      action: "stock_location_change",
      entity: "stock_location",
      entityId: id,
      detail: { from: { name: row.name, active: row.active === 1 }, to: { name: nextName, active: nextActive } },
    }),
  ]);
  return c.json<StockLocationSaveResponse>({ location: toLocation((await loadLocation(db, id))!) });
});

// Spec 021b: what is at one place (read only).
locationRoutes.get("/locations/:id/stock", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const row = await loadLocation(db, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const items = (
    await db
      .prepare(
        `SELECT i.id, i.u_no, t.name AS type_name, i.status FROM inventory_items i JOIN inventory_item_types t ON t.id = i.type_id
         WHERE i.location_id = ?1 AND i.voided_at IS NULL AND i.status <> 'sold' ORDER BY i.item_code, i.serial`,
      )
      .bind(id)
      .all<{ id: string; u_no: string; type_name: string; status: InventoryStatus }>()
  ).results;
  const bulk = (
    await db
      .prepare(
        `SELECT b.id, b.name, b.unit, q.quantity FROM bulk_item_location_quantities q JOIN bulk_items b ON b.id = q.bulk_item_id
         WHERE q.location_id = ?1 AND q.quantity <> 0 ORDER BY b.name COLLATE NOCASE`,
      )
      .bind(id)
      .all<{ id: string; name: string; unit: string; quantity: number }>()
  ).results;
  return c.json<LocationStockResponse>({
    location: toLocation(row),
    items: items.map((r) => ({ id: r.id, uNo: r.u_no, typeName: r.type_name, status: r.status, statusLabel: INVENTORY_STATUS_LABEL[r.status] })),
    bulk: bulk.map((r) => ({ bulkItemId: r.id, name: r.name, unit: r.unit, quantity: r.quantity })),
  });
});

// ---- transfers (spec 021b T1 to T5, I2 to I4, B3, B4) ----

/** T3: the same id with the same content is a replay. */
function sameTransfer(row: TransferRow, f: StockTransferInput): boolean {
  const quantity = f.kind === "item" ? 1 : (f.quantity ?? 0);
  return (
    row.kind === f.kind &&
    row.inventory_item_id === (f.kind === "item" ? f.inventoryItemId : null) &&
    row.bulk_item_id === (f.kind === "bulk" ? f.bulkItemId : null) &&
    row.quantity === quantity &&
    row.from_location_id === f.fromLocationId &&
    row.to_location_id === f.toLocationId &&
    row.reason === f.reason
  );
}

locationRoutes.post("/transfers", async (c) => {
  const parsed = stockTransferSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = f.id ?? newId();

  const replay = classifyReplay(await loadTransfer(db, id), (row) => sameTransfer(row, f));
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different transfer" }, 409);
  if (replay.kind === "replay") return c.json<StockTransferSaveResponse>({ transfer: toTransfer(replay.row) });

  const from = await loadLocation(db, f.fromLocationId);
  if (!from) return c.json({ error: "validation", issues: [{ field: "fromLocationId", message: "Choose the place from the list" }] }, 400);
  const to = await loadLocation(db, f.toLocationId);
  if (!to) return c.json({ error: "validation", issues: [{ field: "toLocationId", message: "Choose the place from the list" }] }, 400);
  if (from.active !== 1 || to.active !== 1) {
    const off = from.active !== 1 ? from : to;
    return c.json({ error: "location_inactive", message: `${off.name} is not active. Choose another place.` }, 409);
  }

  const now = new Date().toISOString();
  const { reason } = f;

  if (f.kind === "item") {
    const itemId = f.inventoryItemId!;
    const item = await loadItem(db, itemId);
    if (!item) return c.json({ error: "validation", issues: [{ field: "inventoryItemId", message: "Choose the item from the list" }] }, 400);
    // Spec 021b I2: only an item in stock and not voided moves.
    if (item.voided_at || item.status !== "in_stock") {
      const what = item.voided_at ? "voided" : INVENTORY_STATUS_LABEL[item.status].toLowerCase();
      return c.json({ error: "item_not_in_stock", message: `${item.u_no} is ${what}, so it cannot be moved. Only items in stock can be moved.` }, 409);
    }
    // Spec 021b I3: the place the item is expected to be in must be its place now.
    if (item.location_id !== f.fromLocationId) {
      return c.json({ error: "stale", message: `${item.u_no} is at ${item.location_name} now. Reload and try again.` }, 409);
    }
    // I3: the three statements share one guard, so a stale request writes nothing.
    const guard = "EXISTS (SELECT 1 FROM inventory_items WHERE id = ?3 AND location_id = ?4 AND status = 'in_stock' AND voided_at IS NULL)";
    const [ins, upd] = await db.batch([
      db
        .prepare(
          `INSERT INTO stock_transfers (id, created_at, created_by, updated_at, updated_by, kind, inventory_item_id, bulk_item_id, quantity,
             from_location_id, to_location_id, at, actor, reason)
           SELECT ?1, ?2, ?5, ?2, ?5, 'item', ?3, NULL, 1, ?4, ?6, ?2, ?5, ?7 WHERE ${guard}`,
        )
        .bind(id, now, itemId, f.fromLocationId, user.id, f.toLocationId, reason),
      db
        .prepare("UPDATE inventory_items SET location_id = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1 AND location_id = ?5 AND status = 'in_stock' AND voided_at IS NULL")
        .bind(itemId, f.toLocationId, now, user.id, f.fromLocationId),
      // The audit row is written only with the transfer row (same guard).
      db
        .prepare(
          `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json)
           SELECT ?1, ?2, ?3, 'stock_transfer', 'inventory_item', ?4, ?5 WHERE EXISTS (SELECT 1 FROM stock_transfers WHERE id = ?6)`,
        )
        .bind(newId(), now, user.id, itemId, JSON.stringify({ transfer: id, from: f.fromLocationId, to: f.toLocationId, reason }), id),
    ]);
    if (ins!.meta.changes !== 1 || upd!.meta.changes !== 1) {
      return c.json({ error: "stale", message: "The item changed while you were saving. Reload and try again." }, 409);
    }
    return c.json<StockTransferSaveResponse>({ transfer: toTransfer((await loadTransfer(db, id))!) }, 201);
  }

  // Bulk: one transfer row. The trigger is the last guard; the API says it first, with the numbers.
  const bulkId = f.bulkItemId!;
  const quantity = f.quantity!;
  const bulk = await db.prepare("SELECT id, name, unit FROM bulk_items WHERE id = ?1").bind(bulkId).first<{ id: string; name: string; unit: string }>();
  if (!bulk) return c.json({ error: "validation", issues: [{ field: "bulkItemId", message: "Choose the bulk item from the list" }] }, 400);
  const atFrom = await balanceAt(db, bulkId, f.fromLocationId);
  if (atFrom < quantity) {
    return c.json(
      { error: "insufficient_quantity", message: `Only ${atFrom} ${bulk.unit} of ${bulk.name} are in stock at ${from.name}, so ${quantity} cannot be moved`, inStock: atFrom },
      409,
    );
  }
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO stock_transfers (id, created_at, created_by, updated_at, updated_by, kind, inventory_item_id, bulk_item_id, quantity,
             from_location_id, to_location_id, at, actor, reason)
           VALUES (?1, ?2, ?3, ?2, ?3, 'bulk', NULL, ?4, ?5, ?6, ?7, ?2, ?3, ?8)`,
        )
        .bind(id, now, user.id, bulkId, quantity, f.fromLocationId, f.toLocationId, reason),
      auditStatement(db, {
        actor: user.id,
        action: "stock_transfer",
        entity: "bulk_item",
        entityId: bulkId,
        detail: { transfer: id, quantity, from: f.fromLocationId, to: f.toLocationId, reason },
      }),
    ]);
  } catch (e) {
    if (isBelowZero(e)) {
      const left = await balanceAt(db, bulkId, f.fromLocationId);
      return c.json({ error: "insufficient_quantity", message: `Only ${left} ${bulk.unit} of ${bulk.name} are in stock at ${from.name}, so ${quantity} cannot be moved`, inStock: left }, 409);
    }
    if (isUniqueError(e)) {
      const again = classifyReplay(await loadTransfer(db, id), (row) => sameTransfer(row, f));
      if (again.kind === "replay") return c.json<StockTransferSaveResponse>({ transfer: toTransfer(again.row) });
      return c.json({ error: "id_conflict", message: "This id is already used by a different transfer" }, 409);
    }
    throw e;
  }
  return c.json<StockTransferSaveResponse>({ transfer: toTransfer((await loadTransfer(db, id))!) }, 201);
});

// Newest first, 20 per page with an offset cursor.
locationRoutes.get("/transfers", async (c) => {
  const db = c.env.DB;
  const itemId = c.req.query("itemId") ?? "";
  const bulkItemId = c.req.query("bulkItemId") ?? "";
  const locationId = c.req.query("locationId") ?? "";
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  if (itemId) where.push(`t.inventory_item_id = ${add(itemId)}`);
  if (bulkItemId) where.push(`t.bulk_item_id = ${add(bulkItemId)}`);
  if (locationId) {
    const p = add(locationId);
    where.push(`(t.from_location_id = ${p} OR t.to_location_id = ${p})`);
  }
  const sql = `${TRANSFER_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY t.at DESC, t.rowid DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const rows = (await db.prepare(sql).bind(...args).all<TransferRow>()).results;
  return c.json<StockTransferListResponse>({
    items: rows.slice(0, PAGE_SIZE).map(toTransfer),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  });
});
