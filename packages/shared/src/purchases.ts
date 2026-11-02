import { z } from "zod";
import { PURITIES } from "./invoice";
import { MAX_AMOUNT_PAISE } from "./pricing";
import type { BulkUnit } from "./bulkItems";
import { DEFAULT_LOCATION_ID, INVENTORY_HSNS, INVENTORY_METALS, LABOUR_NOTE_MAX, PIECES_MAX, REASON_MAX, U_NO_PATTERN, type InventoryStatus } from "./inventory";

/** Spec 022 PU1: the three purchase types. */
export const PURCHASE_TYPES = ["finished", "raw_metal", "karigar_made"] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];
export const PURCHASE_TYPE_LABEL: Record<PurchaseType, string> = {
  finished: "Finished jewellery",
  raw_metal: "Raw gold or silver",
  karigar_made: "Made by a karigar",
};

/** Spec 022 PU5 to PU8: the kinds of line. `metal_used` is the shop metal a karigar was given (karigar purchases only). */
export const PURCHASE_LINE_KINDS = ["item", "bulk", "raw_metal", "metal_used"] as const;
export type PurchaseLineKind = (typeof PURCHASE_LINE_KINDS)[number];
/** The line kinds each purchase type accepts (PU1, PU22). */
export const LINE_KINDS_BY_TYPE: Record<PurchaseType, readonly PurchaseLineKind[]> = {
  finished: ["item", "bulk"],
  raw_metal: ["raw_metal"],
  karigar_made: ["item", "metal_used"],
};

export const PURCHASE_NAME_MAX = 100;
export const SUPPLIER_BILL_MAX = 60;

const amountPaise = z
  .number({ error: "Enter the amount in rupees" })
  .int("Amount must be whole paise")
  .min(0, "Amount cannot be negative")
  .max(MAX_AMOUNT_PAISE, "Amount is too large")
  .optional()
  .nullable()
  .transform((v) => v ?? null);

const weightMg = z.number({ error: "Enter the weight" }).int("Weight must be whole milligrams").min(1, "Weight must be more than 0").max(100_000_000, "Weight is too large");
const metalField = z.enum(INVENTORY_METALS, { error: "Choose gold or silver" });
const purityField = z.enum(PURITIES, { error: "Choose a purity" });
const purityMatchesMetal = (v: { metal: string; purity: string }, ctx: z.RefinementCtx) => {
  if ((v.metal === "silver") !== (v.purity === "silver")) {
    ctx.addIssue({ code: "custom", path: ["purity"], message: "Silver is silver purity, and silver purity is for silver" });
  }
};

/** Spec 022 PU5: an item line, with the fields of the spec 020 creation form. */
const itemLine = z
  .object({
    kind: z.literal("item"),
    typeId: z.string({ error: "Choose the item type" }).min(1, "Choose the item type"),
    uNo: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .nullable()
      .transform((v) => v || null),
    pieces: z.number({ error: "Enter the number of pieces" }).int("Pieces must be a whole number").min(1, "At least 1 piece").max(PIECES_MAX, `At most ${PIECES_MAX} pieces (a pair is 2)`).default(1),
    metal: metalField,
    purity: purityField,
    grossWeightMg: weightMg,
    netWeightMg: weightMg,
    hsn: z.enum(INVENTORY_HSNS, { error: "Choose 7113 or 9988" }).default("7113"),
    labourNote: z
      .string()
      .trim()
      .max(LABOUR_NOTE_MAX, "Labour note is too long (200 characters at most)")
      .optional()
      .nullable()
      .transform((v) => v || null),
    amountPaise,
  })
  .superRefine((v, ctx) => {
    if (v.netWeightMg > v.grossWeightMg) ctx.addIssue({ code: "custom", path: ["netWeightMg"], message: "Net weight cannot be more than gross weight" });
    if (v.uNo !== null && !U_NO_PATTERN.test(v.uNo)) {
      ctx.addIssue({ code: "custom", path: ["uNo"], message: "A U No. is 4 letters or digits and a 2-digit serial from 01 to 99, like RING01" });
    }
    purityMatchesMetal(v, ctx);
  });

/** Spec 022 PU6: a bulk line. */
const bulkLine = z.object({
  kind: z.literal("bulk"),
  bulkItemId: z.string({ error: "Choose the bulk item" }).min(1, "Choose the bulk item"),
  quantity: z.number({ error: "Enter the quantity" }).int("Quantity must be a whole number").min(1, "Quantity must be at least 1").max(10_000_000, "Quantity is too large"),
  amountPaise,
});

/** Spec 022 PU7, PU8: a raw metal line, or the metal a karigar was given (`metal_used`). */
const rawLineShape = { metal: metalField, purity: purityField, weightMg, amountPaise };
const rawLine = z.object({ kind: z.literal("raw_metal"), ...rawLineShape }).superRefine(purityMatchesMetal);
const metalUsedLine = z.object({ kind: z.literal("metal_used"), ...rawLineShape }).superRefine(purityMatchesMetal);

export const purchaseLineSchema = z.discriminatedUnion("kind", [itemLine, bulkLine, rawLine, metalUsedLine]);
export type PurchaseLineInput = z.infer<typeof purchaseLineSchema>;

/** Spec 022 PU2 to PU4, PU15: create a purchase with its lines. */
export const purchaseCreateSchema = z
  .object({
    id: z.string().uuid().optional(),
    purchaseType: z.enum(PURCHASE_TYPES, { error: "Choose the type of purchase" }),
    purchaseDate: z
      .string({ error: "Enter the purchase date" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date as 2026-11-02"),
    supplierName: z.string({ error: "Enter the supplier's name" }).trim().min(1, "Enter the supplier's name").max(PURCHASE_NAME_MAX, "Name is too long (100 characters at most)"),
    supplierBillNo: z
      .string()
      .trim()
      .max(SUPPLIER_BILL_MAX, "Bill number is too long (60 characters at most)")
      .optional()
      .nullable()
      .transform((v) => v || null),
    karigarName: z
      .string()
      .trim()
      .max(PURCHASE_NAME_MAX, "Name is too long (100 characters at most)")
      .optional()
      .nullable()
      .transform((v) => v || null),
    locationId: z
      .string()
      .optional()
      .nullable()
      .transform((v) => v || DEFAULT_LOCATION_ID),
    remarks: z
      .string()
      .trim()
      .max(REASON_MAX, "Remarks are too long (300 characters at most)")
      .optional()
      .nullable()
      .transform((v) => v || null),
    lines: z.array(purchaseLineSchema, { error: "Add at least one line" }).min(1, "Add at least one line"),
  })
  .superRefine((v, ctx) => {
    if (v.purchaseType === "karigar_made" && !v.karigarName) {
      ctx.addIssue({ code: "custom", path: ["karigarName"], message: "Enter the karigar's name" });
    }
    if (v.purchaseType !== "karigar_made" && v.karigarName) {
      ctx.addIssue({ code: "custom", path: ["karigarName"], message: "A karigar name is only for jewellery made by a karigar" });
    }
    v.lines.forEach((l, i) => {
      if (!LINE_KINDS_BY_TYPE[v.purchaseType].includes(l.kind)) {
        ctx.addIssue({ code: "custom", path: ["lines", i, "kind"], message: "This kind of line does not belong to this type of purchase" });
      }
    });
  });
export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;

// ---- responses ----

export type PurchaseListItem = {
  id: string;
  purchaseNo: string;
  purchaseDate: string;
  purchaseType: PurchaseType;
  purchaseTypeLabel: string;
  supplierName: string;
  supplierBillNo: string | null;
  karigarName: string | null;
  locationId: string;
  locationName: string;
  lineCount: number;
  voided: boolean;
  voidedAt: string | null;
};
export type PurchaseListResponse = { items: PurchaseListItem[]; nextCursor: string | null };

export type PurchaseLineView = {
  lineNo: number;
  kind: PurchaseLineKind;
  amountPaise: number | null;
  /** Item lines: the item that was created. */
  item: { id: string; uNo: string; typeName: string; status: InventoryStatus; statusLabel: string; voided: boolean } | null;
  /** Bulk lines: the bulk item, the quantity this line received, and the balance at the purchase place now. */
  bulk: { id: string; name: string; unit: BulkUnit; quantity: number; balanceAtPlace: number } | null;
  /** Raw and metal-used lines. */
  metal: "gold" | "silver" | null;
  purity: string | null;
  weightMg: number | null;
};

export type PurchaseDetail = {
  id: string;
  purchaseNo: string;
  fy: string;
  purchaseDate: string;
  purchaseType: PurchaseType;
  purchaseTypeLabel: string;
  supplierName: string;
  supplierBillNo: string | null;
  karigarName: string | null;
  locationId: string;
  locationName: string;
  remarks: string | null;
  createdAt: string;
  createdBy: string;
  voided: boolean;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  lines: PurchaseLineView[];
};
export type PurchaseSaveResponse = { purchase: PurchaseDetail };

export type RawStockRow = { metal: "gold" | "silver"; purity: string; locationId: string; locationName: string; weightMg: number };
export type RawStockResponse = { items: RawStockRow[] };
