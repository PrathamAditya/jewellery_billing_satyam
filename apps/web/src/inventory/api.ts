import type {
  ReconciliationCloseResponse,
  ReconciliationDetailResponse,
  ReconciliationListResponse,
  ReconciliationReportResponse,
  BulkHistoryResponse,
  BulkItemDetailResponse,
  BulkItemListResponse,
  BulkItemSaveResponse,
  BulkMovementSaveResponse,
  InventoryHistoryResponse,
  InventoryItemListResponse,
  InventoryItemSaveResponse,
  InventoryItemType,
  InventoryStatus,
  InventoryTypesResponse,
  LocationStockResponse,
  StockLocationListResponse,
  StockLocationSaveResponse,
  StockTransferListResponse,
  StockTransferSaveResponse,
  PurchaseListResponse,
  PurchaseSaveResponse,
  RawStockResponse,
} from "@jewellery/shared";
import { newId } from "@jewellery/shared";
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
export const getBulk = (id: string) => api<BulkItemDetailResponse>(`/api/inventory/bulk/${id}`);
export const getBulkHistory = (id: string) => api<BulkHistoryResponse>(`/api/inventory/bulk/${id}/history`);
export const createBulk = (body: Record<string, unknown>) => api<BulkItemSaveResponse>("/api/inventory/bulk", { method: "POST", body });
export const recordBulkMovement = (id: string, body: Record<string, unknown>) => api<BulkMovementSaveResponse>(`/api/inventory/bulk/${id}/movements`, { method: "POST", body });

/** Spec 021b: stock locations, the stock at each place, and transfers. */
export const listLocations = () => api<StockLocationListResponse>("/api/inventory/locations");
export const createLocation = (body: { id: string; name: string }) => api<StockLocationSaveResponse>("/api/inventory/locations", { method: "POST", body });
export const updateLocation = (id: string, body: { name?: string; active?: boolean }) =>
  api<StockLocationSaveResponse>(`/api/inventory/locations/${id}`, { method: "PATCH", body });
export const getLocationStock = (id: string) => api<LocationStockResponse>(`/api/inventory/locations/${id}/stock`);
export const createTransfer = (body: Record<string, unknown>) => api<StockTransferSaveResponse>("/api/inventory/transfers", { method: "POST", body });
export const listTransfers = (query: string) => api<StockTransferListResponse>(`/api/inventory/transfers${query}`);

/** Spec 022: purchases of three types, and the raw gold and silver stock. */
export const listPurchases = (query: string) => api<PurchaseListResponse>(`/api/inventory/purchases${query}`);
export const getPurchase = (id: string) => api<PurchaseSaveResponse>(`/api/inventory/purchases/${id}`);
export const createPurchase = (body: Record<string, unknown>) => api<PurchaseSaveResponse>("/api/inventory/purchases", { method: "POST", body });
export const voidPurchase = (id: string, reason: string) => api<PurchaseSaveResponse>(`/api/inventory/purchases/${id}/void`, { method: "POST", body: { reason } });
export const getRawStock = () => api<RawStockResponse>("/api/inventory/purchases/raw-stock");

/** Spec 025: monthly stock reconciliation calls. */
export const listReconciliations = () => api<ReconciliationListResponse>("/api/inventory/reconciliations");
export const getReconciliation = (id: string) => api<ReconciliationDetailResponse>(`/api/inventory/reconciliations/${id}`);
export const getReconciliationReport = (id: string) => api<ReconciliationReportResponse>(`/api/inventory/reconciliations/${id}/report`);
export const openReconciliation = (body: { month: string; locationId: string | null }) =>
  api<ReconciliationDetailResponse>("/api/inventory/reconciliations", { method: "POST", body: { id: newId(), ...body } });
export const saveReconciliationCounts = (id: string, lines: { id: string; counted: unknown; note: string | null }[]) =>
  api<ReconciliationDetailResponse>(`/api/inventory/reconciliations/${id}/counts`, { method: "PUT", body: { lines } });
export const addReconciliationLine = (id: string, inventoryItemId: string) =>
  api<ReconciliationDetailResponse>(`/api/inventory/reconciliations/${id}/lines`, { method: "POST", body: { id: newId(), inventoryItemId } });
export const closeReconciliation = (id: string) => api<ReconciliationCloseResponse>(`/api/inventory/reconciliations/${id}/close`, { method: "POST", body: {} });
