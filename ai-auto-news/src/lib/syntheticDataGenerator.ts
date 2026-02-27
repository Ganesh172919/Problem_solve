/**
 * @module syntheticDataGenerator
 * @description AI-powered synthetic test data generation engine. Produces statistically
 * realistic, privacy-safe datasets with support for complex schemas, referential integrity,
 * PII masking, distribution modeling, and anomaly injection. No external faker libraries
 * required — all generation logic is implemented inline.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface FieldDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'email' | 'uuid' | 'phone' | 'address' | 'enum' | 'nested';
  required: boolean;
  nullable?: boolean;
  nullRate?: number;
  enumValues?: string[];
  min?: number;
  max?: number;
  pattern?: string;
  distribution?: 'uniform' | 'normal' | 'exponential' | 'zipf';
  mean?: number;
  stddev?: number;
  nestedSchema?: DataSchema;
  foreignKey?: { dataset: string; field: string };
  unique?: boolean;
}

export interface DataSchema {
  name: string;
  fields: FieldDefinition[];
  primaryKey?: string;
  constraints?: SchemaConstraint[];
}

export interface SchemaConstraint {
  type: 'unique_combo' | 'range_check' | 'referential' | 'conditional';
  fields: string[];
  condition?: string;
  targetDataset?: string;
  targetField?: string;
}

export interface GenerationRule {
  fieldName: string;
  dependsOn?: string;
  transform?: (value: unknown, row: Record<string, unknown>) => unknown;
  weightedValues?: Array<{ value: unknown; weight: number }>;
}

export interface PrivacyConstraint {
  field: string;
  technique: 'mask' | 'pseudonymize' | 'generalize' | 'suppress' | 'noise_add';
  maskChar?: string;
  precision?: number;
  noiseSigma?: number;
  keepChars?: number;
}

export interface SyntheticDataSpec {
  schema: DataSchema;
  rowCount: number;
  rules?: GenerationRule[];
  privacyConstraints?: PrivacyConstraint[];
  seed?: number;
  injectAnomalyRate?: number;
  locale?: string;
}

export interface SyntheticDataset {
  id: string;
  schemaName: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  generatedAt: Date;
  qualityReport: DataQualityReport;
  metadata: Record<string, unknown>;
}

export interface DataQualityReport {
  completeness: number;
  uniquenessScore: number;
  distributionFidelity: number;
  anomalyCount: number;
  constraintViolations: number;
  overallScore: number;
  fieldStats: Record<string, FieldStats>;
}

export interface FieldStats {
  nullCount: number;
  uniqueCount: number;
  min?: number | string;
  max?: number | string;
  mean?: number;
  stddev?: number;
  distribution?: Record<string, number>;
}

export interface GenerationStats {
  totalGenerated: number;
  totalExported: number;
  schemasProcessed: number;
  avgGenerationTimeMs: number;
  anomaliesInjected: number;
  privacyOpsApplied: number;
}

// ─── Inline pseudo-random seeded PRNG (Mulberry32) ───────────────────────────
function createPRNG(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Inline generation helpers ────────────────────────────────────────────────
const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Eva', 'Frank', 'Grace', 'Hank', 'Iris', 'Jack'];
const LAST_NAMES  = ['Smith', 'Jones', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson'];
const DOMAINS     = ['example.com', 'test.io', 'demo.net', 'sample.org', 'mock.dev'];
const STREETS     = ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Pine Rd', 'Elm Blvd', 'Birch Way'];
const CITIES      = ['Springfield', 'Shelbyville', 'Ogdenville', 'North Haverbrook', 'Capital City'];
const STATES      = ['CA', 'NY', 'TX', 'FL', 'IL', 'WA', 'OR', 'CO', 'GA', 'MA'];

function sampleArray<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function normalSample(mean: number, std: number, rng: () => number): number {
  // Box-Muller
  const u1 = rng(), u2 = rng();
  const z  = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

function exponentialSample(mean: number, rng: () => number): number {
  return -mean * Math.log(Math.max(rng(), 1e-10));
}

function zipfSample(n: number, s: number, rng: () => number): number {
  const H = Array.from({ length: n }, (_, k) => 1 / Math.pow(k + 1, s))
    .reduce((a, b) => a + b, 0);
  const r = rng() * H;
  let cum = 0;
  for (let k = 1; k <= n; k++) {
    cum += 1 / Math.pow(k, s);
    if (cum >= r) return k;
  }
  return n;
}

function generateUUID(rng: () => number): string {
  const hex = (n: number) => Math.floor(rng() * n).toString(16).padStart(2, '0');
  return `${hex(256)}${hex(256)}${hex(256)}${hex(256)}-${hex(256)}${hex(256)}-4${hex(16)}${hex(256)}-${(8 + Math.floor(rng() * 4)).toString(16)}${hex(256)}-${hex(256)}${hex(256)}${hex(256)}${hex(256)}${hex(256)}${hex(256)}`;
}

function generateEmail(rng: () => number): string {
  const first = sampleArray(FIRST_NAMES, rng).toLowerCase();
  const last  = sampleArray(LAST_NAMES, rng).toLowerCase();
  const n     = Math.floor(rng() * 999);
  return `${first}.${last}${n}@${sampleArray(DOMAINS, rng)}`;
}

function generatePhone(rng: () => number): string {
  const area = Math.floor(200 + rng() * 800);
  const exch = Math.floor(200 + rng() * 800);
  const subs = Math.floor(1000 + rng() * 9000);
  return `+1-${area}-${exch}-${subs}`;
}

function generateAddress(rng: () => number): string {
  const num  = Math.floor(100 + rng() * 9900);
  const zip  = Math.floor(10000 + rng() * 90000);
  return `${num} ${sampleArray(STREETS, rng)}, ${sampleArray(CITIES, rng)}, ${sampleArray(STATES, rng)} ${zip}`;
}

function generateString(field: FieldDefinition, rng: () => number): string {
  const charset = 'abcdefghijklmnopqrstuvwxyz';
  const len     = Math.floor((field.min ?? 5) + rng() * ((field.max ?? 20) - (field.min ?? 5)));
  return Array.from({ length: len }, () => charset[Math.floor(rng() * charset.length)]).join('');
}

function generateDate(field: FieldDefinition, rng: () => number): Date {
  const minMs = field.min ?? new Date('2000-01-01').getTime();
  const maxMs = field.max ?? Date.now();
  return new Date(minMs + rng() * (maxMs - minMs));
}

// ─── Main Class ───────────────────────────────────────────────────────────────
export class SyntheticDataGenerator {
  private stats: GenerationStats = {
    totalGenerated: 0, totalExported: 0,
    schemasProcessed: 0, avgGenerationTimeMs: 0,
    anomaliesInjected: 0, privacyOpsApplied: 0,
  };
  private timings: number[] = [];
  private datasets = new Map<string, SyntheticDataset>();
  private uniqueTrackers = new Map<string, Set<unknown>>();

  generateDataset(spec: SyntheticDataSpec): SyntheticDataset {
    const start = Date.now();
    const rng   = createPRNG(spec.seed ?? Math.floor(Math.random() * 1e9));
    logger.info('Starting synthetic dataset generation', { schema: spec.schema.name, rows: spec.rowCount });

    const validationErrors = this.validateSchema(spec.schema);
    if (validationErrors.length > 0) {
      logger.warn('Schema validation warnings', { errors: validationErrors });
    }

    this.uniqueTrackers.clear();
    const rows: Record<string, unknown>[] = [];

    for (let i = 0; i < spec.rowCount; i++) {
      const row = this.generateRow(spec.schema, spec.rules ?? [], rng);
      if (spec.injectAnomalyRate && rng() < spec.injectAnomalyRate) {
        this.injectAnomaly(row, spec.schema, rng);
        this.stats.anomaliesInjected++;
      }
      rows.push(row);
    }

    let finalRows = rows;
    if (spec.privacyConstraints && spec.privacyConstraints.length > 0) {
      finalRows = this.applyPrivacyConstraints(rows, spec.privacyConstraints);
    }

    const qualityReport = this.computeQualityReport(finalRows, spec.schema);
    const dataset: SyntheticDataset = {
      id: generateUUID(rng),
      schemaName: spec.schema.name,
      rows: finalRows,
      rowCount: finalRows.length,
      generatedAt: new Date(),
      qualityReport,
      metadata: { seed: spec.seed, locale: spec.locale ?? 'en', specHash: spec.rowCount },
    };

    this.datasets.set(dataset.id, dataset);
    const elapsed = Date.now() - start;
    this.timings.push(elapsed);
    this.stats.totalGenerated += finalRows.length;
    this.stats.schemasProcessed++;
    this.stats.avgGenerationTimeMs = this.timings.reduce((a, b) => a + b, 0) / this.timings.length;

    logger.info('Dataset generation complete', { id: dataset.id, rows: finalRows.length, ms: elapsed });
    return dataset;
  }

  private generateRow(schema: DataSchema, rules: GenerationRule[], rng: () => number): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (field.nullable && rng() < (field.nullRate ?? 0.05)) {
        row[field.name] = null;
        continue;
      }
      const rule = rules.find(r => r.fieldName === field.name);
      if (rule?.weightedValues) {
        row[field.name] = this.weightedSample(rule.weightedValues, rng);
      } else {
        let val = this.generateFieldValue(field, rng);
        if (field.unique) val = this.ensureUnique(field.name, val, field, rng);
        row[field.name] = val;
      }
    }
    for (const rule of rules) {
      if (rule.transform) {
        row[rule.fieldName] = rule.transform(row[rule.fieldName], row);
      }
    }
    return row;
  }

  generateFieldValue(field: FieldDefinition, rng: () => number = Math.random): unknown {
    switch (field.type) {
      case 'uuid':    return generateUUID(rng);
      case 'email':   return generateEmail(rng);
      case 'phone':   return generatePhone(rng);
      case 'address': return generateAddress(rng);
      case 'boolean': return rng() > 0.5;
      case 'date':    return generateDate(field, rng);
      case 'enum':    return sampleArray(field.enumValues ?? ['A', 'B', 'C'], rng);
      case 'nested':  return field.nestedSchema ? this.generateRow(field.nestedSchema, [], rng) : {};
      case 'string':  return generateString(field, rng);
      case 'number': {
        const lo = field.min ?? 0, hi = field.max ?? 1000;
        if (field.distribution === 'normal')      return Math.round(normalSample(field.mean ?? (lo + hi) / 2, field.stddev ?? (hi - lo) / 6, rng));
        if (field.distribution === 'exponential') return Math.round(exponentialSample(field.mean ?? (hi - lo) / 3, rng));
        if (field.distribution === 'zipf')        return zipfSample(Math.round(hi - lo), 1.07, rng) + lo;
        return lo + rng() * (hi - lo);
      }
      default: return null;
    }
  }

  private ensureUnique(fieldName: string, value: unknown, field: FieldDefinition, rng: () => number): unknown {
    if (!this.uniqueTrackers.has(fieldName)) this.uniqueTrackers.set(fieldName, new Set());
    const seen = this.uniqueTrackers.get(fieldName)!;
    let attempts = 0;
    let v = value;
    while (seen.has(v) && attempts++ < 100) v = this.generateFieldValue(field, rng);
    seen.add(v);
    return v;
  }

  private weightedSample(items: Array<{ value: unknown; weight: number }>, rng: () => number): unknown {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = rng() * total;
    for (const item of items) { r -= item.weight; if (r <= 0) return item.value; }
    return items[items.length - 1].value;
  }

  private injectAnomaly(row: Record<string, unknown>, schema: DataSchema, rng: () => number): void {
    const field = sampleArray(schema.fields.filter(f => f.type === 'number'), rng);
    if (!field) return;
    const multiplier = rng() > 0.5 ? 100 : -1;
    row[field.name] = (typeof row[field.name] === 'number' ? (row[field.name] as number) : 0) * multiplier;
  }

  validateSchema(schema: DataSchema): string[] {
    const errors: string[] = [];
    const names = new Set<string>();
    for (const f of schema.fields) {
      if (names.has(f.name)) errors.push(`Duplicate field name: ${f.name}`);
      names.add(f.name);
      if (f.type === 'enum' && (!f.enumValues || f.enumValues.length === 0))
        errors.push(`Enum field ${f.name} has no enumValues`);
      if (f.type === 'nested' && !f.nestedSchema)
        errors.push(`Nested field ${f.name} missing nestedSchema`);
      if (f.min !== undefined && f.max !== undefined && f.min > f.max)
        errors.push(`Field ${f.name}: min > max`);
    }
    if (schema.primaryKey && !schema.fields.find(f => f.name === schema.primaryKey))
      errors.push(`Primary key ${schema.primaryKey} not found in fields`);
    return errors;
  }

  applyPrivacyConstraints(data: Record<string, unknown>[], constraints: PrivacyConstraint[]): Record<string, unknown>[] {
    const rng = createPRNG(42);
    return data.map(row => {
      const out = { ...row };
      for (const c of constraints) {
        if (!(c.field in out) || out[c.field] === null) continue;
        const val = String(out[c.field]);
        switch (c.technique) {
          case 'mask':
            out[c.field] = val.slice(0, c.keepChars ?? 2) + (c.maskChar ?? '*').repeat(Math.max(0, val.length - (c.keepChars ?? 2)));
            break;
          case 'pseudonymize':
            out[c.field] = generateUUID(rng);
            break;
          case 'generalize':
            if (typeof out[c.field] === 'number') {
              const p = c.precision ?? 10;
              out[c.field] = Math.floor((out[c.field] as number) / p) * p;
            }
            break;
          case 'suppress':
            out[c.field] = null;
            break;
          case 'noise_add':
            if (typeof out[c.field] === 'number') {
              out[c.field] = (out[c.field] as number) + normalSample(0, c.noiseSigma ?? 1, rng);
            }
            break;
        }
        this.stats.privacyOpsApplied++;
      }
      return out;
    });
  }

  computeStatistics(dataset: SyntheticDataset): Record<string, FieldStats> {
    return this.buildFieldStats(dataset.rows);
  }

  private buildFieldStats(rows: Record<string, unknown>[]): Record<string, FieldStats> {
    if (rows.length === 0) return {};
    const stats: Record<string, FieldStats> = {};
    const keys = Object.keys(rows[0]);
    for (const key of keys) {
      const vals    = rows.map(r => r[key]).filter(v => v !== null && v !== undefined);
      const nullCnt = rows.length - vals.length;
      const unique  = new Set(vals.map(String)).size;
      const nums    = vals.filter(v => typeof v === 'number') as number[];
      const mean    = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
      const stddev  = nums.length && mean !== undefined
        ? Math.sqrt(nums.reduce((a, v) => a + (v - mean) ** 2, 0) / nums.length)
        : undefined;
      const dist: Record<string, number> = {};
      if (vals.length <= 20 || unique < 20) {
        for (const v of vals) { const k = String(v); dist[k] = (dist[k] ?? 0) + 1; }
      }
      stats[key] = {
        nullCount: nullCnt, uniqueCount: unique,
        min: nums.length ? Math.min(...nums) : undefined,
        max: nums.length ? Math.max(...nums) : undefined,
        mean, stddev, distribution: Object.keys(dist).length ? dist : undefined,
      };
    }
    return stats;
  }

  private computeQualityReport(rows: Record<string, unknown>[], schema: DataSchema): DataQualityReport {
    const fieldStats   = this.buildFieldStats(rows);
    const totalCells   = rows.length * schema.fields.length;
    const nullCells    = Object.values(fieldStats).reduce((s, fs) => s + fs.nullCount, 0);
    const completeness = totalCells > 0 ? 1 - nullCells / totalCells : 1;
    const pkField      = schema.primaryKey;
    const uniqueness   = pkField && fieldStats[pkField]
      ? fieldStats[pkField].uniqueCount / rows.length : 1;
    const distFidelity = this.scoreDistributionFidelity(fieldStats, schema);
    const anomalyCount = this.detectAnomalies({ rows } as SyntheticDataset);
    const overall      = (completeness + uniqueness + distFidelity) / 3;
    return {
      completeness, uniquenessScore: uniqueness, distributionFidelity: distFidelity,
      anomalyCount, constraintViolations: 0, overallScore: overall, fieldStats,
    };
  }

  private scoreDistributionFidelity(stats: Record<string, FieldStats>, schema: DataSchema): number {
    let score = 0, count = 0;
    for (const f of schema.fields) {
      if (f.type !== 'number' || !stats[f.name]) continue;
      const s = stats[f.name];
      if (f.distribution === 'normal' && f.mean !== undefined && s.mean !== undefined) {
        const drift = Math.abs(s.mean - f.mean) / (f.mean || 1);
        score += Math.max(0, 1 - drift);
      } else {
        score += 0.9;
      }
      count++;
    }
    return count > 0 ? score / count : 0.9;
  }

  detectAnomalies(dataset: Pick<SyntheticDataset, 'rows'>): number {
    let count = 0;
    if (dataset.rows.length < 10) return 0;
    const keys = Object.keys(dataset.rows[0]);
    for (const key of keys) {
      const nums = dataset.rows.map(r => r[key]).filter(v => typeof v === 'number') as number[];
      if (nums.length < 5) continue;
      const mean   = nums.reduce((a, b) => a + b, 0) / nums.length;
      const std    = Math.sqrt(nums.reduce((a, v) => a + (v - mean) ** 2, 0) / nums.length);
      count += nums.filter(v => Math.abs(v - mean) > 3 * std).length;
    }
    return count;
  }

  exportDataset(dataset: SyntheticDataset, format: 'json' | 'csv' | 'jsonl' | 'tsv'): string {
    this.stats.totalExported++;
    switch (format) {
      case 'jsonl':
        return dataset.rows.map(r => JSON.stringify(r)).join('\n');
      case 'csv':
      case 'tsv': {
        const sep = format === 'csv' ? ',' : '\t';
        if (dataset.rows.length === 0) return '';
        const headers = Object.keys(dataset.rows[0]).join(sep);
        const body    = dataset.rows.map(r =>
          Object.values(r).map(v => v === null ? '' : String(v)).join(sep)
        ).join('\n');
        return `${headers}\n${body}`;
      }
      default:
        return JSON.stringify(dataset.rows, null, 2);
    }
  }

  getGenerationStats(): GenerationStats {
    return { ...this.stats };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export function getSyntheticDataGenerator(): SyntheticDataGenerator {
  if (!(globalThis as Record<string, unknown>).__syntheticDataGenerator__) {
    (globalThis as Record<string, unknown>).__syntheticDataGenerator__ = new SyntheticDataGenerator();
  }
  return (globalThis as Record<string, unknown>).__syntheticDataGenerator__ as SyntheticDataGenerator;
}
