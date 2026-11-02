import type {
  KarigarDetailResponse,
  KarigarJobListResponse,
  KarigarJobResponse,
  KarigarListResponse,
  KarigarStatementResponse,
} from "@jewellery/shared";
import { api } from "../api";

/** Spec 023: karigar calls. Weights are whole milligrams, money whole paise. */
export const listKarigars = () => api<KarigarListResponse>("/api/karigar/karigars");
export const createKarigar = (body: { name: string; phone: string | null; remarks: string | null; id: string }) =>
  api<{ karigar: KarigarDetailResponse["karigar"] }>("/api/karigar/karigars", { method: "POST", body });
export const getKarigar = (id: string) => api<KarigarDetailResponse>(`/api/karigar/karigars/${id}`);
export const getStatement = (id: string) => api<KarigarStatementResponse>(`/api/karigar/karigars/${id}/statement`);
export const payKarigar = (id: string, body: Record<string, unknown>) =>
  api<{ karigar: KarigarDetailResponse["karigar"]; payoutId: string }>(`/api/karigar/karigars/${id}/payouts`, { method: "POST", body });
export const listJobs = (query: string) => api<KarigarJobListResponse>(`/api/karigar/jobs${query}`);
export const getJob = (id: string) => api<KarigarJobResponse>(`/api/karigar/jobs/${id}`);
export const openJob = (body: Record<string, unknown>) => api<KarigarJobResponse>("/api/karigar/jobs", { method: "POST", body });
export const addIssue = (id: string, body: Record<string, unknown>) => api<KarigarJobResponse>(`/api/karigar/jobs/${id}/issues`, { method: "POST", body });
export const recordReturn = (id: string, body: Record<string, unknown>) => api<KarigarJobResponse>(`/api/karigar/jobs/${id}/returns`, { method: "POST", body });
export const closeJob = (id: string, body: Record<string, unknown>) => api<KarigarJobResponse>(`/api/karigar/jobs/${id}/close`, { method: "POST", body });
