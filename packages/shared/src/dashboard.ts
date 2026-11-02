import type { PaymentMode } from "./payments";

/**
 * Spec 030: the dashboard on the Home screen. Read-only. A section is `null` when the user lacks the
 * permission for it (invoices.view for sales, payments.view for money), so the screen hides the tiles.
 */
export type DashboardMonth = {
  /** `2026-04` */
  month: string;
  /** Null when the user cannot see sales. */
  salesPaise: number | null;
  /** Null when the user cannot see payments. */
  receiptsPaise: number | null;
};

export type DashboardFy = {
  /** `2026-27` */
  fy: string;
  from: string;
  to: string;
  months: DashboardMonth[];
};

export type DashboardResponse = {
  /** Today's business date (India). */
  asOf: string;
  sales: {
    todayPaise: number;
    todayCount: number;
    /** Sales still waiting for their rate (spec 019c). Open ones, any date. */
    pendingRateCount: number;
  } | null;
  money: {
    receivedTodayPaise: number;
    receivedTodayByMode: { mode: PaymentMode; paise: number }[];
    outstandingPaise: number;
    customersWithOutstanding: number;
    advancesHeldPaise: number;
    advancesTakenTodayPaise: number;
    pendingChequeCount: number;
    pendingChequePaise: number;
  } | null;
  /** Current financial year first, then the previous one. */
  monthly: DashboardFy[];
};
