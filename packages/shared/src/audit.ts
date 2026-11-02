import { z } from "zod";
import { isValidBusinessDate } from "./rates";

/** Spec 051: the audit history viewer. Read-only. Rows are listed newest first in pages of 20. */

export const auditFilterSchema = z.object({
  from: z.string().refine(isValidBusinessDate, "Date must look like 2026-11-01").optional(),
  to: z.string().refine(isValidBusinessDate, "Date must look like 2026-11-01").optional(),
  actor: z.string().trim().max(64).optional(),
  entity: z.string().trim().max(64).optional(),
  action: z.string().trim().max(64).optional(),
});

export type AuditRowResponse = {
  id: string;
  /** When it happened, ISO UTC. The screen shows it in India time. */
  at: string;
  /** The user id (or "anonymous" for a failed login). */
  actor: string;
  /** The person's display name, or a plain label when there is no user. */
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  /** The stored JSON detail, parsed. Null when the change had none. */
  detail: unknown;
};

export type AuditListResponse = {
  items: AuditRowResponse[];
  /** Pass as `cursor` to get the next page. Null on the last page. */
  nextCursor: string | null;
};

/** The choices for the filter boxes: every entity, action and actor that appears in the log. */
export type AuditOptionsResponse = {
  entities: string[];
  actions: string[];
  actors: { id: string; label: string }[];
};
