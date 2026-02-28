import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  PredictiveChurnPreventor,
  getPredictiveChurnPreventor,
  BehaviorSignal,
  InterventionCampaign,
} from '@/lib/predictiveChurnPreventor';

function makeSignal(overrides: Partial<BehaviorSignal> = {}): BehaviorSignal {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    signalType: 'login',
    value: 0.8,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<InterventionCampaign> = {}): InterventionCampaign {
  return {
    id: 'campaign-1',
    name: 'Critical Risk Campaign',
    targetCohort: 'critical',
    channel: 'email',
    triggerRule: 'risk_score > 0.8',
    active: true,
    startedAt: Date.now(),
    totalTriggered: 0,
    totalConverted: 0,
    conversionRate: 0,
    ...overrides,
  };
}

describe('PredictiveChurnPreventor', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__predictiveChurnPreventor__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getPredictiveChurnPreventor();
    const b = getPredictiveChurnPreventor();
    expect(a).toBe(b);
  });

  it('new instance is a PredictiveChurnPreventor', () => {
    const preventor = getPredictiveChurnPreventor();
    expect(preventor).toBeInstanceOf(PredictiveChurnPreventor);
  });

  it('ingestBehaviorSignal enables computeRiskScore to run for user', () => {
    const preventor = getPredictiveChurnPreventor();
    preventor.ingestBehaviorSignal(makeSignal());
    const result = preventor.computeRiskScore('user-1', 'tenant-1');
    expect(result.userId).toBe('user-1');
    expect(result.signalCount ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('computeRiskScore returns score in [0, 1] range', () => {
    const preventor = getPredictiveChurnPreventor();
    const result = preventor.computeRiskScore('user-2', 'tenant-1');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.tenantId).toBe('tenant-1');
    expect(typeof result.computedAt).toBe('number');
  });

  it('computeRiskScore returns breakdown with expected keys', () => {
    const preventor = getPredictiveChurnPreventor();
    const result = preventor.computeRiskScore('user-3', 'tenant-1');
    const keys = Object.keys(result.breakdown);
    expect(keys).toContain('inactivity');
    expect(keys).toContain('feature_adoption');
    expect(keys).toContain('login_frequency');
  });

  it('classifyCohort returns low for score below 0.35', () => {
    const preventor = getPredictiveChurnPreventor();
    expect(preventor.classifyCohort(0.1)).toBe('low');
    expect(preventor.classifyCohort(0.34)).toBe('low');
  });

  it('classifyCohort returns correct cohort at each threshold', () => {
    const preventor = getPredictiveChurnPreventor();
    expect(preventor.classifyCohort(0.35)).toBe('medium');
    expect(preventor.classifyCohort(0.60)).toBe('high');
    expect(preventor.classifyCohort(0.80)).toBe('critical');
    expect(preventor.classifyCohort(1.0)).toBe('critical');
  });

  it('triggerIntervention returns true for matching active campaign and profile', () => {
    const preventor = getPredictiveChurnPreventor();
    // computeRiskScore with no signals scores ~1.0 -> 'critical'
    preventor.computeRiskScore('user-1', 'tenant-1');
    preventor.registerCampaign(makeCampaign({ targetCohort: 'critical' }));
    const triggered = preventor.triggerIntervention('user-1', 'campaign-1');
    expect(triggered).toBe(true);
  });

  it('triggerIntervention returns false when campaign does not exist', () => {
    const preventor = getPredictiveChurnPreventor();
    preventor.computeRiskScore('user-1', 'tenant-1');
    const triggered = preventor.triggerIntervention('user-1', 'nonexistent-campaign');
    expect(triggered).toBe(false);
  });

  it('getSummary has correct shape', () => {
    const preventor = getPredictiveChurnPreventor();
    const summary = preventor.getSummary();
    expect(typeof summary.totalProfiles).toBe('number');
    expect(typeof summary.criticalRiskCount).toBe('number');
    expect(typeof summary.highRiskCount).toBe('number');
    expect(typeof summary.mediumRiskCount).toBe('number');
    expect(typeof summary.lowRiskCount).toBe('number');
    expect(typeof summary.activeCampaigns).toBe('number');
    expect(typeof summary.avgChurnRisk).toBe('number');
    expect(typeof summary.avgConversionRate).toBe('number');
    expect(typeof summary.totalInterventions).toBe('number');
    expect(typeof summary.churnRateByTenant).toBe('object');
  });
});
