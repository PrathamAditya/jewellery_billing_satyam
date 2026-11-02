import { z } from "zod";
import { isValidBusinessDate } from "./rates";
import { REFUND_MODES, type RefundMode } from "./orders";

/** Spec 019d R1: a credit note has one kind. */
export const CREDIT_NOTE_KINDS = ["credit", "exchange", "old_gold"] as const;
export type CreditNoteKind = (typeof CREDIT_NOTE_KINDS)[number];
export const CREDIT_NOTE_KIND_LABEL: Record<CreditNoteKind, string> = {
  credit: "Return (credit)",
  exchange: "Exchange",
  old_gold: "Old gold adjustment",
};

/** Spec 019d R2: one returned line of the original invoice. */
const creditLineSchema = z.object({
  invoiceLineNo: z.number({ error: "Choose the line" }).int().min(1),
  taxablePaise: z.number({ error: "Enter the returned value" }).int("Value must be whole paise").min(1, "Returned value must be more than 0"),
});

/** Spec 019d R2, R6, R8, R9: create. Kind-specific fields are checked below. */
export const creditNoteRequestSchema = z
  .object({
    id: z.string().uuid().optional(),
    invoiceId: z.string().uuid({ error: "Choose the invoice" }),
    cnDate: z.string({ error: "Date is required" }).refine(isValidBusinessDate, "Date must look like 2026-11-01"),
    kind: z.enum(CREDIT_NOTE_KINDS, { error: "Choose the kind of return" }),
    lines: z.array(creditLineSchema).min(1, "Add at least one returned line").max(50, "A credit note can have at most 50 lines"),
    reason: z.string().trim().min(1, "Please give a reason").max(300, "Reason is too long (300 characters at most)"),
    replacementInvoiceId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
    ogpId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    const dupes = new Set<number>();
    for (const l of v.lines) {
      if (dupes.has(l.invoiceLineNo)) ctx.addIssue({ code: "custom", message: "A line can be returned once per credit note", path: ["lines"] });
      dupes.add(l.invoiceLineNo);
    }
    if (v.kind === "exchange" && !v.replacementInvoiceId) ctx.addIssue({ code: "custom", message: "Choose the replacement invoice", path: ["replacementInvoiceId"] });
    if (v.kind !== "exchange" && v.replacementInvoiceId) ctx.addIssue({ code: "custom", message: "A replacement invoice is only for an exchange", path: ["replacementInvoiceId"] });
    if (v.kind === "old_gold" && !v.ogpId) ctx.addIssue({ code: "custom", message: "Choose the old gold receipt", path: ["ogpId"] });
    if (v.kind !== "old_gold" && v.ogpId) ctx.addIssue({ code: "custom", message: "An old gold receipt is only for an old gold adjustment", path: ["ogpId"] });
  });
export type CreditNoteRequest = z.infer<typeof creditNoteRequestSchema>;

/** Spec 019d R11: apply held credit to another invoice of the same customer. */
export const creditApplySchema = z.object({
  invoiceId: z.string().uuid({ error: "Choose the invoice" }),
  amountPaise: z.number({ error: "Enter the amount" }).int("Amount must be whole paise").min(1, "Amount must be more than 0"),
});
export type CreditApplyRequest = z.infer<typeof creditApplySchema>;

/** Spec 019d R12: pay back held credit. */
export const creditPayoutSchema = z.object({
  amountPaise: z.number({ error: "Enter the amount" }).int("Amount must be whole paise").min(1, "Amount must be more than 0"),
  mode: z.enum(REFUND_MODES, { error: "Choose how it is paid" }),
  reference: z.string().trim().max(60, "Reference is too long (60 characters at most)").optional().nullable().transform((v) => (v ? v : null)),
  paidDate: z.string({ error: "Date is required" }).refine(isValidBusinessDate, "Date must look like 2026-11-01"),
  remarks: z.string().trim().max(300).optional().nullable().transform((v) => (v ? v : null)),
});
export type CreditPayoutRequest = z.infer<typeof creditPayoutSchema>;

/** Spec 019d R13, R14: a reason for every reversal and void. */
export const creditReasonSchema = z.object({ reason: z.string().trim().min(1, "Please give a reason").max(300) });

export type CreditNoteSummary = {
  id: string;
  cnNo: string;
  cnDate: string;
  kind: CreditNoteKind;
  kindLabel: string;
  invoiceId: string;
  invoiceNo: string;
  customerId: string | null;
  customerName: string;
  amountPaise: number;
  /** Spec 019d R10: amount not yet applied or paid out. */
  heldPaise: number;
  voided: boolean;
  voidedAt: string | null;
  voidReason: string | null;
};

export type CreditNoteLineView = {
  lineNo: number;
  invoiceLineNo: number;
  description: string;
  hsn: string;
  gstRateBps: number;
  taxablePaise: number;
  taxPaise: number;
};

export type CreditApplicationView = {
  id: string;
  invoiceId: string;
  invoiceNo: string;
  amountPaise: number;
  date: string;
  reversed: boolean;
  reverseReason: string | null;
};

export type CreditPayoutView = {
  id: string;
  amountPaise: number;
  mode: RefundMode;
  reference: string | null;
  paidDate: string;
  remarks: string | null;
  reversed: boolean;
  reverseReason: string | null;
};

export type CreditNoteDetail = CreditNoteSummary & {
  reason: string;
  taxMode: "intra" | "inter";
  taxablePaise: number;
  taxPaise: number;
  totalBeforeRoundOffPaise: number;
  roundOffPaise: number;
  replacementInvoiceId: string | null;
  replacementInvoiceNo: string | null;
  ogpId: string | null;
  ogpNo: string | null;
  customer: { name: string; mobile: string | null; address: string | null; pan: string | null };
  lines: CreditNoteLineView[];
  applications: CreditApplicationView[];
  payouts: CreditPayoutView[];
  /** The business header saved with the note (spec 003 R5), for printing. */
  header: Record<string, unknown> | null;
};

export type CreditNoteListResponse = { items: CreditNoteSummary[]; nextCursor: string | null };
