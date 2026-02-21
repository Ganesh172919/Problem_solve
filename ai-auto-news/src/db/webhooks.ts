import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import getDb from './index';
import { Webhook, WebhookRow } from '@/types/saas';

function rowToWebhook(row: WebhookRow): Webhook {
  return {
    ...row,
    events: JSON.parse(row.events || '[]'),
    isActive: row.isActive === 1,
  };
}

export function generateWebhookSecret(): string {
  return 'whsec_' + crypto.randomBytes(32).toString('hex');
}

export function createWebhook(params: {
  userId: string;
  url: string;
  events: string[];
  secret?: string;
}): Webhook {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const secret = params.secret || generateWebhookSecret();

  db.prepare(`
    INSERT INTO webhooks (id, userId, url, events, secret, isActive, deliveryCount, failureCount, lastDeliveredAt, createdAt)
    VALUES (?, ?, ?, ?, ?, 1, 0, 0, NULL, ?)
  `).run(id, params.userId, params.url, JSON.stringify(params.events), secret, now);

  return {
    id,
    userId: params.userId,
    url: params.url,
    events: params.events,
    secret,
    isActive: true,
    deliveryCount: 0,
    failureCount: 0,
    lastDeliveredAt: null,
    createdAt: now,
  };
}

export function getWebhookById(id: string): Webhook | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM webhooks WHERE id = ?')
    .get(id) as WebhookRow | undefined;
  return row ? rowToWebhook(row) : null;
}

export function getWebhooksByUserId(userId: string): Webhook[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM webhooks WHERE userId = ? ORDER BY createdAt DESC')
    .all(userId) as WebhookRow[];
  return rows.map(rowToWebhook);
}

export function getActiveWebhooksForEvent(eventName: string): Webhook[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM webhooks WHERE isActive = 1 AND (events LIKE ? OR events LIKE '%\"*\"%')")
    .all(`%"${eventName}"%`) as WebhookRow[];
  return rows.map(rowToWebhook);
}

export function updateWebhook(
  id: string,
  userId: string,
  updates: Partial<Pick<Webhook, 'url' | 'events' | 'isActive'>>,
): boolean {
  const db = getDb();
  const current = getWebhookById(id);
  if (!current || current.userId !== userId) return false;

  const updated = { ...current, ...updates };
  const result = db
    .prepare('UPDATE webhooks SET url = ?, events = ?, isActive = ? WHERE id = ?')
    .run(
      updated.url,
      JSON.stringify(updated.events),
      updated.isActive ? 1 : 0,
      id,
    );
  return result.changes > 0;
}

export function deleteWebhook(id: string, userId: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM webhooks WHERE id = ? AND userId = ?')
    .run(id, userId);
  return result.changes > 0;
}

export function recordWebhookDelivery(id: string, success: boolean): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (success) {
    db.prepare(
      'UPDATE webhooks SET deliveryCount = deliveryCount + 1, lastDeliveredAt = ? WHERE id = ?',
    ).run(now, id);
  } else {
    db.prepare('UPDATE webhooks SET failureCount = failureCount + 1 WHERE id = ?').run(id);
  }
}
