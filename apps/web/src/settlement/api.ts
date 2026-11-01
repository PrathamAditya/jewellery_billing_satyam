import type { SettlementResponse } from "@jewellery/shared";
import { api } from "../api";

export const getSettlement = (invoiceId: string) => api<SettlementResponse>(`/api/invoices/${invoiceId}/settlement`);
export const saveSettlementRemarks = (invoiceId: string, remarks: string | null) =>
  api<SettlementResponse>(`/api/invoices/${invoiceId}/settlement`, { method: "PUT", body: { remarks } });
export const useAdvances = (invoiceId: string, allocations: { paymentId: string; amountPaise: number }[]) =>
  api<SettlementResponse>(`/api/invoices/${invoiceId}/advance-allocations`, { method: "POST", body: { allocations } });
export const customerAdvanceList = (customerId: string) =>
  api<{ items: { paymentId: string; receiptNo: string | null; orderNo: string | null; receiptDate: string; kind: string; amountPaise: number; remainingPaise: number }[] }>(`/api/customers/${customerId}/advances`);
