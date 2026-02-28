import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getConfigManager } from '@/lib/configurationManagementEngine';

describe('ConfigurationManagementEngine', () => {
  let config: ReturnType<typeof getConfigManager>;

  beforeEach(() => {
    delete (globalThis as any).__configurationManagementEngine__;
    config = getConfigManager();
  });

  it('should set and get config values', () => {
    config.set('app.name', 'MyApp');
    expect(config.get('app.name')).toBe('MyApp');
  });

  it('should return undefined for missing keys', () => {
    expect(config.get('nonexistent')).toBeUndefined();
  });

  it('should resolve hierarchically: user > tenant > environment > global', () => {
    config.set('theme', 'light', { scope: 'global' });
    config.set('theme', 'dark', { scope: 'environment', scopeId: 'prod' });
    config.set('theme', 'blue', { scope: 'user', scopeId: 'u1' });

    expect(config.get('theme', { scopeId: 'u1', environment: 'prod' })).toBe('blue');
    expect(config.get('theme', { environment: 'prod' })).toBe('dark');
    expect(config.get('theme')).toBe('blue');
  });

  it('should return version history for a key', () => {
    config.set('count', 1);
    config.set('count', 2);
    config.set('count', 3);

    const history = config.getHistory('count');
    expect(history).toHaveLength(3);
    expect(history[0].version).toBe(1);
    expect(history[2].newValue).toBe(3);
  });

  it('should rollback to a previous version', () => {
    config.set('color', 'red');
    config.set('color', 'green');
    config.set('color', 'blue');

    const rolled = config.rollback('color', 1);
    expect(rolled.version).toBe(4);
    expect(config.get('color')).toBe('red');
  });

  it('should validate values against a schema', () => {
    const schema = { type: 'number' as const, required: true, minValue: 0, maxValue: 100 };
    const valid = config.validate('score', 50, schema);
    expect(valid.valid).toBe(true);

    const invalid = config.validate('score', 200, schema);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('should create and restore snapshots', () => {
    config.set('a', 1);
    config.set('b', 2);
    const snapshot = config.createSnapshot('backup');
    expect(snapshot.id).toBeDefined();

    config.set('a', 999);
    const restored = config.restoreSnapshot(snapshot.id);
    expect(restored).toBe(2);
    expect(config.get('a')).toBe(1);
  });

  it('should trigger onChange callbacks', () => {
    const cb = jest.fn();
    const unsub = config.onChange('key1', cb);

    config.set('key1', 'hello');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ key: 'key1', newValue: 'hello' }));

    unsub();
    config.set('key1', 'world');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('should export and import config entries', () => {
    config.set('x', 10, { scope: 'global' });
    config.set('y', 20, { scope: 'global' });

    const exported = config.export('global');
    expect(exported).toEqual(expect.objectContaining({ x: 10, y: 20 }));

    delete (globalThis as any).__configurationManagementEngine__;
    const fresh = getConfigManager();
    const count = fresh.import({ a: 1, b: 2, c: 3 }, 'global');
    expect(count).toBe(3);
    expect(fresh.get('b')).toBe(2);
  });

  it('should return accurate stats', () => {
    config.set('s1', 'val', { scope: 'global' });
    config.set('s2', 42, { scope: 'environment', scopeId: 'dev' });
    config.set('s3', true, { scope: 'global', secret: true });

    const stats = config.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.secretCount).toBe(1);
    expect(stats.entriesByScope.global).toBe(2);
    expect(stats.entriesByScope.environment).toBe(1);
    expect(stats.totalVersions).toBeGreaterThanOrEqual(3);
  });
});
