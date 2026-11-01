import { z } from "zod";
import { cleanMobile, cleanPan } from "./customer";

const optional = (max: number) => z.string().trim().max(max).optional().default("");
const phone = z.string().transform((v, ctx) => { const out = cleanMobile(v); if (!out) { ctx.addIssue({ code: "custom", message: "Phone must be 10 digits" }); return z.NEVER; } return out; });
const gstin = z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN is not valid");

export const businessSettingsSchema = z.object({
  legalName: z.string().trim().min(2).max(100), tagline: optional(80).default("FINE GOLD · CRAFTED JEWELLERY"),
  addressLines: z.array(z.string().trim().max(100)).max(3).default([]), city: optional(100), state: optional(100).default("Himachal Pradesh"), stateCode: z.string().regex(/^\d{2}$/).default("02"),
  pincode: z.union([z.string().regex(/^\d{6}$/), z.literal("")]).default(""), gstin: z.union([gstin, z.literal("")]).default(""),
  pan: z.union([z.string().transform((v) => cleanPan(v) ?? ""), z.literal("")]).default(""), phones: z.array(phone).max(3).default([]), email: z.union([z.string().email(), z.literal("")]).default(""),
});
export const bankSettingsSchema = z.object({ accountName: optional(100), bankName: optional(100), accountNo: z.union([z.string().regex(/^\d{6,20}$/), z.literal("")]).default(""), ifsc: z.union([z.string().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), z.literal("")]).default(""), upiId: z.union([z.string().regex(/^[^\s@]+@[^\s@]+$/), z.literal("")]).default("") });
export const textsSettingsSchema = z.object({ invoiceTerms: z.array(z.string().trim().max(200)).max(8).default([]), declaration: optional(400), invoiceNote: optional(500).default("GST on Gold & Silver: 3% (1.5% CGST + 1.5% SGST) applied on finished ornaments under HSN 7113. Job work under HSN 9988 carries 5% GST."), settlementNote: optional(500).default("Settlement adjustments on this page are linked to the invoice above. Keep both pages together for your records."), receiptFooter: optional(300).default("Receipt acknowledges money received; it is not a tax invoice."), oldGoldSlogan: optional(200).default("OLD GOLD TODAY, A BRIGHTER TOMORROW"), copyLabels: z.array(z.string().trim().min(1).max(40)).length(2).default(["SHOP COPY", "CUSTOMER COPY"]) });
export const limitsSettingsSchema = z.object({ cashWarningPaise: z.number().int().min(0).default(20_000_000) });
export const numberingSettingsSchema = z.object({ prefixes: z.object({ INV: z.string().trim().min(1).max(12).default("INV"), PAY: z.string().trim().min(1).max(12).default("PAY"), OGP: z.string().trim().min(1).max(12).default("OGP"), ORD: z.string().trim().min(1).max(12).default("ORD"), CN: z.string().trim().min(1).max(12).default("CN") }).default({ INV: "INV", PAY: "PAY", OGP: "OGP", ORD: "ORD", CN: "CN" }), fyInNumber: z.boolean().default(false), padDigits: z.number().int().min(1).max(10).default(4) });
export const printSettingsSchema = z.object({ showBisLogo: z.boolean().default(false), showMetalLine: z.boolean().default(true) });
export const logoSettingsSchema = z.object({ mime: z.enum(["image/png", "image/jpeg", "image/svg+xml"]), dataUrl: z.string().max(410_000) }).nullable().default(null);
export const settingsSchemas = { business: businessSettingsSchema, bank: bankSettingsSchema, texts: textsSettingsSchema, limits: limitsSettingsSchema, numbering: numberingSettingsSchema, print: printSettingsSchema, logo: logoSettingsSchema } as const;
export type SettingsKey = keyof typeof settingsSchemas;
export type SettingsSnapshot = { [K in SettingsKey]: z.infer<(typeof settingsSchemas)[K]> };
export const SETTINGS_KEYS = Object.keys(settingsSchemas) as SettingsKey[];
