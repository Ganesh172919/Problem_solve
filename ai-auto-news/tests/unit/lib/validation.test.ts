import { describe, it, expect } from '@jest/globals';
import { validateEmail, validateApiKey, validateTier, validatePagination, ValidationError } from '@/lib/validation';

function tryValidateEmail(email: string): boolean {
  try { validateEmail(email); return true; } catch { return false; }
}

describe('Validation Module', () => {
  describe('validateEmail', () => {
    it('should validate correct email formats', () => {
      expect(tryValidateEmail('user@example.com')).toBe(true);
      expect(tryValidateEmail('user.name+tag@example.co.uk')).toBe(true);
      expect(tryValidateEmail('user_name@example-domain.com')).toBe(true);
    });

    it('should reject invalid email formats', () => {
      expect(tryValidateEmail('invalid')).toBe(false);
      expect(tryValidateEmail('invalid@')).toBe(false);
      expect(tryValidateEmail('@example.com')).toBe(false);
      expect(tryValidateEmail('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(tryValidateEmail('a@b.c')).toBe(true);
      expect(tryValidateEmail('user@localhost')).toBe(true);
    });

    it('should throw ValidationError for invalid input', () => {
      expect(() => validateEmail('invalid')).toThrow(ValidationError);
      expect(() => validateEmail('')).toThrow(ValidationError);
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

    it('should throw for invalid values', () => {
      expect(() => validatePagination(0, 10)).toThrow(ValidationError);
      expect(() => validatePagination(-1, 10)).toThrow(ValidationError);
      expect(() => validatePagination(1, 0)).toThrow(ValidationError);
      expect(() => validatePagination(1, -5)).toThrow(ValidationError);
    });

    it('should enforce maximum limits', () => {
      expect(() => validatePagination(1, 200)).toThrow(ValidationError);
      expect(validatePagination(1000, 50)).toEqual({ page: 1000, limit: 50 });
    });
  });
});
