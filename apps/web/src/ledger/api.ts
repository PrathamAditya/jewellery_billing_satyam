import type { LedgerResponse, LedgerSummary, OutstandingRow } from "@jewellery/shared";
import { api } from "../api";

export const getLedger = (customerId: string, from?: string) => api<LedgerResponse>(`/api/customers/${customerId}/ledger${from ? `?from=${from}` : ""}`);
export const getOutstanding = (q: string, cursor?: string | null) => api<{ items: OutstandingRow[]; nextCursor: string | null }>(`/api/ledger/outstanding?q=${encodeURIComponent(q)}${cursor ? `&cursor=${cursor}` : ""}`);
export const getLedgerSummary = () => api<LedgerSummary>("/api/ledger/summary");
export const addOpeningBalance = (body: Record<string, unknown>) => api<{ id: string }>("/api/opening-balances", { method: "POST", body });
