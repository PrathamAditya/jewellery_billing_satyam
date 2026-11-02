import { z } from "zod";
import { isValidBusinessDate } from "./rates";
import { MAX_AMOUNT_PAISE } from "./pricing";

/** Spec 032: daily cash closing. All money is integer paise. A difference is counted minus expected (negative = short). */

export const CASH_REASON_MAX = 300;

export const cashClosingRequestSchema = z.object({
  id: z.string().uuid().optional(),
  date: z.string().refine(isValidBusinessDate, "Date must look like 2026-11-01"),
  countedPaise: z
    .number({ error: "Enter the cash you counted" })
    .int("The counted cash must be whole paise")
    .min(0, "The counted cash cannot be negative")
    .max(MAX_AMOUNT_PAISE, "That amount is too large"),
  /** Only for the first closing ever: the cash in the drawer at the start of the day. Later days carry the last count. */
  openingPaise: z.number().int().min(0).max(MAX_AMOUNT_PAISE).optional(),
  reason: z
    .string()
    .trim()
    .max(CASH_REASON_MAX, `Keep the reason under ${CASH_REASON_MAX} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type CashClosingRequest = z.infer<typeof cashClosingRequestSchema>;

export const cashNoteRequestSchema = z.object({
  id: z.string().uuid().optional(),
  note: z.string().trim().min(1, "Write the correction").max(CASH_REASON_MAX, `Keep the note under ${CASH_REASON_MAX} characters`),
});
export type CashNoteRequest = z.infer<typeof cashNoteRequestSchema>;

/** Where a cash entry comes from. Only cash moves the drawer; UPI, card, cheque and bank transfer never do. */
export type CashMovementKind = "receipt" | "refund" | "credit_payout" | "old_gold_payout";

export type CashMovement = {
  kind: CashMovementKind;
  direction: "in" | "out";
  /** Receipt number, refund's receipt, credit note number or old gold receipt number. */
  reference: string | null;
  /** Who the money came from or went to. */
  party: string;
  date: string;
  amountPaise: number;
};

export type CashTotals = {
  receiptsPaise: number;
  receiptsCount: number;
  refundsPaise: number;
  refundsCount: number;
  creditPayoutsPaise: number;
  creditPayoutsCount: number;
  oldGoldPayoutsPaise: number;
  oldGoldPayoutsCount: number;
  /** Cash in minus cash out for the day. */
  netPaise: number;
};

export type CashClosingRow = {
  id: string;
  date: string;
  openingPaise: number;
  expectedPaise: number;
  countedPaise: number;
  /** counted minus expected. Zero means the drawer agrees. */
  differencePaise: number;
  reason: string | null;
  totals: CashTotals;
  closedBy: string;
  closedAt: string;
};

export type CashNote = { id: string; date: string; note: string; createdAt: string; createdBy: string };

export type CashClosingDayResponse = {
  date: string;
  /** Where the opening cash comes from: the last count ("carried"), or typed on the first closing ("typed"). */
  opening: { paise: number; source: "carried" | "typed"; fromDate: string | null };
  movements: CashMovement[];
  totals: CashTotals;
  /** Null while the opening is still to be typed (first closing), otherwise opening + net. */
  expectedPaise: number | null;
  /** The closing that already exists for this date, with the figures it was saved with. */
  closing: CashClosingRow | null;
  /** For a closed day: what the drawer would be expected to hold now, if money changed after the closing. */
  currentExpectedPaise: number | null;
  notes: CashNote[];
  /** The latest closed date, if any. Days close in order after it. */
  lastClosedDate: string | null;
  /** An earlier day with cash activity that is not closed yet. Blocks closing this day until it is closed. */
  blockedByDate: string | null;
  canClose: boolean;
};

export type CashClosingListResponse = {
  items: (CashClosingRow & { noteCount: number })[];
  nextCursor: string | null;
};

export type CashClosingSaveResponse = { closing: CashClosingRow };
export type CashNoteSaveResponse = { note: CashNote };

/** Expected cash = the opening cash plus what came in and went out. */
export function expectedCashPaise(openingPaise: number, netPaise: number): number {
  return openingPaise + netPaise;
}

/** counted minus expected. Positive means more cash than expected, negative means short. */
export function cashDifferencePaise(countedPaise: number, expectedPaise: number): number {
  return countedPaise - expectedPaise;
}

export const CASH_KIND_LABEL: Record<CashMovementKind, string> = {
  receipt: "Cash received",
  refund: "Cash refund",
  credit_payout: "Credit note payout (cash)",
  old_gold_payout: "Old gold payout (cash)",
};
