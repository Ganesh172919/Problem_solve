import { describe, it, expect } from '@jest/globals';
import { validateEmail, validateApiKey, validateTier, validatePagination } from '@/lib/validation';

describe('Validation Module', () => {
  describe('validateEmail', () => {
    it('should validate correct email formats', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('user.name+tag@example.co.uk')).toBe(true);
      expect(validateEmail('user_name@example-domain.com')).toBe(true);
    });

    it('should reject invalid email formats', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('invalid@')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('user@.com')).toBe(false);
      expect(validateEmail('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateEmail('a@b.c')).toBe(true);
      expect(validateEmail('user@localhost')).toBe(true);
    });
  });

  describe('validateApiKey', () => {
    it('should validate correct API key format', () => {
      const validKey = 'aian_' + '0'.repeat(64);
      expect(validateApiKey(validKey)).toBe(true);
    });

    it('should reject invalid API key formats', () => {
      expect(validateApiKey('invalid')).toBe(false);
      expect(validateApiKey('aian_short')).toBe(false);
      expect(validateApiKey('wrong_prefix_' + '0'.repeat(64))).toBe(false);
      expect(validateApiKey('')).toBe(false);
    });
  });

  describe('validateTier', () => {
    it('should validate correct tier values', () => {
      expect(validateTier('free')).toBe(true);
      expect(validateTier('pro')).toBe(true);
      expect(validateTier('enterprise')).toBe(true);
    });

    it('should reject invalid tier values', () => {
      expect(validateTier('premium')).toBe(false);
      expect(validateTier('basic')).toBe(false);
      expect(validateTier('')).toBe(false);
      expect(validateTier('FREE')).toBe(false);
    });
  });

  describe('validatePagination', () => {
    it('should validate correct pagination values', () => {
      expect(validatePagination(1, 10)).toEqual({ page: 1, limit: 10 });
      expect(validatePagination(5, 50)).toEqual({ page: 5, limit: 50 });
    });

    it('should apply defaults for invalid values', () => {
      expect(validatePagination(0, 10)).toEqual({ page: 1, limit: 10 });
      expect(validatePagination(-1, 10)).toEqual({ page: 1, limit: 10 });
      expect(validatePagination(1, 0)).toEqual({ page: 1, limit: 20 });
      expect(validatePagination(1, -5)).toEqual({ page: 1, limit: 20 });
    });

    it('should enforce maximum limits', () => {
      expect(validatePagination(1, 200)).toEqual({ page: 1, limit: 100 });
      expect(validatePagination(1000, 50)).toEqual({ page: 1000, limit: 50 });
    });
  });
});
