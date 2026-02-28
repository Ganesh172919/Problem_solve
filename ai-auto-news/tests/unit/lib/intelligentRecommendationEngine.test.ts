import { describe, it, expect, beforeEach } from '@jest/globals';
import { getRecommendationEngine } from '@/lib/intelligentRecommendationEngine';

describe('IntelligentRecommendationEngine', () => {
  let engine: ReturnType<typeof getRecommendationEngine>;

  const makeItem = (id: string, tags: string[] = ['tech'], features: Record<string, number> = { quality: 0.8 }) => ({
    id, type: 'article', title: `Item ${id}`, description: `Description for ${id}`, tags, features,
  });

  beforeEach(() => {
    delete (globalThis as any).__intelligentRecommendationEngine__;
    engine = getRecommendationEngine();
  });

  it('should add items with popularity and createdAt', () => {
    const item = engine.addItem(makeItem('i1'));
    expect(item.id).toBe('i1');
    expect(item.popularity).toBe(0);
    expect(item.createdAt).toBeInstanceOf(Date);
  });

  it('should record interactions and update popularity', () => {
    engine.addItem(makeItem('i1'));
    engine.recordInteraction('u1', { itemId: 'i1', type: 'click' });
    engine.recordInteraction('u1', { itemId: 'i1', type: 'purchase' });

    const recs = engine.getPopularRecommendations(5);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].itemId).toBe('i1');
    expect(recs[0].score).toBeGreaterThan(0);
  });

  it('should return scored recommendations', () => {
    engine.addItem(makeItem('i1', ['tech']));
    engine.addItem(makeItem('i2', ['tech', 'ai']));
    engine.addItem(makeItem('i3', ['sports']));

    engine.recordInteraction('u1', { itemId: 'i1', type: 'click' });

    const recs = engine.getRecommendations({ userId: 'u1', count: 5 });
    expect(Array.isArray(recs)).toBe(true);
    for (const rec of recs) {
      expect(rec.score).toBeGreaterThanOrEqual(0);
      expect(rec.strategy).toBeDefined();
      expect(rec.explanation).toBeDefined();
    }
  });

  it('should return content-based recommendations', () => {
    engine.addItem(makeItem('i1', ['tech'], { quality: 1.0 }));
    engine.addItem(makeItem('i2', ['tech'], { quality: 0.9 }));
    engine.addItem(makeItem('i3', ['cooking'], { quality: 0.5 }));

    engine.recordInteraction('u1', { itemId: 'i1', type: 'click' });

    const recs = engine.getContentBasedRecommendations('u1', 5);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].strategy).toBe('content');
  });

  it('should return popular recommendations sorted by decayed score', () => {
    engine.addItem(makeItem('i1'));
    engine.addItem(makeItem('i2'));
    engine.recordInteraction('u1', { itemId: 'i1', type: 'purchase' });
    engine.recordInteraction('u1', { itemId: 'i1', type: 'purchase' });
    engine.recordInteraction('u1', { itemId: 'i2', type: 'view' });

    const recs = engine.getPopularRecommendations(5);
    expect(recs[0].itemId).toBe('i1');
    expect(recs[0].strategy).toBe('popular');
  });

  it('should compute item similarity', () => {
    engine.addItem(makeItem('i1', ['tech', 'ai'], { quality: 1.0 }));
    engine.addItem(makeItem('i2', ['tech', 'ai'], { quality: 0.9 }));
    engine.addItem(makeItem('i3', ['cooking'], { quality: 0.1 }));

    const simHigh = engine.computeItemSimilarity('i1', 'i2');
    const simLow = engine.computeItemSimilarity('i1', 'i3');
    expect(simHigh).toBeGreaterThan(simLow);
  });

  it('should return 0 similarity for missing items', () => {
    expect(engine.computeItemSimilarity('missing1', 'missing2')).toBe(0);
  });

  it('should submit feedback and adjust preferences', () => {
    engine.addItem(makeItem('i1', ['tech']));
    engine.addUserProfile({ userId: 'u1', preferences: {}, interactionHistory: [], segments: [] });

    engine.submitFeedback({ userId: 'u1', itemId: 'i1', accepted: true, timestamp: new Date() });
    engine.submitFeedback({ userId: 'u1', itemId: 'i1', accepted: false, timestamp: new Date() });

    const stats = engine.getStats();
    expect(stats.acceptanceRate).toBe(0.5);
  });

  it('should return accurate stats', () => {
    engine.addItem(makeItem('i1'));
    engine.addItem(makeItem('i2'));
    engine.addUserProfile({ userId: 'u1', preferences: {}, interactionHistory: [], segments: [] });

    engine.getRecommendations({ userId: 'u1', count: 3 });

    const stats = engine.getStats();
    expect(stats.totalItems).toBe(2);
    expect(stats.totalUsers).toBe(1);
    expect(stats.totalRecommendations).toBeGreaterThanOrEqual(0);
    expect(stats.strategyPerformance).toBeDefined();
  });
});
