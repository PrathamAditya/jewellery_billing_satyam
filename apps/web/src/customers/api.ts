import type {
  CustomerHistoryEntry,
  CustomerListResponse,
  CustomerResponse,
  CustomerSaveResponse,
} from "@jewellery/shared";
import { api } from "../api";

export const searchCustomers = (q: string, opts: { cursor?: string | null; includeVoided?: boolean } = {}) => {
  const p = new URLSearchParams({ q });
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.includeVoided) p.set("includeVoided", "1");
  return api<CustomerListResponse>(`/api/customers?${p}`);
};

export const getCustomer = (id: string) => api<CustomerResponse>(`/api/customers/${id}`);
export const getHistory = (id: string) => api<{ items: CustomerHistoryEntry[] }>(`/api/customers/${id}/history`);
export const createCustomer = (body: Record<string, unknown>) =>
  api<CustomerSaveResponse>("/api/customers", { method: "POST", body });
export const updateCustomer = (id: string, body: Record<string, unknown>) =>
  api<CustomerSaveResponse>(`/api/customers/${id}`, { method: "PATCH", body });
export const voidCustomer = (id: string, reason: string) =>
  api<CustomerResponse>(`/api/customers/${id}/void`, { method: "POST", body: { reason } });
export const restoreCustomer = (id: string) => api<CustomerResponse>(`/api/customers/${id}/restore`, { method: "POST" });
export const revealAadhaar = (id: string) => api<{ aadhaar: string }>(`/api/customers/${id}/aadhaar/reveal`, { method: "POST" });
