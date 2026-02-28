import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  AdaptiveInfrastructureProvisioner,
  getAdaptiveInfrastructureProvisioner,
  ProvisioningRequest,
} from '@/lib/adaptiveInfrastructureProvisioner';

type RequestInput = Omit<ProvisioningRequest, 'status' | 'requestedAt'>;

function makeRequestInput(overrides: Partial<RequestInput> = {}): RequestInput {
  return {
    id: 'req-1',
    tenantId: 'tenant-1',
    resourceType: 'compute',
    region: 'us-east-1',
    requestedUnits: 2,
    instanceType: 't3.medium',
    priority: 'normal',
    estimatedCostPerHour: 0,
    tags: { env: 'production' },
    ...overrides,
  };
}

describe('AdaptiveInfrastructureProvisioner', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__adaptiveInfrastructureProvisioner__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getAdaptiveInfrastructureProvisioner();
    const b = getAdaptiveInfrastructureProvisioner();
    expect(a).toBe(b);
  });

  it('new instance is an AdaptiveInfrastructureProvisioner', () => {
    const provisioner = getAdaptiveInfrastructureProvisioner();
    expect(provisioner).toBeInstanceOf(AdaptiveInfrastructureProvisioner);
  });

  it('submitRequest returns request with status pending', () => {
    const provisioner = getAdaptiveInfrastructureProvisioner();
    const req = provisioner.submitRequest(makeRequestInput());
    expect(req.id).toBe('req-1');
    expect(req.status).toBe('pending');
    expect(req.requestedAt).toBeGreaterThan(0);
    expect(req.estimatedCostPerHour).toBeGreaterThan(0);
  });

  it('approveRequest changes status to approved', () => {
    const provisioner = getAdaptiveInfrastructureProvisioner();
    provisioner.submitRequest(makeRequestInput());
    const approved = provisioner.approveRequest('req-1', 'admin-user');
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeDefined();
  });

  it('approveRequest throws for non-pending request', () => {
    const provisioner = getAdaptiveInfrastructureProvisioner();
    provisioner.submitRequest(makeRequestInput());
    provisioner.approveRequest('req-1', 'admin');
    expect(() => provisioner.approveRequest('req-1', 'admin')).toThrow('not pending');
  });

  it('executeProvisioning creates resource after approve', () => {
    const provisioner = getAdaptiveInfrastructureProvisioner();
    provisioner.submitRequest(makeRequestInput());
    provisioner.approveRequest('req-1', 'admin');
    const resource = provisioner.executeProvisioning('req-1');
    expect(resource.id).toBeDefined();
    expect(resource.tenantId).toBe('tenant-1');
    expect(resource.instanceType).toBe('t3.medium');
    expect(provisioner.getSummary().totalResources).toBe(1);
  });

  it('detectDrift returns DriftReport with hasDrift false for fresh resource', () => {
    const provisioner = getAdaptiveInfrastructureProvisioner();
    provisioner.submitRequest(makeRequestInput());
    provisioner.approveRequest('req-1', 'admin');
    const resource = provisioner.executeProvisioning('req-1');
    const drift = provisioner.detectDrift(resource.id);
    expect(drift.resourceId).toBe(resource.id);
    expect(drift.hasDrift).toBe(false);
    expect(Array.isArray(drift.driftedFields)).toBe(true);
    expect(drift.driftedFields).toHaveLength(0);
  });

  it('makeScalingDecision returns ScalingDecision with valid direction', () => {
    const provisioner = getAdaptiveInfrastructureProvisioner();
    provisioner.submitRequest(makeRequestInput());
    provisioner.approveRequest('req-1', 'admin');
    const resource = provisioner.executeProvisioning('req-1');
    const decision = provisioner.makeScalingDecision(resource.id);
    expect(decision.resourceId).toBe(resource.id);
    expect(['scale_out', 'scale_in', 'no_change']).toContain(decision.direction);
    expect(decision.currentUnits).toBe(2);
    expect(typeof decision.reason).toBe('string');
  });

  it('getSummary has correct shape', () => {
    const provisioner = getAdaptiveInfrastructureProvisioner();
    const report = provisioner.getSummary();
    expect(typeof report.totalResources).toBe('number');
    expect(typeof report.healthyCount).toBe('number');
    expect(typeof report.degradedCount).toBe('number');
    expect(typeof report.unhealthyCount).toBe('number');
    expect(typeof report.avgCpuUtilization).toBe('number');
    expect(typeof report.avgMemUtilization).toBe('number');
    expect(typeof report.driftedResources).toBe('number');
    expect(typeof report.totalCostPerHour).toBe('number');
    expect(typeof report.generatedAt).toBe('number');
  });
});
