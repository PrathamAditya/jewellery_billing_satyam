import { text } from "drizzle-orm/sqlite-core";

/** Columns every business table has (spec 001, R8). */
export const standardColumns = () => ({
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

/** Columns for voidable business tables (spec 001, R9). Rows are voided, never deleted. */
export const voidColumns = () => ({
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason"),
});
