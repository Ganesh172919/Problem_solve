import { describe, it, expect } from '@jest/globals';
import {
  getTierPricing,
  getUpgradeCostProrated,
  estimateMonthlyApiCost,
  getTierComparison,
} from '@/lib/billing';

describe('Billing Module', () => {
  describe('getTierPricing', () => {
    it('should return correct pricing for all tiers', () => {
      expect(getTierPricing('free')).toEqual({ monthly: 0, apiCallLimit: 100 });
      expect(getTierPricing('pro')).toEqual({ monthly: 29, apiCallLimit: 10000 });
      expect(getTierPricing('enterprise')).toEqual({ monthly: 299, apiCallLimit: 1000000 });
    });

    it('should handle invalid tiers', () => {
      expect(getTierPricing('invalid' as any)).toBeUndefined();
    });
  });

  describe('getUpgradeCostProrated', () => {
    it('should calculate prorated cost for upgrade', () => {
      const startDate = new Date('2024-01-01');
      const currentDate = new Date('2024-01-15');

      // 15 days into 31-day month (approximately 48% through period)
      const cost = getUpgradeCostProrated('free', 'pro', startDate, currentDate);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(29);
    });

    it('should return 0 for same tier', () => {
      const startDate = new Date('2024-01-01');
      const currentDate = new Date('2024-01-15');

      const cost = getUpgradeCostProrated('pro', 'pro', startDate, currentDate);
      expect(cost).toBe(0);
    });

    it('should handle downgrade scenarios', () => {
      const startDate = new Date('2024-01-01');
      const currentDate = new Date('2024-01-15');

      const cost = getUpgradeCostProrated('pro', 'free', startDate, currentDate);
      expect(cost).toBeLessThanOrEqual(0);
    });
  });

  describe('estimateMonthlyApiCost', () => {
    it('should calculate costs within tier limits', () => {
      expect(estimateMonthlyApiCost('free', 50)).toBe(0);
      expect(estimateMonthlyApiCost('pro', 5000)).toBe(29);
      expect(estimateMonthlyApiCost('enterprise', 500000)).toBe(299);
    });

    it('should calculate overage costs', () => {
      const cost = estimateMonthlyApiCost('free', 200);
      expect(cost).toBeGreaterThan(0);

      const proCost = estimateMonthlyApiCost('pro', 15000);
      expect(proCost).toBeGreaterThan(29);
    });

    it('should handle zero usage', () => {
      expect(estimateMonthlyApiCost('free', 0)).toBe(0);
      expect(estimateMonthlyApiCost('pro', 0)).toBe(29);
    });
  });

  describe('getTierComparison', () => {
    it('should return comparison for all tiers', () => {
      const comparison = getTierComparison();

      expect(comparison).toHaveLength(3);
      expect(comparison[0].tier).toBe('free');
      expect(comparison[1].tier).toBe('pro');
      expect(comparison[2].tier).toBe('enterprise');
    });

    it('should include all required fields', () => {
      const comparison = getTierComparison();

      comparison.forEach(tier => {
        expect(tier).toHaveProperty('tier');
        expect(tier).toHaveProperty('price');
        expect(tier).toHaveProperty('features');
        expect(tier.features).toHaveProperty('apiCalls');
        expect(tier.features).toHaveProperty('rateLimit');
      });
    });
  });
});
