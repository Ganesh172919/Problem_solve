import { describe, it, expect, beforeEach } from '@jest/globals';
import { FeatureAdoptionTracker } from '@/lib/featureAdoptionTracker';

describe('FeatureAdoptionTracker', () => {
  let tracker: FeatureAdoptionTracker;

  beforeEach(() => {
    tracker = new FeatureAdoptionTracker();
  });

  describe('registerFeature', () => {
    it('should register features', () => {
      tracker.registerFeature({
        id: 'f1',
        name: 'Analytics Dashboard',
        category: 'analytics',
        tier: 'pro',
        releaseDate: Date.now() - 30 * 24 * 60 * 60 * 1000,
        description: 'Advanced analytics',
        isActive: true,
        tags: ['analytics', 'dashboard'],
      });

      expect(tracker.getFeatures()).toHaveLength(1);
    });
  });

  describe('trackUsage', () => {
    it('should track feature usage events', () => {
      tracker.registerFeature({
        id: 'f1', name: 'Test Feature', category: 'test', tier: 'free',
        releaseDate: Date.now(), description: 'Test', isActive: true, tags: [],
      });

      tracker.trackUsage({
        id: 'e1', featureId: 'f1', userId: 'u1', tenantId: 't1',
        action: 'used', duration: 5000, metadata: {}, timestamp: Date.now(),
      });

      const metrics = tracker.getAdoptionMetrics('f1');
      expect(metrics.activeUsers).toBe(1);
    });
  });

  describe('getAdoptionMetrics', () => {
    it('should return metrics for a feature', () => {
      tracker.registerFeature({
        id: 'f1', name: 'Feature 1', category: 'test', tier: 'free',
        releaseDate: Date.now() - 86400000, description: 'Test', isActive: true, tags: [],
      });

      tracker.setTotalUsers(100);

      for (let i = 0; i < 10; i++) {
        tracker.trackUsage({
          id: `e${i}`, featureId: 'f1', userId: `u${i}`, tenantId: 't1',
          action: 'used', duration: 3000, metadata: {}, timestamp: Date.now(),
        });
      }

      for (let i = 0; i < 5; i++) {
        tracker.trackUsage({
          id: `ea${i}`, featureId: 'f1', userId: `u${i}`, tenantId: 't1',
          action: 'completed', metadata: {}, timestamp: Date.now(),
        });
      }

      const metrics = tracker.getAdoptionMetrics('f1');
      expect(metrics.activeUsers).toBe(10);
      expect(metrics.adoptionRate).toBe(0.1);
      expect(metrics.completionRate).toBe(0.5);
      expect(metrics.avgSessionDuration).toBe(3000);
    });

    it('should return empty metrics for unknown feature', () => {
      const metrics = tracker.getAdoptionMetrics('unknown');
      expect(metrics.activeUsers).toBe(0);
      expect(metrics.adoptionRate).toBe(0);
    });
  });

  describe('getFeatureCorrelations', () => {
    it('should compute correlations between features', () => {
      tracker.registerFeature({
        id: 'f1', name: 'Feature 1', category: 'test', tier: 'free',
        releaseDate: Date.now(), description: 'Test', isActive: true, tags: [],
      });
      tracker.registerFeature({
        id: 'f2', name: 'Feature 2', category: 'test', tier: 'free',
        releaseDate: Date.now(), description: 'Test', isActive: true, tags: [],
      });

      // Users 1-5 use both features
      for (let i = 0; i < 5; i++) {
        tracker.trackUsage({
          id: `e1_${i}`, featureId: 'f1', userId: `u${i}`, tenantId: 't1',
          action: 'used', metadata: {}, timestamp: Date.now(),
        });
        tracker.trackUsage({
          id: `e2_${i}`, featureId: 'f2', userId: `u${i}`, tenantId: 't1',
          action: 'used', metadata: {}, timestamp: Date.now(),
        });
      }

      const correlations = tracker.getFeatureCorrelations();
      expect(correlations).toHaveLength(1);
      expect(correlations[0].correlation).toBe(1);
      expect(correlations[0].direction).toBe('positive');
    });
  });

  describe('getUserJourney', () => {
    it('should return user journey data', () => {
      tracker.registerFeature({
        id: 'f1', name: 'Feature 1', category: 'test', tier: 'free',
        releaseDate: Date.now(), description: 'Test', isActive: true, tags: [],
      });
      tracker.registerFeature({
        id: 'f2', name: 'Feature 2', category: 'test', tier: 'free',
        releaseDate: Date.now(), description: 'Test', isActive: true, tags: [],
      });

      tracker.trackUsage({
        id: 'e1', featureId: 'f1', userId: 'u1', tenantId: 't1',
        action: 'used', metadata: {}, timestamp: Date.now() - 1000,
      });
      tracker.trackUsage({
        id: 'e2', featureId: 'f2', userId: 'u1', tenantId: 't1',
        action: 'used', metadata: {}, timestamp: Date.now(),
      });

      const journey = tracker.getUserJourney('u1');
      expect(journey.totalFeatures).toBe(2);
      expect(journey.engagementScore).toBe(1);
      expect(journey.segment).toBe('power_user');
      expect(journey.riskLevel).toBe('low');
    });
  });

  describe('generateInsights', () => {
    it('should generate insights', () => {
      tracker.registerFeature({
        id: 'f1', name: 'Feature 1', category: 'test', tier: 'free',
        releaseDate: Date.now(), description: 'Test', isActive: true, tags: [],
      });
      tracker.setTotalUsers(1000);

      // Only 5 users use the feature (very low adoption)
      for (let i = 0; i < 5; i++) {
        tracker.trackUsage({
          id: `e${i}`, featureId: 'f1', userId: `u${i}`, tenantId: 't1',
          action: 'used', metadata: {}, timestamp: Date.now(),
        });
      }

      const insights = tracker.generateInsights();
      expect(insights.length).toBeGreaterThan(0);
      expect(insights.some(i => i.type === 'risk')).toBe(true);
    });
  });

  describe('getProductHealthScore', () => {
    it('should return product health score', () => {
      tracker.registerFeature({
        id: 'f1', name: 'Feature 1', category: 'test', tier: 'free',
        releaseDate: Date.now(), description: 'Test', isActive: true, tags: [],
      });

      tracker.setTotalUsers(100);

      for (let i = 0; i < 50; i++) {
        tracker.trackUsage({
          id: `e${i}`, featureId: 'f1', userId: `u${i}`, tenantId: 't1',
          action: 'used', metadata: {}, timestamp: Date.now(),
        });
      }

      const score = tracker.getProductHealthScore();
      expect(score.overall).toBeGreaterThan(0);
      expect(score).toHaveProperty('adoption');
      expect(score).toHaveProperty('engagement');
      expect(score).toHaveProperty('retention');
      expect(score.topFeatures).toHaveLength(1);
    });

    it('should handle empty state', () => {
      const score = tracker.getProductHealthScore();
      expect(score.overall).toBe(0);
    });
  });
});
