import { v4 as uuidv4 } from 'uuid';
import getDb from './index';
import { Task, TaskRow, TaskStatus } from '@/types/saas';

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    payload: JSON.parse(row.payload || '{}'),
  };
}

export function enqueueTask(
  type: string,
  payload: Record<string, unknown>,
  scheduledAt?: string,
  maxAttempts = 3,
): Task {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const runAt = scheduledAt || now;

  db.prepare(`
    INSERT INTO tasks (id, type, payload, status, attempts, maxAttempts, error, createdAt, updatedAt, scheduledAt)
    VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, ?, ?)
  `).run(id, type, JSON.stringify(payload), maxAttempts, now, now, runAt);

  return {
    id,
    type,
    payload,
    status: 'pending',
    attempts: 0,
    maxAttempts,
    error: null,
    createdAt: now,
    updatedAt: now,
    scheduledAt: runAt,
  };
}

export function claimNextTask(): Task | null {
  const db = getDb();
  const now = new Date().toISOString();

  const row = db
    .prepare(`
      SELECT * FROM tasks
      WHERE status = 'pending' AND scheduledAt <= ?
      ORDER BY scheduledAt ASC, createdAt ASC
      LIMIT 1
    `)
    .get(now) as TaskRow | undefined;

  if (!row) return null;

  const result = db
    .prepare(`
      UPDATE tasks SET status = 'running', attempts = attempts + 1, updatedAt = ?
      WHERE id = ? AND status = 'pending'
    `)
    .run(now, row.id);

  if (result.changes === 0) return null;

  return rowToTask({ ...row, status: 'running', attempts: row.attempts + 1, updatedAt: now });
}

export function completeTask(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status = 'completed', updatedAt = ? WHERE id = ?").run(now, id);
}

export function failTask(id: string, error: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  if (!task) return;

  const newStatus: TaskStatus =
    task.attempts >= task.maxAttempts ? 'failed' : 'pending';

  const backoffSeconds = Math.pow(2, task.attempts) * 30;
  const nextRun = new Date(Date.now() + backoffSeconds * 1000).toISOString();

  db.prepare(`
    UPDATE tasks SET status = ?, error = ?, updatedAt = ?, scheduledAt = ? WHERE id = ?
  `).run(newStatus, error, now, newStatus === 'pending' ? nextRun : now, id);
}

export function getTaskById(id: string): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function getPendingTaskCount(): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'")
    .get() as { count: number };
  return row.count;
}

export function getTaskStats(): Record<TaskStatus, number> {
  const db = getDb();
  const rows = db
    .prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status')
    .all() as { status: string; count: number }[];
  const stats: Record<TaskStatus, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const row of rows) {
    stats[row.status as TaskStatus] = row.count;
  }
  return stats;
}

export function requeueStuckTasks(olderThanMinutes = 10): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const now = new Date().toISOString();
  const result = db
    .prepare(`
      UPDATE tasks SET status = 'pending', updatedAt = ?
      WHERE status = 'running' AND updatedAt < ?
    `)
    .run(now, cutoff);
  return result.changes;
}
