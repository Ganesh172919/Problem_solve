import { v4 as uuidv4 } from 'uuid';
import getDb from './index';
import { User, UserRow, SubscriptionTier } from '@/types/saas';

function rowToUser(row: UserRow): User {
  return {
    ...row,
    isActive: row.isActive === 1,
    isVerified: row.isVerified === 1,
  };
}

export function createUser(params: {
  email: string;
  username: string;
  passwordHash: string;
  tier?: SubscriptionTier;
}): User {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const tier: SubscriptionTier = params.tier || 'free';

  db.prepare(`
    INSERT INTO users (id, email, username, passwordHash, tier, apiCallsTotal, createdAt, updatedAt, lastActiveAt, isActive, isVerified)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, 1, 0)
  `).run(id, params.email.toLowerCase().trim(), params.username.trim(), params.passwordHash, tier, now, now);

  return {
    id,
    email: params.email.toLowerCase().trim(),
    username: params.username.trim(),
    passwordHash: params.passwordHash,
    tier,
    apiCallsTotal: 0,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: null,
    isActive: true,
    isVerified: false,
  };
}

export function getUserById(id: string): User | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByEmail(email: string): User | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.toLowerCase().trim()) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByUsername(username: string): User | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username.trim()) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function updateUserTier(userId: string, tier: SubscriptionTier): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE users SET tier = ?, updatedAt = ? WHERE id = ?')
    .run(tier, now, userId);
  return result.changes > 0;
}

export function updateUserLastActive(userId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET lastActiveAt = ?, updatedAt = ? WHERE id = ?').run(now, now, userId);
}

export function incrementUserApiCalls(userId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET apiCallsTotal = apiCallsTotal + 1, updatedAt = ? WHERE id = ?').run(
    now,
    userId,
  );
}

export function deactivateUser(userId: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE users SET isActive = 0, updatedAt = ? WHERE id = ?')
    .run(now, userId);
  return result.changes > 0;
}

export function verifyUser(userId: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE users SET isVerified = 1, updatedAt = ? WHERE id = ?')
    .run(now, userId);
  return result.changes > 0;
}

export function listUsers(page = 1, limit = 20): { users: User[]; total: number } {
  const db = getDb();
  const offset = (page - 1) * limit;
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  const rows = db
    .prepare('SELECT * FROM users ORDER BY createdAt DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as UserRow[];
  return { users: rows.map(rowToUser), total: totalRow.count };
}

export function getUserStats(): {
  total: number;
  byTier: Record<SubscriptionTier, number>;
  activeToday: number;
} {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const activeToday = (
    db
      .prepare('SELECT COUNT(*) as count FROM users WHERE lastActiveAt >= ?')
      .get(todayStart.toISOString()) as { count: number }
  ).count;

  const tierRows = db
    .prepare('SELECT tier, COUNT(*) as count FROM users GROUP BY tier')
    .all() as { tier: string; count: number }[];

  const byTier: Record<SubscriptionTier, number> = { free: 0, pro: 0, enterprise: 0 };
  for (const row of tierRows) {
    byTier[row.tier as SubscriptionTier] = row.count;
  }

  return { total, byTier, activeToday };
}
