import { newId } from "@jewellery/shared";

export type AuditEntry = {
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  detail?: unknown;
};

/** Add to the same D1 batch as the change it describes (spec 001, R11). */
export function auditStatement(db: D1Database, e: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      newId(),
      new Date().toISOString(),
      e.actor,
      e.action,
      e.entity,
      e.entityId,
      e.detail === undefined ? null : JSON.stringify(e.detail),
    );
}
