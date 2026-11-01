import type { InvoiceHistoryEntry, InvoiceListResponse, InvoiceResponse } from "@jewellery/shared";
import { api } from "../api";

export const searchInvoices = (q: string, o: { status?: string; from?: string; to?: string; cursor?: string | null; customerId?: string } = {}) => {
  const p = new URLSearchParams({ q });
  if (o.customerId) p.set("customerId", o.customerId);
  if (o.status) p.set("status", o.status);
  if (o.from) p.set("from", o.from);
  if (o.to) p.set("to", o.to);
  if (o.cursor) p.set("cursor", o.cursor);
  return api<InvoiceListResponse>(`/api/invoices?${p}`);
};
export const getInvoice = (id: string, revision?: number) => api<InvoiceResponse>(`/api/invoices/${id}${revision ? `?revision=${revision}` : ""}`);
export const getInvoiceHistory = (id: string) => api<{ items: InvoiceHistoryEntry[] }>(`/api/invoices/${id}/history`);
export const createInvoice = (body: Record<string, unknown>) => api<InvoiceResponse>("/api/invoices", { method: "POST", body });
export const updateInvoice = (id: string, body: Record<string, unknown>) => api<InvoiceResponse>(`/api/invoices/${id}`, { method: "PUT", body });
export const voidInvoice = (id: string, reason: string) => api<InvoiceResponse>(`/api/invoices/${id}/void`, { method: "POST", body: { reason } });
