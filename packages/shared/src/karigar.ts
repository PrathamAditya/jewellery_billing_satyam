import { z } from "zod";
import { MAX_AMOUNT_PAISE } from "./pricing";
import { DEFAULT_LOCATION_ID, INVENTORY_METALS, REASON_MAX, type InventoryMetal } from "./inventory";

/** Spec 023: karigar job work. Weights are whole milligrams, money is whole paise. */

export const KARIGAR_GOLD_PURITIES = ["22K916", "24K995", "18K750", "14K", "24K999"] as const;
export const KARIGAR_PAYMENT_MODES = ["cash", "upi", "bank_transfer", "cheque"] as const;
export type KarigarPaymentMode = (typeof KARIGAR_PAYMENT_MODES)[number];
export const KARIGAR_PAYMENT_MODE_LABEL: Record<KarigarPaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
};
export const LABOUR_BASES = ["gram", "piece"] as const;
export type KarigarLabourBasis = (typeof LABOUR_BASES)[number];
export const KARIGAR_RETURN_PARTS = ["finished", "remainder"] as const;
export type KarigarReturnPart = (typeof KARIGAR_RETURN_PARTS)[number];
export const KARIGAR_ENTRY_KINDS = ["issue", "return", "wastage", "labour", "payout", "adjust"] as const;
export type KarigarEntryKind = (typeof KARIGAR_ENTRY_KINDS)[number];
export const KARIGAR_ENTRY_KIND_LABEL: Record<KarigarEntryKind, string> = {
  issue: "Metal issued",
  return: "Returned",
  wastage: "Wastage",
  labour: "Labour",
  payout: "Paid to karigar",
  adjust: "Correction",
};
export const KARIGAR_NAME_MAX = 100;
export const KARIGAR_PHONE_MAX = 15;
export const KARIGAR_REFERENCE_MAX = 60;
/** Spec 023 K3: the wastage allowance, in basis points (200 = 2.00%). */
export const KARIGAR_WASTAGE_BPS_MAX = 1000;
export const KARIGAR_WASTAGE_BPS_DEFAULT = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = (what: string) => z.string({ error: `Enter the ${what}` }).regex(DATE, "Use the date as 2026-11-02");
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable()
    .transform((v) => v || null);
const weightMg = (what: string) =>
  z.number({ error: `Enter the ${what} in grams` }).int("Weight must be whole milligrams").min(1, `The ${what} must be more than 0`).max(100_000_000, "Weight is too large");
const optionalId = z.string().uuid().optional();

export const karigarCreateSchema = z.object({
  id: optionalId,
  name: z.string({ error: "Enter the karigar's name" }).trim().min(1, "Enter the karigar's name").max(KARIGAR_NAME_MAX, "Name is too long (100 characters at most)"),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9 +-]*$/, "Use digits only for the phone")
    .max(KARIGAR_PHONE_MAX, "Phone is too long")
    .optional()
    .nullable()
    .transform((v) => v || null),
  remarks: optionalText(REASON_MAX, "Remarks are too long (300 characters at most)"),
});
export type KarigarCreateInput = z.infer<typeof karigarCreateSchema>;

const purityFor = (metal: InventoryMetal, purity: string) => (metal === "silver" ? purity === "silver" : (KARIGAR_GOLD_PURITIES as readonly string[]).includes(purity));

/** K4, K5: one metal line with its purity and weight. */
export const karigarIssueLineSchema = z
  .object({
    metal: z.enum(INVENTORY_METALS, { error: "Choose gold or silver" }),
    purity: z.string({ error: "Choose a purity" }),
    weightMg: weightMg("weight"),
  })
  .superRefine((v, ctx) => {
    if (!purityFor(v.metal, v.purity)) ctx.addIssue({ code: "custom", path: ["purity"], message: "Choose a purity that fits the metal (silver is silver; gold is 22K916, 24K995, 18K750, 14K or 24K999)" });
  });
export type KarigarIssueLineInput = z.infer<typeof karigarIssueLineSchema>;

const issueLines = z.array(karigarIssueLineSchema, { error: "Add at least one metal line" }).min(1, "Add at least one metal line").max(10, "At most 10 lines");

/** K3: open a job with its issue lines. */
export const karigarJobOpenSchema = z.object({
  id: optionalId,
  karigarId: z.string({ error: "Choose the karigar" }).min(1, "Choose the karigar"),
  jobDate: dateField("job date"),
  sourceLocationId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || DEFAULT_LOCATION_ID),
  labourBasis: z.enum(LABOUR_BASES, { error: "Choose labour per gram or per piece" }),
  labourRatePaise: z
    .number({ error: "Enter the labour rate" })
    .int("Labour rate must be whole paise")
    .min(0, "Labour rate cannot be negative")
    .max(MAX_AMOUNT_PAISE, "Labour rate is too large"),
  wastageBps: z
    .number({ error: "Enter the wastage allowance" })
    .int("Wastage allowance must be whole basis points")
    .min(0, "Wastage allowance cannot be negative")
    .max(KARIGAR_WASTAGE_BPS_MAX, "Wastage allowance is at most 10%"),
  remarks: optionalText(REASON_MAX, "Remarks are too long (300 characters at most)"),
  issues: issueLines,
});
export type KarigarJobOpenInput = z.infer<typeof karigarJobOpenSchema>;

/** K5: more metal to a job that is still open. */
export const karigarIssueSchema = z.object({
  id: optionalId,
  issueDate: dateField("issue date"),
  remarks: optionalText(REASON_MAX, "Remarks are too long (300 characters at most)"),
  issues: issueLines,
});
export type KarigarIssueInput = z.infer<typeof karigarIssueSchema>;

/** K6: a return line. A finished line carries the pieces and the purity tested on them. */
const finishedLine = z
  .object({
    part: z.literal("finished"),
    purity: z.string({ error: "Choose a purity" }),
    weightMg: weightMg("finished weight"),
    pieces: z.number({ error: "Enter the number of pieces" }).int("Pieces must be a whole number").min(1, "At least 1 piece").max(10_000, "Too many pieces"),
    testedPurity: z.string({ error: "Enter the purity tested on the pieces" }),
  });
const remainderLine = z.object({
  part: z.literal("remainder"),
  purity: z.string({ error: "Choose a purity" }),
  weightMg: weightMg("remainder weight"),
});
export const karigarReturnSchema = z.object({
  id: optionalId,
  returnDate: dateField("return date"),
  remarks: optionalText(REASON_MAX, "Remarks are too long (300 characters at most)"),
  lines: z.array(z.discriminatedUnion("part", [finishedLine, remainderLine]), { error: "Add at least one return line" }).min(1, "Add at least one return line").max(20, "At most 20 lines"),
});
export type KarigarReturnInput = z.infer<typeof karigarReturnSchema>;

/** K10: close a job; the metal still held is written off as wastage if it is within the allowance. Not replayed. */
export const karigarCloseSchema = z.object({
  closeDate: dateField("close date"),
  remarks: optionalText(REASON_MAX, "Remarks are too long (300 characters at most)"),
});
export type KarigarCloseInput = z.infer<typeof karigarCloseSchema>;

/** K12: a payout to the karigar (not tied to a job). */
export const karigarPayoutSchema = z.object({
  id: optionalId,
  payoutDate: dateField("payment date"),
  amountPaise: z
    .number({ error: "Enter the amount in rupees" })
    .int("Amount must be whole paise")
    .min(1, "The amount must be more than ₹0")
    .max(MAX_AMOUNT_PAISE, "Amount is too large"),
  paymentMode: z.enum(KARIGAR_PAYMENT_MODES, { error: "Choose cash, UPI, bank transfer or cheque" }),
  reference: optionalText(KARIGAR_REFERENCE_MAX, "Reference is too long (60 characters at most)"),
  remarks: optionalText(REASON_MAX, "Remarks are too long (300 characters at most)"),
});
export type KarigarPayoutInput = z.infer<typeof karigarPayoutSchema>;

// ---- responses ----

export type KarigarMetalBalance = { metal: InventoryMetal; purity: string; heldMg: number };

export type KarigarRow = {
  id: string;
  name: string;
  phone: string | null;
  remarks: string | null;
  createdAt: string;
};

export type KarigarListItem = KarigarRow & {
  openJobs: number;
  balances: KarigarMetalBalance[];
  labourPayablePaise: number;
};
export type KarigarListResponse = { items: KarigarListItem[] };

export type KarigarJobListItem = {
  id: string;
  jobNo: string;
  jobDate: string;
  karigarId: string;
  karigarName: string;
  status: "open" | "closed";
  sourceLocationName: string;
  labourBasis: KarigarLabourBasis;
  labourRatePaise: number;
  wastageBps: number;
  /** Metal issued on the job, per metal and purity (several deliveries are added together). */
  issued: { metal: InventoryMetal; purity: string; weightMg: number }[];
};
export type KarigarJobListResponse = { items: KarigarJobListItem[]; nextCursor: string | null };

/** One line of a statement, with the running balances after it. */
export type KarigarStatementRow = {
  id: string;
  entryDate: string;
  kind: KarigarEntryKind;
  kindLabel: string;
  jobId: string | null;
  jobNo: string | null;
  part: KarigarReturnPart | null;
  metal: InventoryMetal | null;
  purity: string | null;
  weightMg: number | null;
  pieces: number | null;
  testedPurity: string | null;
  amountPaise: number | null;
  paymentMode: KarigarPaymentMode | null;
  paymentModeLabel: string | null;
  reference: string | null;
  reason: string | null;
  /** Metal held by the karigar after this line, for the line's purity. */
  heldAfterMg: number | null;
  /** Labour still owed to the karigar after this line. */
  labourPayableAfterPaise: number;
};

export type KarigarDetail = {
  id: string;
  name: string;
  phone: string | null;
  remarks: string | null;
  createdAt: string;
  balances: KarigarMetalBalance[];
  labourAccruedPaise: number;
  labourPaidPaise: number;
  labourPayablePaise: number;
};
export type KarigarDetailResponse = { karigar: KarigarDetail; jobs: KarigarJobListItem[]; statement: KarigarStatementRow[] };
export type KarigarStatementResponse = { karigar: KarigarDetail; statement: KarigarStatementRow[] };

export type KarigarJobTotals = {
  metal: InventoryMetal;
  purity: string;
  issuedMg: number;
  finishedMg: number;
  remainderMg: number;
  wastageMg: number;
  heldMg: number;
  allowanceMg: number;
};

export type KarigarJobDetail = KarigarJobListItem & {
  remarks: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closeRemarks: string | null;
  totals: KarigarJobTotals[];
  finishedPieces: number;
  labourAccruedPaise: number;
  statement: KarigarStatementRow[];
};
export type KarigarJobResponse = { job: KarigarJobDetail };
