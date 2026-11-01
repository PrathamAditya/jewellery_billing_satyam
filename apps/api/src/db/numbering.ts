import { NUMBER_SERIES, financialYearOf, formatDocumentNumber } from "@jewellery/calc";
import type { NumberSeries } from "@jewellery/calc";
import { formatCustomerNumber } from "@jewellery/shared";

export type { NumberSeries };

/**
 * Statement that bumps the counter and returns it (RETURNING last_no). Put it in the same
 * D1 batch as the insert that uses the number, so a failed save does not consume a number.
 */
export function allocateNumberStatement(
  db: D1Database,
  series: NumberSeries,
  businessDate: string,
): D1PreparedStatement {
  if (!NUMBER_SERIES.includes(series)) throw new RangeError(`Unknown number series: ${series}`);
  const fy = financialYearOf(businessDate);
  return db
    .prepare(
      `INSERT INTO number_series (series, fy, last_no) VALUES (?1, ?2, 1)
       ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1
       RETURNING last_no`,
    )
    .bind(series, fy);
}

/** Allocates one number on its own, e.g. "INV/2026-27/0001". */
export async function allocateNumber(
  db: D1Database,
  series: NumberSeries,
  businessDate: string,
): Promise<string> {
  const row = await allocateNumberStatement(db, series, businessDate).first<{ last_no: number }>();
  if (!row) throw new Error("Number allocation returned no row");
  return formatDocumentNumber(series, financialYearOf(businessDate), row.last_no);
}

/** Spec 010 R2: customer numbers are one never-resetting series, stored under this fixed `fy` value. */
export const CUSTOMER_SERIES = "C";
export const CUSTOMER_SERIES_FY = "all";

/** Bumps the customer counter. Same batch as the insert, so a failed save does not use up a number. */
export function allocateCustomerNumberStatement(db: D1Database): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO number_series (series, fy, last_no) VALUES (?1, ?2, 1)
       ON CONFLICT (series, fy) DO UPDATE SET last_no = last_no + 1
       RETURNING last_no`,
    )
    .bind(CUSTOMER_SERIES, CUSTOMER_SERIES_FY);
}

/** SQL expression for the number just allocated by the statement above, e.g. 'C-0001'. Use inside the insert. */
export const CURRENT_CUSTOMER_NO_SQL = `('C' || printf('%04d', (SELECT last_no FROM number_series WHERE series = 'C' AND fy = 'all')))`;

/** Allocates one customer number on its own, e.g. "C-0001". */
export async function allocateCustomerNumber(db: D1Database): Promise<string> {
  const row = await allocateCustomerNumberStatement(db).first<{ last_no: number }>();
  if (!row) throw new Error("Number allocation returned no row");
  return formatCustomerNumber(row.last_no);
}
