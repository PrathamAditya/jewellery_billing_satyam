import { z } from "zod";

export { newId } from "./id";
export { financialYearRange, indiaDate } from "./dates";
export * from "./customer";
export * from "./rates";
export * from "./weight";
export * from "./pricing";
export * from "./invoice";
export * from "./permissions";
export * from "./words";
export * from "./payments";
export * from "./orders";
export * from "./oldGold";
export * from "./settlement";
export * from "./ledger";
export * from "./print";
export * from "./settings";
export * from "./inventory";
export * from "./bulkItems";
export * from "./purchases";
export * from "./integrity";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("jewellery-billing"),
  db: z.enum(["ok", "error"]),
  time: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Spec 002 R2: minimum length for a new password. Nothing else is enforced. */
export const MIN_PASSWORD_LENGTH = 10;
/** Upper bound so a huge body is rejected early. */
export const MAX_PASSWORD_LENGTH = 256;

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** What the API returns about the logged-in user. Never includes the hash. */
export const userResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
  mustChangePassword: z.boolean(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;
export * from "./creditNotes";
export * from "./dashboard";
export * from "./reports";
export * from "./audit";
export * from "./cashClosing";
