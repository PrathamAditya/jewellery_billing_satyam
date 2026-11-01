import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { standardColumns } from "./columns";

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

/** Login accounts (spec 002). Only the owner for now; `role` and ids allow staff later. */
export const users = sqliteTable("users", {
  ...standardColumns(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"),
  disabledAt: text("disabled_at"),
});

/** Login sessions. Only the SHA-256 of the cookie token is stored (spec 002, R4). */
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Failed logins, for rate limiting (spec 002, R12). Rows older than a day are cleaned on login. */
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    ip: text("ip").notNull(),
    username: text("username"),
  },
  (t) => [index("login_attempts_ip_at_idx").on(t.ip, t.at), index("login_attempts_at_idx").on(t.at)],
);
