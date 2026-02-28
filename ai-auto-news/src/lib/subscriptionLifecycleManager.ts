/**
 * @module subscriptionLifecycleManager
 * @description Subscription lifecycle management for SaaS billing. Handles plan
 * registration, subscription creation with optional trials, upgrades/downgrades
 * with real proration math, cancellation, pause/resume, renewal processing,
 * grace periods for failed payments, usage-limit enforcement per tier, trial
 * expiration, and revenue analytics (MRR, ARR, churn, ARPU).
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'cancelled'
  | 'expired';

export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise';

export type SubscriptionEventType =
  | 'created'
  | 'activated'
  | 'upgraded'
  | 'downgraded'
  | 'paused'
  | 'resumed'
  | 'cancelled'
  | 'renewed'
  | 'payment_failed'
  | 'payment_succeeded'
  | 'trial_started'
  | 'trial_ended';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface PlanLimits {
  apiCallsPerMonth: number;
  storageGb: number;
  teamMembers: number;
  pluginsAllowed: number;
  aiTokensPerMonth: number;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: PlanTier;
  monthlyPriceCents: number;
  annualPriceCents: number;
  features: string[];
  limits: PlanLimits;
  trialDays: number;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd?: Date;
  cancelAt?: Date;
  pausedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface SubscriptionEvent {
  id: string;
  subscriptionId: string;
  type: SubscriptionEventType;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface ProrationResult {
  creditCents: number;
  chargeCents: number;
  netCents: number;
  description: string;
}

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  totalSubscriptions: number;
  trialConversionRate: number;
  churnRate: number;
  avgRevenuePerUser: number;
  planDistribution: Record<string, number>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIER_ORDER: Record<PlanTier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };
const GRACE_PERIOD_DAYS = 7;

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class SubscriptionLifecycleManager {
  private plans = new Map<string, SubscriptionPlan>();
  private subscriptions = new Map<string, Subscription>();
  private tenantIndex = new Map<string, string>();
  private events = new Map<string, SubscriptionEvent[]>();
  private usage = new Map<string, Record<string, number>>();
  private cancelledCount = 0;
  private totalEverCreated = 0;
  private trialConversions = 0;
  private trialExpirations = 0;

  // ── Plan management ──────────────────────────────────────────────────────

  registerPlan(plan: SubscriptionPlan): void {
    this.plans.set(plan.id, plan);
    logger.info('Plan registered', { planId: plan.id, tier: plan.tier });
  }

  getPlan(planId: string): SubscriptionPlan | null {
    return this.plans.get(planId) ?? null;
  }

  getPlans(): SubscriptionPlan[] {
    return Array.from(this.plans.values());
  }

  // ── Subscription CRUD ────────────────────────────────────────────────────

  createSubscription(tenantId: string, planId: string, startTrial = false): Subscription {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    if (this.tenantIndex.has(tenantId)) {
      throw new Error(`Tenant ${tenantId} already has an active subscription`);
    }

    const now = new Date();
    const useTrial = startTrial && plan.trialDays > 0;
    const periodEnd = useTrial ? addDays(now, plan.trialDays) : addDays(now, 30);

    const sub: Subscription = {
      id: generateId('sub'),
      tenantId,
      planId,
      status: useTrial ? 'trialing' : 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEnd: useTrial ? addDays(now, plan.trialDays) : undefined,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    this.subscriptions.set(sub.id, sub);
    this.tenantIndex.set(tenantId, sub.id);
    this.usage.set(sub.id, {});
    this.totalEverCreated++;

    this.recordEvent(sub.id, 'created', { planId, tenantId });
    if (useTrial) {
      this.recordEvent(sub.id, 'trial_started', { trialDays: plan.trialDays });
    } else {
      this.recordEvent(sub.id, 'activated', { planId });
    }

    logger.info('Subscription created', { subscriptionId: sub.id, tenantId, planId, trial: useTrial });
    return sub;
  }

  getSubscription(subscriptionId: string): Subscription | null {
    return this.subscriptions.get(subscriptionId) ?? null;
  }

  getTenantSubscription(tenantId: string): Subscription | null {
    const subId = this.tenantIndex.get(tenantId);
    if (!subId) return null;
    return this.subscriptions.get(subId) ?? null;
  }

  // ── Upgrade / Downgrade ──────────────────────────────────────────────────

  upgradeSubscription(
    subscriptionId: string,
    newPlanId: string,
  ): { subscription: Subscription; proration: ProrationResult } {
    const sub = this.requireSubscription(subscriptionId);
    const currentPlan = this.requirePlan(sub.planId);
    const newPlan = this.requirePlan(newPlanId);

    if (TIER_ORDER[newPlan.tier] <= TIER_ORDER[currentPlan.tier]) {
      throw new Error('New plan must be a higher tier for upgrade');
    }
    this.assertMutable(sub);

    const totalDays = daysBetween(sub.currentPeriodStart, sub.currentPeriodEnd);
    const daysRemaining = daysBetween(new Date(), sub.currentPeriodEnd);
    const proration = this.calculateProration(sub.planId, newPlanId, daysRemaining, totalDays);

    const now = new Date();
    const wasTrial = sub.status === 'trialing';
    sub.planId = newPlanId;
    sub.status = 'active';
    sub.updatedAt = now;
    if (wasTrial) this.trialConversions++;

    this.recordEvent(subscriptionId, 'upgraded', {
      from: currentPlan.id,
      to: newPlanId,
      proration,
    });
    logger.info('Subscription upgraded', { subscriptionId, from: currentPlan.id, to: newPlanId });
    return { subscription: sub, proration };
  }

  downgradeSubscription(
    subscriptionId: string,
    newPlanId: string,
  ): { subscription: Subscription; proration: ProrationResult } {
    const sub = this.requireSubscription(subscriptionId);
    const currentPlan = this.requirePlan(sub.planId);
    const newPlan = this.requirePlan(newPlanId);

    if (TIER_ORDER[newPlan.tier] >= TIER_ORDER[currentPlan.tier]) {
      throw new Error('New plan must be a lower tier for downgrade');
    }
    this.assertMutable(sub);

    const totalDays = daysBetween(sub.currentPeriodStart, sub.currentPeriodEnd);
    const daysRemaining = daysBetween(new Date(), sub.currentPeriodEnd);
    const proration = this.calculateProration(sub.planId, newPlanId, daysRemaining, totalDays);

    const now = new Date();
    sub.planId = newPlanId;
    sub.updatedAt = now;

    this.recordEvent(subscriptionId, 'downgraded', {
      from: currentPlan.id,
      to: newPlanId,
      proration,
    });
    logger.info('Subscription downgraded', { subscriptionId, from: currentPlan.id, to: newPlanId });
    return { subscription: sub, proration };
  }

  // ── Cancel / Pause / Resume ──────────────────────────────────────────────

  cancelSubscription(subscriptionId: string, immediate = false): Subscription {
    const sub = this.requireSubscription(subscriptionId);
    this.assertMutable(sub);

    const wasTrial = sub.status === 'trialing';
    const now = new Date();
    if (immediate) {
      sub.status = 'cancelled';
      sub.cancelAt = now;
      this.tenantIndex.delete(sub.tenantId);
    } else {
      sub.cancelAt = sub.currentPeriodEnd;
    }
    sub.updatedAt = now;
    this.cancelledCount++;
    if (wasTrial) this.trialExpirations++;

    this.recordEvent(subscriptionId, 'cancelled', { immediate });
    logger.info('Subscription cancelled', { subscriptionId, immediate });
    return sub;
  }

  pauseSubscription(subscriptionId: string): Subscription {
    const sub = this.requireSubscription(subscriptionId);
    if (sub.status !== 'active') {
      throw new Error(`Cannot pause subscription in status: ${sub.status}`);
    }

    const now = new Date();
    sub.status = 'paused';
    sub.pausedAt = now;
    sub.updatedAt = now;

    this.recordEvent(subscriptionId, 'paused', {});
    logger.info('Subscription paused', { subscriptionId });
    return sub;
  }

  resumeSubscription(subscriptionId: string): Subscription {
    const sub = this.requireSubscription(subscriptionId);
    if (sub.status !== 'paused') {
      throw new Error(`Cannot resume subscription in status: ${sub.status}`);
    }

    const now = new Date();
    const pausedDays = sub.pausedAt ? daysBetween(sub.pausedAt, now) : 0;
    sub.currentPeriodEnd = addDays(sub.currentPeriodEnd, pausedDays);
    sub.status = 'active';
    sub.pausedAt = undefined;
    sub.updatedAt = now;

    this.recordEvent(subscriptionId, 'resumed', { pausedDays });
    logger.info('Subscription resumed', { subscriptionId, pausedDays });
    return sub;
  }

  // ── Renewal ──────────────────────────────────────────────────────────────

  renewSubscription(subscriptionId: string): Subscription {
    const sub = this.requireSubscription(subscriptionId);
    if (sub.status !== 'active' && sub.status !== 'past_due') {
      throw new Error(`Cannot renew subscription in status: ${sub.status}`);
    }

    if (sub.cancelAt && sub.cancelAt <= sub.currentPeriodEnd) {
      sub.status = 'cancelled';
      sub.updatedAt = new Date();
      this.tenantIndex.delete(sub.tenantId);
      this.recordEvent(subscriptionId, 'cancelled', { reason: 'scheduled' });
      logger.info('Subscription ended at scheduled cancel date', { subscriptionId });
      return sub;
    }

    const now = new Date();
    sub.currentPeriodStart = now;
    sub.currentPeriodEnd = addDays(now, 30);
    sub.status = 'active';
    sub.updatedAt = now;
    this.usage.set(subscriptionId, {});

    this.recordEvent(subscriptionId, 'renewed', {});
    logger.info('Subscription renewed', { subscriptionId });
    return sub;
  }

  // ── Payment handling ─────────────────────────────────────────────────────

  handlePaymentFailed(subscriptionId: string): Subscription {
    const sub = this.requireSubscription(subscriptionId);
    const now = new Date();

    sub.status = 'past_due';
    sub.updatedAt = now;
    sub.metadata['gracePeriodEnd'] = addDays(now, GRACE_PERIOD_DAYS).toISOString();
    sub.metadata['failedPayments'] = ((sub.metadata['failedPayments'] as number) || 0) + 1;

    const failCount = sub.metadata['failedPayments'] as number;
    if (failCount >= 3) {
      sub.status = 'cancelled';
      this.tenantIndex.delete(sub.tenantId);
      this.cancelledCount++;
      logger.warn('Subscription cancelled after 3 failed payments', { subscriptionId });
    }

    this.recordEvent(subscriptionId, 'payment_failed', { failCount });
    logger.info('Payment failed', { subscriptionId, failCount });
    return sub;
  }

  handlePaymentSucceeded(subscriptionId: string): Subscription {
    const sub = this.requireSubscription(subscriptionId);
    const now = new Date();

    if (sub.status === 'past_due') {
      sub.status = 'active';
    }
    sub.metadata['failedPayments'] = 0;
    sub.metadata['gracePeriodEnd'] = undefined;
    sub.updatedAt = now;

    this.recordEvent(subscriptionId, 'payment_succeeded', {});
    logger.info('Payment succeeded', { subscriptionId });
    return sub;
  }

  // ── Usage & Limits ───────────────────────────────────────────────────────

  checkLimits(
    subscriptionId: string,
    resource: keyof PlanLimits,
    amount: number,
  ): { allowed: boolean; remaining: number; limit: number } {
    const sub = this.requireSubscription(subscriptionId);
    const plan = this.requirePlan(sub.planId);
    const limit = plan.limits[resource];
    const consumed = this.usage.get(subscriptionId)?.[resource] ?? 0;
    const remaining = Math.max(0, limit - consumed);
    const allowed = consumed + amount <= limit;

    if (allowed) {
      const current = this.usage.get(subscriptionId) ?? {};
      current[resource] = consumed + amount;
      this.usage.set(subscriptionId, current);
    } else {
      logger.warn('Usage limit exceeded', { subscriptionId, resource, consumed, limit, requested: amount });
    }

    return { allowed, remaining: allowed ? remaining - amount : remaining, limit };
  }

  // ── Events ───────────────────────────────────────────────────────────────

  getSubscriptionEvents(subscriptionId: string): SubscriptionEvent[] {
    return this.events.get(subscriptionId) ?? [];
  }

  // ── Proration ────────────────────────────────────────────────────────────

  calculateProration(
    currentPlanId: string,
    newPlanId: string,
    daysRemaining: number,
    totalDays: number,
  ): ProrationResult {
    const currentPlan = this.requirePlan(currentPlanId);
    const newPlan = this.requirePlan(newPlanId);

    if (totalDays <= 0) {
      return { creditCents: 0, chargeCents: 0, netCents: 0, description: 'No proration needed' };
    }

    const fraction = daysRemaining / totalDays;
    const creditCents = Math.round(currentPlan.monthlyPriceCents * fraction);
    const chargeCents = Math.round(newPlan.monthlyPriceCents * fraction);
    const netCents = chargeCents - creditCents;

    const description =
      netCents > 0
        ? `Charge ${netCents} cents: ${daysRemaining}/${totalDays} days remaining, upgrading from ${currentPlan.name} to ${newPlan.name}`
        : netCents < 0
          ? `Credit ${Math.abs(netCents)} cents: ${daysRemaining}/${totalDays} days remaining, downgrading from ${currentPlan.name} to ${newPlan.name}`
          : `No charge: plans are equivalent for remaining period`;

    return { creditCents, chargeCents, netCents, description };
  }

  // ── Revenue metrics ──────────────────────────────────────────────────────

  getRevenueMetrics(): RevenueMetrics {
    let mrr = 0;
    const planDistribution: Record<string, number> = {};
    let activeCount = 0;

    for (const sub of this.subscriptions.values()) {
      const isActive = sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due';
      if (!isActive) continue;

      activeCount++;
      const plan = this.plans.get(sub.planId);
      if (plan) {
        mrr += plan.monthlyPriceCents;
        planDistribution[plan.id] = (planDistribution[plan.id] ?? 0) + 1;
      }
    }

    const mrrDollars = mrr / 100;
    const arr = mrrDollars * 12;
    const totalTrialOutcomes = this.trialConversions + this.trialExpirations;
    const trialConversionRate = totalTrialOutcomes > 0 ? this.trialConversions / totalTrialOutcomes : 0;
    const churnRate = this.totalEverCreated > 0 ? this.cancelledCount / this.totalEverCreated : 0;
    const avgRevenuePerUser = activeCount > 0 ? mrrDollars / activeCount : 0;

    return {
      mrr: mrrDollars,
      arr,
      totalSubscriptions: activeCount,
      trialConversionRate,
      churnRate,
      avgRevenuePerUser,
      planDistribution,
    };
  }

  // ── Batch processors ─────────────────────────────────────────────────────

  processTrialExpirations(): number {
    const now = new Date();
    let count = 0;

    for (const sub of this.subscriptions.values()) {
      if (sub.status !== 'trialing') continue;
      if (!sub.trialEnd || sub.trialEnd > now) continue;

      sub.status = 'active';
      sub.trialEnd = undefined;
      sub.currentPeriodStart = now;
      sub.currentPeriodEnd = addDays(now, 30);
      sub.updatedAt = now;
      this.trialConversions++;
      count++;

      this.recordEvent(sub.id, 'trial_ended', { converted: true });
      this.recordEvent(sub.id, 'activated', { from: 'trial' });
      logger.info('Trial converted to active', { subscriptionId: sub.id });
    }

    if (count > 0) {
      logger.info('Processed trial expirations', { converted: count });
    }
    return count;
  }

  processRenewals(): number {
    const now = new Date();
    let count = 0;

    for (const sub of this.subscriptions.values()) {
      if (sub.status !== 'active') continue;
      if (sub.currentPeriodEnd > now) continue;

      if (sub.cancelAt && sub.cancelAt <= now) {
        sub.status = 'cancelled';
        sub.updatedAt = now;
        this.tenantIndex.delete(sub.tenantId);
        this.cancelledCount++;
        this.recordEvent(sub.id, 'cancelled', { reason: 'period_end' });
        logger.info('Subscription expired at cancel date', { subscriptionId: sub.id });
        continue;
      }

      sub.currentPeriodStart = now;
      sub.currentPeriodEnd = addDays(now, 30);
      sub.updatedAt = now;
      this.usage.set(sub.id, {});
      count++;

      this.recordEvent(sub.id, 'renewed', { auto: true });
    }

    if (count > 0) {
      logger.info('Processed renewals', { renewed: count });
    }
    return count;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private requireSubscription(id: string): Subscription {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new Error(`Subscription not found: ${id}`);
    return sub;
  }

  private requirePlan(id: string): SubscriptionPlan {
    const plan = this.plans.get(id);
    if (!plan) throw new Error(`Plan not found: ${id}`);
    return plan;
  }

  private assertMutable(sub: Subscription): void {
    if (sub.status === 'cancelled' || sub.status === 'expired') {
      throw new Error(`Cannot modify subscription in status: ${sub.status}`);
    }
  }

  private recordEvent(subscriptionId: string, type: SubscriptionEventType, data: Record<string, unknown>): void {
    const event: SubscriptionEvent = {
      id: generateId('evt'),
      subscriptionId,
      type,
      data,
      timestamp: new Date(),
    };
    const list = this.events.get(subscriptionId) ?? [];
    list.push(event);
    this.events.set(subscriptionId, list);
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

declare global {
  var __subscriptionLifecycleManager__: SubscriptionLifecycleManager | undefined;
}

export function getSubscriptionManager(): SubscriptionLifecycleManager {
  if (!globalThis.__subscriptionLifecycleManager__) {
    globalThis.__subscriptionLifecycleManager__ = new SubscriptionLifecycleManager();
  }
  return globalThis.__subscriptionLifecycleManager__;
}
