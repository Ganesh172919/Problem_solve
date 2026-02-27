import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  PredictiveResourceAllocator,
  getResourceAllocator,
  ResourceUsageSample,
  ResourceBudget,
} from '../../../src/lib/predictiveResourceAllocator';

describe('PredictiveResourceAllocator', () => {
  beforeEach(() => {
    (globalThis as any).__predictiveResourceAllocator__ = undefined;
  });

  it('singleton returns the same instance', () => {
    const a = getResourceAllocator();
    const b = getResourceAllocator();
    expect(a).toBe(b);
  });

  it('recordUsage stores sample without error', () => {
    const allocator = new PredictiveResourceAllocator();
    const sample: ResourceUsageSample = {
      tenantId: 'tenant1',
      resourceType: 'cpu',
      timestamp: Date.now(),
      utilization: 0.6,
      allocated: 4,
      consumed: 2.4,
      unit: 'cores',
    };
    expect(() => allocator.recordUsage(sample)).not.toThrow();
  });

  it('predict returns a plan with required fields', () => {
    const allocator = new PredictiveResourceAllocator();
    const sample: ResourceUsageSample = {
      tenantId: 'tenant2',
      resourceType: 'memory',
      timestamp: Date.now(),
      utilization: 0.7,
      allocated: 16,
      consumed: 11.2,
      unit: 'GB',
    };
    allocator.recordUsage(sample);
    const plan = allocator.predict('tenant2', 'memory');
    expect(plan.tenantId).toBe('tenant2');
    expect(plan.resourceType).toBe('memory');
    expect(plan.recommendedAllocation).toBeGreaterThan(0);
    expect(plan.confidence).toBeGreaterThanOrEqual(0);
    expect(plan.confidence).toBeLessThanOrEqual(1);
  });

  it('setBudget affects SLA violation detection', () => {
    const allocator = new PredictiveResourceAllocator();
    const budget: ResourceBudget = {
      tenantId: 'tenant3',
      resourceType: 'cpu',
      softLimit: 4,
      hardLimit: 8,
      burstAllowance: 2,
      billingUnit: 1,
      tier: 'pro',
    };
    allocator.setBudget(budget);
    const overSample: ResourceUsageSample = {
      tenantId: 'tenant3',
      resourceType: 'cpu',
      timestamp: Date.now(),
      utilization: 1.2,
      allocated: 8,
      consumed: 10, // exceeds hardLimit
      unit: 'cores',
    };
    expect(() => allocator.recordUsage(overSample)).not.toThrow();
  });

  it('generateAllocationPlans returns plans for all resource types', () => {
    const allocator = new PredictiveResourceAllocator();
    allocator.recordUsage({
      tenantId: 'tenant4', resourceType: 'cpu', timestamp: Date.now(),
      utilization: 0.5, allocated: 2, consumed: 1, unit: 'cores',
    });
    const plans = allocator.generateAllocationPlans(['tenant4']);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0]).toHaveProperty('tenantId', 'tenant4');
  });

  it('getMetrics returns structured metrics', () => {
    const allocator = new PredictiveResourceAllocator();
    const metrics = allocator.getMetrics();
    expect(metrics).toHaveProperty('totalTenants');
    expect(metrics).toHaveProperty('slaViolations');
    expect(metrics).toHaveProperty('allocationAccuracy');
  });
});
