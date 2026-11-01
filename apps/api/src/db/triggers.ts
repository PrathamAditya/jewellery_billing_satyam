/**
 * SQL for the "no hard deletes" trigger (spec 001, R9). Every business table gets one,
 * in the migration that creates the table. Generate it here and paste it into the
 * migration (use `npm run db:generate -- --custom --name=<table>_no_delete`).
 */
export function noDeleteTriggerSql(table: string): string {
  return `CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} rows are voided, never deleted');
END;`;
}
