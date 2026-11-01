import type { CustomerAdvanceRow, OrderListResponse, OrderResponse } from "@jewellery/shared";
import { api } from "../api";

export const listOrders = (q: string, cursor?: string | null) => api<OrderListResponse>(`/api/orders?q=${encodeURIComponent(q)}${cursor ? `&cursor=${cursor}` : ""}`);
export const getOrder = (id: string) => api<OrderResponse>(`/api/orders/${id}`);
export const createOrder = (body: Record<string, unknown>) => api<OrderResponse>("/api/orders", { method: "POST", body });
export const closeOrder = (id: string) => api<OrderResponse>(`/api/orders/${id}/close`, { method: "POST" });
export const cancelOrder = (id: string, body: Record<string, unknown>) => api<OrderResponse>(`/api/orders/${id}/cancel`, { method: "POST", body });
export const customerAdvances = (customerId: string) => api<{ items: CustomerAdvanceRow[] }>(`/api/customers/${customerId}/advances`);
