import { describe, it, expect, beforeEach } from '@jest/globals';
import { getSyntheticDataGenerator, SyntheticDataGenerator, FieldDefinition } from '../../../src/lib/syntheticDataGenerator';

describe('getSyntheticDataGenerator', () => {
  beforeEach(() => {
    (globalThis as any).__syntheticDataGenerator__ = undefined;
  });

  it('returns a singleton instance', () => {
    const a = getSyntheticDataGenerator();
    const b = getSyntheticDataGenerator();
    expect(a).toBe(b);
  });

  it('returns a new instance after reset', () => {
    const a = getSyntheticDataGenerator();
    (globalThis as any).__syntheticDataGenerator__ = undefined;
    const b = getSyntheticDataGenerator();
    expect(a).not.toBe(b);
  });
});

describe('SyntheticDataGenerator', () => {
  let gen: SyntheticDataGenerator;
  const rng = () => 0.5;

  beforeEach(() => {
    (globalThis as any).__syntheticDataGenerator__ = undefined;
    gen = getSyntheticDataGenerator();
  });

  describe('generateFieldValue', () => {
    it('generates a string', () => {
      const field: FieldDefinition = { name: 'f', type: 'string', required: true };
      expect(typeof gen.generateFieldValue(field, rng)).toBe('string');
    });

    it('generates a number', () => {
      const field: FieldDefinition = { name: 'f', type: 'number', required: true, min: 0, max: 100 };
      expect(typeof gen.generateFieldValue(field, rng)).toBe('number');
    });

    it('generates a boolean', () => {
      const field: FieldDefinition = { name: 'f', type: 'boolean', required: true };
      expect(typeof gen.generateFieldValue(field, rng)).toBe('boolean');
    });

    it('generates a date', () => {
      const field: FieldDefinition = { name: 'f', type: 'date', required: true };
      expect(gen.generateFieldValue(field, rng)).toBeInstanceOf(Date);
    });

    it('generates an email containing @', () => {
      const field: FieldDefinition = { name: 'f', type: 'email', required: true };
      const val = gen.generateFieldValue(field, rng) as string;
      expect(val).toContain('@');
    });

    it('generates a uuid matching v4 pattern', () => {
      const field: FieldDefinition = { name: 'f', type: 'uuid', required: true };
      const val = gen.generateFieldValue(field, rng) as string;
      expect(val).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates a phone in E.164-like format', () => {
      const field: FieldDefinition = { name: 'f', type: 'phone', required: true };
      const val = gen.generateFieldValue(field, rng) as string;
      expect(val).toMatch(/^\+1-\d{3}-\d{3}-\d{4}$/);
    });

    it('generates an enum value from enumValues list', () => {
      const field: FieldDefinition = { name: 'f', type: 'enum', required: true, enumValues: ['X', 'Y', 'Z'] };
      expect(['X', 'Y', 'Z']).toContain(gen.generateFieldValue(field, rng));
    });
  });

  describe('generateDataset', () => {
    it('returns the correct row count', () => {
      const dataset = gen.generateDataset({
        schema: { name: 'test', fields: [{ name: 'id', type: 'uuid', required: true }] },
        rowCount: 10,
        seed: 42,
      });
      expect(dataset.rowCount).toBe(10);
      expect(dataset.rows.length).toBe(10);
    });
  });

  describe('validateSchema', () => {
    it('catches duplicate field names', () => {
      const errors = gen.validateSchema({
        name: 'bad',
        fields: [
          { name: 'x', type: 'string', required: true },
          { name: 'x', type: 'string', required: true },
        ],
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('returns empty array for a valid schema', () => {
      const errors = gen.validateSchema({
        name: 'good',
        fields: [{ name: 'id', type: 'uuid', required: true }],
      });
      expect(errors).toEqual([]);
    });
  });

  describe('applyPrivacyConstraints', () => {
    it('masks PII keeping specified leading chars', () => {
      const data = [{ email: 'alice.smith@example.com' }];
      const result = gen.applyPrivacyConstraints(data, [
        { field: 'email', technique: 'mask', keepChars: 2, maskChar: '*' },
      ]);
      expect((result[0].email as string).startsWith('al')).toBe(true);
      expect(result[0].email as string).toContain('*');
    });
  });

  describe('computeStatistics', () => {
    it('returns mean and stddev for numeric fields', () => {
      const dataset = gen.generateDataset({
        schema: { name: 'stats', fields: [{ name: 'val', type: 'number', required: true, min: 0, max: 100 }] },
        rowCount: 20,
        seed: 1,
      });
      const stats = gen.computeStatistics(dataset);
      expect(stats['val']).toBeDefined();
      expect(typeof stats['val'].mean).toBe('number');
      expect(typeof stats['val'].stddev).toBe('number');
    });
  });

  describe('detectAnomalies', () => {
    it('returns a non-negative number', () => {
      const dataset = gen.generateDataset({
        schema: { name: 'anom', fields: [{ name: 'val', type: 'number', required: true, min: 0, max: 100 }] },
        rowCount: 20,
        seed: 2,
      });
      const count = gen.detectAnomalies(dataset);
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getGenerationStats', () => {
    it('returns a stats object with numeric fields', () => {
      gen.generateDataset({
        schema: { name: 'gs', fields: [{ name: 'id', type: 'uuid', required: true }] },
        rowCount: 5,
        seed: 3,
      });
      const stats = gen.getGenerationStats();
      expect(typeof stats.totalGenerated).toBe('number');
      expect(typeof stats.schemasProcessed).toBe('number');
      expect(typeof stats.avgGenerationTimeMs).toBe('number');
      expect(stats.schemasProcessed).toBeGreaterThanOrEqual(1);
    });
  });
});
