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

/** Feedback point 3: one more payment mode on the same receipt (the first mode is given by the main fields of the request). */
export const paymentModeLineSchema = z.object({
  mode: z.enum(CUSTOMER_PAYMENT_MODES, { error: "Choose a payment mode" }),
  reference: z.string().trim().max(60, "Reference is too long (60 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
  amountPaise: z.number({ error: "Enter the amount" }).int("Amount must be whole paise").min(1, "Amount must be more than 0").max(MAX_PAYMENT_PAISE, "Amount is too large"),
  chequeBank: z.string().trim().max(100, "Bank name is too long (100 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
  chequeDate: z.string().refine(isValidBusinessDate, "Cheque date must look like 2026-11-01").optional().nullable().transform((v) => (v ? v : null)),
  chequeDrawer: z.string().trim().max(100, "Drawer name is too long (100 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
});
export type PaymentModeLineRequest = z.infer<typeof paymentModeLineSchema>;
/** One receipt can carry up to this many payment modes in total (the main one plus up to 5 more). */
export const MAX_MODES_PER_RECEIPT = 6;

export const paymentRequestSchema = z.object({
  id: z.string().uuid().optional(),
  date: z.string().refine(isValidBusinessDate, "Date must look like 2026-11-01"),
  customerId: z.string().uuid().nullable().optional(),
  mode: z.enum(CUSTOMER_PAYMENT_MODES, { error: "Choose a payment mode" }),
  reference: z.string().trim().max(60, "Reference is too long (60 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
  amountPaise: z.number({ error: "Enter the amount" }).int("Amount must be whole paise").min(1, "Amount must be more than 0").max(MAX_PAYMENT_PAISE, "Amount is too large"),
  /** `advance` = no invoice yet. `against_invoices` = pay one or more invoices. `at_sale` = recorded on one invoice at the time of sale. */
  purpose: z.enum(["advance", "against_invoices", "at_sale", "opening_advance", "pending_sale"], { error: "Choose what this payment is for" }),
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
  /** Spec 019b C8: cheque details, used when mode is `cheque` (all optional). */
  chequeBank: z.string().trim().max(100, "Bank name is too long (100 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
  chequeDate: z.string().refine(isValidBusinessDate, "Cheque date must look like 2026-11-01").optional().nullable().transform((v) => (v ? v : null)),
  chequeDrawer: z.string().trim().max(100, "Drawer name is too long (100 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
  /** Feedback point 3: more payment modes on the same receipt. The amounts of all modes add up to the receipt's total; `amountPaise` above is the first mode's amount only. */
  extraModes: z.array(paymentModeLineSchema).max(MAX_MODES_PER_RECEIPT - 1, `A receipt can have at most ${MAX_MODES_PER_RECEIPT} payment modes`).optional().default([]),
});
export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

/** Spec 019b C1, C2: a cheque's status, and the moves that can be asked for. */
export const CHEQUE_STATUSES = ["received", "deposited", "cleared", "bounced"] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];
export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = { received: "Received", deposited: "Deposited", cleared: "Cleared", bounced: "Bounced" };
export const chequeMoveSchema = z
  .object({
    status: z.enum(["deposited", "cleared", "bounced"], { error: "Choose deposited, cleared or bounced" }),
    reason: z.string().trim().max(300, "Reason is too long (300 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
  })
  .refine((b) => b.status !== "bounced" || b.reason !== null, { message: "Please give the reason for the bounce", path: ["reason"] });
export type ChequeMove = z.infer<typeof chequeMoveSchema>;

export type ChequeEventResponse = { status: ChequeStatus; at: string; by: string; reason: string | null };
export type ChequeResponse = { bank: string | null; date: string | null; drawer: string | null; status: ChequeStatus; events: ChequeEventResponse[] };
export type ChequePendingResponse = { count: number; totalPaise: number };

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

/** One payment mode of a receipt. A receipt with one mode has one line. */
export type PaymentModeLine = {
  /** The id of this mode's own payment row: cheque moves and refunds use it. */
  id: string;
  mode: PaymentMode;
  reference: string | null;
  amountPaise: number;
  remainingPaise: number;
  voided: boolean;
  cheque: ChequeResponse | null;
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
  /** Combined remaining balance due across live invoices paid by this receipt, or null if not against an invoice. */
  invoiceBalanceDuePaise?: number | null;
  /** Spec 019b: the cheque record for a cheque payment, null for other modes. For a receipt with several modes: the first mode's. */
  cheque: ChequeResponse | null;
  /** Feedback point 3: every payment mode of this receipt, first mode first. `amountPaise`, `remainingPaise` and `allocations` above are totals over all of them. */
  modeLines: PaymentModeLine[];
  header: Record<string, unknown> | null;
  createdAt: string;
  createdBy: string;
};

export type PaymentWarning = { code: "cash_limit"; limitPaise: number } | { code: "duplicate_cheque_number"; reference: string };
export type PaymentSaveResponse = { payment: PaymentResponse; warnings: PaymentWarning[] };
export type PaymentSummary = { id: string; kind: PaymentKind; receiptNo: string | null; receiptDate: string; payerName: string; mode: PaymentMode; /** Feedback point 3: every mode of the receipt, first first (one entry for an ordinary receipt). */ modes: PaymentMode[]; amountPaise: number; remainingPaise: number; voided: boolean; chequeStatus: ChequeStatus | null };
export type PaymentListResponse = { items: PaymentSummary[]; nextCursor: string | null };

export type PaymentStatus = "unpaid" | "part_paid" | "paid" | "voided" | "pending_rate";
/** Spec 015 R12: computed from allocations, never stored. Spec 019c: a sale whose rate is not fixed yet is "pending_rate". */
export const paymentStatusOf = (payablePaise: number, receivedPaise: number, voided: boolean, pendingRate = false): PaymentStatus =>
  voided ? "voided" : pendingRate ? "pending_rate" : receivedPaise <= 0 ? "unpaid" : receivedPaise >= payablePaise ? "paid" : "part_paid";
