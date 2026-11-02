import type { AuditListResponse, AuditOptionsResponse } from "@jewellery/shared";
import { api } from "../api";

export type AuditFilters = { from: string; to: string; actor: string; entity: string; action: string };

export const listAudit = (f: AuditFilters, cursor: string | null) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (cursor) p.set("cursor", cursor);
  return api<AuditListResponse>(`/api/audit?${p}`);
};
export const auditOptions = () => api<AuditOptionsResponse>("/api/audit/options");
