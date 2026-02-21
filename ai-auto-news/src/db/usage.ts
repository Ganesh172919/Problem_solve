import { v4 as uuidv4 } from 'uuid';
import getDb from './index';
import { UsageEvent, SubscriptionTier } from '@/types/saas';

type UsageTier = SubscriptionTier | 'admin' | 'public';

export function trackUsageEvent(event: Omit<UsageEvent, 'id' | 'createdAt'>): void {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO usage_events (id, userId, apiKeyId, endpoint, method, statusCode, durationMs, tokensUsed, tier, ipAddress, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.userId || null,
    event.apiKeyId || null,
    event.endpoint,
    event.method,
    event.statusCode,
    event.durationMs,
    event.tokensUsed,
    event.tier,
    event.ipAddress,
    now,
  );
}

export function getDailyUsageForUser(userId: string, date: string): number {
  const db = getDb();
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;
  const row = db
    .prepare(
      'SELECT COUNT(*) as count FROM usage_events WHERE userId = ? AND createdAt >= ? AND createdAt <= ?',
    )
    .get(userId, dayStart, dayEnd) as { count: number };
  return row.count;
}

export function getMinuteUsageForUser(userId: string): number {
  const db = getDb();
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const row = db
    .prepare(
      'SELECT COUNT(*) as count FROM usage_events WHERE userId = ? AND createdAt >= ?',
    )
    .get(userId, oneMinuteAgo) as { count: number };
  return row.count;
}

export function getMinuteUsageForApiKey(apiKeyId: string): number {
  const db = getDb();
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const row = db
    .prepare(
      'SELECT COUNT(*) as count FROM usage_events WHERE apiKeyId = ? AND createdAt >= ?',
    )
    .get(apiKeyId, oneMinuteAgo) as { count: number };
  return row.count;
}

export function getUsageReport(
  userId: string,
  days = 30,
): { date: string; calls: number; tokens: number }[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = db
    .prepare(`
      SELECT substr(createdAt, 1, 10) as date,
             COUNT(*) as calls,
             SUM(tokensUsed) as tokens
      FROM usage_events
      WHERE userId = ? AND createdAt >= ?
      GROUP BY substr(createdAt, 1, 10)
      ORDER BY date ASC
    `)
    .all(userId, since) as { date: string; calls: number; tokens: number }[];
  return rows;
}

export function getSystemUsageSummary(days = 7): {
  totalCalls: number;
  totalTokens: number;
  callsByTier: Record<UsageTier, number>;
  avgLatencyMs: number;
  errorRate: number;
} {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const summary = db
    .prepare(`
      SELECT COUNT(*) as totalCalls,
             SUM(tokensUsed) as totalTokens,
             AVG(durationMs) as avgLatencyMs,
             SUM(CASE WHEN statusCode >= 400 THEN 1 ELSE 0 END) as errorCount
      FROM usage_events
      WHERE createdAt >= ?
    `)
    .get(since) as {
    totalCalls: number;
    totalTokens: number;
    avgLatencyMs: number;
    errorCount: number;
  };

  const tierRows = db
    .prepare(
      'SELECT tier, COUNT(*) as count FROM usage_events WHERE createdAt >= ? GROUP BY tier',
    )
    .all(since) as { tier: string; count: number }[];

  const callsByTier: Record<UsageTier, number> = {
    free: 0,
    pro: 0,
    enterprise: 0,
    admin: 0,
    public: 0,
  };
  for (const row of tierRows) {
    callsByTier[row.tier as UsageTier] = row.count;
  }

  const total = summary.totalCalls || 0;
  const errors = summary.errorCount || 0;

  return {
    totalCalls: total,
    totalTokens: summary.totalTokens || 0,
    callsByTier,
    avgLatencyMs: Math.round(summary.avgLatencyMs || 0),
    errorRate: total > 0 ? parseFloat(((errors / total) * 100).toFixed(2)) : 0,
  };
}

export function getTopEndpoints(
  limit = 10,
  days = 7,
): { endpoint: string; method: string; count: number; avgMs: number }[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db
    .prepare(`
      SELECT endpoint, method, COUNT(*) as count, AVG(durationMs) as avgMs
      FROM usage_events
      WHERE createdAt >= ?
      GROUP BY endpoint, method
      ORDER BY count DESC
      LIMIT ?
    `)
    .all(since, limit) as { endpoint: string; method: string; count: number; avgMs: number }[];
}
