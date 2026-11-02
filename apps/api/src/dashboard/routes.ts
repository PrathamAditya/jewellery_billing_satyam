import { Hono } from "hono";
import { financialYearOf } from "@jewellery/calc";
import { financialYearRange, indiaDate, PAYMENT_MODES, type DashboardFy, type DashboardResponse, type PaymentMode } from "@jewellery/shared";
import type { AppEnv } from "../env";
import { ledgerTotals } from "../ledger/routes";
import { pendingCheques } from "../payments/routes";

/**
 * Spec 030: read-only dashboard for the Home screen. Writes nothing. Sales tiles need `invoices.view`,
 * money tiles need `payments.view`; the route itself needs `dashboard.view` (permission map).
 */
export const dashboardRoutes = new Hono<AppEnv>();

/** Twelve month keys of a financial year, April first. */
function monthKeys(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = 4 + i;
    return m <= 12 ? `${start}-${String(m).padStart(2, "0")}` : `${start + 1}-${String(m - 12).padStart(2, "0")}`;
  });
}

/** The previous financial year label, e.g. `2025-26` for `2026-27`. */
export const previousFy = (fy: string): string => {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

dashboardRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const perms = c.get("user").permissions;
  const canSales = perms.includes("invoices.view");
  const canMoney = perms.includes("payments.view");
  const today = indiaDate(c.get("now"));
  const fy = financialYearOf(today);

  let sales: DashboardResponse["sales"] = null;
  if (canSales) {
    const day = await db
      .prepare("SELECT COALESCE(SUM(payable_paise), 0) AS total, COUNT(*) AS n FROM invoices WHERE invoice_date = ?1 AND voided_at IS NULL AND rate_status = 'fixed'")
      .bind(today)
      .first<{ total: number; n: number }>();
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE rate_status = 'pending' AND voided_at IS NULL").first<{ n: number }>();
    sales = { todayPaise: day?.total ?? 0, todayCount: day?.n ?? 0, pendingRateCount: pending?.n ?? 0 };
  }

  let money: DashboardResponse["money"] = null;
  if (canMoney) {
    const byMode = (
      await db.prepare("SELECT mode, COALESCE(SUM(amount_paise), 0) AS paise FROM payments WHERE receipt_date = ?1 AND voided_at IS NULL GROUP BY mode").bind(today).all<{ mode: string; paise: number }>()
    ).results;
    const taken = await db
      .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payments WHERE kind = 'advance' AND receipt_date = ?1 AND voided_at IS NULL")
      .bind(today)
      .first<{ n: number }>();
    const totals = await ledgerTotals(db);
    const cheques = await pendingCheques(db);
    const receivedByMode = PAYMENT_MODES.map((mode) => ({ mode: mode as PaymentMode, paise: byMode.find((r) => r.mode === mode)?.paise ?? 0 }));
    money = {
      receivedTodayPaise: receivedByMode.reduce((s, r) => s + r.paise, 0),
      receivedTodayByMode: receivedByMode,
      outstandingPaise: totals.totalOutstandingPaise,
      customersWithOutstanding: totals.customersWithOutstanding,
      advancesHeldPaise: totals.totalAdvanceHeldPaise,
      advancesTakenTodayPaise: taken?.n ?? 0,
      pendingChequeCount: cheques.count,
      pendingChequePaise: cheques.totalPaise,
    };
  }

  const monthly: DashboardFy[] = [];
  for (const y of [fy, previousFy(fy)]) {
    const { from, to } = financialYearRange(y);
    const salesByMonth = new Map<string, number>();
    const receiptsByMonth = new Map<string, number>();
    if (canSales) {
      for (const r of (await db.prepare("SELECT substr(invoice_date, 1, 7) AS m, SUM(payable_paise) AS n FROM invoices WHERE rate_status = 'fixed' AND voided_at IS NULL AND invoice_date BETWEEN ?1 AND ?2 GROUP BY m").bind(from, to).all<{ m: string; n: number }>()).results) salesByMonth.set(r.m, r.n);
    }
    if (canMoney) {
      for (const r of (await db.prepare("SELECT substr(receipt_date, 1, 7) AS m, SUM(amount_paise) AS n FROM payments WHERE voided_at IS NULL AND receipt_date BETWEEN ?1 AND ?2 GROUP BY m").bind(from, to).all<{ m: string; n: number }>()).results) receiptsByMonth.set(r.m, r.n);
    }
    monthly.push({
      fy: y,
      from,
      to,
      months: monthKeys(y).map((month) => ({
        month,
        salesPaise: canSales ? (salesByMonth.get(month) ?? 0) : null,
        receiptsPaise: canMoney ? (receiptsByMonth.get(month) ?? 0) : null,
      })),
    });
  }

  const body: DashboardResponse = { asOf: today, sales, money, monthly };
  return c.json(body);
});
