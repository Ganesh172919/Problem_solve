import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  AutonomousRevenueOptimizer,
  getAutonomousRevenueOptimizer,
  RevenueStream,
  RevenueEvent,
} from '@/lib/autonomousRevenueOptimizer';

function makeStream(overrides: Partial<RevenueStream> = {}): RevenueStream {
  return {
    id: 'stream-1',
    name: 'Pro Plan',
    type: 'subscription',
    tenantId: 'tenant-1',
    monthlyRecurring: 1000,
    annualRecurring: 12000,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
    tags: ['saas'],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RevenueEvent> = {}): RevenueEvent {
  return {
    streamId: 'stream-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    amount: 200,
    currency: 'USD',
    timestamp: Date.now(),
    eventType: 'upgrade',
    metadata: {},
    ...overrides,
  };
}

describe('AutonomousRevenueOptimizer', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__autonomousRevenueOptimizer__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getAutonomousRevenueOptimizer();
    const b = getAutonomousRevenueOptimizer();
    expect(a).toBe(b);
  });

  it('new instance is an AutonomousRevenueOptimizer', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    expect(optimizer).toBeInstanceOf(AutonomousRevenueOptimizer);
  });

  it('addRevenueStream registers stream and reflects in summary', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    optimizer.addRevenueStream(makeStream());
    const summary = optimizer.getSummary();
    expect(summary.totalStreams).toBe(1);
    expect(summary.totalMRR).toBe(1000);
    expect(summary.totalARR).toBe(12000);
  });

  it('recordRevenueEvent upgrade increases stream MRR', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    optimizer.addRevenueStream(makeStream());
    optimizer.recordRevenueEvent(makeEvent({ eventType: 'upgrade', amount: 200 }));
    const summary = optimizer.getSummary();
    expect(summary.totalMRR).toBe(1200);
  });

  it('recordRevenueEvent churn zeroes stream MRR', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    optimizer.addRevenueStream(makeStream());
    optimizer.recordRevenueEvent(makeEvent({ eventType: 'churn', amount: 0 }));
    const summary = optimizer.getSummary();
    expect(summary.totalMRR).toBe(0);
  });

  it('computeElasticity returns valid ElasticityScore shape and range', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    optimizer.addRevenueStream(makeStream());
    const score = optimizer.computeElasticity('stream-1');
    expect(score.streamId).toBe('stream-1');
    expect(score.priceElasticity).toBeGreaterThanOrEqual(-1);
    expect(score.priceElasticity).toBeLessThanOrEqual(1);
    expect(score.optimalPriceMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(score.optimalPriceMultiplier).toBeLessThanOrEqual(3.0);
    expect(typeof score.revenueAtOptimal).toBe('number');
    expect(typeof score.computedAt).toBe('number');
  });

  it('computeElasticity throws for unknown stream', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    expect(() => optimizer.computeElasticity('nonexistent')).toThrow('Unknown stream');
  });

  it('detectExpansionOpportunities returns an array', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    optimizer.addRevenueStream(makeStream({ id: 's2', tenantId: 'tenant-2', monthlyRecurring: 600 }));
    const opportunities = optimizer.detectExpansionOpportunities();
    expect(Array.isArray(opportunities)).toBe(true);
  });

  it('generateUpliftRecommendations returns model with correct upliftPercent', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    const model = optimizer.generateUpliftRecommendations('model-1', 'Price Test', 10000, 11500, 500);
    expect(model.id).toBe('model-1');
    expect(model.upliftPercent).toBeCloseTo(15, 1);
    expect(model.pValue).toBeGreaterThanOrEqual(0.001);
    expect(model.pValue).toBeLessThanOrEqual(1);
    expect(model.confidence).toBeGreaterThanOrEqual(0);
  });

  it('getSummary has correct shape', () => {
    const optimizer = getAutonomousRevenueOptimizer();
    const summary = optimizer.getSummary();
    expect(typeof summary.totalStreams).toBe('number');
    expect(typeof summary.totalMRR).toBe('number');
    expect(typeof summary.totalARR).toBe('number');
    expect(typeof summary.averageElasticity).toBe('number');
    expect(typeof summary.expansionOpportunities).toBe('number');
    expect(typeof summary.contractionAlerts).toBe('number');
    expect(Array.isArray(summary.topLTVTenants)).toBe(true);
    expect(typeof summary.upliftModels).toBe('number');
    expect(typeof summary.avgNetRevenueRetention).toBe('number');
    expect(typeof summary.revenueGrowthRate).toBe('number');
  });
});
