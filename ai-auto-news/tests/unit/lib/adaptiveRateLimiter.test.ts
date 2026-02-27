import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AdaptiveRateLimiter } from '@/lib/adaptiveRateLimiter';

describe('AdaptiveRateLimiter', () => {
  let limiter: AdaptiveRateLimiter;

  beforeEach(() => {
    limiter = new AdaptiveRateLimiter();
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('check', () => {
    it('should allow requests within limit', () => {
      const result = limiter.check('client-1', 'tenant-1', 'free');
      expect(result.allowed).toBe(true);
      expect(result.policyApplied).toBe('free');
    });

    it('should return remaining quota', () => {
      const result = limiter.check('client-1', 'tenant-1', 'free');
      expect(result.remainingQuota).toBeDefined();
      expect(result.remainingQuota.second).toBeGreaterThanOrEqual(0);
      expect(result.remainingQuota.minute).toBeGreaterThanOrEqual(0);
    });

    it('should return rate limit headers', () => {
      const result = limiter.check('client-1', 'tenant-1', 'pro');
      expect(result.headers).toBeDefined();
      expect(result.headers['X-RateLimit-Limit-Second']).toBeDefined();
      expect(result.headers['X-RateLimit-Policy']).toBe('pro');
    });

    it('should deny when policy is not found', () => {
      const result = limiter.check('client-1', 'tenant-1', 'nonexistent');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('policy_not_found');
    });

    it('should create client profile on first request', () => {
      limiter.check('new-client', 'tenant-1', 'free');
      const profile = limiter.getClientProfile('new-client');
      expect(profile).toBeDefined();
      expect(profile!.clientId).toBe('new-client');
    });

    it('should decrement bucket tokens on allowed requests', () => {
      limiter.check('client-1', 'tenant-1', 'free');
      const profile = limiter.getClientProfile('client-1');
      expect(profile?.buckets.second.tokens).toBeLessThan(10);
    });

    it('should deny when second bucket is exhausted', () => {
      for (let i = 0; i < 12; i++) {
        limiter.check('burst-client', 'tenant-1', 'free');
      }
      const finalResult = limiter.check('burst-client', 'tenant-1', 'free');
      expect(finalResult.allowed).toBe(false);
    });

    it('should track stats', () => {
      limiter.check('stats-client', 'tenant-1', 'free');
      const profile = limiter.getClientProfile('stats-client');
      expect(profile?.stats.totalRequests).toBeGreaterThan(0);
      expect(profile?.stats.allowedRequests).toBeGreaterThan(0);
    });
  });

  describe('release', () => {
    it('should decrement concurrent counter', () => {
      limiter.check('client-1', 'tenant-1', 'free');
      const before = limiter.getClientProfile('client-1')?.buckets.concurrent.active ?? 0;
      limiter.release('client-1');
      const after = limiter.getClientProfile('client-1')?.buckets.concurrent.active ?? 0;
      expect(after).toBeLessThanOrEqual(before);
    });

    it('should not go below zero', () => {
      limiter.release('new-client');
      limiter.check('new-client', 'tenant-1', 'free');
      limiter.release('new-client');
      const profile = limiter.getClientProfile('new-client');
      expect(profile?.buckets.concurrent.active).toBeGreaterThanOrEqual(0);
    });
  });

  describe('updateSystemLoad', () => {
    it('should update load metrics', () => {
      limiter.updateSystemLoad({ cpuUtilization: 0.8, errorRate: 0.1 });
      const stats = limiter.getStats();
      expect(stats.systemLoad.cpuUtilization).toBe(0.8);
    });
  });

  describe('getStats', () => {
    it('should return global statistics', () => {
      limiter.check('c1', 't1', 'free');
      const stats = limiter.getStats();
      expect(stats.totalClients).toBeGreaterThan(0);
      expect(stats.activePolicies).toBeGreaterThan(0);
      expect(stats.globalAllowRate).toBeGreaterThanOrEqual(0);
    });

    it('should list active policies', () => {
      const stats = limiter.getStats();
      expect(stats.activePolicies).toBe(4);
    });
  });

  describe('updatePolicy', () => {
    it('should update an existing policy', () => {
      limiter.updatePolicy('free', { active: false });
      const stats = limiter.getStats();
      expect(stats.activePolicies).toBe(3);
    });

    it('should throw if policy not found', () => {
      expect(() => limiter.updatePolicy('nonexistent', {})).toThrow('Policy nonexistent not found');
    });
  });
});
