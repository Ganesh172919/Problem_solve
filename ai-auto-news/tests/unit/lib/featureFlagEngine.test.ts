import { describe, it, expect, beforeEach } from '@jest/globals';
import { getFeatureFlagEngine } from '@/lib/featureFlagEngine';
import type { FeatureFlag } from '@/lib/featureFlagEngine';

type FlagInput = Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>;

function makeFlag(overrides: Partial<FlagInput> = {}): FlagInput {
  return {
    key: 'test-flag', name: 'Test Flag', description: 'A flag for tests',
    enabled: true,
    targeting: { userIds: [], tenantIds: [], attributes: [], percentage: 100 },
    variants: [
      { key: 'on', value: true, weight: 50 },
      { key: 'off', value: false, weight: 50 },
    ],
    defaultVariant: 'off', rolloutPercentage: 100,
    environment: 'test', tags: ['test'], ...overrides,
  };
}

describe('FeatureFlagEngine', () => {
  let engine: ReturnType<typeof getFeatureFlagEngine>;

  beforeEach(() => {
    delete (globalThis as any).__featureFlagEngine__;
    engine = getFeatureFlagEngine();
  });

  it('createFlag and getFlag manage flags', () => {
    const flag = engine.createFlag(makeFlag());
    expect(flag.key).toBe('test-flag');
    expect(flag.id).toBeDefined();
    const retrieved = engine.getFlag('test-flag');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.key).toBe('test-flag');
  });

  it('evaluate returns targeting match for targeted user', () => {
    engine.createFlag(makeFlag({
      targeting: { userIds: ['u1'], tenantIds: [], attributes: [], percentage: 100 },
    }));
    const result = engine.evaluate('test-flag', { userId: 'u1', environment: 'test' });
    expect(result.reason).toBe('targeting');
    expect(result.variant.key).toBe('on');
  });

  it('evaluate respects rollout percentage', () => {
    engine.createFlag(makeFlag({ rolloutPercentage: 0 }));
    const result = engine.evaluate('test-flag', { userId: 'user-abc', environment: 'test' });
    expect(result.reason).toBe('default');
    expect(result.variant.key).toBe('off');
  });

  it('addOverride overrides flag value', () => {
    engine.createFlag(makeFlag());
    engine.addOverride({
      flagKey: 'test-flag', scope: 'user', scopeId: 'u99', variant: 'off',
    });
    const result = engine.evaluate('test-flag', { userId: 'u99', environment: 'test' });
    expect(result.reason).toBe('override');
    expect(result.variant.key).toBe('off');
  });

  it('updateFlag modifies an existing flag', () => {
    engine.createFlag(makeFlag());
    const updated = engine.updateFlag('test-flag', { description: 'Updated desc' });
    expect(updated.description).toBe('Updated desc');
    expect(updated.key).toBe('test-flag');
  });

  it('deleteFlag removes a flag', () => {
    engine.createFlag(makeFlag());
    engine.deleteFlag('test-flag');
    expect(engine.getFlag('test-flag')).toBeNull();
  });

  it('getAllFlags lists all flags', () => {
    engine.createFlag(makeFlag());
    engine.createFlag(makeFlag({ key: 'flag-2', name: 'Second' }));
    const flags = engine.getAllFlags();
    expect(flags).toHaveLength(2);
  });

  it('getAuditLog records changes', () => {
    engine.createFlag(makeFlag());
    engine.updateFlag('test-flag', { enabled: false });
    const log = engine.getAuditLog('test-flag');
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log[0].action).toBe('create');
    expect(log[1].action).toBe('update');
  });

  it('isEnabled returns boolean convenience check', () => {
    engine.createFlag(makeFlag({ enabled: true }));
    expect(engine.isEnabled('test-flag', { environment: 'test' })).toBe(true);
    engine.updateFlag('test-flag', { enabled: false });
    expect(engine.isEnabled('test-flag', { environment: 'test' })).toBe(false);
  });

  it('getStats returns correct stats', () => {
    engine.createFlag(makeFlag());
    engine.evaluate('test-flag', { environment: 'test' });
    const stats = engine.getStats();
    expect(stats.totalFlags).toBe(1);
    expect(stats.enabledCount).toBe(1);
    expect(stats.evaluationCount).toBeGreaterThanOrEqual(1);
  });
});
