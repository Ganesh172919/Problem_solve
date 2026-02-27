import { describe, it, expect, beforeEach } from '@jest/globals';
import { getDataVersioningEngine } from '../../../src/lib/dataVersioningEngine';

describe('DataVersioningEngine', () => {
  beforeEach(() => {
    (globalThis as any).__dataVersioningEngine__ = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getDataVersioningEngine();
    const b = getDataVersioningEngine();
    expect(a).toBe(b);
  });

  it('save() returns DataVersion with correct version number', () => {
    const engine = getDataVersioningEngine();
    const v = engine.save('user', 'u1', { name: 'Alice' }, 'test');
    expect(v.version).toBe(1);
    expect(v.entityType).toBe('user');
    expect(v.entityId).toBe('u1');
    expect(v.data).toEqual({ name: 'Alice' });
    const v2 = engine.save('user', 'u1', { name: 'Bob' }, 'test');
    expect(v2.version).toBe(2);
  });

  it('getVersion() retrieves saved version', () => {
    const engine = getDataVersioningEngine();
    engine.save('product', 'p1', { price: 10 }, 'test');
    const fetched = engine.getVersion('p1', 1);
    expect(fetched).toBeDefined();
    expect(fetched!.version).toBe(1);
    expect(fetched!.data).toEqual({ price: 10 });
  });

  it('getLatest() returns most recent version', () => {
    const engine = getDataVersioningEngine();
    engine.save('order', 'o1', { status: 'pending' }, 'test');
    engine.save('order', 'o1', { status: 'shipped' }, 'test');
    const latest = engine.getLatest('o1');
    expect(latest).toBeDefined();
    expect(latest!.data).toEqual({ status: 'shipped' });
  });

  it('diff() detects added, modified, and removed fields', () => {
    const engine = getDataVersioningEngine();
    engine.save('item', 'i1', { a: 1, b: 2 }, 'test');
    engine.save('item', 'i1', { b: 99, c: 3 }, 'test');
    const d = engine.diff('i1', 1, 2);
    expect(d.added).toHaveProperty('c');
    expect(d.modified).toHaveProperty('b');
    expect(d.removed).toHaveProperty('a');
  });

  it('revert() creates new version with old data', () => {
    const engine = getDataVersioningEngine();
    engine.save('doc', 'd1', { text: 'v1' }, 'test');
    engine.save('doc', 'd1', { text: 'v2' }, 'test');
    const reverted = engine.revert('d1', 1, 'author');
    expect(reverted.data).toEqual({ text: 'v1' });
    expect(reverted.version).toBe(3);
  });

  it('queryVersions() filters by entityType', () => {
    const engine = getDataVersioningEngine();
    engine.save('invoice', 'inv1', { amount: 100 }, 'test');
    engine.save('invoice', 'inv1', { amount: 200 }, 'test');
    const results = engine.queryVersions({ entityType: 'invoice', entityId: 'inv1' });
    expect(results.length).toBe(2);
    results.forEach(r => expect(r.entityType).toBe('invoice'));
  });

  it('travelToTime() returns data at timestamp', () => {
    const engine = getDataVersioningEngine();
    const before = Date.now();
    engine.save('config', 'cfg1', { value: 42 }, 'test');
    const after = Date.now();
    const result = engine.travelToTime('cfg1', after);
    expect(result).toBeDefined();
    expect(result!.version).toBe(1);
    expect(result!.data).toEqual({ value: 42 });
    expect(result!.asOf).toBeGreaterThanOrEqual(before);
    expect(result!.asOf).toBeLessThanOrEqual(after);
  });

  it('getStats() returns numeric fields', () => {
    const engine = getDataVersioningEngine();
    engine.save('stat', 's1', { x: 1 }, 'test');
    const stats = engine.getStats();
    expect(typeof stats.totalVersions).toBe('number');
    expect(typeof stats.totalEntities).toBe('number');
    expect(typeof stats.avgVersionsPerEntity).toBe('number');
    expect(typeof stats.storageBytes).toBe('number');
    expect(stats.totalVersions).toBeGreaterThanOrEqual(1);
  });
});
