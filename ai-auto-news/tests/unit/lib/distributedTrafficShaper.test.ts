import { describe, it, expect, beforeEach } from '@jest/globals';
import { getTrafficShaper } from '../../../src/lib/distributedTrafficShaper';

describe('distributedTrafficShaper', () => {
  let shaper: ReturnType<typeof getTrafficShaper>;

  beforeEach(() => {
    // Reset singleton for test isolation
    delete (globalThis as Record<string, unknown>)['__distributedTrafficShaper__'];
    shaper = getTrafficShaper();
  });

  it('returns same singleton instance', () => {
    const a = getTrafficShaper();
    const b = getTrafficShaper();
    expect(a).toBe(b);
  });

  it('creates a traffic policy', () => {
    const policy = shaper.createPolicy({
      name: 'Test Policy',
      tenantId: 'tenant1',
      serviceId: 'svc1',
      trafficClass: 'normal',
      strategy: 'token_bucket',
      rateLimit: 100,
      burstLimit: 200,
      bandwidthKbps: 1000,
      priorityWeight: 50,
      enabled: true,
      tags: [],
    });
    expect(policy.id).toBeDefined();
    expect(policy.tenantId).toBe('tenant1');
    expect(policy.rateLimit).toBe(100);
  });

  it('lists policies by tenant', () => {
    shaper.createPolicy({ name: 'P1', tenantId: 'tenantA', serviceId: 'svc1', trafficClass: 'high', strategy: 'token_bucket', rateLimit: 50, burstLimit: 100, bandwidthKbps: 500, priorityWeight: 80, enabled: true, tags: [] });
    shaper.createPolicy({ name: 'P2', tenantId: 'tenantB', serviceId: 'svc2', trafficClass: 'low', strategy: 'token_bucket', rateLimit: 10, burstLimit: 20, bandwidthKbps: 100, priorityWeight: 20, enabled: true, tags: [] });
    const aList = shaper.listPolicies('tenantA');
    expect(aList).toHaveLength(1);
    expect(aList[0].tenantId).toBe('tenantA');
  });

  it('allows request when tokens available', () => {
    const policy = shaper.createPolicy({ name: 'P', tenantId: 't1', serviceId: 's1', trafficClass: 'normal', strategy: 'token_bucket', rateLimit: 100, burstLimit: 200, bandwidthKbps: 1000, priorityWeight: 50, enabled: true, tags: [] });
    const decision = shaper.evaluateRequest({ id: 'req1', policyId: policy.id, tenantId: 't1', serviceId: 's1', trafficClass: 'normal', payloadBytes: 100, timestamp: Date.now(), metadata: {} });
    expect(decision.allowed).toBe(true);
    expect(decision.remainingTokens).toBeGreaterThan(0);
  });

  it('rejects request when policy not found', () => {
    const decision = shaper.evaluateRequest({ id: 'req99', policyId: 'nonexistent', tenantId: 't1', serviceId: 's1', trafficClass: 'normal', payloadBytes: 100, timestamp: Date.now(), metadata: {} });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('not found');
  });

  it('records and resolves congestion', () => {
    const event = shaper.recordCongestion('svc1', 't1', 15000);
    expect(event.level).toBe('critical');
    expect(event.resolvedAt).toBeUndefined();
    shaper.resolveCongestion('svc1', 't1');
    const events = shaper.listCongestions(false);
    const resolved = events.find(e => e.serviceId === 'svc1');
    expect(resolved?.resolvedAt).toBeDefined();
  });

  it('getSummary returns correct structure', () => {
    const summary = shaper.getSummary();
    expect(typeof summary.totalPolicies).toBe('number');
    expect(typeof summary.overallAllowRatePct).toBe('number');
    expect(Array.isArray(summary.topConsumers)).toBe(true);
  });

  it('updates policy', () => {
    const policy = shaper.createPolicy({ name: 'UpdateMe', tenantId: 't1', serviceId: 's1', trafficClass: 'normal', strategy: 'token_bucket', rateLimit: 50, burstLimit: 100, bandwidthKbps: 500, priorityWeight: 50, enabled: true, tags: [] });
    const updated = shaper.updatePolicy(policy.id, { rateLimit: 200 });
    expect(updated.rateLimit).toBe(200);
  });

  it('throws on update of nonexistent policy', () => {
    expect(() => shaper.updatePolicy('does_not_exist', { rateLimit: 10 })).toThrow();
  });

  it('computes bandwidth allocations', () => {
    shaper.createPolicy({ name: 'BW', tenantId: 't1', serviceId: 's1', trafficClass: 'normal', strategy: 'token_bucket', rateLimit: 100, burstLimit: 200, bandwidthKbps: 500, priorityWeight: 50, enabled: true, tags: [] });
    const allocations = shaper.computeBandwidthAllocations();
    expect(Array.isArray(allocations)).toBe(true);
  });

  it('lists decisions', () => {
    const policy = shaper.createPolicy({ name: 'D', tenantId: 't1', serviceId: 's1', trafficClass: 'normal', strategy: 'token_bucket', rateLimit: 100, burstLimit: 200, bandwidthKbps: 1000, priorityWeight: 50, enabled: true, tags: [] });
    shaper.evaluateRequest({ id: 'req1', policyId: policy.id, tenantId: 't1', serviceId: 's1', trafficClass: 'normal', payloadBytes: 100, timestamp: Date.now(), metadata: {} });
    const decisions = shaper.listDecisions(policy.id);
    expect(decisions.length).toBeGreaterThan(0);
  });

  it('deletes policy', () => {
    const policy = shaper.createPolicy({ name: 'Del', tenantId: 't1', serviceId: 's1', trafficClass: 'normal', strategy: 'token_bucket', rateLimit: 100, burstLimit: 200, bandwidthKbps: 1000, priorityWeight: 50, enabled: true, tags: [] });
    shaper.deletePolicy(policy.id);
    expect(shaper.getPolicy(policy.id)).toBeUndefined();
  });
});
