import { z } from "zod";
import { isValidBusinessDate } from "./rates";

export const openingBalanceSchema = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid({ error: "Choose the customer" }),
  amountPaise: z.number({ error: "Enter the amount" }).int().min(1, "Amount must be more than 0"),
  asOfDate: z.string().refine(isValidBusinessDate, "Date must look like 2026-11-01"),
  reference: z.string().trim().max(60).optional().nullable().transform((v) => (v ? v : null)),
  remarks: z.string().trim().max(300).optional().nullable().transform((v) => (v ? v : null)),
});
export type OpeningBalanceRequest = z.infer<typeof openingBalanceSchema>;

export type LedgerEntry = {
  date: string;
  type: string;
  reference: string | null;
  description: string;
  debitPaise: number;
  creditPaise: number;
  /** What the customer owes after this line (spec 019 R4). */
  outstandingAfterPaise: number;
  /** What the shop holds for the customer after this line. */
  advanceAfterPaise: number;
};

export type LedgerResponse = {
  customerId: string;
  customerName: string;
  from: string | null;
  outstandingPaise: number;
  advanceHeldPaise: number;
  netPaise: number;
  entries: LedgerEntry[];
};

export type OutstandingRow = { customerId: string; customerName: string; outstandingPaise: number; advanceHeldPaise: number; oldestUnpaidDate: string | null };
export type LedgerSummary = { totalOutstandingPaise: number; totalAdvanceHeldPaise: number; customersWithOutstanding: number; top: OutstandingRow[] };
