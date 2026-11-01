import {
  CUSTOMER_FIELDS,
  maskAadhaar,
  nameSearchKey,
  type CustomerField,
  type CustomerHistoryEntry,
  type CustomerResponse,
} from "@jewellery/shared";

/** A row of the `customers` table. */
export type CustomerRow = {
  id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  customer_no: string;
  name: string;
  name_search: string;
  mobile: string | null;
  alt_mobile: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  pan: string | null;
  aadhaar: string | null;
  notes: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

/** Editable fields as they appear in the table. */
export const COLUMN_OF: Record<CustomerField, keyof CustomerRow> = {
  name: "name",
  mobile: "mobile",
  altMobile: "alt_mobile",
  address: "address",
  city: "city",
  pincode: "pincode",
  pan: "pan",
  aadhaar: "aadhaar",
  notes: "notes",
};

export function toResponse(r: CustomerRow): CustomerResponse {
  return {
    id: r.id,
    customerNo: r.customer_no,
    name: r.name,
    mobile: r.mobile,
    altMobile: r.alt_mobile,
    address: r.address,
    city: r.city,
    pincode: r.pincode,
    pan: r.pan,
    aadhaarMasked: r.aadhaar ? maskAadhaar(r.aadhaar) : null,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
  };
}

export async function getCustomer(db: D1Database, id: string): Promise<CustomerRow | null> {
  return db.prepare("SELECT * FROM customers WHERE id = ?1").bind(id).first<CustomerRow>();
}

/** Active (not voided) customers using this mobile as their mobile or alternate mobile (R5). */
export async function findByMobile(db: D1Database, mobile: string, exceptId?: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT id FROM customers
       WHERE voided_at IS NULL AND (mobile = ?1 OR alt_mobile = ?1) AND id != ?2
       ORDER BY customer_no`,
    )
    .bind(mobile, exceptId ?? "")
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/** The active customer who already has this PAN, if any (R6). */
export async function findByPan(db: D1Database, pan: string, exceptId?: string) {
  return db
    .prepare(
      `SELECT id, customer_no, name FROM customers
       WHERE pan = ?1 AND voided_at IS NULL AND id != ?2`,
    )
    .bind(pan, exceptId ?? "")
    .first<{ id: string; customer_no: string; name: string }>();
}

export { nameSearchKey };

/** Compares the editable fields of two states (aadhaar compared by value, reported without it). */
export function diffFields(before: CustomerRow, after: Partial<Record<keyof CustomerRow, unknown>>): CustomerField[] {
  return CUSTOMER_FIELDS.filter((f) => {
    const col = COLUMN_OF[f];
    return col in after && (before[col] ?? null) !== (after[col] ?? null);
  });
}

type Revision = { revision_no: number; snapshot_json: string; reason: string | null; created_at: string; created_by: string };

/** Spec 010 R11: each revision holds the record as it was before an edit; the change is the gap to the next state. */
export async function loadHistory(db: D1Database, current: CustomerRow): Promise<CustomerHistoryEntry[]> {
  const revs = (
    await db
      .prepare(
        `SELECT revision_no, snapshot_json, reason, created_at, created_by
         FROM record_revisions WHERE entity = 'customer' AND entity_id = ?1 ORDER BY revision_no`,
      )
      .bind(current.id)
      .all<Revision>()
  ).results;

  const show = (field: CustomerField, v: string | null) => (field === "aadhaar" && v ? maskAadhaar(v) : v);
  return revs
    .map((rev, i) => {
      const before = JSON.parse(rev.snapshot_json) as CustomerRow;
      const after = i + 1 < revs.length ? (JSON.parse(revs[i + 1]!.snapshot_json) as CustomerRow) : current;
      return {
        revisionNo: rev.revision_no,
        at: rev.created_at,
        by: rev.created_by,
        reason: rev.reason,
        changes: diffFields(before, after as unknown as Record<keyof CustomerRow, unknown>).map((field) => ({
          field,
          from: show(field, (before[COLUMN_OF[field]] as string | null) ?? null),
          to: show(field, (after[COLUMN_OF[field]] as string | null) ?? null),
        })),
      };
    })
    .reverse();
}
