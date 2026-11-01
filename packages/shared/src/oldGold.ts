import { z } from "zod";
import { isValidBusinessDate } from "./rates";

export const OLD_GOLD_TREATMENTS = ["direct_payment", "advance", "invoice_adjustment", "split"] as const;
export type OldGoldTreatment = (typeof OLD_GOLD_TREATMENTS)[number];
export const KARATS = ["22K", "24K", "other"] as const;
export const PAYOUT_MODES = ["bank_transfer", "upi", "cheque"] as const;

/** Spec 018 R2. Weights in mg, purity in basis points (75.26% = 7526), rate in paise per kg. */
export const oldGoldRowSchema = z.object({
  description: z.string().trim().min(1).max(100).default("Old Gold"),
  grossMg: z.number().int().min(1, "Gross weight must be more than 0"),
  lessMg: z.number().int().min(0, "Less cannot be negative").default(0),
  karat: z.enum(KARATS).default("22K"),
  purityBps: z.number().int().min(1, "Purity must be more than 0%").max(10_000, "Purity cannot be more than 100%"),
  rateKgPaise: z.number().int().min(1, "Rate must be more than 0"),
});

export const oldGoldRequestSchema = z.object({
  id: z.string().uuid().optional(),
  date: z.string().refine(isValidBusinessDate, "Date must look like 2026-11-01"),
  customerId: z.string().uuid({ error: "Choose the customer" }),
  rows: z.array(oldGoldRowSchema).min(1, "Add at least one row").max(10, "A receipt can have at most 10 rows"),
  treatment: z.enum(OLD_GOLD_TREATMENTS, { error: "Choose how the old gold is settled" }),
  /** Direct payment and split: the money paid to the customer now. */
  directPaise: z.number().int().min(0).default(0),
  /** Advance and split: the money kept as the customer's advance. */
  advancePaise: z.number().int().min(0).default(0),
  /** Invoice adjustment and split: the money used on an invoice. */
  invoiceAdjustPaise: z.number().int().min(0).default(0),
  invoiceId: z.string().uuid().nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
  payoutMode: z.enum(PAYOUT_MODES).nullable().optional(),
  payoutReference: z.string().trim().max(60).nullable().optional().transform((v) => (v ? v : null)),
  remarks: z.string().trim().max(500).nullable().optional().transform((v) => (v ? v : null)),
});
export type OldGoldRequest = z.infer<typeof oldGoldRequestSchema>;

export const voidOldGoldSchema = z.object({ reason: z.string().trim().min(1, "Please give a reason").max(300) });

/** Spec 018 R6, R7: the words printed on the receipt, from the settlement that was chosen. */
export const OLD_GOLD_STATUS: Record<OldGoldTreatment, string> = {
  direct_payment: "Paid",
  advance: "Advance Created",
  invoice_adjustment: "Adjusted Against Invoice",
  split: "Split Settlement",
};
export const OLD_GOLD_TREATMENT_LABEL: Record<OldGoldTreatment, string> = {
  direct_payment: "Direct Payment to Customer",
  advance: "Transfer to Customer Advance",
  invoice_adjustment: "Adjust Against Invoice",
  split: "Split Settlement",
};

export type OldGoldRowResponse = { lineNo: number; description: string; grossMg: number; lessMg: number; netMg: number; karat: string; purityBps: number; rateKgPaise: number; amountPaise: number };
export type OldGoldResponse = {
  id: string;
  receiptNo: string;
  receiptDate: string;
  customerId: string;
  payer: { name: string; mobile: string | null; pan: string | null; address: string | null };
  treatment: OldGoldTreatment;
  treatmentLabel: string;
  status: string;
  settlementMethod: "Ledger Adjustment" | "Direct Payment";
  settlementNote: string;
  invoiceId: string | null;
  orderId: string | null;
  rows: OldGoldRowResponse[];
  originalPaise: number;
  roundOffPaise: number;
  finalPaise: number;
  parts: { directPaise: number; advancePaise: number; invoiceAdjustPaise: number };
  payment: { id: string; receiptNo: string | null; remainingPaise: number } | null;
  payouts: { id: string; mode: string; reference: string | null; amountPaise: number; paidDate: string; voided: boolean }[];
  voided: boolean;
  voidReason: string | null;
  createdAt: string;
  createdBy: string;
};
export type OldGoldSummary = { id: string; receiptNo: string; receiptDate: string; customerName: string; finalPaise: number; treatment: OldGoldTreatment; voided: boolean };
export type OldGoldListResponse = { items: OldGoldSummary[]; nextCursor: string | null };
