import { v4 as uuidv4 } from 'uuid';
import getDb from './index';

export interface CustomTopic {
  id: string;
  userId: string;
  topic: string;
  isActive: boolean;
  weight: number;
  lastUsedAt: string | null;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CustomTopicRow extends Omit<CustomTopic, 'isActive'> {
  isActive: number;
}

function rowToTopic(row: CustomTopicRow): CustomTopic {
  return {
    ...row,
    isActive: row.isActive === 1,
  };
}

export function createCustomTopic(userId: string, topic: string, weight = 1): CustomTopic {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const trimmed = topic.trim().substring(0, 200);

  db.prepare(`
    INSERT INTO custom_topics (id, userId, topic, isActive, weight, lastUsedAt, useCount, createdAt, updatedAt)
    VALUES (?, ?, ?, 1, ?, NULL, 0, ?, ?)
  `).run(id, userId, trimmed, weight, now, now);

  return {
    id,
    userId,
    topic: trimmed,
    isActive: true,
    weight,
    lastUsedAt: null,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function getCustomTopicsByUserId(userId: string): CustomTopic[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM custom_topics WHERE userId = ? ORDER BY weight DESC, createdAt ASC')
    .all(userId) as CustomTopicRow[];
  return rows.map(rowToTopic);
}

export function getActiveCustomTopicsByUserId(userId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT topic FROM custom_topics WHERE userId = ? AND isActive = 1 ORDER BY weight DESC, CASE WHEN lastUsedAt IS NULL THEN 0 ELSE 1 END ASC, lastUsedAt ASC',
    )
    .all(userId) as { topic: string }[];
  return rows.map((r) => r.topic);
}

export function updateCustomTopic(
  id: string,
  userId: string,
  updates: Partial<Pick<CustomTopic, 'topic' | 'isActive' | 'weight'>>,
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const current = db
    .prepare('SELECT * FROM custom_topics WHERE id = ? AND userId = ?')
    .get(id, userId) as CustomTopicRow | undefined;

  if (!current) return false;

  const topic = updates.topic !== undefined ? updates.topic.trim().substring(0, 200) : current.topic;
  const isActive = updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : current.isActive;
  const weight = updates.weight !== undefined ? updates.weight : current.weight;

  const result = db
    .prepare('UPDATE custom_topics SET topic = ?, isActive = ?, weight = ?, updatedAt = ? WHERE id = ? AND userId = ?')
    .run(topic, isActive, weight, now, id, userId);

  return result.changes > 0;
}

export function deleteCustomTopic(id: string, userId: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM custom_topics WHERE id = ? AND userId = ?')
    .run(id, userId);
  return result.changes > 0;
}

export function recordTopicUsed(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE custom_topics SET useCount = useCount + 1, lastUsedAt = ?, updatedAt = ? WHERE id = ?')
    .run(now, now, id);
}

export function getTopicCount(userId: string): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) as count FROM custom_topics WHERE userId = ?')
    .get(userId) as { count: number };
  return row.count;
}
