import { z } from "zod";

/** Spec 010 R3: trim, collapse inner spaces. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Lowercase copy of the name used for searching (spec 010 R8). */
export function nameSearchKey(name: string): string {
  return cleanName(name).toLowerCase();
}

/**
 * Spec 010 R3: returns the 10 digits, or null if the input cannot be a mobile number.
 * Spaces, dashes, brackets, a leading "+91", "91" or "0" are removed.
 */
export function cleanMobile(raw: string): string | null {
  if (/[^\d\s+\-().]/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** Spec 010 R4: uppercase, must look like AAAAA9999A. */
export function cleanPan(raw: string): string | null {
  const pan = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : null;
}

/** Spec 010 R4: 12 digits, spaces allowed on input. */
export function cleanAadhaar(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{12}$/.test(digits) ? digits : null;
}

/** Spec 010 R4: 6 digits. */
export function cleanPincode(raw: string): string | null {
  const pin = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(pin) ? pin : null;
}

/** Spec 010 R14: shown everywhere as "XXXX XXXX 1234". */
export function maskAadhaar(aadhaar: string): string {
  return `XXXX XXXX ${aadhaar.slice(-4)}`;
}

/** Spec 010 R2: "C-0001". Pads to 4 digits and grows beyond. */
export function formatCustomerNumber(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`Invalid number: ${n}`);
  return `C-${String(n).padStart(4, "0")}`;
}

/** A blank optional field means "nothing". */
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

function optionalField(label: string, clean: (raw: string) => string | null, message: string) {
  return z.preprocess(
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
  ).describe(label);
}

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

/** Every customer field after cleaning. Only the name is required (spec 010 R1). */
export const customerFieldShapes = {
  name: z
    .string({ error: "Name is required" })
    .transform(cleanName)
    .pipe(z.string().min(2, "Name must be 2 to 100 characters").max(100, "Name must be 2 to 100 characters")),
  mobile: optionalField("mobile", cleanMobile, "Mobile must be 10 digits"),
  altMobile: optionalField("altMobile", cleanMobile, "Alternate mobile must be 10 digits"),
  address: optionalText(300, "Address is too long (300 characters at most)"),
  city: optionalText(80, "City is too long (80 characters at most)"),
  pincode: optionalField("pincode", cleanPincode, "PIN code must be 6 digits"),
  pan: optionalField("pan", cleanPan, "PAN must look like ABCDE1234F"),
  aadhaar: optionalField("aadhaar", cleanAadhaar, "Aadhaar must be 12 digits"),
  notes: optionalText(1000, "Notes are too long (1000 characters at most)"),
};

export const CUSTOMER_FIELDS = Object.keys(customerFieldShapes) as (keyof typeof customerFieldShapes)[];
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

/** Body for creating a customer. `id` is the client-generated UUID that makes a retry safe (spec 001 R5). */
export const createCustomerSchema = z.object({
  id: z.string().uuid().optional(),
  ...customerFieldShapes,
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/** Body for editing: only the fields that are sent change. `null` or blank clears an optional field. */
export const updateCustomerSchema = z
  .object({
    name: customerFieldShapes.name,
    mobile: customerFieldShapes.mobile,
    altMobile: customerFieldShapes.altMobile,
    address: customerFieldShapes.address,
    city: customerFieldShapes.city,
    pincode: customerFieldShapes.pincode,
    pan: customerFieldShapes.pan,
    aadhaar: customerFieldShapes.aadhaar,
    notes: customerFieldShapes.notes,
  })
  .partial()
  .extend({ reason: z.string().trim().max(300).optional() });
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const voidCustomerSchema = z.object({
  reason: z.string().trim().min(1, "Please give a reason").max(300),
});

/** What the API returns for a customer. The full Aadhaar is never in it (spec 010 R14). */
export type CustomerResponse = {
  id: string;
  customerNo: string;
  name: string;
  mobile: string | null;
  altMobile: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  pan: string | null;
  aadhaarMasked: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

export type CustomerWarning = { code: "duplicate_mobile"; customerIds: string[] };

export type CustomerSaveResponse = { customer: CustomerResponse; warnings: CustomerWarning[] };

export type CustomerListResponse = { items: CustomerResponse[]; nextCursor: string | null };

export type CustomerHistoryEntry = {
  revisionNo: number;
  at: string;
  by: string;
  reason: string | null;
  changes: { field: CustomerField; from: string | null; to: string | null }[];
};
