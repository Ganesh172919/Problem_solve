import { describe, it, expect, beforeEach } from '@jest/globals';
import { CanaryDeploymentEngine } from '@/lib/canaryDeploymentEngine';

describe('CanaryDeploymentEngine', () => {
  let engine: CanaryDeploymentEngine;

  beforeEach(() => {
    engine = new CanaryDeploymentEngine();
  });

  describe('createDeployment', () => {
    it('should create a deployment with phases', () => {
      const deployment = engine.createDeployment({
        name: 'v2.0 release',
        service: 'api',
        version: '2.0.0',
        previousVersion: '1.9.0',
      });

      expect(deployment.id).toContain('deploy_');
      expect(deployment.status).toBe('pending');
      expect(deployment.phases.length).toBeGreaterThan(0);
      expect(deployment.healthChecks.length).toBeGreaterThan(0);
      expect(deployment.rollbackTriggers.length).toBeGreaterThan(0);
    });

    it('should generate phases based on strategy', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'worker',
        version: '1.0.0',
        previousVersion: '0.9.0',
        strategy: {
          initialCanaryPercent: 10,
          maxCanaryPercent: 100,
          incrementPercent: 30,
        },
      });

      expect(deployment.phases.length).toBeGreaterThanOrEqual(3);
      expect(deployment.phases[0].trafficPercent).toBe(10);
    });
  });

  describe('startDeployment', () => {
    it('should start a pending deployment', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'api',
        version: '1.0.0',
        previousVersion: '0.9.0',
      });

      const started = engine.startDeployment(deployment.id);
      expect(started).toBe(true);

      const updated = engine.getDeployment(deployment.id);
      expect(updated!.status).toBe('in_progress');
      expect(updated!.startedAt).not.toBeNull();
      expect(updated!.phases[0].status).toBe('active');
    });

    it('should not start an already started deployment', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'api',
        version: '1.0.0',
        previousVersion: '0.9.0',
      });

      engine.startDeployment(deployment.id);
      expect(engine.startDeployment(deployment.id)).toBe(false);
    });
  });

  describe('recordMetrics and evaluatePhase', () => {
    it('should record metrics for active phase', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'api',
        version: '1.0.0',
        previousVersion: '0.9.0',
      });

      engine.startDeployment(deployment.id);

      const success = engine.recordMetrics(deployment.id, {
        requestCount: 100,
        errorCount: 2,
        avgLatencyMs: 50,
      });

      expect(success).toBe(true);
    });

    it('should evaluate phase comparison', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'api',
        version: '1.0.0',
        previousVersion: '0.9.0',
      });

      engine.startDeployment(deployment.id);
      engine.setBaselineMetrics(deployment.id, {
        requestCount: 1000,
        errorCount: 10,
        errorRate: 0.01,
        avgLatencyMs: 100,
        p95LatencyMs: 200,
        p99LatencyMs: 400,
        successRate: 0.99,
        saturationPercent: 0.3,
      });

      engine.recordMetrics(deployment.id, {
        requestCount: 100,
        errorCount: 1,
        avgLatencyMs: 90,
        p95LatencyMs: 180,
        p99LatencyMs: 350,
      });

      const comparison = engine.evaluatePhase(deployment.id);
      expect(comparison).not.toBeNull();
      expect(comparison!.healthScore).toBeGreaterThan(0);
      expect(comparison!.details.length).toBeGreaterThan(0);
    });
  });

  describe('advancePhase', () => {
    it('should advance to next phase', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'api',
        version: '1.0.0',
        previousVersion: '0.9.0',
        strategy: { initialCanaryPercent: 10, maxCanaryPercent: 50, incrementPercent: 20 },
      });

      engine.startDeployment(deployment.id);
      const advanced = engine.advancePhase(deployment.id);
      expect(advanced).toBe(true);

      const updated = engine.getDeployment(deployment.id);
      expect(updated!.phases[0].status).toBe('passed');
    });
  });

  describe('rollback', () => {
    it('should rollback a deployment', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'api',
        version: '1.0.0',
        previousVersion: '0.9.0',
      });

      engine.startDeployment(deployment.id);
      const rolledBack = engine.rollback(deployment.id, 'high error rate');
      expect(rolledBack).toBe(true);

      const updated = engine.getDeployment(deployment.id);
      expect(updated!.status).toBe('failed');
    });
  });

  describe('getDeploymentStats', () => {
    it('should return deployment statistics', () => {
      engine.createDeployment({ name: 'D1', service: 'api', version: '1.0', previousVersion: '0.9' });
      engine.createDeployment({ name: 'D2', service: 'api', version: '1.1', previousVersion: '1.0' });

      const stats = engine.getDeploymentStats();
      expect(stats.total).toBe(2);
      expect(stats.successful).toBe(0);
      expect(stats.inProgress).toBe(0);
    });
  });

  describe('getCurrentTrafficSplit', () => {
    it('should return traffic split', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'api',
        version: '1.0.0',
        previousVersion: '0.9.0',
        strategy: { initialCanaryPercent: 10 },
      });

      engine.startDeployment(deployment.id);
      const split = engine.getCurrentTrafficSplit(deployment.id);
      expect(split.canary).toBe(10);
      expect(split.baseline).toBe(90);
    });
  });

  describe('events', () => {
    it('should track deployment events', () => {
      const deployment = engine.createDeployment({
        name: 'Test',
        service: 'api',
        version: '1.0.0',
        previousVersion: '0.9.0',
      });

      engine.startDeployment(deployment.id);

      const events = engine.getEvents(deployment.id);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('started');
    });
  });
});
