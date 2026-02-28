import { describe, it, expect, beforeEach } from '@jest/globals';
import { getAlertCorrelator } from '../../../src/lib/aiPoweredAlertCorrelator';

describe('aiPoweredAlertCorrelator', () => {
  let correlator: ReturnType<typeof getAlertCorrelator>;

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)['__aiPoweredAlertCorrelator__'];
    correlator = getAlertCorrelator();
  });

  it('returns same singleton instance', () => {
    const a = getAlertCorrelator();
    const b = getAlertCorrelator();
    expect(a).toBe(b);
  });

  it('creates an alert rule', () => {
    const rule = correlator.createRule({
      name: 'CPU High',
      tenantId: 't1',
      serviceId: 'svc1',
      metric: 'cpu_usage',
      condition: '>90',
      severity: 'high',
      suppressionWindowMs: 60_000,
      escalationAfterMs: 300_000,
      tags: [],
      enabled: true,
    });
    expect(rule.id).toBeDefined();
    expect(rule.severity).toBe('high');
  });

  it('ingests an alert', () => {
    const rule = correlator.createRule({ name: 'R1', tenantId: 't1', serviceId: 'svc1', metric: 'm1', condition: '>1', severity: 'medium', suppressionWindowMs: 60_000, escalationAfterMs: 300_000, tags: [], enabled: true });
    const alert = correlator.ingestAlert({ ruleId: rule.id, tenantId: 't1', serviceId: 'svc1', title: 'Test Alert', description: 'desc', severity: 'medium', labels: { env: 'prod' } });
    expect(alert.id).toBeDefined();
    expect(alert.status).toBe('firing');
  });

  it('deduplicates alerts with same fingerprint', () => {
    const rule = correlator.createRule({ name: 'R2', tenantId: 't1', serviceId: 'svc1', metric: 'm2', condition: '>1', severity: 'high', suppressionWindowMs: 60_000, escalationAfterMs: 300_000, tags: [], enabled: true });
    const params = { ruleId: rule.id, tenantId: 't1', serviceId: 'svc1', title: 'Dup Alert', description: 'desc', severity: 'high' as const, labels: { env: 'prod' } };
    const a1 = correlator.ingestAlert(params);
    const a2 = correlator.ingestAlert(params);
    expect(a1.id).toBe(a2.id);
    expect(a2.occurrenceCount).toBeGreaterThan(1);
  });

  it('resolves an alert', () => {
    const rule = correlator.createRule({ name: 'R3', tenantId: 't1', serviceId: 'svc1', metric: 'm3', condition: '>1', severity: 'low', suppressionWindowMs: 0, escalationAfterMs: 999_999_999, tags: [], enabled: true });
    const alert = correlator.ingestAlert({ ruleId: rule.id, tenantId: 't1', serviceId: 'svc1', title: 'Resolvable', description: '', severity: 'low', labels: { env: 'test' } });
    const resolved = correlator.resolveAlert(alert.id);
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).toBeDefined();
  });

  it('acknowledges an alert', () => {
    const rule = correlator.createRule({ name: 'R4', tenantId: 't1', serviceId: 'svc1', metric: 'm4', condition: '>1', severity: 'critical', suppressionWindowMs: 0, escalationAfterMs: 999_999_999, tags: [], enabled: true });
    const alert = correlator.ingestAlert({ ruleId: rule.id, tenantId: 't1', serviceId: 'svc1', title: 'Ack', description: '', severity: 'critical', labels: {} });
    correlator.acknowledgeAlert(alert.id);
    const fetched = correlator.getAlert(alert.id)!;
    expect(fetched.status).toBe('acknowledged');
  });

  it('creates suppression rule and suppresses matching alert', () => {
    const now = Date.now();
    correlator.createSuppressionRule({
      tenantId: 't1',
      matchLabels: { env: 'staging' },
      suppressDurationMs: 3_600_000,
      reason: 'Maintenance',
      expiresAt: now + 3_600_000,
      enabled: true,
    });
    const rule = correlator.createRule({ name: 'R5', tenantId: 't1', serviceId: 'svc1', metric: 'm5', condition: '>1', severity: 'low', suppressionWindowMs: 0, escalationAfterMs: 999_999_999, tags: [], enabled: true });
    const alert = correlator.ingestAlert({ ruleId: rule.id, tenantId: 't1', serviceId: 'svc1', title: 'Suppressed', description: '', severity: 'low', labels: { env: 'staging' } });
    expect(alert.status).toBe('suppressed');
  });

  it('getSummary returns correct structure', () => {
    const summary = correlator.getSummary();
    expect(typeof summary.totalRules).toBe('number');
    expect(typeof summary.activeAlerts).toBe('number');
    expect(typeof summary.noiseReductionPct).toBe('number');
  });

  it('lists alerts filtered by severity', () => {
    const rule = correlator.createRule({ name: 'R6', tenantId: 't2', serviceId: 'svc2', metric: 'm6', condition: '>1', severity: 'critical', suppressionWindowMs: 0, escalationAfterMs: 999_999_999, tags: [], enabled: true });
    correlator.ingestAlert({ ruleId: rule.id, tenantId: 't2', serviceId: 'svc2', title: 'Crit', description: '', severity: 'critical', labels: {} });
    const critAlerts = correlator.listAlerts('t2', undefined, 'critical');
    expect(critAlerts.length).toBeGreaterThan(0);
    expect(critAlerts.every(a => a.severity === 'critical')).toBe(true);
  });

  it('throws on resolving nonexistent alert', () => {
    expect(() => correlator.resolveAlert('nonexistent')).toThrow();
  });

  it('lists suppression rules by tenant', () => {
    correlator.createSuppressionRule({ tenantId: 'ts1', matchLabels: {}, suppressDurationMs: 1000, reason: 'x', expiresAt: Date.now() + 1000, enabled: true });
    correlator.createSuppressionRule({ tenantId: 'ts2', matchLabels: {}, suppressDurationMs: 1000, reason: 'y', expiresAt: Date.now() + 1000, enabled: true });
    const ts1Rules = correlator.listSuppressionRules('ts1');
    expect(ts1Rules.length).toBe(1);
  });
});
