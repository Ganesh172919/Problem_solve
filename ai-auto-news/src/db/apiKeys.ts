import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import getDb from './index';
import { ApiKey, ApiKeyRow } from '@/types/saas';
import { APP_CONFIG } from '@/lib/config';

function rowToApiKey(row: ApiKeyRow): ApiKey {
  return {
    ...row,
    scopes: JSON.parse(row.scopes || '["read"]'),
    isActive: row.isActive === 1,
  };
}

export function generateRawKey(): string {
  const bytes = crypto.randomBytes(APP_CONFIG.apiKeyLength);
  return APP_CONFIG.apiKeyPrefix + bytes.toString('hex');
}

export function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function createApiKey(params: {
  userId: string;
  name: string;
  scopes?: string[];
  expiresAt?: string;
}): { apiKey: ApiKey; rawKey: string } {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);
  const scopes = params.scopes || ['read'];

  db.prepare(`
    INSERT INTO api_keys (id, userId, name, keyHash, keyPrefix, scopes, callCount, lastUsedAt, expiresAt, isActive, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, 1, ?)
  `).run(
    id,
    params.userId,
    params.name,
    keyHash,
    keyPrefix,
    JSON.stringify(scopes),
    params.expiresAt || null,
    now,
  );

  const apiKey: ApiKey = {
    id,
    userId: params.userId,
    name: params.name,
    keyHash,
    keyPrefix,
    scopes,
    callCount: 0,
    lastUsedAt: null,
    expiresAt: params.expiresAt || null,
    isActive: true,
    createdAt: now,
  };

  return { apiKey, rawKey };
}

export function getApiKeyByHash(rawKey: string): ApiKey | null {
  const db = getDb();
  const keyHash = hashKey(rawKey);
  const row = db
    .prepare('SELECT * FROM api_keys WHERE keyHash = ? AND isActive = 1')
    .get(keyHash) as ApiKeyRow | undefined;
  if (!row) return null;

  // Check expiry
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    return null;
  }

  return rowToApiKey(row);
}

export function getApiKeysByUserId(userId: string): ApiKey[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM api_keys WHERE userId = ? ORDER BY createdAt DESC')
    .all(userId) as ApiKeyRow[];
  return rows.map(rowToApiKey);
}

export function getActiveApiKeyCountForUser(userId: string): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) as count FROM api_keys WHERE userId = ? AND isActive = 1')
    .get(userId) as { count: number };
  return row.count;
}

export function revokeApiKey(keyId: string, userId: string): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE api_keys SET isActive = 0 WHERE id = ? AND userId = ?')
    .run(keyId, userId);
  return result.changes > 0;
}

export function incrementApiKeyUsage(keyId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE api_keys SET callCount = callCount + 1, lastUsedAt = ? WHERE id = ?',
  ).run(now, keyId);
}
