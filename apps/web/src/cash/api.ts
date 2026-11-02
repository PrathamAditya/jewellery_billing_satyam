import type { CashClosingDayResponse, CashClosingListResponse, CashClosingSaveResponse, CashNoteSaveResponse } from "@jewellery/shared";
import { api } from "../api";

export const getCashDay = (date: string) => api<CashClosingDayResponse>(`/api/cash-closing?date=${date}`);
export const listCashClosings = (cursor: string | null = null) => api<CashClosingListResponse>(`/api/cash-closing/list${cursor ? `?cursor=${cursor}` : ""}`);
export const closeCashDay = (body: Record<string, unknown>) => api<CashClosingSaveResponse>("/api/cash-closing", { method: "POST", body });
export const addCashNote = (date: string, note: string) => api<CashNoteSaveResponse>(`/api/cash-closing/${date}/notes`, { method: "POST", body: { note } });
