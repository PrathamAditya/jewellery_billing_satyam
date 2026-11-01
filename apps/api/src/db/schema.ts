import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { standardColumns, voidColumns } from "./columns";

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

/** Customers (spec 010). Voided, never deleted. `aadhaar` is shown masked everywhere (R14). */
export const customers = sqliteTable(
  "customers",
  {
    ...standardColumns(),
    customerNo: text("customer_no").notNull().unique(),
    name: text("name").notNull(),
    nameSearch: text("name_search").notNull(),
    mobile: text("mobile"),
    altMobile: text("alt_mobile"),
    address: text("address"),
    city: text("city"),
    pincode: text("pincode"),
    pan: text("pan"),
    aadhaar: text("aadhaar"),
    notes: text("notes"),
    ...voidColumns(),
  },
  (t) => [
    index("customers_name_search_idx").on(t.nameSearch),
    index("customers_mobile_idx").on(t.mobile),
    index("customers_pan_idx").on(t.pan),
    // R6: a PAN is unique among customers that are not voided.
    uniqueIndex("customers_pan_active_unique").on(t.pan).where(sql`${t.pan} IS NOT NULL AND ${t.voidedAt} IS NULL`),
  ],
);

/** Daily gold and silver rates (spec 011). One row per kind per business date; edits keep revisions. */
export const rates = sqliteTable(
  "rates",
  {
    ...standardColumns(),
    rateDate: text("rate_date").notNull(),
    kind: text("kind").notNull(),
    pricePaisePerKg: integer("price_paise_per_kg").notNull(),
  },
  (t) => [
    uniqueIndex("rates_date_kind_unique").on(t.rateDate, t.kind),
    index("rates_kind_date_idx").on(t.kind, t.rateDate),
    check("rates_price_positive", sql`${t.pricePaisePerKg} > 0`),
    check("rates_kind_valid", sql`${t.kind} IN ('gold_24k995', 'gold_22k916', 'silver')`),
  ],
);
