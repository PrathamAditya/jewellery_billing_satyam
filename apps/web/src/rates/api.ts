import type {
  ApplicableRatesResponse,
  RateHistoryEntry,
  RateKind,
  RateUnit,
  RatesListResponse,
  SaveRateResponse,
} from "@jewellery/shared";
import { api } from "../api";

export const getApplicable = (date?: string) => api<ApplicableRatesResponse>(`/api/rates/applicable${date ? `?date=${date}` : ""}`);

export const listRates = (before?: string | null) =>
  api<RatesListResponse>(`/api/rates?limit=30${before ? `&before=${before}` : ""}`);

export const getRateHistory = (date: string, kind: RateKind) =>
  api<{ items: RateHistoryEntry[] }>(`/api/rates/${date}/${kind}/history`);

export const saveRate = (
  date: string,
  kind: RateKind,
  body: { price: string; unit: RateUnit; reason?: string; confirmLargeChange?: boolean },
) => api<SaveRateResponse>(`/api/rates/${date}/${kind}`, { method: "PUT", body });

/** "1 Nov 2026" for a YYYY-MM-DD business date. */
export const niceDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
