import { z } from "zod";
import { isValidBusinessDate } from "./rates";

/** Spec 015 R1: modes. `old_gold` is created only by spec 018. */
export const PAYMENT_MODES = ["cash", "upi", "card", "cheque", "bank_transfer", "old_gold"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const CUSTOMER_PAYMENT_MODES = ["cash", "upi", "card", "cheque", "bank_transfer"] as const;

export const PAYMENT_KINDS = ["advance", "invoice_payment", "at_sale", "opening_advance", "old_gold"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const MAX_PAYMENT_PAISE = 10_00_00_000 * 100;

export const MODE_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  old_gold: "Old Gold",
};

export const KIND_LABEL: Record<PaymentKind, string> = {
  advance: "Advance",
  invoice_payment: "Later payment",
  at_sale: "At sale",
  opening_advance: "Opening advance",
  old_gold: "Old gold",
};

export const paymentRequestSchema = z.object({
  id: z.string().uuid().optional(),
  date: z.string().refine(isValidBusinessDate, "Date must look like 2026-11-01"),
  customerId: z.string().uuid().nullable().optional(),
  mode: z.enum(CUSTOMER_PAYMENT_MODES, { error: "Choose a payment mode" }),
  reference: z.string().trim().max(60, "Reference is too long (60 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
  amountPaise: z.number({ error: "Enter the amount" }).int("Amount must be whole paise").min(1, "Amount must be more than 0").max(MAX_PAYMENT_PAISE, "Amount is too large"),
  /** `advance` = no invoice yet. `against_invoices` = pay one or more invoices. `at_sale` = recorded on one invoice at the time of sale. */
  purpose: z.enum(["advance", "against_invoices", "at_sale", "opening_advance"], { error: "Choose what this payment is for" }),
  /** Old booklet receipt number, for opening advances (spec 016 R3). */
  oldReference: z.string().trim().max(60).optional().nullable().transform((v) => (v ? v : null)),
  invoiceId: z.string().uuid().optional(),
  /** Manual allocation for `against_invoices`. `auto` (default) fills the oldest invoice first (FIFO). */
  allocation: z
    .union([
      z.literal("auto"),
      z
        .array(
          z
            .object({ invoiceId: z.string().uuid().optional(), openingBalanceId: z.string().uuid().optional(), amountPaise: z.number().int().min(1) })
            .refine((a) => (a.invoiceId ? 1 : 0) + (a.openingBalanceId ? 1 : 0) === 1, "Each line must name one invoice or one opening balance"),
        )
        .min(1)
        .max(50),
    ])
    .optional()
    .default("auto"),
  orderId: z.string().uuid().nullable().optional(),
  remarks: z.string().trim().max(500, "Remarks are too long (500 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
});
export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

export const paymentRemarksSchema = z.object({ remarks: z.string().trim().max(500).nullable() });
export const voidPaymentSchema = z.object({ reason: z.string().trim().min(1, "Please give a reason").max(300) });
export const reverseAllocationSchema = z.object({ reason: z.string().trim().min(1, "Please give a reason").max(300) });

export type PaymentAllocationResponse = {
  id: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  amountPaise: number;
  reversed: boolean;
  reversedAt: string | null;
};

export type PaymentResponse = {
  id: string;
  kind: PaymentKind;
  receiptNo: string | null;
  receiptDate: string;
  customerId: string | null;
  payer: { name: string; mobile: string | null; pan: string | null; address: string | null };
  mode: PaymentMode;
  reference: string | null;
  amountPaise: number;
  remainingPaise: number;
  remarks: string | null;
  voided: boolean;
  voidReason: string | null;
  allocations: PaymentAllocationResponse[];
  advanceSummary: { previousRemainingPaise: number; thisRemainingPaise: number; totalAvailablePaise: number } | null;
  header: Record<string, unknown> | null;
  createdAt: string;
  createdBy: string;
};

export type PaymentWarning = { code: "cash_limit"; limitPaise: number };
export type PaymentSaveResponse = { payment: PaymentResponse; warnings: PaymentWarning[] };
export type PaymentSummary = { id: string; kind: PaymentKind; receiptNo: string | null; receiptDate: string; payerName: string; mode: PaymentMode; amountPaise: number; remainingPaise: number; voided: boolean };
export type PaymentListResponse = { items: PaymentSummary[]; nextCursor: string | null };

export type PaymentStatus = "unpaid" | "part_paid" | "paid" | "voided";
/** Spec 015 R12: computed from allocations, never stored. */
export const paymentStatusOf = (payablePaise: number, receivedPaise: number, voided: boolean): PaymentStatus =>
  voided ? "voided" : receivedPaise <= 0 ? "unpaid" : receivedPaise >= payablePaise ? "paid" : "part_paid";
