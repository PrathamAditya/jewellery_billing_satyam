import { z } from "zod";
import type { BulkUnit } from "./bulkItems";
import type { InventoryStatus } from "./inventory";

/** Spec 025: monthly stock reconciliation. A count at one place (or all places) compared with the system. */
export const RECONCILIATION_STATUSES = ["open", "closed"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];
export const RECONCILIATION_STATUS_LABEL: Record<ReconciliationStatus, string> = { open: "Open", closed: "Closed" };

/** Spec 025 R5, R7: the outcome typed for an individual item line. */
export const COUNT_OUTCOMES = ["found", "not_found"] as const;
export type CountOutcome = (typeof COUNT_OUTCOMES)[number];

/** Spec 025 section 3: at most this many lines in one save of counts. */
export const COUNT_SAVE_MAX_LINES = 100;
export const RECONCILIATION_NOTE_MAX = 300;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Spec 025 R1, R2: open a reconciliation. `locationId` null (or missing) means all active places. */
export const reconciliationOpenSchema = z.object({
  id: z.string().uuid().optional(),
  month: z.string({ error: "Choose the month" }).regex(MONTH, "Choose the month"),
  locationId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
});
export type ReconciliationOpen = z.infer<typeof reconciliationOpenSchema>;

/** Spec 025 R6: add an item found but not on the count. */
export const reconciliationLineAddSchema = z.object({
  id: z.string().uuid().optional(),
  inventoryItemId: z.string({ error: "Choose the item" }).min(1, "Choose the item"),
});
export type ReconciliationLineAdd = z.infer<typeof reconciliationLineAddSchema>;

/**
 * Spec 025 R7, R8: counts for several lines. An item line takes `found` or `not_found`; a bulk line takes a whole
 * number of 0 or more. `null` clears a count. The route checks which kind each line is.
 */
export const reconciliationCountsSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.string().min(1, "Line id is missing"),
        counted: z.union([z.enum(COUNT_OUTCOMES), z.number().int("Count must be a whole number").min(0, "Count cannot be negative").max(10_000_000, "Count is too large"), z.null()]),
        note: z
          .string()
          .trim()
          .max(RECONCILIATION_NOTE_MAX, "Note is too long (300 characters at most)")
          .nullable()
          .optional()
          .transform((v) => v || null),
      }),
    )
    .min(1, "Nothing to save")
    .max(COUNT_SAVE_MAX_LINES, "Save at most 100 lines at a time"),
});
export type ReconciliationCounts = z.infer<typeof reconciliationCountsSchema>;

export type Reconciliation = {
  id: string;
  month: string;
  locationId: string | null;
  locationName: string;
  status: ReconciliationStatus;
  openedAt: string;
  openedBy: string;
  closedAt: string | null;
  closedBy: string | null;
  lineCount: number;
  countedCount: number;
};

export type ReconciliationLine = {
  id: string;
  lineKind: "item" | "bulk";
  inventoryItemId: string | null;
  uNo: string | null;
  typeName: string | null;
  bulkItemId: string | null;
  bulkName: string | null;
  unit: BulkUnit | null;
  locationId: string;
  locationName: string;
  /** The figure taken when the reconciliation was opened (for an extra line: when it was added). */
  systemAtOpening: number;
  systemStatus: InventoryStatus | null;
  addedLater: boolean;
  /** Movements since the opening, shown so a sale during the count is visible. */
  movedSinceOpening: number;
  /** The system figure the difference is taken against (live while open, stored when closed). */
  expected: number;
  countedStatus: CountOutcome | null;
  counted: number | null;
  difference: number | null;
  note: string | null;
  adjustmentNote: string | null;
};

export type ReconciliationListResponse = { items: Reconciliation[] };
export type ReconciliationDetailResponse = { reconciliation: Reconciliation; lines: ReconciliationLine[] };
export type ReconciliationReportResponse = {
  reconciliation: Reconciliation;
  summary: { lines: number; counted: number; notCounted: number; adjustments: number; missing: number; extra: number; bulkUp: number; bulkDown: number };
  differences: ReconciliationLine[];
};
export type ReconciliationCloseResponse = { reconciliation: Reconciliation; adjustments: number };
