import { NUMBER_SERIES, financialYearOf, formatDocumentNumber } from "@jewellery/calc";
import type { NumberSeries } from "@jewellery/calc";

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
