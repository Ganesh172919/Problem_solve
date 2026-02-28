import { describe, it, expect } from '@jest/globals';
import {
  getMonthlyPrice,
  getUpgradeCostProrated,
  estimateMonthlyApiCost,
  getTierComparison,
} from '@/lib/billing';

describe('Billing Module', () => {
  describe('getMonthlyPrice', () => {
    it('should return correct monthly pricing for all tiers', () => {
      expect(getMonthlyPrice('free')).toBe(0);
      expect(getMonthlyPrice('pro')).toBeGreaterThan(0);
      expect(getMonthlyPrice('enterprise')).toBeGreaterThan(getMonthlyPrice('pro'));
    });
  });

  describe('getUpgradeCostProrated', () => {
    it('should calculate prorated cost for upgrade', () => {
      const cost = getUpgradeCostProrated('free', 'pro', 16);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(getMonthlyPrice('pro'));
    });

    it('should return 0 for same tier', () => {
      const cost = getUpgradeCostProrated('pro', 'pro', 15);
      expect(cost).toBe(0);
    });

    it('should return 0 for downgrade (no charge)', () => {
      const cost = getUpgradeCostProrated('pro', 'free', 15);
      expect(cost).toBe(0);
    });
  });

  describe('estimateMonthlyApiCost', () => {
    it('should return included=true when within limits', () => {
      const result = estimateMonthlyApiCost(50, 'free');
      expect(result.included).toBe(true);
      expect(result.overageCallCount).toBe(0);
      expect(result.estimatedOverageCost).toBe(0);
    });

    it('should calculate overage costs', () => {
      const result = estimateMonthlyApiCost(999999, 'free');
      expect(result.included).toBe(false);
      expect(result.overageCallCount).toBeGreaterThan(0);
    });

    it('should handle zero usage', () => {
      const result = estimateMonthlyApiCost(0, 'pro');
      expect(result.included).toBe(true);
      expect(result.overageCallCount).toBe(0);
    });
  });

  describe('getTierComparison', () => {
    it('should return comparison rows', () => {
      const comparison = getTierComparison();
      expect(Array.isArray(comparison)).toBe(true);
      expect(comparison.length).toBeGreaterThan(0);
    });

    it('should include required fields per row', () => {
      const comparison = getTierComparison();
      comparison.forEach(row => {
        expect(row).toHaveProperty('feature');
        expect(row).toHaveProperty('free');
        expect(row).toHaveProperty('pro');
        expect(row).toHaveProperty('enterprise');
      });
    });
  });
});
