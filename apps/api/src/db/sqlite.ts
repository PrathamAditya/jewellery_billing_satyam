import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/**
 * Spec 080: a D1-compatible database over a local SQLite file, built on Node's built-in `node:sqlite`.
 *
 * It covers exactly the D1 calls the API uses: `prepare`, `bind`, `first`, `all`, `run` and `batch`.
 * Result shapes follow D1: `first` returns the row or null, `all` and `run` return `{ success, results, meta }`,
 * and `batch` runs its statements in one transaction and returns their results in order.
 *
 * Parity rules (checked by `test/dbAdapter.test.ts` on both backends):
 * - Foreign keys are ON for every connection (D1 has them on by default). `PRAGMA foreign_keys` is set in the
 *   constructor and verified.
 * - Errors keep the SQLite message text, with the D1 wrapper: `D1_ERROR: <message>: <CODE> (extended: <CODE>)`.
 *   Trigger aborts (`RAISE(ABORT, 'exceeds_due')`) and UNIQUE violations therefore match on the same text.
 * - Booleans bind as 1 and 0, as D1 does. `undefined` and `bigint` are refused, as D1 refuses them.
 * - A wrong number of bound values is refused (`Wrong number of parameter bindings`), as D1 refuses it.
 *   The count reads `?N` and `?` placeholders in the SQL text, so a literal `?` inside a string or comment
 *   would be miscounted. The API SQL does not contain one.
 * - `run` and `batch` execute every statement in a multi-statement SQL text when the text has no bound values
 *   (migration files do). `node:sqlite` alone would silently run only the first statement.
 *   Statements with bound values must be a single SQL statement, as the API always writes them.
 * - Execution is synchronous inside the adapter. A `batch` is one unbroken block, so no other query can run
 *   between its statements. Errors surface as rejected promises, not synchronous throws, as in D1.
 *
 * Not covered (the API does not use them): `exec`, `dump`, `withSession`, `raw`, `first(column)`, blob bindings,
 * `meta.duration` and the other D1 meta fields.
 */

export type SqliteRow = Record<string, unknown>;

/** The result of `run`, `all` and each statement of `batch`: D1's shape, with the meta fields the code can read. */
export type SqliteResult<T = SqliteRow> = {
  success: true;
  results: T[];
  meta: { changes: number; last_row_id: number };
};

type Mode = "first" | "all";
type Outcome = { rows: SqliteRow[]; changes: number; lastRowId: number };

const PRIMARY_NAMES: Record<number, string> = {
  1: "SQLITE_ERROR",
  3: "SQLITE_PERM",
  5: "SQLITE_BUSY",
  6: "SQLITE_LOCKED",
  8: "SQLITE_READONLY",
  10: "SQLITE_IOERR",
  11: "SQLITE_CORRUPT",
  13: "SQLITE_FULL",
  14: "SQLITE_CANTOPEN",
  19: "SQLITE_CONSTRAINT",
  25: "SQLITE_RANGE",
};

const EXTENDED_NAMES: Record<number, string> = {
  275: "SQLITE_CONSTRAINT_CHECK",
  787: "SQLITE_CONSTRAINT_FOREIGNKEY",
  1299: "SQLITE_CONSTRAINT_NOTNULL",
  1555: "SQLITE_CONSTRAINT_PRIMARYKEY",
  1811: "SQLITE_CONSTRAINT_TRIGGER",
  2067: "SQLITE_CONSTRAINT_UNIQUE",
  2579: "SQLITE_CONSTRAINT_ROWID",
};

/** Comments before the first keyword of a statement. */
const LEADING_COMMENTS = /^(?:\s+|--[^\n]*|\/\*[\s\S]*?\*\/)*/;
const DML = /^(insert|update|delete|replace)\b/i;
const RETURNING = /\breturning\b/i;
/** Statements that return rows: SELECT, WITH, VALUES, PRAGMA, and DML with RETURNING (checked separately). */
const ROW_STATEMENT = /^(select|with|values|pragma)\b/i;

/** Wraps a node:sqlite error in D1's message format. Errors without an SQLite code pass through unchanged. */
function toD1Error(error: unknown): unknown {
  const code = error instanceof Error ? (error as Error & { errcode?: unknown }).errcode : undefined;
  if (typeof code !== "number") return error;
  const primary = PRIMARY_NAMES[code & 0xff] ?? "SQLITE_ERROR";
  const extended = EXTENDED_NAMES[code];
  const suffix = extended ? `${primary} (extended: ${extended})` : primary;
  return new Error(`D1_ERROR: ${(error as Error).message}: ${suffix}`, { cause: error });
}

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw toD1Error(error);
  }
}

/** Number of values the SQL expects: the highest `?N`, or the running count of bare `?`, as SQLite numbers them. */
function expectedParamCount(sql: string): number {
  let largest = 0;
  for (const m of sql.matchAll(/\?(\d*)/g)) {
    const index = m[1] ? Number(m[1]) : largest + 1;
    largest = Math.max(largest, index);
  }
  return largest;
}

/** Converts one bound value to what node:sqlite accepts, or refuses it as D1 does. */
function toSqlValue(value: unknown): SQLInputValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  throw new Error(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${String(value)}'`);
}

export class SqliteDatabase {
  private readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  /** `path` is a file, or ":memory:" for a throwaway database (tests). */
  constructor(path: string) {
    this.raw = guard(() => new DatabaseSync(path));
    guard(() => this.raw.exec("PRAGMA foreign_keys = ON"));
    const fk = guard(() => this.raw.prepare("PRAGMA foreign_keys").get()) as { foreign_keys: number } | undefined;
    if (fk?.foreign_keys !== 1) throw new Error("Could not turn foreign keys on for the SQLite database");
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this, sql, []);
  }

  /**
   * Runs the statements in one transaction (BEGIN IMMEDIATE ... COMMIT). Any error rolls back every statement
   * of the batch and is thrown. Results come back in order.
   */
  async batch(statements: SqliteStatement[]): Promise<SqliteResult[]> {
    for (const s of statements) {
      if (!(s instanceof SqliteStatement)) throw new TypeError("D1_ERROR: batch() takes statements made by prepare()");
    }
    if (statements.length === 0) throw new Error("D1_ERROR: No SQL statements detected.");
    // No await inside: the whole batch runs as one synchronous block.
    guard(() => this.raw.exec("BEGIN IMMEDIATE"));
    const results: SqliteResult[] = [];
    try {
      for (const s of statements) results.push(toResult(this.execute(s.sql, s.params, "all")));
      guard(() => this.raw.exec("COMMIT"));
    } catch (error) {
      if (this.raw.isTransaction) {
        try {
          this.raw.exec("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "batch failed and ROLLBACK failed too");
        }
      }
      throw error;
    }
    return results;
  }

  close(): void {
    this.statements.clear();
    this.raw.close();
  }

  /**
   * Runs one statement synchronously. Used by statements and by batch.
   * Which path runs is decided from the SQL text, not from `columns()`: SQLite reports a column for some DDL
   * (for example ALTER TABLE ... CHECK), and that would run only the first statement of a migration chunk.
   */
  execute(sql: string, params: readonly unknown[], mode: Mode | "run"): Outcome {
    const values = params.map(toSqlValue);
    const expected = expectedParamCount(sql);
    if (values.length !== expected) {
      throw new Error("D1_ERROR: Wrong number of parameter bindings for SQL query.");
    }
    const body = sql.replace(LEADING_COMMENTS, "");
    const dml = DML.test(body);
    if (ROW_STATEMENT.test(body) || (dml && RETURNING.test(body))) {
      const compiled = this.compile(sql);
      const rows = guard(() => (mode === "first" ? [compiled.get(...values)].filter(Boolean) : compiled.all(...values))) as SqliteRow[];
      return {
        rows: rows.map((r) => ({ ...r })),
        changes: dml ? this.changes() : 0,
        lastRowId: dml ? this.lastRowId() : 0,
      };
    }
    if (values.length === 0) {
      // No bound values and no rows: run every statement in the text (multi-statement migration files).
      guard(() => this.raw.exec(sql));
      return { rows: [], changes: dml ? this.changes() : 0, lastRowId: dml ? this.lastRowId() : 0 };
    }
    const info = guard(() => this.compile(sql).run(...values));
    return { rows: [], changes: Number(info.changes), lastRowId: Number(info.lastInsertRowid) };
  }

  private compile(sql: string): StatementSync {
    let compiled = this.statements.get(sql);
    if (!compiled) {
      compiled = guard(() => this.raw.prepare(sql));
      this.statements.set(sql, compiled);
    }
    return compiled;
  }

  private changes(): number {
    return Number((guard(() => this.raw.prepare("SELECT changes() AS c").get()) as { c: number }).c);
  }

  private lastRowId(): number {
    return Number((guard(() => this.raw.prepare("SELECT last_insert_rowid() AS r").get()) as { r: number }).r);
  }
}

/** A prepared statement. Immutable: `bind` returns a new statement, so one statement can be reused. */
export class SqliteStatement {
  constructor(
    private readonly database: SqliteDatabase,
    readonly sql: string,
    readonly params: readonly unknown[],
  ) {}

  /** Refuses a value D1 refuses (undefined, bigint) at once, as D1 does. */
  bind(...values: unknown[]): SqliteStatement {
    values.forEach(toSqlValue);
    return new SqliteStatement(this.database, this.sql, values);
  }

  async first<T = SqliteRow>(): Promise<T | null> {
    const { rows } = this.database.execute(this.sql, this.params, "first");
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T = SqliteRow>(): Promise<SqliteResult<T>> {
    return toResult(this.database.execute(this.sql, this.params, "all")) as SqliteResult<T>;
  }

  async run(): Promise<SqliteResult<never>> {
    return toResult(this.database.execute(this.sql, this.params, "run")) as SqliteResult<never>;
  }
}

function toResult(outcome: Outcome): SqliteResult {
  return { success: true, results: outcome.rows, meta: { changes: outcome.changes, last_row_id: outcome.lastRowId } };
}
