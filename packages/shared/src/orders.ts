import { z } from "zod";
import { isValidBusinessDate } from "./rates";

/** Spec 016 R1: an order collects advances. Status is open, closed or cancelled. */
export const ORDER_STATUSES = ["open", "closed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const REFUND_MODES = ["cash", "upi", "bank_transfer", "cheque"] as const;
export type RefundMode = (typeof REFUND_MODES)[number];

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const createOrderSchema = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid({ error: "Choose the customer" }),
  description: optionalText(300),
  expectedDate: z.string().refine(isValidBusinessDate, "Expected date must look like 2026-12-01").optional().nullable().transform((v) => v ?? null),
  remarks: optionalText(500),
});
export type CreateOrderRequest = z.infer<typeof createOrderSchema>;

export const cancelOrderSchema = z
  .object({
    resolution: z.enum(["transfer", "refund"], { error: "Choose transfer or refund" }),
    refundAmountPaise: z.number().int().min(1).optional(),
    refundMode: z.enum(REFUND_MODES).optional(),
    refundReference: optionalText(60),
    refundDate: z.string().refine(isValidBusinessDate, "Refund date must look like 2026-11-01").optional(),
    remarks: optionalText(300),
  })
  .refine((v) => v.resolution === "transfer" || v.refundMode !== undefined, { message: "Choose how the refund is paid", path: ["refundMode"] });
export type CancelOrderRequest = z.infer<typeof cancelOrderSchema>;

export const refundRequestSchema = z.object({
  id: z.string().uuid().optional(),
  amountPaise: z.number({ error: "Enter the refund amount" }).int().min(1, "Refund must be more than 0"),
  mode: z.enum(REFUND_MODES, { error: "Choose how the money is paid back" }),
  reference: optionalText(60),
  date: z.string().refine(isValidBusinessDate, "Date must look like 2026-11-01"),
  remarks: optionalText(300),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;

export const reverseRefundSchema = z.object({ reason: z.string().trim().min(1, "Please give a reason").max(300) });

export type OrderResponse = {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  description: string;
  expectedDate: string | null;
  status: OrderStatus;
  remarks: string | null;
  cancelResolution: string | null;
  createdAt: string;
  createdBy: string;
  /** Money still held for this order (remaining of its advances). */
  remainingPaise: number;
  advances: { id: string; receiptNo: string | null; receiptDate: string; amountPaise: number; remainingPaise: number; kind: string }[];
  refunds: { id: string; paymentId: string; receiptNo: string | null; amountPaise: number; mode: RefundMode; refundDate: string; reversed: boolean }[];
  history: { at: string; by: string; action: string }[];
};

export type OrderSummary = { id: string; orderNo: string; customerName: string; description: string; status: OrderStatus; remainingPaise: number; createdAt: string };
export type OrderListResponse = { items: OrderSummary[]; nextCursor: string | null };

export type CustomerAdvanceRow = {
  paymentId: string;
  receiptNo: string | null;
  orderNo: string | null;
  receiptDate: string;
  kind: string;
  amountPaise: number;
  remainingPaise: number;
};
