import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ServiceGraphAnalyzer,
  getServiceGraph,
} from '../../../src/lib/serviceGraphAnalyzer';

function makeService(overrides: Partial<{ id: string; name: string; type: 'api' | 'database'; tenantId: string }> = {}) {
  return {
    id: overrides.id ?? `svc-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? 'Test Service',
    version: '1.0.0',
    type: overrides.type ?? 'api' as const,
    team: 'platform',
    tenantId: overrides.tenantId ?? 'tenant-001',
    sla: { availabilityPercent: 99.9, p99LatencyMs: 200, rtoMs: 60_000, rpoMs: 3_600_000 },
    tags: ['test'],
    endpoints: ['/api/v1/health'],
    healthStatus: 'healthy' as const,
    healthScore: 95,
    deploymentRegions: ['us-east-1'],
    scalingModel: 'horizontal' as const,
    instanceCount: 3,
    metadata: {},
  };
}

function makeDep(sourceId: string, targetId: string) {
  return {
    sourceId,
    targetId,
    type: 'sync' as const,
    criticality: 'high' as const,
    protocol: 'http',
    callsPerMinute: 100,
    avgLatencyMs: 30,
    p99LatencyMs: 80,
    errorRate: 0.001,
    hasFallback: true,
    hasCircuitBreaker: true,
    hasRetry: true,
    isRequired: true,
    tags: [],
  };
}

describe('ServiceGraphAnalyzer', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__serviceGraphAnalyzer__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getServiceGraph();
    const b = getServiceGraph();
    expect(a).toBe(b);
  });

  it('registerService stores and returns service', () => {
    const sg = new ServiceGraphAnalyzer();
    const svc = sg.registerService(makeService({ id: 'svc-api', name: 'API Gateway' }));
    expect(svc.id).toBe('svc-api');
    expect(sg.getService('svc-api')).toBe(svc);
  });

  it('updateService modifies fields', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-api' }));
    sg.updateService('svc-api', { version: '2.0.0' });
    expect(sg.getService('svc-api')!.version).toBe('2.0.0');
  });

  it('updateHealth changes healthStatus and healthScore', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-api' }));
    sg.updateHealth('svc-api', 'degraded', 40);
    expect(sg.getService('svc-api')!.healthStatus).toBe('degraded');
    expect(sg.getService('svc-api')!.healthScore).toBe(40);
  });

  it('addDependency creates edge and updates adjacency', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-a' }));
    sg.registerService(makeService({ id: 'svc-b' }));
    const dep = sg.addDependency(makeDep('svc-a', 'svc-b'));
    expect(dep.id).toBeTruthy();
    expect(dep.sourceId).toBe('svc-a');
    expect(dep.targetId).toBe('svc-b');
    expect(sg.getDirectDependencies('svc-a').map(s => s.id)).toContain('svc-b');
    expect(sg.getDirectDependents('svc-b').map(s => s.id)).toContain('svc-a');
  });

  it('addDependency throws for unknown source', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-b' }));
    expect(() => sg.addDependency(makeDep('no-such', 'svc-b'))).toThrow();
  });

  it('removeDependency clears adjacency', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-a' }));
    sg.registerService(makeService({ id: 'svc-b' }));
    const dep = sg.addDependency(makeDep('svc-a', 'svc-b'));
    sg.removeDependency(dep.id);
    expect(sg.getDirectDependencies('svc-a').length).toBe(0);
  });

  it('computeBlastRadius identifies dependents', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-core' }));
    sg.registerService(makeService({ id: 'svc-dep1' }));
    sg.registerService(makeService({ id: 'svc-dep2' }));
    sg.addDependency(makeDep('svc-dep1', 'svc-core'));
    sg.addDependency(makeDep('svc-dep2', 'svc-core'));
    const radius = sg.computeBlastRadius('svc-core');
    expect(radius.directDependents).toContain('svc-dep1');
    expect(radius.directDependents).toContain('svc-dep2');
  });

  it('computeBlastRadius throws for unknown service', () => {
    const sg = new ServiceGraphAnalyzer();
    expect(() => sg.computeBlastRadius('no-such-svc')).toThrow();
  });

  it('computeMetrics returns expected shape', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-a' }));
    sg.registerService(makeService({ id: 'svc-b' }));
    sg.addDependency(makeDep('svc-a', 'svc-b'));
    const metrics = sg.computeMetrics();
    expect(metrics.nodeCount).toBe(2);
    expect(metrics.edgeCount).toBe(1);
    expect(metrics).toHaveProperty('avgDegree');
    expect(metrics).toHaveProperty('maxInDegree');
  });

  it('generateMeshPolicy returns policy for service', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-api' }));
    const policy = sg.generateMeshPolicy('svc-api');
    expect(policy.serviceId).toBe('svc-api');
    expect(policy.retryPolicy.maxAttempts).toBeGreaterThan(0);
    expect(policy.circuitBreaker.consecutiveErrors).toBeGreaterThan(0);
    expect(policy.timeout.requestMs).toBeGreaterThan(0);
  });

  it('checkVersionCompatibility returns report', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-a' }));
    sg.registerService(makeService({ id: 'svc-b' }));
    const report = sg.checkVersionCompatibility('svc-a', 'svc-b');
    expect(report.serviceAId).toBe('svc-a');
    expect(report.serviceBId).toBe('svc-b');
    expect(typeof report.compatible).toBe('boolean');
  });

  it('detectAllIssues identifies orphan services', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-orphan', tenantId: 'tenant-001' }));
    const issues = sg.detectAllIssues('tenant-001');
    expect(issues.some(i => i.type === 'orphan_service' && i.affectedServiceIds.includes('svc-orphan'))).toBe(true);
  });

  it('detectAllIssues identifies missing fallbacks on critical deps', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-a', tenantId: 'tenant-001' }));
    sg.registerService(makeService({ id: 'svc-b', tenantId: 'tenant-001' }));
    sg.addDependency({ ...makeDep('svc-a', 'svc-b'), criticality: 'critical', hasFallback: false });
    const issues = sg.detectAllIssues('tenant-001');
    expect(issues.some(i => i.type === 'missing_fallback')).toBe(true);
  });

  it('findCriticalPath returns null for empty graph', () => {
    const sg = new ServiceGraphAnalyzer();
    expect(sg.findCriticalPath()).toBeNull();
  });

  it('findCriticalPath returns path for connected graph', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-a' }));
    sg.registerService(makeService({ id: 'svc-b' }));
    sg.addDependency(makeDep('svc-a', 'svc-b'));
    const cp = sg.findCriticalPath();
    expect(cp).not.toBeNull();
    expect(cp!.nodes.length).toBeGreaterThan(0);
    expect(cp!.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('getDashboardSummary reflects state', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-a' }));
    const summary = sg.getDashboardSummary();
    expect(summary.totalServices).toBe(1);
    expect(summary.healthyServices).toBe(1);
    expect(summary).toHaveProperty('openIssues');
  });

  it('listDependencies filters by sourceId', () => {
    const sg = new ServiceGraphAnalyzer();
    sg.registerService(makeService({ id: 'svc-a' }));
    sg.registerService(makeService({ id: 'svc-b' }));
    sg.registerService(makeService({ id: 'svc-c' }));
    sg.addDependency(makeDep('svc-a', 'svc-b'));
    sg.addDependency(makeDep('svc-a', 'svc-c'));
    expect(sg.listDependencies('svc-a').length).toBe(2);
    expect(sg.listDependencies('svc-b').length).toBe(0);
  });
});
