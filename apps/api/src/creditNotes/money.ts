/**
 * Spec 019d R16: money on an invoice and on a credit note. Written once here so every screen,
 * list, ledger line and payment check reads the same figures.
 */

/** Live credit applications on an invoice (they count as settled money, R16). */
export async function creditAppliedOn(db: D1Database, invoiceId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM credit_applications WHERE invoice_id = ?1 AND reversed_at IS NULL")
    .bind(invoiceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Live payment allocations plus live credit applications: everything settled on an invoice (spec 015 M4, 019d R16). */
export async function settledOn(db: D1Database, invoiceId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE((SELECT SUM(amount_paise) FROM payment_allocations WHERE invoice_id = ?1 AND reversed_at IS NULL), 0)
            + COALESCE((SELECT SUM(amount_paise) FROM credit_applications WHERE invoice_id = ?1 AND reversed_at IS NULL), 0) AS n`,
    )
    .bind(invoiceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** What is still due on an invoice (never below 0). */
export async function balanceDueOn(db: D1Database, invoiceId: string): Promise<number> {
  const row = await db.prepare("SELECT payable_paise FROM invoices WHERE id = ?1").bind(invoiceId).first<{ payable_paise: number }>();
  if (!row) return 0;
  return Math.max(0, row.payable_paise - (await settledOn(db, invoiceId)));
}

/** Sum of the live credit notes on an invoice: the bill's creditable room is payable minus this (R4). */
export async function liveCreditTotalOn(db: D1Database, invoiceId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS n FROM credit_notes WHERE invoice_id = ?1 AND voided_at IS NULL")
    .bind(invoiceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Credit a credit note still holds: amount minus live applications minus live payouts (R10). Voided notes and old gold notes hold nothing (R9). */
export const HELD_SQL = `CASE WHEN c.voided_at IS NULL AND c.kind <> 'old_gold' THEN c.amount_paise
  - COALESCE((SELECT SUM(x.amount_paise) FROM credit_applications x WHERE x.credit_note_id = c.id AND x.reversed_at IS NULL), 0)
  - COALESCE((SELECT SUM(p.amount_paise) FROM credit_note_payouts p WHERE p.credit_note_id = c.id AND p.reversed_at IS NULL), 0)
  ELSE 0 END`;

/** Taxable value already returned on one invoice line by live credit notes (R2). */
export async function returnedTaxableOnLine(db: D1Database, invoiceId: string, revisionNo: number, lineNo: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(l.taxable_paise), 0) AS n FROM credit_note_lines l JOIN credit_notes c ON c.id = l.credit_note_id
       WHERE c.invoice_id = ?1 AND c.invoice_revision_no = ?2 AND l.invoice_line_no = ?3 AND c.voided_at IS NULL`,
    )
    .bind(invoiceId, revisionNo, lineNo)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
