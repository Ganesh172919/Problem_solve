import { describe, it, expect, beforeEach } from '@jest/globals';
import { getRevenueLeakageDetector, RevenueLeakageDetector, LeakageEvent } from '../../../src/lib/revenueLeakageDetector';

const period = { start: new Date('2024-01-01'), end: new Date('2024-01-31') };

function makeEvent(tenantId: string): LeakageEvent {
  return {
    id: `ev_${Date.now()}_${Math.random()}`,
    tenantId,
    category: 'billing_errors',
    detectedAt: new Date(),
    periodStart: period.start,
    periodEnd: period.end,
    estimatedLoss: 500,
    currency: 'USD',
    evidence: {},
    severity: 'medium',
    status: 'open',
  };
}

describe('getRevenueLeakageDetector', () => {
  beforeEach(() => {
    (globalThis as any).__revenueLeakageDetector__ = undefined;
  });

  it('returns a singleton instance', () => {
    const a = getRevenueLeakageDetector();
    const b = getRevenueLeakageDetector();
    expect(a).toBe(b);
  });

  it('returns a new instance after reset', () => {
    const a = getRevenueLeakageDetector();
    (globalThis as any).__revenueLeakageDetector__ = undefined;
    const b = getRevenueLeakageDetector();
    expect(a).not.toBe(b);
  });
});

describe('RevenueLeakageDetector', () => {
  let detector: RevenueLeakageDetector;

  beforeEach(() => {
    (globalThis as any).__revenueLeakageDetector__ = undefined;
    detector = getRevenueLeakageDetector();
  });

  describe('detectLeakage', () => {
    it('returns a LeakageReport (array of LeakageEvents)', () => {
      const events = detector.detectLeakage('tenant1', period);
      expect(Array.isArray(events)).toBe(true);
      for (const ev of events) {
        expect(ev.tenantId).toBe('tenant1');
        expect(typeof ev.estimatedLoss).toBe('number');
        expect(ev.status).toBe('open');
      }
    });
  });

  describe('computeRevenueGap', () => {
    it('returns a non-negative gap when actual < expected', () => {
      const gap = detector.computeRevenueGap(10000, 8000, 'tenant2', period);
      expect(gap.gap).toBeGreaterThanOrEqual(0);
      expect(gap.gapRate).toBeGreaterThanOrEqual(0);
      expect(gap.expectedRevenue).toBe(10000);
      expect(gap.actualRevenue).toBe(8000);
    });

    it('returns gap of 0 when actual >= expected', () => {
      const gap = detector.computeRevenueGap(5000, 6000, 'tenant2', period);
      expect(gap.gap).toBe(0);
    });
  });

  describe('analyzePatterns', () => {
    it('returns an array of patterns grouped by category', () => {
      const events = [makeEvent('tenant3'), makeEvent('tenant3')];
      const patterns = detector.analyzePatterns(events);
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].category).toBe('billing_errors');
      expect(typeof patterns[0].avgLossPerEvent).toBe('number');
    });
  });

  describe('generateRecoveryPlan', () => {
    it('returns a plan with actions and recovery estimate', () => {
      const events: LeakageEvent[] = [
        { ...makeEvent('tenant4'), category: 'unpaid_invoices', estimatedLoss: 1500, severity: 'high' },
      ];
      const plan = detector.generateRecoveryPlan(events);
      expect(plan.actions.length).toBeGreaterThan(0);
      expect(plan.totalEstimatedRecovery).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(plan.priorityOrder)).toBe(true);
    });
  });

  describe('getLeakageMetrics', () => {
    it('returns metrics object with numeric fields', () => {
      detector.detectLeakage('tenant5', period);
      const metrics = detector.getLeakageMetrics();
      expect(typeof metrics.totalEventsDetected).toBe('number');
      expect(typeof metrics.totalEstimatedLoss).toBe('number');
      expect(typeof metrics.totalRecovered).toBe('number');
      expect(typeof metrics.recoveryRate).toBe('number');
      expect(typeof metrics.openCases).toBe('number');
    });
  });

  describe('generateReport', () => {
    it('returns a LeakageReport with tenantId and all required fields', () => {
      const report = detector.generateReport('tenant6', period);
      expect(report.tenantId).toBe('tenant6');
      expect(Array.isArray(report.events)).toBe(true);
      expect(Array.isArray(report.patterns)).toBe(true);
      expect(report.recoveryPlan).toBeDefined();
      expect(report.revenueGap).toBeDefined();
      expect(report.generatedAt).toBeInstanceOf(Date);
    });
  });
});
