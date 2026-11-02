import { Hono } from "hono";
import type { ZodError } from "zod";
import {
  INVENTORY_STATUS_LABEL,
  PURCHASE_TYPES,
  PURCHASE_TYPE_LABEL,
  formatUNo,
  formatWeightGrams,
  inventoryVoidSchema,
  newId,
  purchaseCreateSchema,
  SERIAL_MAX,
  type BulkUnit,
  type InventoryStatus,
  type PurchaseCreateInput,
  type PurchaseDetail,
  type PurchaseLineKind,
  type PurchaseLineView,
  type PurchaseListItem,
  type PurchaseListResponse,
  type PurchaseSaveResponse,
  type PurchaseType,
  type RawStockResponse,
  type RawStockRow,
} from "@jewellery/shared";
import { financialYearOf } from "@jewellery/calc";
import type { AppEnv } from "../env";
import { classifyReplay } from "../db/idempotency";
import { readJson } from "../http";
import { loadLocation } from "./routes";

/**
 * Spec 022: purchases of three types. A save and a void are each one D1 batch: the number, the rows, the stock
 * movements and the audit row go together, so a refused save writes nothing and uses no number.
 */
export const purchaseRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 20;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type PurchaseRow = {
  id: string;
  created_at: string;
  created_by: string;
  purchase_no: string;
  fy: string;
  serial: number;
  purchase_type: PurchaseType;
  purchase_date: string;
  supplier_name: string;
  supplier_bill_no: string | null;
  karigar_name: string | null;
  location_id: string;
  location_name: string;
  remarks: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

type LineRow = {
  id: string;
  line_no: number;
  line_kind: PurchaseLineKind;
  inventory_item_id: string | null;
  bulk_item_id: string | null;
  quantity: number | null;
  metal: "gold" | "silver" | null;
  purity: string | null;
  weight_mg: number | null;
  amount_paise: number | null;
  u_no: string | null;
  item_status: InventoryStatus | null;
  item_voided_at: string | null;
  item_type_id: string | null;
  item_pieces: number | null;
  item_metal: string | null;
  item_purity: string | null;
  item_gross: number | null;
  item_net: number | null;
  item_hsn: string | null;
  item_labour: string | null;
  type_name: string | null;
  bulk_name: string | null;
  bulk_unit: BulkUnit | null;
};

type TypeRow = { id: string; name: string; item_code: string; active: number };

const PURCHASE_SELECT = `SELECT p.id, p.created_at, p.created_by, p.purchase_no, p.fy, p.serial, p.purchase_type, p.purchase_date,
    p.supplier_name, p.supplier_bill_no, p.karigar_name, p.location_id, l.name AS location_name, p.remarks,
    p.voided_at, p.voided_by, p.void_reason
  FROM purchases p JOIN stock_locations l ON l.id = p.location_id`;

const LINE_SELECT = `SELECT pl.id, pl.line_no, pl.line_kind, pl.inventory_item_id, pl.bulk_item_id, pl.quantity, pl.metal, pl.purity,
    pl.weight_mg, pl.amount_paise, i.u_no, i.status AS item_status, i.voided_at AS item_voided_at,
    i.type_id AS item_type_id, i.pieces AS item_pieces, i.metal AS item_metal, i.purity AS item_purity,
    i.gross_weight_mg AS item_gross, i.net_weight_mg AS item_net, i.hsn AS item_hsn, i.labour_note AS item_labour,
    t.name AS type_name, b.name AS bulk_name, b.unit AS bulk_unit
  FROM purchase_lines pl
  LEFT JOIN inventory_items i ON i.id = pl.inventory_item_id
  LEFT JOIN inventory_item_types t ON t.id = i.type_id
  LEFT JOIN bulk_items b ON b.id = pl.bulk_item_id`;

/** Spec 021 / 021b: the stock of one bulk item at one place (movements there, plus transfers in, minus transfers out). */
const BULK_AT_PLACE = `(SELECT COALESCE(SUM(m.quantity_change), 0) FROM bulk_item_movements m WHERE m.bulk_item_id = ?1 AND m.location_id = ?2)
  + (SELECT COALESCE(SUM(t.quantity), 0) FROM stock_transfers t WHERE t.bulk_item_id = ?1 AND t.to_location_id = ?2)
  - (SELECT COALESCE(SUM(t.quantity), 0) FROM stock_transfers t WHERE t.bulk_item_id = ?1 AND t.from_location_id = ?2)`;

const bulkAtPlace = async (db: D1Database, bulkId: string, locationId: string) =>
  (await db.prepare(`SELECT ${BULK_AT_PLACE} AS q`).bind(bulkId, locationId).first<{ q: number }>())?.q ?? 0;
const rawAtPlace = async (db: D1Database, metal: string, purity: string, locationId: string) =>
  (
    await db
      .prepare("SELECT COALESCE(SUM(weight_mg), 0) AS w FROM raw_metal_movements WHERE metal = ?1 AND purity = ?2 AND location_id = ?3")
      .bind(metal, purity, locationId)
      .first<{ w: number }>()
  )?.w ?? 0;

/** Spec 022 PU17: true when the purchase has been voided at exactly this batch's time. */
const purchaseVoidedNow = (purchaseParam: string, nowParam: string) => `(SELECT voided_at FROM purchases WHERE id = ${purchaseParam}) = ${nowParam}`;

const isUniqueError = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const isBelowZero = (e: unknown) => e instanceof Error && /raw_stock_below_zero|quantity_below_zero/.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const grams = (mg: number) => `${formatWeightGrams(mg)} g`;
const purityText = (metal: string, purity: string) => (purity === "silver" ? "silver" : `${metal} ${purity}`);

const loadPurchase = (db: D1Database, id: string) => db.prepare(`${PURCHASE_SELECT} WHERE p.id = ?1`).bind(id).first<PurchaseRow>();
const loadLines = (db: D1Database, id: string) => db.prepare(`${LINE_SELECT} WHERE pl.purchase_id = ?1 ORDER BY pl.line_no`).bind(id).all<LineRow>();

/** Spec 022: a validation error with fields like `lines.2.purity` (lines numbered from 1, as the screen shows them). */
function purchaseValidation(error: ZodError) {
  return {
    error: "validation" as const,
    issues: error.issues.map((i) => ({ field: i.path.map((p) => (typeof p === "number" ? String(p + 1) : String(p))).join("."), message: i.message })),
  };
}

async function toDetail(db: D1Database, p: PurchaseRow): Promise<PurchaseDetail> {
  const rows = (await loadLines(db, p.id)).results;
  const lines: PurchaseLineView[] = [];
  for (const r of rows) {
    lines.push({
      lineNo: r.line_no,
      kind: r.line_kind,
      amountPaise: r.amount_paise,
      item: r.inventory_item_id
        ? {
            id: r.inventory_item_id,
            uNo: r.u_no ?? "",
            typeName: r.type_name ?? "",
            status: r.item_status ?? "in_stock",
            statusLabel: INVENTORY_STATUS_LABEL[r.item_status ?? "in_stock"],
            voided: r.item_voided_at !== null,
          }
        : null,
      bulk: r.bulk_item_id
        ? {
            id: r.bulk_item_id,
            name: r.bulk_name ?? "",
            unit: r.bulk_unit ?? "pcs",
            quantity: r.quantity ?? 0,
            balanceAtPlace: await bulkAtPlace(db, r.bulk_item_id, p.location_id),
          }
        : null,
      metal: r.metal,
      purity: r.purity,
      weightMg: r.weight_mg,
    });
  }
  return {
    id: p.id,
    purchaseNo: p.purchase_no,
    fy: p.fy,
    purchaseDate: p.purchase_date,
    purchaseType: p.purchase_type,
    purchaseTypeLabel: PURCHASE_TYPE_LABEL[p.purchase_type],
    supplierName: p.supplier_name,
    supplierBillNo: p.supplier_bill_no,
    karigarName: p.karigar_name,
    locationId: p.location_id,
    locationName: p.location_name,
    remarks: p.remarks,
    createdAt: p.created_at,
    createdBy: p.created_by,
    voided: p.voided_at !== null,
    voidedAt: p.voided_at,
    voidedBy: p.voided_by,
    voidReason: p.void_reason,
    lines,
  };
}

// ---- replay (spec 001 R5): the same id with the same content returns the first purchase ----

/** A request line as a string, without its U No. (a typed U No. is compared separately). */
function requestSignature(l: PurchaseCreateInput["lines"][number]): string {
  const amount = l.amountPaise ?? "";
  switch (l.kind) {
    case "item":
      return ["item", l.typeId, l.pieces, l.metal, l.purity, l.grossWeightMg, l.netWeightMg, l.hsn, l.labourNote ?? "", amount].join("|");
    case "bulk":
      return ["bulk", l.bulkItemId, l.quantity, amount].join("|");
    default:
      return [l.kind, l.metal, l.purity, l.weightMg, amount].join("|");
  }
}

function storedSignature(r: LineRow): string {
  const amount = r.amount_paise ?? "";
  switch (r.line_kind) {
    case "item":
      return ["item", r.item_type_id, r.item_pieces, r.item_metal, r.item_purity, r.item_gross, r.item_net, r.item_hsn, r.item_labour ?? "", amount].join("|");
    case "bulk":
      return ["bulk", r.bulk_item_id, r.quantity, amount].join("|");
    default:
      return [r.line_kind, r.metal, r.purity, r.weight_mg, amount].join("|");
  }
}

function sameContent(p: PurchaseRow, lines: LineRow[], f: PurchaseCreateInput): boolean {
  const header =
    p.purchase_type === f.purchaseType &&
    p.purchase_date === f.purchaseDate &&
    p.supplier_name === f.supplierName &&
    p.supplier_bill_no === f.supplierBillNo &&
    p.karigar_name === f.karigarName &&
    p.location_id === f.locationId &&
    p.remarks === f.remarks;
  if (!header || lines.length !== f.lines.length) return false;
  return f.lines.every((l, i) => {
    const r = lines[i]!;
    if (requestSignature(l) !== storedSignature(r)) return false;
    // A typed U No. must be the one stored; an automatic one (not typed) matches whatever was issued.
    return l.kind !== "item" || !l.uNo || l.uNo === r.u_no;
  });
}

async function replayFor(db: D1Database, id: string, f: PurchaseCreateInput) {
  const existing = await loadPurchase(db, id);
  if (!existing) return { kind: "new" as const };
  const lines = (await loadLines(db, id)).results;
  return classifyReplay(existing, () => sameContent(existing, lines, f));
}

// ---- list and raw stock ----

purchaseRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const type = c.req.query("type") ?? "";
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const includeVoided = c.req.query("includeVoided") === "1";
  const offset = Math.max(0, Number.parseInt(c.req.query("cursor") ?? "0", 10) || 0);
  if (type && !(PURCHASE_TYPES as readonly string[]).includes(type)) return c.json({ error: "validation", issues: [{ field: "type", message: "Unknown purchase type" }] }, 400);
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return c.json({ error: "validation", issues: [{ field: "from", message: "Use the date as 2026-11-02" }] }, 400);

  const where: string[] = [];
  const args: unknown[] = [];
  const add = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  if (type) where.push(`p.purchase_type = ${add(type)}`);
  if (from) where.push(`p.purchase_date >= ${add(from)}`);
  if (to) where.push(`p.purchase_date <= ${add(to)}`);
  if (q) where.push(`lower(p.supplier_name) LIKE ${add(`%${escapeLike(q)}%`)} ESCAPE '\\'`);
  if (!includeVoided) where.push("p.voided_at IS NULL");

  const sql = `SELECT p.id, p.purchase_no, p.purchase_date, p.purchase_type, p.supplier_name, p.supplier_bill_no, p.karigar_name,
      p.location_id, l.name AS location_name, p.voided_at,
      (SELECT COUNT(*) FROM purchase_lines pl WHERE pl.purchase_id = p.id) AS line_count
    FROM purchases p JOIN stock_locations l ON l.id = p.location_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY p.purchase_date DESC, p.created_at DESC, p.id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const rows = (
    await db.prepare(sql).bind(...args).all<{
      id: string;
      purchase_no: string;
      purchase_date: string;
      purchase_type: PurchaseType;
      supplier_name: string;
      supplier_bill_no: string | null;
      karigar_name: string | null;
      location_id: string;
      location_name: string;
      voided_at: string | null;
      line_count: number;
    }>()
  ).results;
  const items: PurchaseListItem[] = rows.slice(0, PAGE_SIZE).map((r) => ({
    id: r.id,
    purchaseNo: r.purchase_no,
    purchaseDate: r.purchase_date,
    purchaseType: r.purchase_type,
    purchaseTypeLabel: PURCHASE_TYPE_LABEL[r.purchase_type],
    supplierName: r.supplier_name,
    supplierBillNo: r.supplier_bill_no,
    karigarName: r.karigar_name,
    locationId: r.location_id,
    locationName: r.location_name,
    lineCount: r.line_count,
    voided: r.voided_at !== null,
    voidedAt: r.voided_at,
  }));
  return c.json<PurchaseListResponse>({ items, nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null });
});

// Spec 022: the raw gold and silver that is in stock (balances that are not zero), by metal, purity and place.
// Listed before "/:id" so that "raw-stock" is not read as an id.
purchaseRoutes.get("/raw-stock", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      `SELECT r.metal, r.purity, r.location_id, l.name AS location_name, r.weight_mg
       FROM raw_metal_balances r JOIN stock_locations l ON l.id = r.location_id
       WHERE r.weight_mg <> 0 ORDER BY r.metal, r.purity, l.name COLLATE NOCASE`,
    ).all<{ metal: "gold" | "silver"; purity: string; location_id: string; location_name: string; weight_mg: number }>()
  ).results;
  const items: RawStockRow[] = rows.map((r) => ({ metal: r.metal, purity: r.purity, locationId: r.location_id, locationName: r.location_name, weightMg: r.weight_mg }));
  return c.json<RawStockResponse>({ items });
});

// ---- save ----

purchaseRoutes.post("/", async (c) => {
  const parsed = purchaseCreateSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(purchaseValidation(parsed.error), 400);
  const f = parsed.data;
  const db = c.env.DB;
  const user = c.get("user");
  const id = f.id ?? newId();

  const replay = await replayFor(db, id, f);
  if (replay.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different purchase" }, 409);
  if (replay.kind === "replay") return c.json<PurchaseSaveResponse>({ purchase: await toDetail(db, replay.row) });

  const issues: { field: string; message: string }[] = [];
  let fy: string;
  try {
    fy = financialYearOf(f.purchaseDate);
  } catch {
    return c.json({ error: "validation", issues: [{ field: "purchaseDate", message: "That is not a real date. Use the date as 2026-11-02" }] }, 400);
  }
  const place = await loadLocation(db, f.locationId);
  if (!place) return c.json({ error: "validation", issues: [{ field: "locationId", message: "Choose the place from the list" }] }, 400);
  if (!place.active) return c.json({ error: "location_inactive", message: `${place.name} is not active. Choose another place.` }, 409);

  // Item lines: the type must exist and be active; a typed U No. must fit the type and be free.
  const types = new Map<string, TypeRow>();
  const codes = new Map<string, number>();
  for (const [i, l] of f.lines.entries()) {
    if (l.kind !== "item" || types.has(l.typeId)) continue;
    const t = await db.prepare("SELECT id, name, item_code, active FROM inventory_item_types WHERE id = ?1").bind(l.typeId).first<TypeRow>();
    if (!t) issues.push({ field: `lines.${i + 1}.typeId`, message: "Choose the item type from the list" });
    else types.set(l.typeId, t);
  }
  const bulkItems = new Map<string, { id: string; name: string; unit: BulkUnit }>();
  for (const [i, l] of f.lines.entries()) {
    if (l.kind !== "bulk") continue;
    if (bulkItems.has(l.bulkItemId)) continue;
    const b = await db.prepare("SELECT id, name, unit FROM bulk_items WHERE id = ?1").bind(l.bulkItemId).first<{ id: string; name: string; unit: BulkUnit }>();
    if (!b) issues.push({ field: `lines.${i + 1}.bulkItemId`, message: "Choose the bulk item from the list" });
    else bulkItems.set(l.bulkItemId, b);
  }
  for (const t of types.values()) {
    if (!codes.has(t.item_code)) {
      const max = await db.prepare("SELECT MAX(serial) AS m FROM inventory_items WHERE item_code = ?1").bind(t.item_code).first<{ m: number | null }>();
      codes.set(t.item_code, max?.m ?? 0);
    }
  }
  // PU11: the U No. of each item line, in the order of the lines (automatic serials count on from the typed ones).
  const uNos = new Map<number, string>();
  const typedSeen = new Map<string, number>();
  for (const [i, l] of f.lines.entries()) {
    if (l.kind !== "item") continue;
    const t = types.get(l.typeId);
    if (!t) continue;
    if (l.uNo) {
      if (!l.uNo.startsWith(t.item_code)) {
        issues.push({ field: `lines.${i + 1}.uNo`, message: `The U No. of a ${t.name} starts with ${t.item_code}` });
        continue;
      }
      if (typedSeen.has(l.uNo)) {
        issues.push({ field: `lines.${i + 1}.uNo`, message: `${l.uNo} is already on line ${typedSeen.get(l.uNo)}` });
        continue;
      }
      typedSeen.set(l.uNo, i + 1);
      uNos.set(i, l.uNo);
      codes.set(t.item_code, Math.max(codes.get(t.item_code) ?? 0, Number(l.uNo.slice(4))));
    }
  }
  if (issues.length) return c.json({ error: "validation", issues }, 400);

  for (const [i, l] of f.lines.entries()) {
    if (l.kind !== "item" || uNos.has(i)) continue;
    const t = types.get(l.typeId)!;
    const next = (codes.get(t.item_code) ?? 0) + 1;
    if (next > SERIAL_MAX) return c.json({ error: "serial_full", message: `${t.item_code} has used all 99 numbers. Add a new item type with another code.` }, 409);
    codes.set(t.item_code, next);
    uNos.set(i, formatUNo(t.item_code, next));
  }
  for (const l of f.lines) {
    if (l.kind !== "item") continue;
    const t = types.get(l.typeId)!;
    if (t.active !== 1) return c.json({ error: "type_inactive", message: `${t.name} is no longer used for new items` }, 409);
    if (l.uNo) {
      const taken = await db.prepare("SELECT id FROM inventory_items WHERE u_no = ?1 AND voided_at IS NULL").bind(l.uNo).first();
      if (taken) return c.json({ error: "u_no_taken", message: `${l.uNo} is already used by another item` }, 409);
    }
  }

  // PU14: metal given to a karigar must be in stock at the place, for each metal and purity together.
  const used = new Map<string, { metal: string; purity: string; need: number }>();
  for (const l of f.lines) {
    if (l.kind !== "metal_used") continue;
    const key = `${l.metal}|${l.purity}`;
    const cur = used.get(key) ?? { metal: l.metal, purity: l.purity, need: 0 };
    cur.need += l.weightMg;
    used.set(key, cur);
  }
  for (const u of used.values()) {
    const have = await rawAtPlace(db, u.metal, u.purity, f.locationId);
    if (have < u.need) {
      return c.json(
        {
          error: "raw_stock_short",
          message: `Only ${grams(have)} of ${purityText(u.metal, u.purity)} is in stock at ${place.name}, so ${grams(u.need)} cannot be given to the karigar`,
        },
        409,
      );
    }
  }

  // The batch: number, purchase, items (with their history), lines, bulk and raw movements, audit.
  const now = new Date().toISOString();
  const lineIds = f.lines.map(() => newId());
  const itemIds = new Map<number, string>();
  const batch: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO number_series (series, fy, last_no) VALUES ('PUR', ?1, 1) ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1`).bind(fy),
    db
      .prepare(
        `INSERT INTO purchases (id, created_at, created_by, updated_at, updated_by, purchase_no, fy, serial, purchase_type, purchase_date,
           supplier_name, supplier_bill_no, karigar_name, location_id, remarks)
         VALUES (?1, ?2, ?3, ?2, ?3,
           'PUR-' || printf('%04d', (SELECT last_no FROM number_series WHERE series = 'PUR' AND fy = ?4)), ?4,
           (SELECT last_no FROM number_series WHERE series = 'PUR' AND fy = ?4), ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(id, now, user.id, fy, f.purchaseType, f.purchaseDate, f.supplierName, f.supplierBillNo, f.karigarName, f.locationId, f.remarks),
  ];
  for (const [i, l] of f.lines.entries()) {
    if (l.kind !== "item") continue;
    const t = types.get(l.typeId)!;
    const itemId = newId();
    itemIds.set(i, itemId);
    const uNo = uNos.get(i)!;
    batch.push(
      db
        .prepare(
          `INSERT INTO inventory_items
             (id, created_at, created_by, updated_at, updated_by, u_no, item_code, serial, type_id, pieces, metal, purity,
              gross_weight_mg, net_weight_mg, hsn, labour_note, location, location_id, status)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, ?15, 'in_stock')`,
        )
        .bind(itemId, now, user.id, uNo, t.item_code, Number(uNo.slice(4)), l.typeId, l.pieces, l.metal, l.purity, l.grossWeightMg, l.netWeightMg, l.hsn, l.labourNote, f.locationId),
    );
    batch.push(
      db
        .prepare(
          `INSERT INTO inventory_item_history (id, item_id, from_status, to_status, at, actor, reason, created_at, created_by)
           VALUES (?1, ?2, NULL, 'in_stock', ?3, ?4, 'Purchased on ' || (SELECT purchase_no FROM purchases WHERE id = ?5), ?3, ?4)`,
        )
        .bind(newId(), itemId, now, user.id, id),
    );
  }
  for (const [i, l] of f.lines.entries()) {
    batch.push(
      db
        .prepare(
          `INSERT INTO purchase_lines (id, created_at, created_by, updated_at, updated_by, purchase_id, line_no, line_kind,
             inventory_item_id, bulk_item_id, quantity, metal, purity, weight_mg, amount_paise)
           VALUES (?1, ?2, ?3, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        )
        .bind(
          lineIds[i],
          now,
          user.id,
          id,
          i + 1,
          l.kind,
          itemIds.get(i) ?? null,
          l.kind === "bulk" ? l.bulkItemId : null,
          l.kind === "bulk" ? l.quantity : null,
          l.kind === "raw_metal" || l.kind === "metal_used" ? l.metal : null,
          l.kind === "raw_metal" || l.kind === "metal_used" ? l.purity : null,
          l.kind === "raw_metal" || l.kind === "metal_used" ? l.weightMg : null,
          l.amountPaise,
        ),
    );
  }
  for (const [i, l] of f.lines.entries()) {
    if (l.kind === "bulk") {
      batch.push(
        db
          .prepare(
            `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by, location_id)
             VALUES (?1, ?2, 'received', ?3, ?4, ?5, 'Purchase ' || (SELECT purchase_no FROM purchases WHERE id = ?6), ?4, ?5, ?7)`,
          )
          .bind(newId(), l.bulkItemId, l.quantity, now, user.id, id, f.locationId),
      );
    } else if (l.kind === "raw_metal" || l.kind === "metal_used") {
      const change = l.kind === "raw_metal" ? l.weightMg : -l.weightMg;
      const label = l.kind === "raw_metal" ? "'Purchase ' || " : "'Used for karigar purchase ' || ";
      batch.push(
        db
          .prepare(
            `INSERT INTO raw_metal_movements (id, created_at, created_by, metal, purity, weight_mg, location_id, purchase_id, purchase_line_id, at, actor, reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?2, ?3, ${label}(SELECT purchase_no FROM purchases WHERE id = ?8))`,
          )
          .bind(newId(), now, user.id, l.metal, l.purity, change, f.locationId, id, lineIds[i]),
      );
    }
  }
  batch.push(
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json)
         VALUES (?1, ?2, ?3, 'purchase_create', 'purchase', ?4,
           json_object('purchaseNo', (SELECT purchase_no FROM purchases WHERE id = ?4), 'purchaseType', ?5, 'lines', ?6, 'locationId', ?7))`,
      )
      .bind(newId(), now, user.id, id, f.purchaseType, f.lines.length, f.locationId),
  );

  try {
    await db.batch(batch);
  } catch (e) {
    if (isBelowZero(e)) {
      return c.json({ error: "raw_stock_short", message: "The raw stock at this place is not enough for the metal given to the karigar. Nothing was saved." }, 409);
    }
    if (isUniqueError(e)) {
      // Lost a race: the same id (a replay that was saved meanwhile), or the same U No.
      const again = await replayFor(db, id, f);
      if (again.kind === "replay") return c.json<PurchaseSaveResponse>({ purchase: await toDetail(db, again.row) });
      if (again.kind === "conflict") return c.json({ error: "id_conflict", message: "This id is already used by a different purchase" }, 409);
      if (/purchases\.(fy|purchase_no)/.test(String(e))) return c.json({ error: "stale", message: "The purchase number was taken. Save again." }, 409);
      return c.json({ error: "u_no_taken", message: "A U No. was just taken by another save. Save again to get the next number." }, 409);
    }
    throw e;
  }
  return c.json<PurchaseSaveResponse>({ purchase: await toDetail(db, (await loadPurchase(db, id))!) }, 201);
});

// ---- read ----

purchaseRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const p = await loadPurchase(db, c.req.param("id"));
  if (!p) return c.json({ error: "not_found" }, 404);
  return c.json<PurchaseSaveResponse>({ purchase: await toDetail(db, p) });
});

// ---- void (spec 022 PU16 to PU18, Q174) ----

purchaseRoutes.post("/:id/void", async (c) => {
  const parsed = inventoryVoidSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(purchaseValidation(parsed.error), 400);
  const db = c.env.DB;
  const user = c.get("user");
  const id = c.req.param("id");
  const p = await loadPurchase(db, id);
  if (!p) return c.json({ error: "not_found" }, 404);
  if (p.voided_at) return c.json({ error: "already_voided", message: "This purchase is already voided" }, 409);
  const reason = parsed.data.reason;
  const lines = (await loadLines(db, id)).results;

  // PU16: everything the purchase made or received must still be untouched.
  const blockers: string[] = [];
  for (const l of lines) {
    if (!l.inventory_item_id) continue;
    if (l.item_status !== "in_stock" || l.item_voided_at) {
      blockers.push(`${l.u_no} is ${INVENTORY_STATUS_LABEL[l.item_status ?? "in_stock"].toLowerCase()}${l.item_voided_at ? " and voided" : ""}`);
    }
  }
  const bulkTotals = new Map<string, { name: string; unit: BulkUnit; qty: number }>();
  for (const l of lines) {
    if (!l.bulk_item_id) continue;
    const cur = bulkTotals.get(l.bulk_item_id) ?? { name: l.bulk_name ?? "", unit: l.bulk_unit ?? "pcs", qty: 0 };
    cur.qty += l.quantity ?? 0;
    bulkTotals.set(l.bulk_item_id, cur);
  }
  for (const [bulkId, b] of bulkTotals) {
    const left = await bulkAtPlace(db, bulkId, p.location_id);
    if (left - b.qty < 0) {
      blockers.push(`only ${left} ${b.unit} of ${b.name} are left at ${p.location_name}, not the ${b.qty} received`);
      continue;
    }
    const moved = await db
      .prepare("SELECT COUNT(*) AS n FROM stock_transfers WHERE bulk_item_id = ?1 AND from_location_id = ?2 AND at >= ?3")
      .bind(bulkId, p.location_id, p.created_at)
      .first<{ n: number }>();
    if ((moved?.n ?? 0) > 0) blockers.push(`some of ${b.name} was moved out of ${p.location_name} after this purchase`);
  }
  const rawNet = (
    await db
      .prepare("SELECT metal, purity, location_id, SUM(weight_mg) AS s FROM raw_metal_movements WHERE purchase_id = ?1 GROUP BY metal, purity, location_id")
      .bind(id)
      .all<{ metal: string; purity: string; location_id: string; s: number }>()
  ).results;
  for (const r of rawNet) {
    if (r.s === 0) continue;
    const have = await rawAtPlace(db, r.metal, r.purity, r.location_id);
    if (have - r.s < 0) blockers.push(`some ${purityText(r.metal, r.purity)} from this purchase has been used`);
  }
  if (blockers.length) {
    return c.json({ error: "purchase_in_use", message: `This purchase cannot be voided, because ${blockers[0]}. Nothing was changed.` }, 409);
  }

  // PU17: one batch. The first statement voids the purchase; every later statement checks that it did (the
  // purchase's voided_at is this batch's time), so a refusal inside the batch writes nothing.
  const now = new Date().toISOString();
  const itemReason = `Purchase ${p.purchase_no} voided: ${reason}`;
  const batch: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE purchases SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3
         WHERE id = ?1 AND voided_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM purchase_lines pl JOIN inventory_items i ON i.id = pl.inventory_item_id
             WHERE pl.purchase_id = ?1 AND (i.status <> 'in_stock' OR i.voided_at IS NOT NULL))`,
      )
      .bind(id, now, user.id, reason),
  ];
  for (const l of lines) {
    if (!l.inventory_item_id) continue;
    batch.push(
      db
        .prepare(
          `UPDATE inventory_items SET voided_at = ?2, voided_by = ?3, void_reason = ?4, updated_at = ?2, updated_by = ?3
           WHERE id = ?1 AND status = 'in_stock' AND voided_at IS NULL AND ${purchaseVoidedNow("?5", "?2")}`,
        )
        .bind(l.inventory_item_id, now, user.id, itemReason, id),
    );
  }
  for (const l of lines) {
    if (!l.bulk_item_id) continue;
    batch.push(
      db
        .prepare(
          `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by, location_id)
           SELECT ?1, ?2, 'adjusted', ?3, ?4, ?5, 'Purchase ' || (SELECT purchase_no FROM purchases WHERE id = ?6) || ' voided', ?4, ?5, ?7
           WHERE ${purchaseVoidedNow("?6", "?4")}`,
        )
        .bind(newId(), l.bulk_item_id, -(l.quantity ?? 0), now, user.id, id, p.location_id),
    );
  }
  for (const r of rawNet) {
    if (r.s === 0) continue;
    batch.push(
      db
        .prepare(
          `INSERT INTO raw_metal_movements (id, created_at, created_by, metal, purity, weight_mg, location_id, purchase_id, purchase_line_id, at, actor, reason)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?2, ?3, 'Purchase ' || (SELECT purchase_no FROM purchases WHERE id = ?8) || ' voided'
           WHERE ${purchaseVoidedNow("?8", "?2")}`,
        )
        .bind(newId(), now, user.id, r.metal, r.purity, -r.s, r.location_id, id),
    );
  }
  batch.push(
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json)
         SELECT ?1, ?2, ?3, 'purchase_void', 'purchase', ?4, json_object('purchaseNo', (SELECT purchase_no FROM purchases WHERE id = ?4), 'reason', ?5)
         WHERE ${purchaseVoidedNow("?4", "?2")}`,
      )
      .bind(newId(), now, user.id, id, reason),
  );

  let first: D1Result;
  try {
    const results = await db.batch(batch);
    first = results[0]!;
  } catch (e) {
    if (isBelowZero(e)) return c.json({ error: "purchase_in_use", message: "This purchase cannot be voided, because some of its stock has been used. Nothing was changed." }, 409);
    throw e;
  }
  if (first.meta.changes !== 1) return c.json({ error: "stale", message: "The purchase changed while you were saving. Reload and try again." }, 409);
  return c.json<PurchaseSaveResponse>({ purchase: await toDetail(db, (await loadPurchase(db, id))!) });
});
