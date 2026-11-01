import type { OldGoldListResponse, OldGoldResponse } from "@jewellery/shared";
import { api } from "../api";

export const listOldGold = (q: string, cursor?: string | null) => api<OldGoldListResponse>(`/api/old-gold?q=${encodeURIComponent(q)}${cursor ? `&cursor=${cursor}` : ""}`);
export const getOldGold = (id: string) => api<OldGoldResponse>(`/api/old-gold/${id}`);
export const createOldGold = (body: Record<string, unknown>) => api<OldGoldResponse>("/api/old-gold", { method: "POST", body });
export const voidOldGold = (id: string, reason: string) => api<OldGoldResponse>(`/api/old-gold/${id}/void`, { method: "POST", body: { reason } });
export const openOrdersOf = (customerId: string) => api<{ items: { id: string; orderNo: string; status: string }[] }>(`/api/orders?customerId=${customerId}`);
