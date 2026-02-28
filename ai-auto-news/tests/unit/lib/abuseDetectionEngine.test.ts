import { describe, it, expect, beforeEach } from '@jest/globals';
import { getAbuseDetectionEngine } from '@/lib/abuseDetectionEngine';

describe('AbuseDetectionEngine', () => {
  let engine: ReturnType<typeof getAbuseDetectionEngine>;

  beforeEach(() => {
    delete (globalThis as any).__abuseDetectionEngine__;
    engine = getAbuseDetectionEngine();
  });

  it('should add detection rules and return them with an id', () => {
    const rule = engine.addRule({
      name: 'Rate limit', type: 'rate_limit', enabled: true, cooldownMs: 0,
      conditions: [{ metric: 'api_calls', operator: 'gt', threshold: 100, windowMs: 60_000 }],
      action: { type: 'throttle', notifyAdmin: true, notifyUser: false },
    });
    expect(rule.id).toBeDefined();
    expect(rule.name).toBe('Rate limit');
    expect(engine.getRules()).toHaveLength(1);
  });

  it('should record activity for a user', () => {
    engine.recordActivity('u1', 't1', 'api_calls', 1);
    engine.recordActivity('u1', 't1', 'api_calls', 1);

    const profile = engine.getRiskProfile('u1');
    expect(profile.totalApiCalls).toBe(2);
  });

  it('should detect abuse when rule conditions are met', () => {
    engine.addRule({
      name: 'High traffic', type: 'rate_limit', enabled: true, cooldownMs: 0,
      conditions: [{ metric: 'api_calls', operator: 'gt', threshold: 5, windowMs: 60_000 }],
      action: { type: 'warn', notifyAdmin: false, notifyUser: true },
    });

    for (let i = 0; i < 10; i++) {
      engine.recordActivity('u1', 't1', 'api_calls', 1);
    }

    const events = engine.checkAbuse('u1', 't1');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('rate_limit');
    expect(events[0].userId).toBe('u1');
  });

  it('should not detect abuse when conditions are not met', () => {
    engine.addRule({
      name: 'Threshold', type: 'rate_limit', enabled: true, cooldownMs: 0,
      conditions: [{ metric: 'api_calls', operator: 'gt', threshold: 100, windowMs: 60_000 }],
      action: { type: 'warn', notifyAdmin: false, notifyUser: false },
    });

    engine.recordActivity('u1', 't1', 'api_calls', 5);
    const events = engine.checkAbuse('u1', 't1');
    expect(events).toHaveLength(0);
  });

  it('should return a risk profile for a user', () => {
    engine.recordActivity('u1', 't1', 'api_calls', 1);
    const profile = engine.getRiskProfile('u1');

    expect(profile.userId).toBe('u1');
    expect(profile.tenantId).toBe('t1');
    expect(profile.riskScore).toBeGreaterThanOrEqual(0);
    expect(profile.lastAssessed).toBeInstanceOf(Date);
  });

  it('should update risk score and add high_risk flag at threshold', () => {
    engine.recordActivity('u1', 't1', 'api_calls', 1);

    engine.updateRiskScore('u1', 50, 'manual adjustment');
    expect(engine.getRiskProfile('u1').riskScore).toBe(50);

    engine.updateRiskScore('u1', 35, 'escalation');
    const profile = engine.getRiskProfile('u1');
    expect(profile.riskScore).toBe(85);
    expect(profile.flags).toContain('high_risk');
  });

  it('should clamp risk score between 0 and 100', () => {
    engine.updateRiskScore('u1', 200, 'overflow');
    expect(engine.getRiskProfile('u1').riskScore).toBe(100);

    engine.updateRiskScore('u1', -300, 'underflow');
    expect(engine.getRiskProfile('u1').riskScore).toBe(0);
  });

  it('should submit and review abuse reports', () => {
    const report = engine.submitReport({
      reporterId: 'reporter1', targetId: 'offender1', type: 'content',
      description: 'Spam content', evidence: ['link1'],
    });
    expect(report.id).toBeDefined();
    expect(report.status).toBe('pending');

    const reviewed = engine.reviewReport(report.id, 'confirmed', 'admin1');
    expect(reviewed.status).toBe('confirmed');
    expect(reviewed.reviewedBy).toBe('admin1');

    const profile = engine.getRiskProfile('offender1');
    expect(profile.riskScore).toBeGreaterThan(0);
  });

  it('should filter events by userId and type', () => {
    engine.addRule({
      name: 'Bot detect', type: 'bot', enabled: true, cooldownMs: 0,
      conditions: [{ metric: 'requests', operator: 'gt', threshold: 0, windowMs: 60_000 }],
      action: { type: 'log', notifyAdmin: false, notifyUser: false },
    });
    engine.recordActivity('u1', 't1', 'requests', 5);
    engine.checkAbuse('u1', 't1');

    expect(engine.getEvents('u1').length).toBeGreaterThanOrEqual(1);
    expect(engine.getEvents('u1', 'bot').length).toBeGreaterThanOrEqual(1);
    expect(engine.getEvents('u1', 'payment')).toHaveLength(0);
  });

  it('should return detection stats', () => {
    engine.addRule({
      name: 'Rule1', type: 'rate_limit', enabled: true, cooldownMs: 0,
      conditions: [{ metric: 'hits', operator: 'gt', threshold: 0, windowMs: 60_000 }],
      action: { type: 'log', notifyAdmin: false, notifyUser: false },
    });
    engine.recordActivity('u1', 't1', 'hits', 10);
    engine.checkAbuse('u1', 't1');

    const stats = engine.getStats();
    expect(stats.totalEvents).toBeGreaterThanOrEqual(1);
    expect(stats.activeRules).toBe(1);
    expect(stats.eventsByType).toBeDefined();
    expect(stats.eventsBySeverity).toBeDefined();
    expect(stats.topOffenders.length).toBeGreaterThanOrEqual(1);
  });
});
