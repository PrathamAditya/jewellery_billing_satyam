/** Spec 052: the response of `GET /api/integrity` (read-only data checks on the stored rows). */

/** The most problem records returned per check; `count` is always the full number. */
export const INTEGRITY_PROBLEM_LIMIT = 100;

export type IntegrityProblem = {
  /** The record id that breaks the check (an invoice, payment, customer, allocation, ...). */
  recordId: string;
  /** What kind of record it is, for the label: invoice, payment, customer, opening_balance, ... */
  kind: string;
  /** A short label shown to the owner, e.g. the invoice or receipt number. */
  label: string;
  /** One plain sentence saying what is wrong. */
  detail: string;
  /** In-app link to the record's page, or null when the record has no page. */
  link: string | null;
};

export type IntegrityCheckResult = {
  id: string;
  title: string;
  description: string;
  status: "ok" | "fail";
  count: number;
  problems: IntegrityProblem[];
  truncated: boolean;
};

export type IntegrityResponse = {
  ranAt: string;
  ok: boolean;
  passed: number;
  failed: number;
  checks: IntegrityCheckResult[];
};
