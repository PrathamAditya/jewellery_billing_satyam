import type { CreditNoteDetail, CreditNoteListResponse, RefundMode } from "@jewellery/shared";
import { api } from "../api";

/** Spec 019d: credit note calls. Money is always integer paise. */
export const listCreditNotes = (query: string) => api<CreditNoteListResponse>(`/api/credit-notes${query}`);
export const getCreditNote = (id: string) => api<CreditNoteDetail>(`/api/credit-notes/${id}`);
export const createCreditNote = (body: Record<string, unknown>) => api<CreditNoteDetail>("/api/credit-notes", { method: "POST", body });
export const applyCreditNote = (id: string, invoiceId: string, amountPaise: number) =>
  api<CreditNoteDetail>(`/api/credit-notes/${id}/apply`, { method: "POST", body: { invoiceId, amountPaise } });
export const payOutCreditNote = (id: string, body: { amountPaise: number; mode: RefundMode; reference: string | null; paidDate: string; remarks: string | null }) =>
  api<CreditNoteDetail>(`/api/credit-notes/${id}/payouts`, { method: "POST", body });
export const voidCreditNote = (id: string, reason: string) => api<CreditNoteDetail>(`/api/credit-notes/${id}/void`, { method: "POST", body: { reason } });
export const reverseApplication = (id: string, reason: string) => api(`/api/credit-notes/applications/${id}/reverse`, { method: "POST", body: { reason } });
export const reversePayout = (id: string, reason: string) => api<CreditNoteDetail>(`/api/credit-notes/payouts/${id}/reverse`, { method: "POST", body: { reason } });
