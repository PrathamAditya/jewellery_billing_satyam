import { Hono } from "hono";
import {
  bulkItemCreateSchema,
  bulkMovementSchema,
  movementChange,
  newId,
  type BulkHistoryResponse,
  type BulkHistoryRow,
  type BulkItemListResponse,
  type BulkItemResponse,
  type BulkItemSaveResponse,
  type BulkMovementKind,
  type BulkMovementResponse,
  type BulkMovementSaveResponse,
  type BulkUnit,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { classifyReplay } from "../db/idempotency";
import { readJson, validationBody } from "../http";

/** Spec 020b: bulk quantity items. The quantity is the sum of the append-only movements (view bulk_item_quantities). */
export const bulkRoutes = new Hono<AppEnv>();

type ItemRow = { id: string; name: string; unit: BulkUnit; created_at: string; quantity: number };
type MovementRow = { id: string; bulk_item_id: string; kind: BulkMovementKind; quantity_change: number; at: string; actor: string; reason: string | null };

const ITEM_SELECT = `SELECT b.id, b.name, b.unit, b.created_at, q.quantity FROM bulk_items b JOIN bulk_item_quantities q ON q.bulk_item_id = b.id`;
const loadItem = (db: D1Database, id: string) => db.prepare(`${ITEM_SELECT} WHERE b.id = ?1`).bind(id).first<ItemRow>();
const toItem = (r: ItemRow): BulkItemResponse => ({ id: r.id, name: r.name, unit: r.unit, quantity: r.quantity, createdAt: r.created_at });
const toMovement = (r: MovementRow): BulkMovementResponse => ({
  id: r.id,
  kind: r.kind,
  quantityChange: r.quantity_change,
  at: r.at,
  actor: r.actor,
  reason: r.reason,
});
const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const isBelowZero = (e: unknown) => e instanceof Error && /quantity_below_zero/.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

bulkRoutes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const args: unknown[] = [];
  let where = "";
  if (q) {
    args.push(`%${escapeLike(q.toLowerCase())}%`);
    where = `WHERE lower(b.name) LIKE ?1 ESCAPE '\\'`;
  }
  const rows = (await c.env.DB.prepare(`${ITEM_SELECT} ${where} ORDER BY b.name COLLATE NOCASE`).bind(...args).all<ItemRow>()).results;
  return c.json<BulkItemListResponse>({ items: rows.map(toItem) });
});

// B3, B9, B10, B11: create, with an optional opening quantity written as a received movement in the same batch.
bulkRoutes.post("/", async (c) => {
  const parsed = bulkItemCreateSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = f.id ?? newId();
  const sameContent = (row: ItemRow) => row.name === f.name && row.unit === f.unit;

  const replay = classifyReplay(await loadItem(db, id), sameContent);
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different bulk item" }, 409);
  if (replay.kind === "replay") return c.json<BulkItemSaveResponse>({ item: toItem(replay.row) });

  const clash = await db.prepare("SELECT id FROM bulk_items WHERE name = ?1 COLLATE NOCASE").bind(f.name).first();
  if (clash) return c.json({ error: "duplicate_name", message: `There is already a bulk item called ${f.name}` }, 409);

  const now = new Date().toISOString();
  const batch: D1PreparedStatement[] = [
    db
      .prepare(`INSERT INTO bulk_items (id, created_at, created_by, updated_at, updated_by, name, unit) VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5)`)
      .bind(id, now, user.id, f.name, f.unit),
  ];
  if (f.openingQuantity > 0) {
    batch.push(
      db
        .prepare(
          `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by)
           VALUES (?1, ?2, 'received', ?3, ?4, ?5, 'Opening stock', ?4, ?5)`,
        )
        .bind(newId(), id, f.openingQuantity, now, user.id),
    );
  }
  batch.push(auditStatement(db, { actor: user.id, action: "bulk_item_create", entity: "bulk_item", entityId: id, detail: { name: f.name, unit: f.unit, openingQuantity: f.openingQuantity } }));
  try {
    await db.batch(batch);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    const again = classifyReplay(await loadItem(db, id), sameContent);
    if (again.kind === "replay") return c.json<BulkItemSaveResponse>({ item: toItem(again.row) });
    if (again.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different bulk item" }, 409);
    return c.json({ error: "duplicate_name", message: `There is already a bulk item called ${f.name}` }, 409);
  }
  return c.json<BulkItemSaveResponse>({ item: toItem((await loadItem(db, id))!) }, 201);
});

bulkRoutes.get("/:id", async (c) => {
  const row = await loadItem(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json<BulkItemSaveResponse>({ item: toItem(row) });
});

// B4, B5, B9, B10: record a movement. The database trigger is the final guard against a negative quantity.
bulkRoutes.post("/:id/movements", async (c) => {
  const parsed = bulkMovementSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const itemId = c.req.param("id");
  const item = await loadItem(db, itemId);
  if (!item) return c.json({ error: "not_found" }, 404);
  const change = movementChange(f.kind, f.quantity);
  const id = f.id ?? newId();

  const sameMovement = (m: MovementRow) => m.bulk_item_id === itemId && m.kind === f.kind && m.quantity_change === change && m.reason === f.reason;
  const existing = await db.prepare("SELECT id, bulk_item_id, kind, quantity_change, at, actor, reason FROM bulk_item_movements WHERE id = ?1").bind(id).first<MovementRow>();
  const replay = classifyReplay(existing, sameMovement);
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different movement" }, 409);
  if (replay.kind === "replay") return c.json<BulkMovementSaveResponse>({ movement: toMovement(replay.row), quantity: item.quantity });

  if (item.quantity + change < 0) {
    return c.json(
      {
        error: "insufficient_quantity",
        message: `Only ${item.quantity} ${item.unit} of ${item.name} are in stock, so ${Math.abs(change)} cannot be taken out`,
        inStock: item.quantity,
      },
      409,
    );
  }

  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?5, ?6)`,
        )
        .bind(id, itemId, f.kind, change, now, user.id, f.reason),
      auditStatement(db, {
        actor: user.id,
        action: "bulk_item_movement",
        entity: "bulk_item",
        entityId: itemId,
        detail: { movement: id, kind: f.kind, quantityChange: change, reason: f.reason },
      }),
    ]);
  } catch (e) {
    if (isBelowZero(e)) {
      const now2 = await loadItem(db, itemId);
      return c.json({ error: "insufficient_quantity", message: `Only ${now2?.quantity ?? 0} ${item.unit} are in stock, so this cannot be taken out`, inStock: now2?.quantity ?? 0 }, 409);
    }
    if (isUniqueError(e)) return c.json({ error: "id_conflict", message: "This movement was just saved by someone else" }, 409);
    throw e;
  }
  const saved = (await db.prepare("SELECT id, bulk_item_id, kind, quantity_change, at, actor, reason FROM bulk_item_movements WHERE id = ?1").bind(id).first<MovementRow>())!;
  const after = await loadItem(db, itemId);
  return c.json<BulkMovementSaveResponse>({ movement: toMovement(saved), quantity: after!.quantity }, 201);
});

// B8: oldest first, ties kept in the order they were written, each row with the balance after it.
bulkRoutes.get("/:id/history", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  if (!(await loadItem(db, id))) return c.json({ error: "not_found" }, 404);
  const rows = (
    await db
      .prepare("SELECT id, bulk_item_id, kind, quantity_change, at, actor, reason FROM bulk_item_movements WHERE bulk_item_id = ?1 ORDER BY at, rowid")
      .bind(id)
      .all<MovementRow>()
  ).results;
  let balance = 0;
  const items: BulkHistoryRow[] = rows.map((r) => {
    balance += r.quantity_change;
    return { ...toMovement(r), balanceAfter: balance };
  });
  return c.json<BulkHistoryResponse>({ items });
});
