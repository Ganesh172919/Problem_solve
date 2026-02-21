import { v4 as uuidv4 } from 'uuid';
import getDb from './index';

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorType: 'user' | 'admin' | 'system' | 'api_key';
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AuditLogRow extends Omit<AuditLogEntry, 'details'> {
  details: string;
}

function rowToEntry(row: AuditLogRow): AuditLogEntry {
  return {
    ...row,
    details: JSON.parse(row.details || '{}'),
  };
}

export const AuditAction = {
  // User actions
  USER_CREATED: 'user.created',
  USER_DEACTIVATED: 'user.deactivated',
  USER_VERIFIED: 'user.verified',
  USER_LOGIN: 'user.login',
  USER_LOGIN_FAILED: 'user.login_failed',
  USER_TIER_CHANGED: 'user.tier_changed',
  // Post actions
  POST_CREATED: 'post.created',
  POST_DELETED: 'post.deleted',
  // API key actions
  API_KEY_CREATED: 'api_key.created',
  API_KEY_REVOKED: 'api_key.revoked',
  // Subscription actions
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  SUBSCRIPTION_UPGRADED: 'subscription.upgraded',
  // Feature flag actions
  FEATURE_FLAG_CREATED: 'feature_flag.created',
  FEATURE_FLAG_UPDATED: 'feature_flag.updated',
  FEATURE_FLAG_DELETED: 'feature_flag.deleted',
  // Webhook actions
  WEBHOOK_CREATED: 'webhook.created',
  WEBHOOK_DELETED: 'webhook.deleted',
  // Scheduler actions
  SCHEDULER_STARTED: 'scheduler.started',
  SCHEDULER_STOPPED: 'scheduler.stopped',
  // Content generation
  GENERATION_TRIGGERED: 'generation.triggered',
  GENERATION_COMPLETED: 'generation.completed',
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];

export function writeAuditLog(params: {
  actorId?: string | null;
  actorType?: AuditLogEntry['actorType'];
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}): void {
  try {
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO audit_log (id, actorId, actorType, action, resourceType, resourceId, details, ipAddress, userAgent, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.actorId || null,
      params.actorType || 'system',
      params.action,
      params.resourceType,
      params.resourceId || null,
      JSON.stringify(params.details || {}),
      params.ipAddress || null,
      params.userAgent || null,
      now,
    );
  } catch {
    // Audit log failures must never crash the application
  }
}

export function queryAuditLog(filters: {
  actorId?: string;
  action?: string;
  resourceType?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}): { entries: AuditLogEntry[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.actorId) {
    conditions.push('actorId = ?');
    params.push(filters.actorId);
  }
  if (filters.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }
  if (filters.resourceType) {
    conditions.push('resourceType = ?');
    params.push(filters.resourceType);
  }
  if (filters.since) {
    conditions.push('createdAt >= ?');
    params.push(filters.since);
  }
  if (filters.until) {
    conditions.push('createdAt <= ?');
    params.push(filters.until);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params) as { count: number }
  ).count;

  const rows = db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as AuditLogRow[];

  return { entries: rows.map(rowToEntry), total };
}

export function getRecentAuditEntries(limit = 100): AuditLogEntry[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT ?')
    .all(limit) as AuditLogRow[];
  return rows.map(rowToEntry);
}

export function purgeOldAuditLogs(olderThanDays = 90): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const result = db.prepare('DELETE FROM audit_log WHERE createdAt < ?').run(cutoff);
  return result.changes;
}
