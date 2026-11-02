import { z } from "zod";
import { isValidBusinessDate } from "./rates";

/** Spec 031: the four CA reports. The slug is the URL part: `/api/reports/:kind`. */
export const REPORT_KINDS = ["sales-register", "payments-register", "outstanding", "gst-summary"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABEL: Record<ReportKind, string> = {
  "sales-register": "Sales register",
  "payments-register": "Payments register",
  outstanding: "Outstanding by customer",
  "gst-summary": "GST summary by rate",
};

export const REPORT_FORMATS = ["xlsx", "pdf"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** `2026-27` is the financial year from 1 April 2026 to 31 March 2027. */
export const isFinancialYear = (value: string): boolean => {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return false;
  return Number(m[2]) === (Number(m[1]) + 1) % 100;
};

/** Query of `GET /api/reports/:kind`: either `from` and `to`, or `fy`. Outstanding ignores the period. */
export const reportQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    fy: z.string().optional(),
    format: z.enum(REPORT_FORMATS).default("xlsx"),
  })
  .superRefine((q, ctx) => {
    if (q.fy !== undefined) {
      if (!isFinancialYear(q.fy)) ctx.addIssue({ code: "custom", path: ["fy"], message: "Choose a financial year like 2026-27" });
      return;
    }
    if (!q.from || !isValidBusinessDate(q.from)) ctx.addIssue({ code: "custom", path: ["from"], message: "Choose the start date" });
    if (!q.to || !isValidBusinessDate(q.to)) ctx.addIssue({ code: "custom", path: ["to"], message: "Choose the end date" });
    if (q.from && q.to && isValidBusinessDate(q.from) && isValidBusinessDate(q.to) && q.from > q.to) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "The end date is before the start date" });
    }
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;
