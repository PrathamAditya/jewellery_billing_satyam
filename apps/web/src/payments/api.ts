import type { PaymentListResponse, PaymentResponse, PaymentSaveResponse } from "@jewellery/shared";
import { api } from "../api";

export const listPayments = (q: string, o: { status?: string; cursor?: string | null; customerId?: string } = {}) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (o.status) p.set("status", o.status);
  if (o.customerId) p.set("customerId", o.customerId);
  if (o.cursor) p.set("cursor", o.cursor);
  return api<PaymentListResponse>(`/api/payments?${p}`);
};
export const getPayment = (id: string) => api<PaymentResponse>(`/api/payments/${id}`);
export const createPayment = (body: Record<string, unknown>) => api<PaymentSaveResponse>("/api/payments", { method: "POST", body });
export const voidPayment = (id: string, reason: string) => api<PaymentResponse>(`/api/payments/${id}/void`, { method: "POST", body: { reason } });
export const reverseAllocation = (id: string, reason: string) => api<PaymentResponse>(`/api/allocations/${id}/reverse`, { method: "POST", body: { reason } });
