import { v4 as uuidv4 } from 'uuid';
import getDb from './index';
import { AnalyticsEvent, AnalyticsEventRow } from '@/types/saas';

function rowToEvent(row: AnalyticsEventRow): AnalyticsEvent {
  return {
    ...row,
    properties: JSON.parse(row.properties || '{}'),
  };
}

export function trackAnalyticsEvent(event: Omit<AnalyticsEvent, 'id' | 'createdAt'>): void {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO analytics_events (id, userId, sessionId, eventName, properties, ipAddress, userAgent, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.userId || null,
    event.sessionId || null,
    event.eventName,
    JSON.stringify(event.properties),
    event.ipAddress || null,
    event.userAgent || null,
    now,
  );
}

export function queryAnalyticsEvents(filters: {
  eventName?: string;
  userId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}): { events: AnalyticsEvent[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.eventName) {
    conditions.push('eventName = ?');
    params.push(filters.eventName);
  }
  if (filters.userId) {
    conditions.push('userId = ?');
    params.push(filters.userId);
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
    db.prepare(`SELECT COUNT(*) as count FROM analytics_events ${where}`).get(...params) as {
      count: number;
    }
  ).count;

  const rows = db
    .prepare(`SELECT * FROM analytics_events ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as AnalyticsEventRow[];

  return { events: rows.map(rowToEvent), total };
}

export function getEventCountsByName(
  days = 7,
): { eventName: string; count: number; uniqueUsers: number }[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db
    .prepare(`
      SELECT eventName,
             COUNT(*) as count,
             COUNT(DISTINCT userId) as uniqueUsers
      FROM analytics_events
      WHERE createdAt >= ?
      GROUP BY eventName
      ORDER BY count DESC
      LIMIT 50
    `)
    .all(since) as { eventName: string; count: number; uniqueUsers: number }[];
}

export function getDailyEventCounts(
  eventName: string,
  days = 30,
): { date: string; count: number }[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db
    .prepare(`
      SELECT substr(createdAt, 1, 10) as date, COUNT(*) as count
      FROM analytics_events
      WHERE eventName = ? AND createdAt >= ?
      GROUP BY substr(createdAt, 1, 10)
      ORDER BY date ASC
    `)
    .all(eventName, since) as { date: string; count: number }[];
}
