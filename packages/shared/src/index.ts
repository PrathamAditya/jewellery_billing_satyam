import { z } from "zod";

export { newId } from "./id";
export { indiaDate } from "./dates";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("jewellery-billing"),
  db: z.enum(["ok", "error"]),
  time: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
