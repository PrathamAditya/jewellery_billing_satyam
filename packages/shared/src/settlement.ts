import { z } from "zod";

export const settlementRemarksSchema = z.object({
  remarks: z.string().trim().max(1000, "Remarks are too long (1000 characters at most)").nullable().transform((v) => (v ? v : null)),
});

export const advanceAllocationsSchema = z.object({
  allocations: z
    .array(z.object({ paymentId: z.string().uuid(), amountPaise: z.number().int().min(1, "Amount must be more than 0") }))
    .min(1, "Choose at least one advance")
    .max(20),
});

/** Spec 017 R2: one line per allocation to the invoice, oldest first. */
export type SettlementLine = {
  allocationId: string;
  paymentId: string;
  date: string;
  mode: string;
  reference: string;
  type: string;
  amountPaise: number;
  paymentRemainingPaise: number;
  receiptNo: string | null;
};

/** Spec 019d R17: a credit note applied to this bill, counted as settled money. */
export type SettlementCreditLine = {
  applicationId: string;
  creditNoteId: string;
  creditNoteNo: string;
  date: string;
  amountPaise: number;
};

export type SettlementResponse = {
  invoice: { id: string; invoiceNo: string; invoiceDate: string; customerId: string | null; customerName: string; voided: boolean };
  payablePaise: number;
  receivedPaise: number;
  balanceDuePaise: number;
  /** Spec 017 R4: receipt numbers of the lines, joined. */
  advanceReference: string;
  /** Spec 017 R5: one sentence per advance or old gold line. */
  autoNote: string[];
  remarks: string | null;
  lines: SettlementLine[];
  /** Spec 019d R17: live credit applications. They are part of `receivedPaise`. */
  creditLines: SettlementCreditLine[];
};
