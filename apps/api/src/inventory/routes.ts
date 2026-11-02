import { Hono } from "hono";
import {
  INVENTORY_STATUSES,
  INVENTORY_STATUS_LABEL,
  formatUNo,
  inventoryItemCreateSchema,
  inventoryStatusChangeSchema,
  inventoryVoidSchema,
  itemTypeCreateSchema,
  itemTypeUpdateSchema,
  newId,
  SERIAL_MAX,
  type InventoryHistoryResponse,
  type InventoryHistoryRow,
  type InventoryItemListResponse,
  type InventoryItemResponse,
  type InventoryItemSaveResponse,
  type InventoryItemType,
  type InventoryMetal,
  type InventoryStatus,
  type InventoryTypesResponse,
} from "@jewellery/shared";
import type { AppEnv } from "../env";
import { auditStatement } from "../db/audit";
import { classifyReplay } from "../db/idempotency";
import { readJson, validationBody } from "../http";

/** Spec 020: inventory items with an individual U No., item types and the status history. */
export const inventoryRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;

type ItemRow = {
  id: string;
  created_at: string;
  created_by: string;
  u_no: string;
  item_code: string;
  serial: number;
  type_id: string;
  type_name: string;
  pieces: number;
  metal: InventoryMetal;
  purity: string;
  gross_weight_mg: number;
  net_weight_mg: number;
  hsn: string;
  labour_note: string | null;
  location: string | null;
  status: InventoryStatus;
  voided_at: string | null;
  void_reason: string | null;
};

type TypeRow = { id: string; name: string; item_code: string; active: number };

const ITEM_SELECT = `SELECT i.*, t.name AS type_name FROM inventory_items i JOIN inventory_item_types t ON t.id = i.type_id`;

export const loadItem = (db: D1Database, id: string) => db.prepare(`${ITEM_SELECT} WHERE i.id = ?1`).bind(id).first<ItemRow>();

const toItem = (r: ItemRow): InventoryItemResponse => ({
  id: r.id,
  uNo: r.u_no,
  itemCode: r.item_code,
  serial: r.serial,
  typeId: r.type_id,
  typeName: r.type_name,
  pieces: r.pieces,
  metal: r.metal,
  purity: r.purity,
  grossWeightMg: r.gross_weight_mg,
  netWeightMg: r.net_weight_mg,
  hsn: r.hsn,
  labourNote: r.labour_note,
  location: r.location,
  status: r.status,
  statusLabel: INVENTORY_STATUS_LABEL[r.status],
  createdAt: r.created_at,
  createdBy: r.created_by,
  voided: r.voided_at !== null,
  voidedAt: r.voided_at,
  voidReason: r.void_reason,
});

const toType = (r: TypeRow): InventoryItemType => ({ id: r.id, name: r.name, itemCode: r.item_code, active: r.active === 1 });

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const isStatus = (v: string): v is InventoryStatus => (INVENTORY_STATUSES as readonly string[]).includes(v);

// ---- item types (spec 020 I10, I11) ----

inventoryRoutes.get("/types", async (c) => {
  const rows = (await c.env.DB.prepare("SELECT id, name, item_code, active FROM inventory_item_types ORDER BY active DESC, name COLLATE NOCASE").all<TypeRow>()).results;
  return c.json<InventoryTypesResponse>({ items: rows.map(toType) });
});

inventoryRoutes.post("/types", async (c) => {
  const parsed = itemTypeCreateSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const { name, itemCode } = parsed.data;
  const clashCode = await db.prepare("SELECT id FROM inventory_item_types WHERE item_code = ?1").bind(itemCode).first();
  if (clashCode) return c.json({ error: "duplicate_item_code", message: `The code ${itemCode} is already used by another type` }, 409);
  const clashName = await db.prepare("SELECT id FROM inventory_item_types WHERE name = ?1 COLLATE NOCASE").bind(name).first();
  if (clashName) return c.json({ error: "duplicate_type_name", message: `There is already a type called ${name}` }, 409);

  const id = newId();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO inventory_item_types (id, created_at, created_by, updated_at, updated_by, name, item_code, active)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, 1)`,
        )
        .bind(id, now, user.id, name, itemCode),
      auditStatement(db, { actor: user.id, action: "inventory_type_create", entity: "inventory_item_type", entityId: id, detail: { name, itemCode } }),
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    return c.json({ error: "duplicate_item_code", message: "That type or code was just added by someone else" }, 409);
  }
  const row = await db.prepare("SELECT id, name, item_code, active FROM inventory_item_types WHERE id = ?1").bind(id).first<TypeRow>();
  return c.json(toType(row!), 201);
});

inventoryRoutes.patch("/types/:id", async (c) => {
  const parsed = itemTypeUpdateSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await db.prepare("SELECT id, name, item_code, active FROM inventory_item_types WHERE id = ?1").bind(id).first<TypeRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const { name, active } = parsed.data;
  if (name !== undefined) {
    const clash = await db.prepare("SELECT id FROM inventory_item_types WHERE name = ?1 COLLATE NOCASE AND id <> ?2").bind(name, id).first();
    if (clash) return c.json({ error: "duplicate_type_name", message: `There is already a type called ${name}` }, 409);
  }
  const nextName = name ?? row.name;
  const nextActive = active ?? row.active === 1;
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE inventory_item_types SET name = ?2, active = ?3, updated_at = ?4, updated_by = ?5 WHERE id = ?1")
      .bind(id, nextName, nextActive ? 1 : 0, now, user.id),
    auditStatement(db, {
      actor: user.id,
      action: "inventory_type_change",
      entity: "inventory_item_type",
      entityId: id,
      detail: { from: { name: row.name, active: row.active === 1 }, to: { name: nextName, active: nextActive } },
    }),
  ]);
  const updated = await db.prepare("SELECT id, name, item_code, active FROM inventory_item_types WHERE id = ?1").bind(id).first<TypeRow>();
  return c.json(toType(updated!));
});

// ---- items (spec 020 I1 to I21) ----

// I17: search by U No. (spaces ignored, any part), type and status. 20 per page.
inventoryRoutes.get("/items", async (c) => {
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").replace(/\s+/g, "").toUpperCase();
  const typeId = c.req.query("typeId") ?? "";
  const status = c.req.query("status") ?? "";
  const includeVoided = c.req.query("includeVoided") === "1";
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  if (status && !isStatus(status)) return c.json({ error: "validation", issues: [{ field: "status", message: "Unknown status" }] }, 400);

  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  if (q) where.push(`i.u_no LIKE ${add(`%${escapeLike(q)}%`)} ESCAPE '\\'`);
  if (typeId) where.push(`i.type_id = ${add(typeId)}`);
  if (status) where.push(`i.status = ${add(status)}`);
  if (!includeVoided) where.push("i.voided_at IS NULL");

  const sql = `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY i.item_code, i.serial, i.id LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const rows = (await db.prepare(sql).bind(...args).all<ItemRow>()).results;
  return c.json<InventoryItemListResponse>({
    items: rows.slice(0, PAGE_SIZE).map(toItem),
    nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  });
});

/** I16: a retry with the same id and content returns the first result. */
function sameItemContent(row: ItemRow, f: ReturnType<typeof inventoryItemCreateSchema.parse>): boolean {
  return (
    row.type_id === f.typeId &&
    (f.uNo === null || row.u_no === f.uNo) &&
    row.pieces === f.pieces &&
    row.metal === f.metal &&
    row.purity === f.purity &&
    row.gross_weight_mg === f.grossWeightMg &&
    row.net_weight_mg === f.netWeightMg &&
    row.hsn === f.hsn &&
    row.labour_note === f.labourNote &&
    row.location === f.location
  );
}

inventoryRoutes.post("/items", async (c) => {
  const parsed = inventoryItemCreateSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = f.id ?? newId();

  const replay = classifyReplay(await loadItem(db, id), (row) => sameItemContent(row, f));
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different item" }, 409);
  if (replay.kind === "replay") return c.json<InventoryItemSaveResponse>({ item: toItem(replay.row) });

  const type = await db.prepare("SELECT id, name, item_code, active FROM inventory_item_types WHERE id = ?1").bind(f.typeId).first<TypeRow>();
  if (!type) return c.json({ error: "validation", issues: [{ field: "typeId", message: "Choose the item type from the list" }] }, 400);
  if (type.active !== 1) return c.json({ error: "type_inactive", message: `${type.name} is no longer used for new items` }, 409);

  let uNo: string;
  if (f.uNo) {
    // I7: a typed U No. must start with the type's code, and must not be used by a live item.
    if (!f.uNo.startsWith(type.item_code)) {
      return c.json({ error: "validation", issues: [{ field: "uNo", message: `The U No. of a ${type.name} starts with ${type.item_code}` }] }, 400);
    }
    uNo = f.uNo;
    const taken = await db.prepare("SELECT id FROM inventory_items WHERE u_no = ?1 AND voided_at IS NULL").bind(uNo).first();
    if (taken) return c.json({ error: "u_no_taken", message: `${uNo} is already used by another item` }, 409);
  } else {
    // I6: the next serial for the code, one more than the highest ever used (voided items included).
    const max = await db.prepare("SELECT MAX(serial) AS m FROM inventory_items WHERE item_code = ?1").bind(type.item_code).first<{ m: number | null }>();
    const next = (max?.m ?? 0) + 1;
    if (next > SERIAL_MAX) return c.json({ error: "serial_full", message: `${type.item_code} has used all 99 numbers. Add a new item type with another code.` }, 409);
    uNo = formatUNo(type.item_code, next);
  }
  const serial = Number(uNo.slice(4));
  const now = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO inventory_items
             (id, created_at, created_by, updated_at, updated_by, u_no, item_code, serial, type_id, pieces, metal, purity,
              gross_weight_mg, net_weight_mg, hsn, labour_note, location, status)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'in_stock')`,
        )
        .bind(id, now, user.id, uNo, type.item_code, serial, f.typeId, f.pieces, f.metal, f.purity, f.grossWeightMg, f.netWeightMg, f.hsn, f.labourNote, f.location),
      db
        .prepare(
          `INSERT INTO inventory_item_history (id, item_id, from_status, to_status, at, actor, reason, created_at, created_by)
           VALUES (?1, ?2, NULL, 'in_stock', ?3, ?4, 'Created', ?3, ?4)`,
        )
        .bind(newId(), id, now, user.id),
      auditStatement(db, { actor: user.id, action: "inventory_item_create", entity: "inventory_item", entityId: id, detail: { uNo, pieces: f.pieces } }),
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    // Lost a race for the same U No. or the same id.
    const again = classifyReplay(await loadItem(db, id), (row) => sameItemContent(row, f));
    if (again.kind === "replay") return c.json<InventoryItemSaveResponse>({ item: toItem(again.row) });
    if (again.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different item" }, 409);
    return c.json({ error: "u_no_taken", message: `${uNo} was just taken. Save again to get the next number.` }, 409);
  }
  return c.json<InventoryItemSaveResponse>({ item: toItem((await loadItem(db, id))!) }, 201);
});

inventoryRoutes.get("/items/:id", async (c) => {
  const row = await loadItem(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json<InventoryItemSaveResponse>({ item: toItem(row) });
});

// I14: oldest first, ties kept in the order they were written.
inventoryRoutes.get("/items/:id/history", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  if (!(await loadItem(db, id))) return c.json({ error: "not_found" }, 404);
  const rows = (
    await db
      .prepare(
        `SELECT id, from_status, to_status, at, actor, reason FROM inventory_item_history WHERE item_id = ?1 ORDER BY at, rowid`,
      )
      .bind(id)
      .all<{ id: string; from_status: InventoryStatus | null; to_status: InventoryStatus; at: string; actor: string; reason: string | null }>()
  ).results;
  return c.json<InventoryHistoryResponse>({
    items: rows.map((r): InventoryHistoryRow => ({ id: r.id, fromStatus: r.from_status, toStatus: r.to_status, at: r.at, actor: r.actor, reason: r.reason })),
  });
});

// I13: a status change, one batch. The guards make the batch write nothing if the item changed meanwhile.
inventoryRoutes.post("/items/:id/status", async (c) => {
  const parsed = inventoryStatusChangeSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await loadItem(db, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "item_voided", message: "This item is voided. Its status cannot change." }, 409);
  const to = parsed.data.status;
  const from = row.status;
  if (from === to) return c.json({ error: "same_status", message: `The item is already ${INVENTORY_STATUS_LABEL[to].toLowerCase()}` }, 409);
  if (from === "written_off") return c.json({ error: "invalid_status_move", message: "A written off item cannot change status" }, 409);

  const now = new Date().toISOString();
  const { reason } = parsed.data;
  const [update] = await db.batch([
    db
      .prepare("UPDATE inventory_items SET status = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?1 AND status = ?5 AND voided_at IS NULL")
      .bind(id, to, now, user.id, from),
    db
      .prepare(
        `INSERT INTO inventory_item_history (id, item_id, from_status, to_status, at, actor, reason, created_at, created_by)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?5, ?6 WHERE (SELECT status FROM inventory_items WHERE id = ?2) = ?4`,
      )
      .bind(newId(), id, from, to, now, user.id, reason),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json)
         SELECT ?1, ?2, ?3, 'inventory_status_change', 'inventory_item', ?4, ?5 WHERE (SELECT status FROM inventory_items WHERE id = ?4) = ?6`,
      )
      .bind(newId(), now, user.id, id, JSON.stringify({ from, to, reason }), to),
  ]);
  if (update!.meta.changes !== 1) return c.json({ error: "stale", message: "The item changed while you were saving. Reload and try again." }, 409);
  return c.json<InventoryItemSaveResponse>({ item: toItem((await loadItem(db, id))!) });
});

// I15: void an item that is in stock or written off. Nothing else is touched.
inventoryRoutes.post("/items/:id/void", async (c) => {
  const parsed = inventoryVoidSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(validationBody(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const id = c.req.param("id");
  const row = await loadItem(db, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.voided_at) return c.json({ error: "already_voided", message: "This item is already voided" }, 409);
  if (row.status !== "in_stock" && row.status !== "written_off") {
    return c.json({ error: "item_in_use", message: `A ${INVENTORY_STATUS_LABEL[row.status].toLowerCase()} item cannot be voided` }, 409);
  }
  const now = new Date().toISOString();
  const { reason } = parsed.data;
  const [update] = await db.batch([
    db
      .prepare("UPDATE inventory_items SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE id = ?1 AND voided_at IS NULL")
      .bind(id, now, user.id, reason),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json)
         SELECT ?1, ?2, ?3, 'inventory_item_void', 'inventory_item', ?4, ?5 WHERE (SELECT voided_at FROM inventory_items WHERE id = ?4) = ?2`,
      )
      .bind(newId(), now, user.id, id, JSON.stringify({ uNo: row.u_no, reason })),
  ]);
  if (update!.meta.changes !== 1) return c.json({ error: "stale", message: "The item changed while you were saving. Reload and try again." }, 409);
  return c.json<InventoryItemSaveResponse>({ item: toItem((await loadItem(db, id))!) });
});
