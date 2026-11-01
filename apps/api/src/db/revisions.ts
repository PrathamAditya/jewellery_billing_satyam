export type RevisionEntry = {
  entity: string;
  entityId: string;
  /** The record as it was before this edit. */
  snapshot: unknown;
  reason?: string;
  actor: string;
};

/**
 * Stores the previous version of a record as the next revision (spec 001, R10).
 * The number is computed inside the statement, so it is safe in a D1 batch.
 */
export function revisionStatement(db: D1Database, r: RevisionEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO record_revisions
         (entity, entity_id, revision_no, snapshot_json, reason, created_at, created_by)
       VALUES (?1, ?2,
         (SELECT COALESCE(MAX(revision_no), 0) + 1 FROM record_revisions WHERE entity = ?1 AND entity_id = ?2),
         ?3, ?4, ?5, ?6)`,
    )
    .bind(
      r.entity,
      r.entityId,
      JSON.stringify(r.snapshot),
      r.reason ?? null,
      new Date().toISOString(),
      r.actor,
    );
}
