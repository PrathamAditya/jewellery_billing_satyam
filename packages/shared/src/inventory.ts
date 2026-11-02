import { z } from "zod";
import { PURITIES } from "./invoice";

/** Spec 020 I12: the statuses of an inventory item. */
export const INVENTORY_STATUSES = ["in_stock", "sold", "reserved", "on_memo", "returned", "written_off"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];
export const INVENTORY_STATUS_LABEL: Record<InventoryStatus, string> = {
  in_stock: "In stock",
  sold: "Sold",
  reserved: "Reserved",
  on_memo: "On memo",
  returned: "Returned",
  written_off: "Written off",
};

/** Spec 020 I2: metal and HSN as on the invoices. */
export const INVENTORY_METALS = ["gold", "silver"] as const;
export type InventoryMetal = (typeof INVENTORY_METALS)[number];
export const INVENTORY_HSNS = ["7113", "9988"] as const;

export const ITEM_CODE_PATTERN = /^[A-Z0-9]{4}$/;
export const U_NO_PATTERN = /^[A-Z0-9]{4}(0[1-9]|[1-9][0-9])$/;
/** Spec 020 I5, I9: a serial runs from 01 to 99 for each item code. */
export const SERIAL_MAX = 99;
export const PIECES_MAX = 10;
export const LOCATION_MAX = 60;
export const LABOUR_NOTE_MAX = 200;
export const REASON_MAX = 300;

/** The U No. made from its code and serial: ("RING", 1) -> "RING01". */
export const formatUNo = (itemCode: string, serial: number) => `${itemCode}${String(serial).padStart(2, "0")}`;

/** Spec 020 I10, I11: an item type. */
export const itemTypeCreateSchema = z.object({
  name: z.string({ error: "Name is required" }).trim().min(1, "Name is required").max(60, "Name is too long (60 characters at most)"),
  itemCode: z
    .string({ error: "Item code is required" })
    .trim()
    .toUpperCase()
    .regex(ITEM_CODE_PATTERN, "The item code is 4 letters or digits, like RING"),
});
export type ItemTypeCreate = z.infer<typeof itemTypeCreateSchema>;

export const itemTypeUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(60, "Name is too long (60 characters at most)").optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.active !== undefined, "Nothing to change");
export type ItemTypeUpdate = z.infer<typeof itemTypeUpdateSchema>;

export type InventoryItemType = { id: string; name: string; itemCode: string; active: boolean };

/** Spec 020 I1 to I8, I16: create an item. Weights are whole milligrams. */
export const inventoryItemCreateSchema = z
  .object({
    id: z.string().uuid().optional(),
    typeId: z.string({ error: "Choose the item type" }).min(1, "Choose the item type"),
    uNo: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    pieces: z.number({ error: "Enter the number of pieces" }).int("Pieces must be a whole number").min(1, "At least 1 piece").max(PIECES_MAX, `At most ${PIECES_MAX} pieces (a pair is 2)`).default(1),
    metal: z.enum(INVENTORY_METALS, { error: "Choose gold or silver" }),
    purity: z.enum(PURITIES, { error: "Choose a purity" }),
    grossWeightMg: z.number({ error: "Enter the gross weight" }).int().min(1, "Gross weight must be more than 0"),
    netWeightMg: z.number({ error: "Enter the net weight" }).int().min(1, "Net weight must be more than 0"),
    hsn: z.enum(INVENTORY_HSNS, { error: "Choose 7113 or 9988" }).default("7113"),
    labourNote: z.string().trim().max(LABOUR_NOTE_MAX, "Labour note is too long (200 characters at most)").optional().nullable().transform((v) => v || null),
    location: z.string().trim().max(LOCATION_MAX, "Location is too long (60 characters at most)").optional().nullable().transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.netWeightMg > v.grossWeightMg) ctx.addIssue({ code: "custom", path: ["netWeightMg"], message: "Net weight cannot be more than gross weight" });
    if (v.uNo !== null && !U_NO_PATTERN.test(v.uNo)) {
      ctx.addIssue({ code: "custom", path: ["uNo"], message: "A U No. is 4 letters or digits and a 2-digit serial from 01 to 99, like RING01" });
    }
    if ((v.metal === "silver") !== (v.purity === "silver")) {
      ctx.addIssue({ code: "custom", path: ["purity"], message: "Silver items are silver purity, and silver purity is for silver items" });
    }
  });
export type InventoryItemCreate = z.infer<typeof inventoryItemCreateSchema>;

/** Spec 020 I13: a status change needs a reason. */
export const inventoryStatusChangeSchema = z.object({
  status: z.enum(INVENTORY_STATUSES, { error: "Choose a status" }),
  reason: z.string({ error: "Give a reason" }).trim().min(1, "Give a reason").max(REASON_MAX, "Reason is too long (300 characters at most)"),
});
export type InventoryStatusChange = z.infer<typeof inventoryStatusChangeSchema>;

/** Spec 020 I15: void an item. */
export const inventoryVoidSchema = z.object({
  reason: z.string({ error: "Give a reason" }).trim().min(1, "Give a reason").max(REASON_MAX, "Reason is too long (300 characters at most)"),
});

export type InventoryItemResponse = {
  id: string;
  uNo: string;
  itemCode: string;
  serial: number;
  typeId: string;
  typeName: string;
  pieces: number;
  metal: InventoryMetal;
  purity: string;
  grossWeightMg: number;
  netWeightMg: number;
  hsn: string;
  labourNote: string | null;
  location: string | null;
  status: InventoryStatus;
  statusLabel: string;
  createdAt: string;
  createdBy: string;
  voided: boolean;
  voidedAt: string | null;
  voidReason: string | null;
};

export type InventoryHistoryRow = {
  id: string;
  fromStatus: InventoryStatus | null;
  toStatus: InventoryStatus;
  at: string;
  actor: string;
  reason: string | null;
};

export type InventoryItemListResponse = { items: InventoryItemResponse[]; nextCursor: string | null };
export type InventoryItemSaveResponse = { item: InventoryItemResponse };
export type InventoryHistoryResponse = { items: InventoryHistoryRow[] };
export type InventoryTypesResponse = { items: InventoryItemType[] };
