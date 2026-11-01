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
  /** Spec 012c R1. Missing means `weight`, which is the spec 012 and 012b behaviour. */
  pricingMode: z.enum(["weight", "separate", "combined"], { error: "Choose the pricing: by weight, with a stone, or a combined total" }).optional().default("weight"),
  /** `separate` only: stone weight, part of the gross weight (information). */
  stoneWeightMg: int("Stone weight is not valid").optional(),
  /** `separate` only: typed stone amount in paise, 0 allowed. */
  stoneAmountPaise: int("Stone amount is not valid").optional(),
  /** `combined` only: the one typed amount for the line in paise. */
  totalAmountPaise: int("Total amount is not valid").optional(),
  // Accepted for backward-compatible clients, but ignored by the server (012b R1).
  gstRateBps: int("GST rate is not valid").optional(),
});
export type InvoiceLineBody = z.infer<typeof invoiceLineSchema>;

/** Spec 012c R4: a discount on gold, labour or total. Fixed is paise; percent is basis points (100% is 10,000). */
const discountSchema = z.object({
  kind: z.enum(["fixed", "percent"], { error: "Choose fixed or percent" }),
  value: int("The discount must be a whole number"),
});

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
  /** Spec 012c R4. Each target is optional; a missing target has no discount. */
  discounts: z.object({ gold: discountSchema.optional(), labour: discountSchema.optional(), total: discountSchema.optional() }).optional(),
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
  /** Spec 012c R8: the typed stone amount and the discount and taxable amounts of this line. */
  stoneAmountPaise: number;
  discountPaise: number;
  taxablePaise: number;
};

export type DiscountBody = { kind: "fixed" | "percent"; value: number };
export type DiscountsBody = { gold?: DiscountBody; labour?: DiscountBody; total?: DiscountBody };

export type InvoiceSummary = {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  customerMobile: string | null;
  payablePaise: number;
  revisionNo: number;
  voidedAt: string | null;
  /** Spec 015 R12: computed from live allocations. */
  receivedPaise: number;
  balanceDuePaise: number;
  paymentStatus: "unpaid" | "part_paid" | "paid" | "voided";
};

export type InvoiceResponse = InvoiceSummary & {
  header: Record<string, unknown> | null;
  /** Spec 012c R9: the discounts as entered (null when none), and their total as saved. */
  discounts: DiscountsBody | null;
  discountPaise: number;
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
