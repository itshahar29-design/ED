import { DbClient } from '../../db/client.js';

export interface AuditEntry {
  school_id?: number | null;
  user_id?: number | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  details?: Record<string, any> | null;
  ip_address?: string | null;
}

export async function logAudit(db: DbClient, entry: AuditEntry): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_log (school_id, user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.school_id ?? null,
        entry.user_id ?? null,
        entry.action,
        entry.entity,
        entry.entity_id ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ip_address ?? null,
      ]
    );
  } catch (err) {
    console.error('Audit log yozishda xatolik:', err);
  }
}
