import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  HyperPersonalizationEngine,
  getHyperPersonalization,
  UserSignal,
} from '../../../src/lib/hyperPersonalizationEngine';

function makeSignal(userId: string, type: UserSignal['type'] = 'click', entityId = 'article_1'): UserSignal {
  return {
    signalId: `sig_${Math.random().toString(36).substring(2, 9)}`,
    userId,
    type,
    entityId,
    entityType: 'article',
    value: 1,
    timestamp: Date.now(),
    sessionId: 'sess_1',
    context: {},
  };
}

describe('HyperPersonalizationEngine', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__hyperPersonalizationEngine__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getHyperPersonalization();
    const b = getHyperPersonalization();
    expect(a).toBe(b);
  });

  it('upsertProfile creates new profile', () => {
    const engine = new HyperPersonalizationEngine();
    const profile = engine.upsertProfile({ userId: 'user1', tenantId: 'tenant1' });
    expect(profile.userId).toBe('user1');
    expect(engine.getProfile('user1')).toBe(profile);
  });

  it('upsertProfile updates existing profile', () => {
    const engine = new HyperPersonalizationEngine();
    engine.upsertProfile({ userId: 'user2', tenantId: 'tenant1' });
    const updated = engine.upsertProfile({ userId: 'user2', tenantId: 'tenant1', traits: { color: 'blue' } });
    expect(updated.traits['color']).toBe('blue');
    expect(engine.getProfile('user2')).toBe(updated);
  });

  it('ingestSignal adds signal and updates profile preferences', () => {
    const engine = new HyperPersonalizationEngine();
    engine.upsertProfile({ userId: 'user3', tenantId: 'tenant1' });
    const signal = makeSignal('user3', 'purchase', 'product_42');
    engine.ingestSignal(signal);
    const profile = engine.getProfile('user3')!;
    expect(profile.recentSignals).toHaveLength(1);
    expect(profile.preferences['article:product_42']).toBeGreaterThan(0);
  });

  it('decide returns a decision with valid fields', () => {
    const engine = new HyperPersonalizationEngine({ minSignalsForPersonalization: 3 });
    engine.upsertProfile({ userId: 'user4', tenantId: 't1' });
    // Seed some signals
    for (let i = 0; i < 5; i++) engine.ingestSignal(makeSignal('user4', 'click', `item_${i}`));
    const decision = engine.decide('user4', 'content', ['item_0', 'item_1', 'item_2']);
    expect(decision.selectedVariant).toBeTruthy();
    expect(['item_0', 'item_1', 'item_2']).toContain(decision.selectedVariant);
    expect(decision.confidence).toBeGreaterThan(0);
  });

  it('getRecommendations returns limited results', () => {
    const engine = new HyperPersonalizationEngine();
    engine.upsertProfile({ userId: 'user5', tenantId: 't1' });
    const catalog = Array.from({ length: 20 }, (_, i) => ({ id: `item_${i}`, title: `Item ${i}`, type: 'article', tags: ['news'] }));
    const recs = engine.getRecommendations('user5', catalog, 5);
    expect(recs).toHaveLength(5);
  });

  it('getPersonalizedUI returns config with dashboardWidgets', () => {
    const engine = new HyperPersonalizationEngine();
    engine.upsertProfile({ userId: 'user6', tenantId: 't1' });
    const config = engine.getPersonalizedUI('user6', ['analytics', 'feed', 'alerts', 'settings', 'users', 'billing']);
    expect(config.dashboardWidgets.length).toBeGreaterThan(0);
    expect(config.theme).toBeTruthy();
  });

  it('experiment variant assignment is deterministic', () => {
    const engine = new HyperPersonalizationEngine();
    const experiment = engine.createExperiment({
      name: 'test_exp',
      dimension: 'ui',
      variants: [
        { variantId: 'v1', name: 'Control', weight: 50, config: {}, metrics: { impressions: 0, conversions: 0, revenue: 0 } },
        { variantId: 'v2', name: 'Treatment', weight: 50, config: {}, metrics: { impressions: 0, conversions: 0, revenue: 0 } },
      ],
      status: 'running',
      confidence: 0,
    });
    const v1 = engine.assignToVariant(experiment.experimentId, 'user_abc');
    const v2 = engine.assignToVariant(experiment.experimentId, 'user_abc');
    expect(v1?.variantId).toBe(v2?.variantId);  // same user -> same variant
  });

  it('getSegmentDistribution sums up correctly', () => {
    const engine = new HyperPersonalizationEngine();
    engine.upsertProfile({ userId: 'u1', tenantId: 'tA' });
    engine.upsertProfile({ userId: 'u2', tenantId: 'tA' });
    const dist = engine.getSegmentDistribution('tA');
    const total = Object.values(dist).reduce((s, v) => s + v, 0);
    expect(total).toBe(2);
  });
});
