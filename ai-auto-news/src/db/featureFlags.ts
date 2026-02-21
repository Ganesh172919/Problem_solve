import { v4 as uuidv4 } from 'uuid';
import getDb from './index';
import { FeatureFlag, FeatureFlagRow, SubscriptionTier } from '@/types/saas';

function rowToFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    ...row,
    enabledTiers: JSON.parse(row.enabledTiers || '["free","pro","enterprise"]'),
    isGlobal: row.isGlobal === 1,
  };
}

export function createFeatureFlag(params: {
  name: string;
  description: string;
  enabledTiers?: SubscriptionTier[];
  isGlobal?: boolean;
  rolloutPercent?: number;
}): FeatureFlag {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const enabledTiers = params.enabledTiers || ['free', 'pro', 'enterprise'];
  const isGlobal = params.isGlobal ? 1 : 0;
  const rolloutPercent = params.rolloutPercent ?? 100;

  db.prepare(`
    INSERT INTO feature_flags (id, name, description, enabledTiers, isGlobal, rolloutPercent, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.name, params.description, JSON.stringify(enabledTiers), isGlobal, rolloutPercent, now, now);

  return {
    id,
    name: params.name,
    description: params.description,
    enabledTiers,
    isGlobal: params.isGlobal || false,
    rolloutPercent,
    createdAt: now,
    updatedAt: now,
  };
}

export function getFeatureFlag(name: string): FeatureFlag | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM feature_flags WHERE name = ?')
    .get(name) as FeatureFlagRow | undefined;
  return row ? rowToFlag(row) : null;
}

export function listFeatureFlags(): FeatureFlag[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM feature_flags ORDER BY name ASC')
    .all() as FeatureFlagRow[];
  return rows.map(rowToFlag);
}

export function updateFeatureFlag(
  name: string,
  updates: Partial<Pick<FeatureFlag, 'description' | 'enabledTiers' | 'isGlobal' | 'rolloutPercent'>>,
): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const current = getFeatureFlag(name);
  if (!current) return false;

  const updated = { ...current, ...updates, updatedAt: now };
  const result = db
    .prepare(`
      UPDATE feature_flags
      SET description = ?, enabledTiers = ?, isGlobal = ?, rolloutPercent = ?, updatedAt = ?
      WHERE name = ?
    `)
    .run(
      updated.description,
      JSON.stringify(updated.enabledTiers),
      updated.isGlobal ? 1 : 0,
      updated.rolloutPercent,
      now,
      name,
    );
  return result.changes > 0;
}

export function isFlagEnabledForTier(name: string, tier: SubscriptionTier): boolean {
  const flag = getFeatureFlag(name);
  if (!flag) return false;
  if (flag.isGlobal) return true;
  return flag.enabledTiers.includes(tier);
}

export function deleteFeatureFlag(name: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM feature_flags WHERE name = ?').run(name);
  return result.changes > 0;
}
