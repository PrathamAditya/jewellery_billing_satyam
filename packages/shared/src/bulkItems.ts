import { z } from "zod";
import { DEFAULT_LOCATION_ID, REASON_MAX } from "./inventory";

/** Spec 020b B1, Q157: units for bulk items. */
export const BULK_UNITS = ["pcs", "pairs", "sets", "packets"] as const;
export type BulkUnit = (typeof BULK_UNITS)[number];
export const BULK_UNIT_LABEL: Record<BulkUnit, string> = { pcs: "pcs", pairs: "pairs", sets: "sets", packets: "packets" };

/** Spec 020b B4: the three movement kinds. */
export const BULK_MOVEMENT_KINDS = ["received", "sold", "adjusted"] as const;
export type BulkMovementKind = (typeof BULK_MOVEMENT_KINDS)[number];
export const BULK_MOVEMENT_LABEL: Record<BulkMovementKind, string> = { received: "Received", sold: "Sold", adjusted: "Adjusted" };

/** Spec 020b B3, B9: create a bulk item. The opening quantity becomes a received movement. */
export const bulkItemCreateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(60, "Name is too long (60 characters at most)"),
  unit: z.enum(BULK_UNITS, { error: "Choose the unit" }),
  openingQuantity: z
    .number({ error: "Enter the opening quantity" })
    .int("Quantity must be a whole number")
    .min(0, "Opening quantity cannot be negative")
    .max(10_000_000, "Opening quantity is too large")
    .default(0),
  /** Spec 021b B1: the place the opening quantity goes to. Missing means Showroom. */
  locationId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || DEFAULT_LOCATION_ID),
});
export type BulkItemCreate = z.infer<typeof bulkItemCreateSchema>;

/** Spec 020b B4: a movement as typed. `sold` is typed as a positive number; `adjusted` takes a signed number. */
export const bulkMovementSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.enum(BULK_MOVEMENT_KINDS, { error: "Choose the kind of movement" }),
    quantity: z.number({ error: "Enter the quantity" }).int("Quantity must be a whole number").max(10_000_000, "Quantity is too large").min(-10_000_000),
    reason: z
      .string()
      .trim()
      .max(REASON_MAX, "Reason is too long (300 characters at most)")
      .optional()
      .nullable()
      .transform((v) => v || null),
    /** Spec 021b B1: the place of the movement. Missing means Showroom. */
    locationId: z
      .string()
      .optional()
      .nullable()
      .transform((v) => v || DEFAULT_LOCATION_ID),
  })
  .superRefine((v, ctx) => {
    if (v.quantity === 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity cannot be 0" });
    if ((v.kind === "received" || v.kind === "sold") && v.quantity < 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Type the quantity as a positive number" });
    }
    if (v.kind === "adjusted" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason for an adjustment" });
  });
export type BulkMovementInput = z.infer<typeof bulkMovementSchema>;

/** The signed change a movement makes to the quantity. */
export function movementChange(kind: BulkMovementKind, quantity: number): number {
  return kind === "sold" ? -Math.abs(quantity) : kind === "received" ? Math.abs(quantity) : quantity;
}

export type BulkItemResponse = { id: string; name: string; unit: BulkUnit; quantity: number; createdAt: string };
export type BulkMovementResponse = { id: string; kind: BulkMovementKind; quantityChange: number; at: string; actor: string; reason: string | null; locationId: string };
/** Spec 021b B2: the balance at one active place. */
export type BulkLocationBalance = { locationId: string; locationName: string; quantity: number };
export type BulkHistoryRow = BulkMovementResponse & { balanceAfter: number };
export type BulkItemListResponse = { items: BulkItemResponse[] };
export type BulkItemSaveResponse = { item: BulkItemResponse };
export type BulkItemDetailResponse = { item: BulkItemResponse; byLocation: BulkLocationBalance[] };
export type BulkMovementSaveResponse = { movement: BulkMovementResponse; quantity: number };
export type BulkHistoryResponse = { items: BulkHistoryRow[] };
