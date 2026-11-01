import { z } from "zod";
import { cleanMobile, cleanName, cleanPan } from "./customer";
import type { ApplicableRatesResponse, RateKind } from "./rates";
import { isValidBusinessDate } from "./rates";

/** Spec 013 R8. */
export const PURITIES = ["22K916", "24K995", "silver", "18K750", "14K", "24K999", "other"] as const;
export type Purity = (typeof PURITIES)[number];

/** Purities whose gold rate is filled from the day's rates (spec 013 R8). The others are typed (O9). */
export const PURITY_RATE_KIND: Partial<Record<Purity, RateKind>> = {
  "22K916": "gold_22k916",
  "24K995": "gold_24k995",
  silver: "silver",
};

const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

const optionalText = (max: number, message: string) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .nullable()
      .transform((v, ctx) => {
        if (v === null) return null;
        const out = v.replace(/\r\n/g, "\n").trim();
        if (out.length > max) {
          ctx.addIssue({ code: "custom", message });
          return z.NEVER;
        }
        return out;
      }),
  );

const optionalCleaned = (clean: (raw: string) => string | null, message: string) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .nullable()
      .transform((v, ctx) => {
        if (v === null) return null;
        const out = clean(v);
        if (out === null) {
          ctx.addIssue({ code: "custom", message });
          return z.NEVER;
        }
        return out;
      }),
  );

const int = (message: string) => z.number({ error: message }).int(message);

export const invoiceLineSchema = z.object({
  description: z.preprocess((v) => (typeof v === "string" ? v.trim() : v ?? ""), z.string().max(200, "Description is too long")),
  purity: z.enum(PURITIES, { error: "Choose a purity" }),
  hsn: z.string({ error: "HSN is required" }).trim().refine((v) => v === "7113" || v === "9988", "Choose 7113 or 9988"),
  grossWeightMg: int("Gross weight is not valid"),
  netWeightMg: int("Net weight is not valid"),
  polishBps: int("Polish percentage is not valid").min(0, "Polish percentage cannot be negative").max(10000, "Polish percentage cannot exceed 100%").optional().default(0),
  goldRatePaisePerKg: int("Gold rate is not valid"),
  labourRatePaisePerKg: int("Labour rate is not valid"),
  // Accepted for backward-compatible clients, but ignored by the server (012b R1).
  gstRateBps: int("GST rate is not valid").optional(),
});
export type InvoiceLineBody = z.infer<typeof invoiceLineSchema>;

/** Body for creating or editing an invoice. Totals are never accepted: the server recalculates (spec 013 R2). */
export const invoiceRequestSchema = z.object({
  id: z.string().uuid().optional(),
  invoiceDate: z.string({ error: "Date is required" }).refine(isValidBusinessDate, "Date must look like 2026-11-01"),
  customerId: z.string().uuid().nullable().optional(),
  customerName: z
    .string({ error: "Customer name is required" })
    .transform(cleanName)
    .pipe(z.string().min(2, "Customer name must be 2 to 100 characters").max(100, "Customer name must be 2 to 100 characters")),
  customerMobile: optionalCleaned(cleanMobile, "Mobile must be 10 digits"),
  customerAddress: optionalText(400, "Address is too long (400 characters at most)"),
  customerPan: optionalCleaned(cleanPan, "PAN must look like ABCDE1234F"),
  taxMode: z.enum(["intra", "inter"], { error: "Choose same state or other state" }),
  reverseCharge: z.boolean().optional().default(false),
  remarks: optionalText(500, "Remarks are too long (500 characters at most)"),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line").max(50, "An invoice can have at most 50 lines"),
  /** Edit only. */
  reason: z.string().trim().max(300).optional(),
  /** Edit only: the revision the screen started from, so two devices cannot overwrite each other. */
  expectedRevision: z.number().int().min(1).optional(),
});
export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(1, "Please give a reason").max(300) });

// ---- API shapes ----

export type InvoiceLineResponse = InvoiceLineBody & {
  lineNo: number;
  polishBps: number;
  polishMg: number;
  gstRateBps: number;
  chargeableWeightMg: number;
  goldAmountPaise: number;
  labourAmountPaise: number;
  amountPaise: number;
  displayRatePaisePerGram: number;
};

export type InvoiceSummary = {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  customerMobile: string | null;
  payablePaise: number;
  revisionNo: number;
  voidedAt: string | null;
};

export type InvoiceResponse = InvoiceSummary & {
  customerId: string | null;
  customerAddress: string | null;
  customerPan: string | null;
  taxMode: "intra" | "inter";
  reverseCharge: boolean;
  remarks: string | null;
  rates: ApplicableRatesResponse["rates"];
  lines: InvoiceLineResponse[];
  /** The stored calculation result (spec 012 R14), shown as saved and never recalculated. */
  calc: unknown;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  voidReason: string | null;
  /** True when this is an earlier revision, opened with ?revision=N. */
  isEarlierVersion: boolean;
};

export type InvoiceListResponse = { items: InvoiceSummary[]; nextCursor: string | null };

export type InvoiceHistoryEntry = {
  /** The revision that was replaced by this edit. */
  revisionNo: number;
  at: string;
  by: string;
  reason: string | null;
  fromPayablePaise: number;
  toPayablePaise: number;
  changes: string[];
};
