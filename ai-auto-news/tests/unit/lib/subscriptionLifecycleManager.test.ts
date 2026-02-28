import { describe, it, expect, beforeEach } from '@jest/globals';
import { getSubscriptionManager } from '@/lib/subscriptionLifecycleManager';
import type { SubscriptionPlan, PlanLimits } from '@/lib/subscriptionLifecycleManager';

const limits: PlanLimits = {
  apiCallsPerMonth: 1000, storageGb: 10, teamMembers: 5,
  pluginsAllowed: 3, aiTokensPerMonth: 5000,
};

function makePlan(overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan {
  return {
    id: 'starter', name: 'Starter', tier: 'starter',
    monthlyPriceCents: 2900, annualPriceCents: 29000,
    features: ['basic'], limits, trialDays: 14, ...overrides,
  };
}

function proPlan(): SubscriptionPlan {
  return makePlan({
    id: 'pro', name: 'Pro', tier: 'pro',
    monthlyPriceCents: 9900, annualPriceCents: 99000,
  });
}

function freePlan(): SubscriptionPlan {
  return makePlan({
    id: 'free', name: 'Free', tier: 'free',
    monthlyPriceCents: 0, annualPriceCents: 0,
  });
}

describe('SubscriptionLifecycleManager', () => {
  let mgr: ReturnType<typeof getSubscriptionManager>;

  beforeEach(() => {
    delete (globalThis as any).__subscriptionLifecycleManager__;
    mgr = getSubscriptionManager();
    mgr.registerPlan(makePlan());
    mgr.registerPlan(proPlan());
    mgr.registerPlan(freePlan());
  });

  it('registerPlan, getPlan, and getPlans manage plans', () => {
    expect(mgr.getPlan('starter')).toBeTruthy();
    expect(mgr.getPlan('pro')).toBeTruthy();
    expect(mgr.getPlans()).toHaveLength(3);
  });

  it('createSubscription creates with trial', () => {
    const sub = mgr.createSubscription('t1', 'starter', true);
    expect(sub.status).toBe('trialing');
    expect(sub.trialEnd).toBeDefined();
    expect(sub.tenantId).toBe('t1');
  });

  it('createSubscription creates without trial', () => {
    const sub = mgr.createSubscription('t2', 'starter', false);
    expect(sub.status).toBe('active');
    expect(sub.trialEnd).toBeUndefined();
  });

  it('upgradeSubscription upgrades with proration', () => {
    const sub = mgr.createSubscription('t1', 'starter');
    const { subscription, proration } = mgr.upgradeSubscription(sub.id, 'pro');
    expect(subscription.planId).toBe('pro');
    expect(subscription.status).toBe('active');
    expect(proration).toHaveProperty('netCents');
    expect(proration.chargeCents).toBeGreaterThanOrEqual(proration.creditCents);
  });

  it('downgradeSubscription downgrades with proration', () => {
    const sub = mgr.createSubscription('t1', 'pro');
    const { subscription, proration } = mgr.downgradeSubscription(sub.id, 'starter');
    expect(subscription.planId).toBe('starter');
    expect(proration.netCents).toBeLessThanOrEqual(0);
  });

  it('cancelSubscription cancels immediately', () => {
    const sub = mgr.createSubscription('t1', 'starter');
    const cancelled = mgr.cancelSubscription(sub.id, true);
    expect(cancelled.status).toBe('cancelled');
  });

  it('pauseSubscription and resumeSubscription work', () => {
    const sub = mgr.createSubscription('t1', 'starter');
    const paused = mgr.pauseSubscription(sub.id);
    expect(paused.status).toBe('paused');
    const resumed = mgr.resumeSubscription(sub.id);
    expect(resumed.status).toBe('active');
  });

  it('handlePaymentFailed transitions to past_due', () => {
    const sub = mgr.createSubscription('t1', 'starter');
    const result = mgr.handlePaymentFailed(sub.id);
    expect(result.status).toBe('past_due');
    expect(result.metadata['failedPayments']).toBe(1);
  });

  it('checkLimits enforces plan limits', () => {
    const sub = mgr.createSubscription('t1', 'starter');
    const result = mgr.checkLimits(sub.id, 'apiCallsPerMonth', 500);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(500);
    const exceeded = mgr.checkLimits(sub.id, 'apiCallsPerMonth', 600);
    expect(exceeded.allowed).toBe(false);
  });

  it('getRevenueMetrics returns MRR and ARR', () => {
    mgr.createSubscription('t1', 'starter');
    mgr.createSubscription('t2', 'pro');
    const metrics = mgr.getRevenueMetrics();
    expect(metrics.mrr).toBeGreaterThan(0);
    expect(metrics.arr).toBe(metrics.mrr * 12);
    expect(metrics.totalSubscriptions).toBe(2);
  });

  it('getSubscriptionEvents returns event history', () => {
    const sub = mgr.createSubscription('t1', 'starter');
    const events = mgr.getSubscriptionEvents(sub.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('created');
  });
});
