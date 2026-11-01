import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("jewlray-billing"),
  time: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
