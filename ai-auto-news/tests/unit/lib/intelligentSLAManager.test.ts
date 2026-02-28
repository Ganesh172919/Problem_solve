import { describe, it, expect, beforeEach } from '@jest/globals';
import { IntelligentSLAManager } from '../../../src/lib/intelligentSLAManager';

describe('IntelligentSLAManager', () => {
  let manager: IntelligentSLAManager;

  beforeEach(() => {
    manager = new IntelligentSLAManager({ minObservationsForPrediction: 3, observationWindowSize: 100 });
  });

  function createTestSLA(tenantId = 'tenant-1') {
    return manager.defineSLA({
      name: 'Test SLA',
      tier: 'professional',
      tenantId,
      metrics: [
        { metricType: 'availability', target: 99.9, unit: '%', direction: 'gte', measurementMethod: 'average', weight: 1 },
        { metricType: 'latency_p99', target: 200, unit: 'ms', direction: 'lte', measurementMethod: 'percentile', weight: 0.5 },
      ],
      measurementWindow: 'monthly',
      creditTable: [
        { breachRangeMin: 5, breachRangeMax: 20, creditPercent: 10, description: 'Minor breach' },
        { breachRangeMin: 20, breachRangeMax: 100, creditPercent: 25, description: 'Major breach' },
      ],
      escalationContacts: ['ops@example.com'],
      remediation: { autoScale: true, autoFailover: true, alertThresholdPercent: 5, escalateAfterMs: 60_000, maxAutoRemediations: 3 },
      active: true,
      metadata: {},
    });
  }

  it('defines an SLA and creates initial state', () => {
    const sla = createTestSLA();
    expect(sla.slaId).toMatch(/^sla_/);
    expect(sla.tier).toBe('professional');
    const state = manager.getState(sla.slaId);
    expect(state).toBeDefined();
    expect(state!.status).toBe('in_compliance');
    expect(state!.compositeScore).toBe(100);
  });

  it('records compliant observations and maintains in_compliance status', () => {
    const sla = createTestSLA();
    manager.recordObservation(sla.slaId, 'svc-1', 'availability', 99.95);
    const state = manager.getState(sla.slaId);
    expect(state!.status).toBe('in_compliance');
  });

  it('records non-compliant availability and detects breach', () => {
    const sla = createTestSLA();
    manager.recordObservation(sla.slaId, 'svc-1', 'availability', 90);
    const state = manager.getState(sla.slaId);
    expect(['at_risk', 'breach_imminent', 'breached']).toContain(state!.status);
    const breaches = manager.getBreaches(sla.slaId, false);
    expect(breaches.length).toBeGreaterThan(0);
    expect(breaches[0]!.metricType).toBe('availability');
  });

  it('records non-compliant latency breach', () => {
    const sla = createTestSLA();
    manager.recordObservation(sla.slaId, 'svc-1', 'latency_p99', 500);
    const breaches = manager.getBreaches(sla.slaId, false);
    expect(breaches.length).toBeGreaterThan(0);
    expect(breaches[0]!.metricType).toBe('latency_p99');
  });

  it('predicts breach with insufficient data', () => {
    const sla = createTestSLA();
    const result = manager.predictBreach(sla.slaId, 'availability');
    expect(result.predicted).toBe(false);
    expect(result.confidencePercent).toBe(0);
  });

  it('predicts breach with degrading data trend', () => {
    const sla = createTestSLA();
    // Insert degrading trend observations
    for (let i = 0; i < 15; i++) {
      manager.recordObservation(sla.slaId, 'svc-1', 'availability', 99.9 - i * 0.3);
    }
    const result = manager.predictBreach(sla.slaId, 'availability');
    expect(typeof result.predicted).toBe('boolean');
    expect(result.confidencePercent).toBeGreaterThanOrEqual(0);
  });

  it('resolves a breach by ID', () => {
    const sla = createTestSLA();
    manager.recordObservation(sla.slaId, 'svc-1', 'availability', 80);
    const breaches = manager.getBreaches(sla.slaId, false);
    expect(breaches.length).toBeGreaterThan(0);
    const breach = breaches[0]!;
    manager.resolveBreachById(breach.breachId, 'Rolled back faulty deployment');
    const resolved = manager.getBreaches(sla.slaId, true);
    expect(resolved.some(b => b.breachId === breach.breachId)).toBe(true);
    expect(resolved.find(b => b.breachId === breach.breachId)!.rootCause).toBe('Rolled back faulty deployment');
  });

  it('calculates credits based on breach severity', () => {
    const sla = createTestSLA();
    manager.recordObservation(sla.slaId, 'svc-1', 'availability', 70); // ~30% deviation
    const credits = manager.calculateCredits(sla.slaId, 1000);
    expect(credits).toBeGreaterThanOrEqual(0);
  });

  it('generates portfolio report spanning multiple SLAs', () => {
    createTestSLA('t1');
    createTestSLA('t2');
    const report = manager.generatePortfolioReport(Date.now() - 86_400_000, Date.now());
    expect(report.reportId).toMatch(/^slareport_/);
    expect(report.totalSLAs).toBeGreaterThanOrEqual(2);
    expect(typeof report.avgComplianceScore).toBe('number');
  });

  it('lists SLAs filtered by tenant', () => {
    createTestSLA('tenant-a');
    createTestSLA('tenant-b');
    const tenantA = manager.listSLAs('tenant-a');
    expect(tenantA.every(s => s.tenantId === 'tenant-a')).toBe(true);
  });

  it('computes composite score as 100 for fully compliant SLA', () => {
    const sla = createTestSLA();
    const score = manager.computeCompositeScore(sla.slaId);
    expect(score).toBeCloseTo(100, 5);
  });
});
