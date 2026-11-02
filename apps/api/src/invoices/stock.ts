import { INVENTORY_STATUS_LABEL, newId, type BulkUnit, type InventoryStatus } from "@jewellery/shared";

/**
 * Spec 021: stock movements caused by invoices. Every function here either checks (before the batch) or
 * builds statements that go into the same D1 batch as the invoice change and its audit row.
 */

/** One line's stock link, resolved on the server. Lines with no link have itemId and bulkItemId null. */
export type StockLink = { itemId: string | null; uNo: string | null; bulkItemId: string | null; bulkQuantity: number };

/** A refusal for one line of the request (lineNo is 1-based, as the screen numbers the lines). */
export type StockProblem = { lineNo: number; error: "item_not_in_stock" | "insufficient_quantity"; message: string };

type ItemState = { u_no: string; status: InventoryStatus; voided_at: string | null; location_id: string };
type BulkState = { id: string; name: string; unit: BulkUnit; quantity: number };

/** Spec 021 S2, S3: find the items and bulk items the lines name. Returns the field problems for the 400 response. */
export async function resolveStockLinks(
  db: D1Database,
  lines: { stockUNo?: string | null; bulkItemId?: string | null; bulkQuantity?: number | null }[],
): Promise<{ ok: true; links: StockLink[] } | { ok: false; issues: { field: string; message: string }[] }> {
  const issues: { field: string; message: string }[] = [];
  const links: StockLink[] = [];
  const seenItems = new Map<string, number>();
  for (const [i, l] of lines.entries()) {
    const at = `lines.${i + 1}`;
    let itemId: string | null = null;
    let uNo: string | null = null;
    let bulkItemId: string | null = null;
    let bulkQuantity = 0;
    if (l.stockUNo) {
      const row = await db.prepare("SELECT id, u_no FROM inventory_items WHERE u_no = ?1 AND voided_at IS NULL").bind(l.stockUNo).first<{ id: string; u_no: string }>();
      if (!row) {
        issues.push({ field: `${at}.stockUNo`, message: `No live item has the U No. ${l.stockUNo}` });
      } else if (seenItems.has(row.id)) {
        issues.push({ field: `${at}.stockUNo`, message: `${row.u_no} is already on line ${seenItems.get(row.id)}. An item goes on one line only.` });
      } else {
        seenItems.set(row.id, i + 1);
        itemId = row.id;
        uNo = row.u_no;
      }
    }
    if (l.bulkItemId) {
      const row = await db.prepare("SELECT id FROM bulk_items WHERE id = ?1").bind(l.bulkItemId).first<{ id: string }>();
      if (!row) issues.push({ field: `${at}.bulkItemId`, message: "Choose the bulk item from the list" });
      else {
        bulkItemId = row.id;
        bulkQuantity = l.bulkQuantity ?? 0;
      }
    }
    links.push({ itemId, uNo, bulkItemId, bulkQuantity });
  }
  return issues.length ? { ok: false, issues } : { ok: true, links };
}

/** Spec 021 S10 to S11: the item is still sold on this invoice (its last history row says so). */
export async function soldOnInvoice(db: D1Database, itemId: string, invoiceNo: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT i.status, i.voided_at,
              (SELECT h.reason FROM inventory_item_history h WHERE h.item_id = i.id ORDER BY h.at DESC, h.rowid DESC LIMIT 1) AS last_reason
         FROM inventory_items i WHERE i.id = ?1`,
    )
    .bind(itemId)
    .first<{ status: InventoryStatus; voided_at: string | null; last_reason: string | null }>();
  return !!row && row.status === "sold" && row.voided_at === null && row.last_reason === `Sold on invoice ${invoiceNo}`;
}

/** The items of `ids` that are still sold on this invoice, so a void or a removal may give them back. */
export async function releasableItems(db: D1Database, ids: string[], invoiceNo: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of ids) if (await soldOnInvoice(db, id, invoiceNo)) out.add(id);
  return out;
}

/**
 * Spec 021 S5, S7, S8: is the new content possible? `previous` is the current revision's links (empty for a
 * new invoice). An item on both is kept and must still be sold on this invoice. Returns the first problem.
 */
export async function stockProblem(db: D1Database, links: StockLink[], previous: StockLink[], invoiceNo: string | null): Promise<StockProblem | null> {
  const before = new Set(previous.map((p) => p.itemId).filter((x): x is string => x !== null));
  for (const [i, l] of links.entries()) {
    if (!l.itemId) continue;
    const item = await db.prepare("SELECT u_no, status, voided_at, location_id FROM inventory_items WHERE id = ?1").bind(l.itemId).first<ItemState>();
    if (!item) return { lineNo: i + 1, error: "item_not_in_stock", message: "That item no longer exists" };
    if (before.has(l.itemId)) {
      if (!invoiceNo || !(await soldOnInvoice(db, l.itemId, invoiceNo))) {
        return {
          lineNo: i + 1,
          error: "item_not_in_stock",
          message: `${item.u_no} is ${INVENTORY_STATUS_LABEL[item.status].toLowerCase()} now, not sold on this invoice. Take it off the invoice or change its status first.`,
        };
      }
      continue;
    }
    if (item.voided_at) return { lineNo: i + 1, error: "item_not_in_stock", message: `${item.u_no} is voided, so it cannot go on this invoice` };
    if (item.status !== "in_stock") {
      return { lineNo: i + 1, error: "item_not_in_stock", message: `${item.u_no} is ${INVENTORY_STATUS_LABEL[item.status].toLowerCase()}, so it cannot go on this invoice` };
    }
    // Spec 025 R12: an item not found at a count is held at the hidden Missing place until it is found.
    if (item.location_id === "loc-missing") {
      return { lineNo: i + 1, error: "item_not_in_stock", message: `${item.u_no} was not found at the last stock count, so it cannot go on this invoice` };
    }
  }

  // Bulk: the change in each bulk item's total on this invoice must be in stock.
  const sum = (ls: StockLink[]) => {
    const m = new Map<string, number>();
    for (const l of ls) if (l.bulkItemId) m.set(l.bulkItemId, (m.get(l.bulkItemId) ?? 0) + l.bulkQuantity);
    return m;
  };
  const had = sum(previous);
  const want = sum(links);
  for (const [bulkId, total] of want) {
    const delta = total - (had.get(bulkId) ?? 0);
    if (delta <= 0) continue;
    const b = await db
      .prepare("SELECT b.id, b.name, b.unit, q.quantity FROM bulk_items b JOIN bulk_item_quantities q ON q.bulk_item_id = b.id WHERE b.id = ?1")
      .bind(bulkId)
      .first<BulkState>();
    if (b && b.quantity < delta) {
      const lineNo = links.findIndex((l) => l.bulkItemId === bulkId) + 1;
      return {
        lineNo,
        error: "insufficient_quantity",
        message: `Only ${b.quantity} ${b.unit} of ${b.name} are in stock, so ${delta} more cannot be taken out`,
      };
    }
  }
  return null;
}

/**
 * Spec 021 S6, S7 for a new invoice. Put these after the invoice and its lines in the batch: the line triggers
 * then see the items as in stock, and the items move to sold after them.
 */
export function createStockStatements(db: D1Database, invoiceId: string, links: StockLink[], actor: string, now: string): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (const l of links) {
    if (l.itemId) {
      out.push(
        db
          .prepare("UPDATE inventory_items SET status = 'sold', updated_at = ?2, updated_by = ?3 WHERE id = ?1 AND status = 'in_stock' AND voided_at IS NULL")
          .bind(l.itemId, now, actor),
      );
      out.push(
        db
          .prepare(
            `INSERT INTO inventory_item_history (id, item_id, from_status, to_status, at, actor, reason, created_at, created_by)
             SELECT ?1, ?2, 'in_stock', 'sold', ?3, ?4, 'Sold on invoice ' || (SELECT invoice_no FROM invoices WHERE id = ?5), ?3, ?4
             WHERE (SELECT status FROM inventory_items WHERE id = ?2) = 'sold'`,
          )
          .bind(newId(), l.itemId, now, actor, invoiceId),
      );
    }
    if (l.bulkItemId) {
      out.push(
        db
          .prepare(
            `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by)
             VALUES (?1, ?2, 'sold', ?3, ?4, ?5, 'Invoice ' || (SELECT invoice_no FROM invoices WHERE id = ?6), ?4, ?5)`,
          )
          .bind(newId(), l.bulkItemId, -l.bulkQuantity, now, actor, invoiceId),
      );
    }
  }
  return out;
}

/**
 * Spec 021 S8, S9, Q164: an edit writes only the difference. `releasable` holds the removed items that are still
 * sold on this invoice; the others are left alone.
 */
export function editStockStatements(
  db: D1Database,
  p: { invoiceNo: string; revisionNo: number; previous: StockLink[]; links: StockLink[]; releasable: Set<string>; actor: string; now: string },
): { statements: D1PreparedStatement[]; taken: string[]; released: string[]; bulk: { bulkItemId: string; change: number }[] } {
  const out: D1PreparedStatement[] = [];
  const before = new Map(p.previous.filter((l) => l.itemId).map((l) => [l.itemId!, l.uNo ?? ""] as const));
  const after = new Map(p.links.filter((l) => l.itemId).map((l) => [l.itemId!, l.uNo ?? ""] as const));
  const taken: string[] = [];
  const released: string[] = [];
  for (const [id, uNo] of before) {
    if (after.has(id) || !p.releasable.has(id)) continue;
    released.push(uNo);
    const reason = `Invoice ${p.invoiceNo} changed to revision ${p.revisionNo}: item taken off`;
    out.push(
      db
        .prepare("UPDATE inventory_items SET status = 'in_stock', updated_at = ?2, updated_by = ?3 WHERE id = ?1 AND status = 'sold' AND voided_at IS NULL")
        .bind(id, p.now, p.actor),
    );
    out.push(
      db
        .prepare(
          `INSERT INTO inventory_item_history (id, item_id, from_status, to_status, at, actor, reason, created_at, created_by)
           SELECT ?1, ?2, 'sold', 'in_stock', ?3, ?4, ?5, ?3, ?4 WHERE (SELECT status FROM inventory_items WHERE id = ?2) = 'in_stock'`,
        )
        .bind(newId(), id, p.now, p.actor, reason),
    );
  }
  for (const [id, uNo] of after) {
    if (before.has(id)) continue;
    taken.push(uNo);
    out.push(
      db
        .prepare("UPDATE inventory_items SET status = 'sold', updated_at = ?2, updated_by = ?3 WHERE id = ?1 AND status = 'in_stock' AND voided_at IS NULL")
        .bind(id, p.now, p.actor),
    );
    out.push(
      db
        .prepare(
          `INSERT INTO inventory_item_history (id, item_id, from_status, to_status, at, actor, reason, created_at, created_by)
           SELECT ?1, ?2, 'in_stock', 'sold', ?3, ?4, ?5, ?3, ?4 WHERE (SELECT status FROM inventory_items WHERE id = ?2) = 'sold'`,
        )
        .bind(newId(), id, p.now, p.actor, `Sold on invoice ${p.invoiceNo}`),
    );
  }

  const sum = (ls: StockLink[]) => {
    const m = new Map<string, number>();
    for (const l of ls) if (l.bulkItemId) m.set(l.bulkItemId, (m.get(l.bulkItemId) ?? 0) + l.bulkQuantity);
    return m;
  };
  const had = sum(p.previous);
  const want = sum(p.links);
  const bulk: { bulkItemId: string; change: number }[] = [];
  for (const id of new Set([...had.keys(), ...want.keys()])) {
    const delta = (want.get(id) ?? 0) - (had.get(id) ?? 0);
    if (delta === 0) continue;
    bulk.push({ bulkItemId: id, change: -delta });
    out.push(
      db
        .prepare(
          `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by)
           VALUES (?1, ?2, 'adjusted', ?3, ?4, ?5, ?6, ?4, ?5)`,
        )
        .bind(newId(), id, -delta, p.now, p.actor, `Invoice ${p.invoiceNo} changed to revision ${p.revisionNo}`),
    );
  }
  return { statements: out, taken, released, bulk };
}

/** Spec 021 S11: a void gives back the items still sold on this invoice and every bulk quantity on its current revision. */
export function voidStockStatements(
  db: D1Database,
  p: { invoiceNo: string; links: StockLink[]; releasable: Set<string>; actor: string; now: string },
): { statements: D1PreparedStatement[]; released: string[]; bulk: { bulkItemId: string; quantity: number }[] } {
  const out: D1PreparedStatement[] = [];
  const released: string[] = [];
  const reason = `Invoice ${p.invoiceNo} voided`;
  for (const l of p.links) {
    if (!l.itemId || !p.releasable.has(l.itemId)) continue;
    released.push(l.uNo ?? l.itemId);
    out.push(
      db
        .prepare("UPDATE inventory_items SET status = 'in_stock', updated_at = ?2, updated_by = ?3 WHERE id = ?1 AND status = 'sold' AND voided_at IS NULL")
        .bind(l.itemId, p.now, p.actor),
    );
    out.push(
      db
        .prepare(
          `INSERT INTO inventory_item_history (id, item_id, from_status, to_status, at, actor, reason, created_at, created_by)
           SELECT ?1, ?2, 'sold', 'in_stock', ?3, ?4, ?5, ?3, ?4 WHERE (SELECT status FROM inventory_items WHERE id = ?2) = 'in_stock'`,
        )
        .bind(newId(), l.itemId, p.now, p.actor, reason),
    );
  }
  const bulk: { bulkItemId: string; quantity: number }[] = [];
  for (const l of p.links) {
    if (!l.bulkItemId || l.bulkQuantity <= 0) continue;
    bulk.push({ bulkItemId: l.bulkItemId, quantity: l.bulkQuantity });
    out.push(
      db
        .prepare(
          `INSERT INTO bulk_item_movements (id, bulk_item_id, kind, quantity_change, at, actor, reason, created_at, created_by)
           VALUES (?1, ?2, 'adjusted', ?3, ?4, ?5, ?6, ?4, ?5)`,
        )
        .bind(newId(), l.bulkItemId, l.bulkQuantity, p.now, p.actor, reason),
    );
  }
  return { statements: out, released, bulk };
}

/** Maps a database refusal from the stock triggers (spec 021 S13, 020b B5) to the response the screen shows. */
export function stockTriggerRefusal(e: unknown): { status: 400 | 409; body: { error: string; message: string } } | null {
  const text = e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : "";
  if (/item_not_in_stock/.test(text)) {
    return { status: 409, body: { error: "item_not_in_stock", message: "An item on this invoice is no longer in stock. Reload the invoice and check its stock lines." } };
  }
  if (/quantity_below_zero/.test(text)) {
    return { status: 409, body: { error: "insufficient_quantity", message: "Not enough of a bulk item is in stock any more. Reload the invoice and check the quantities." } };
  }
  if (/invalid_stock_link/.test(text)) return { status: 400, body: { error: "invalid_stock_link", message: "A line links one stock item, or one bulk item with a quantity." } };
  return null;
}
