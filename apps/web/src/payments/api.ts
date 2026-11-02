import type { ChequePendingResponse, PaymentListResponse, PaymentResponse, PaymentSaveResponse } from "@jewellery/shared";
import { api } from "../api";

export const listPayments = (q: string, o: { status?: string; chequeStatus?: string; cursor?: string | null; customerId?: string } = {}) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (o.status) p.set("status", o.status);
  if (o.chequeStatus) p.set("chequeStatus", o.chequeStatus);
  if (o.customerId) p.set("customerId", o.customerId);
  if (o.cursor) p.set("cursor", o.cursor);
  return api<PaymentListResponse>(`/api/payments?${p}`);
};
export const getPayment = (id: string) => api<PaymentResponse>(`/api/payments/${id}`);
export const createPayment = (body: Record<string, unknown>) => api<PaymentSaveResponse>("/api/payments", { method: "POST", body });
export const voidPayment = (id: string, reason: string) => api<PaymentResponse>(`/api/payments/${id}/void`, { method: "POST", body: { reason } });
export const reverseAllocation = (id: string, reason: string) => api<PaymentResponse>(`/api/allocations/${id}/reverse`, { method: "POST", body: { reason } });
/** Spec 019b C2: deposited, cleared or bounced (bounce needs a reason and the owner). */
export const moveCheque = (id: string, status: "deposited" | "cleared" | "bounced", reason?: string) =>
  api<PaymentResponse>(`/api/payments/${id}/cheque`, { method: "POST", body: { status, reason } });
export const pendingCheques = () => api<ChequePendingResponse>("/api/payments/cheques/pending");
