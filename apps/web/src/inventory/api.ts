import type {
  BulkHistoryResponse,
  BulkItemListResponse,
  BulkItemSaveResponse,
  BulkMovementSaveResponse,
  InventoryHistoryResponse,
  InventoryItemListResponse,
  InventoryItemSaveResponse,
  InventoryItemType,
  InventoryStatus,
  InventoryTypesResponse,
} from "@jewellery/shared";
import { api } from "../api";

/** Spec 020: inventory calls. Weights are whole milligrams. */
export const listItems = (query: string) => api<InventoryItemListResponse>(`/api/inventory/items${query}`);
export const getItem = (id: string) => api<InventoryItemSaveResponse>(`/api/inventory/items/${id}`);
export const getItemHistory = (id: string) => api<InventoryHistoryResponse>(`/api/inventory/items/${id}/history`);
export const createItem = (body: Record<string, unknown>) => api<InventoryItemSaveResponse>("/api/inventory/items", { method: "POST", body });
export const changeItemStatus = (id: string, status: InventoryStatus, reason: string) =>
  api<InventoryItemSaveResponse>(`/api/inventory/items/${id}/status`, { method: "POST", body: { status, reason } });
export const voidItem = (id: string, reason: string) => api<InventoryItemSaveResponse>(`/api/inventory/items/${id}/void`, { method: "POST", body: { reason } });
export const listTypes = () => api<InventoryTypesResponse>("/api/inventory/types");
export const createType = (name: string, itemCode: string) => api<InventoryItemType>("/api/inventory/types", { method: "POST", body: { name, itemCode } });
export const updateType = (id: string, body: { name?: string; active?: boolean }) => api<InventoryItemType>(`/api/inventory/types/${id}`, { method: "PATCH", body });

/** Spec 020b: bulk quantity item calls. */
export const listBulk = (query: string) => api<BulkItemListResponse>(`/api/inventory/bulk${query}`);
export const getBulk = (id: string) => api<BulkItemSaveResponse>(`/api/inventory/bulk/${id}`);
export const getBulkHistory = (id: string) => api<BulkHistoryResponse>(`/api/inventory/bulk/${id}/history`);
export const createBulk = (body: Record<string, unknown>) => api<BulkItemSaveResponse>("/api/inventory/bulk", { method: "POST", body });
export const recordBulkMovement = (id: string, body: Record<string, unknown>) => api<BulkMovementSaveResponse>(`/api/inventory/bulk/${id}/movements`, { method: "POST", body });
