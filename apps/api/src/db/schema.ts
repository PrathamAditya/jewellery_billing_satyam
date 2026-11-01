import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export { standardColumns, voidColumns } from "./columns";

/** Last number used per series and financial year (spec 001, R12). */
export const numberSeries = sqliteTable(
  "number_series",
  {
    series: text("series").notNull(),
    fy: text("fy").notNull(),
    lastNo: integer("last_no").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.series, t.fy] }),
    check("number_series_last_no_nonneg", sql`${t.lastNo} >= 0`),
  ],
);

/** Immutable snapshots of earlier versions of a record (spec 001, R10). */
export const recordRevisions = sqliteTable(
  "record_revisions",
  {
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    revisionNo: integer("revision_no").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [primaryKey({ columns: [t.entity, t.entityId, t.revisionNo] })],
);

/** Append-only log of every change (spec 001, R11). */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    detailJson: text("detail_json"),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId, t.at)],
);
