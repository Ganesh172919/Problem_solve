import { v4 as uuidv4 } from 'uuid';
import getDb from './index';
import { Subscription, SubscriptionRow, SubscriptionTier, SubscriptionStatus } from '@/types/saas';

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    ...row,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1,
  };
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function createSubscription(userId: string, tier: SubscriptionTier): Subscription {
  const db = getDb();
  const id = uuidv4();
  const now = new Date();
  const periodStart = now.toISOString();
  const periodEnd = addMonths(now, 1).toISOString();

  db.prepare(`
    INSERT INTO subscriptions (id, userId, tier, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, createdAt, updatedAt)
    VALUES (?, ?, ?, 'active', ?, ?, 0, ?, ?)
  `).run(id, userId, tier, periodStart, periodEnd, periodStart, periodStart);

  return {
    id,
    userId,
    tier,
    status: 'active',
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    createdAt: periodStart,
    updatedAt: periodStart,
  };
}

export function getSubscriptionByUserId(userId: string): Subscription | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM subscriptions WHERE userId = ? ORDER BY createdAt DESC LIMIT 1')
    .get(userId) as SubscriptionRow | undefined;
  return row ? rowToSubscription(row) : null;
}

export function getSubscriptionById(id: string): Subscription | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM subscriptions WHERE id = ?')
    .get(id) as SubscriptionRow | undefined;
  return row ? rowToSubscription(row) : null;
}

export function updateSubscriptionTier(
  subscriptionId: string,
  newTier: SubscriptionTier,
): boolean {
  const db = getDb();
  const now = new Date();
  const periodEnd = addMonths(now, 1).toISOString();
  const result = db
    .prepare(
      'UPDATE subscriptions SET tier = ?, currentPeriodStart = ?, currentPeriodEnd = ?, status = ?, cancelAtPeriodEnd = 0, updatedAt = ? WHERE id = ?',
    )
    .run(newTier, now.toISOString(), periodEnd, 'active', now.toISOString(), subscriptionId);
  return result.changes > 0;
}

export function cancelSubscription(subscriptionId: string, immediate = false): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const status: SubscriptionStatus = immediate ? 'cancelled' : 'active';
  const cancelAtPeriodEnd = immediate ? 0 : 1;
  const result = db
    .prepare(
      'UPDATE subscriptions SET status = ?, cancelAtPeriodEnd = ?, updatedAt = ? WHERE id = ?',
    )
    .run(status, cancelAtPeriodEnd, now, subscriptionId);
  return result.changes > 0;
}

export function listActiveSubscriptions(): Subscription[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM subscriptions WHERE status = 'active' ORDER BY createdAt DESC")
    .all() as SubscriptionRow[];
  return rows.map(rowToSubscription);
}

export function getSubscriptionStats(): Record<SubscriptionTier, number> {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT tier, COUNT(*) as count FROM subscriptions WHERE status = 'active' GROUP BY tier",
    )
    .all() as { tier: string; count: number }[];
  const stats: Record<SubscriptionTier, number> = { free: 0, pro: 0, enterprise: 0 };
  for (const row of rows) {
    stats[row.tier as SubscriptionTier] = row.count;
  }
  return stats;
}
