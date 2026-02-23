import { logger } from '@/lib/logger';
import { TIER_LIMITS } from '@/lib/config';
import { SubscriptionTier } from '@/types/saas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LifecycleStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'cancelled'
  | 'expired';

export interface LifecycleSubscription {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  status: LifecycleStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  activatedAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  expiredAt: string | null;
  pausedAt: string | null;
  resumedAt: string | null;
  gracePeriodEndsAt: string | null;
  renewalAttempts: number;
  lastRenewalAttemptAt: string | null;
  previousTier: SubscriptionTier | null;
  createdAt: string;
  updatedAt: string;
}

export interface LifecycleEvent {
  id: string;
  subscriptionId: string;
  userId: string;
  type: LifecycleEventType;
  fromStatus: LifecycleStatus;
  toStatus: LifecycleStatus;
  fromTier: SubscriptionTier | null;
  toTier: SubscriptionTier | null;
  revenueImpact: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type LifecycleEventType =
  | 'trial_started'
  | 'trial_converted'
  | 'trial_expired'
  | 'activated'
  | 'payment_failed'
  | 'grace_period_started'
  | 'grace_period_ended'
  | 'paused'
  | 'resumed'
  | 'upgraded'
  | 'downgraded'
  | 'renewed'
  | 'cancelled'
  | 'expired'
  | 'renewal_retry';

export interface LifecycleConfig {
  trialDurationDays: number;
  gracePeriodDays: number;
  maxRenewalAttempts: number;
  renewalRetryIntervalHours: number;
  pauseMaxDurationDays: number;
}

export interface PlanChangeResult {
  subscription: LifecycleSubscription;
  proratedAmount: number;
  creditAmount: number;
  chargeAmount: number;
  effectiveDate: string;
}

export interface RenewalResult {
  success: boolean;
  subscription: LifecycleSubscription;
  attemptNumber: number;
  nextRetryAt: string | null;
  error: string | null;
}

type LifecycleEventListener = (event: LifecycleEvent) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${ts}${rand}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addHours(date: Date, hours: number): Date {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: LifecycleConfig = {
  trialDurationDays: 14,
  gracePeriodDays: 7,
  maxRenewalAttempts: 4,
  renewalRetryIntervalHours: 24,
  pauseMaxDurationDays: 90,
};

export class SubscriptionLifecycleManager {
  private subscriptions = new Map<string, LifecycleSubscription>();
  private events: LifecycleEvent[] = [];
  private listeners: LifecycleEventListener[] = [];
  private config: LifecycleConfig;

  constructor(config: Partial<LifecycleConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('SubscriptionLifecycleManager initialized', {
      config: this.config,
    });
  }

  // ---- event system -------------------------------------------------------

  onEvent(listener: LifecycleEventListener): void {
    this.listeners.push(listener);
  }

  private emit(event: LifecycleEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('Lifecycle event listener error', err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private createEvent(
    sub: LifecycleSubscription,
    type: LifecycleEventType,
    fromStatus: LifecycleStatus,
    toStatus: LifecycleStatus,
    fromTier: SubscriptionTier | null,
    toTier: SubscriptionTier | null,
    metadata: Record<string, unknown> = {},
  ): LifecycleEvent {
    const revenueImpact = this.calculateRevenueImpact(fromTier, toTier, fromStatus, toStatus);
    const event: LifecycleEvent = {
      id: generateId('evt'),
      subscriptionId: sub.id,
      userId: sub.userId,
      type,
      fromStatus,
      toStatus,
      fromTier,
      toTier,
      revenueImpact,
      metadata,
      createdAt: new Date().toISOString(),
    };
    this.emit(event);
    return event;
  }

  // ---- revenue impact -----------------------------------------------------

  private tierPrice(tier: SubscriptionTier | null): number {
    if (!tier) return 0;
    return TIER_LIMITS[tier].monthlyPriceUsd;
  }

  calculateRevenueImpact(
    fromTier: SubscriptionTier | null,
    toTier: SubscriptionTier | null,
    fromStatus: LifecycleStatus,
    toStatus: LifecycleStatus,
  ): number {
    const fromPrice = fromStatus === 'active' || fromStatus === 'past_due' ? this.tierPrice(fromTier) : 0;
    const toPrice = toStatus === 'active' ? this.tierPrice(toTier) : 0;
    return toPrice - fromPrice;
  }

  // ---- trial management ---------------------------------------------------

  startTrial(userId: string, tier: SubscriptionTier = 'pro'): LifecycleSubscription {
    const now = new Date();
    const trialEnd = addDays(now, this.config.trialDurationDays);

    const sub: LifecycleSubscription = {
      id: generateId('sub'),
      userId,
      tier,
      status: 'trialing',
      trialStartedAt: now.toISOString(),
      trialEndsAt: trialEnd.toISOString(),
      activatedAt: null,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: trialEnd.toISOString(),
      cancelledAt: null,
      expiredAt: null,
      pausedAt: null,
      resumedAt: null,
      gracePeriodEndsAt: null,
      renewalAttempts: 0,
      lastRenewalAttemptAt: null,
      previousTier: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.subscriptions.set(sub.id, sub);
    this.createEvent(sub, 'trial_started', 'trialing', 'trialing', null, tier);
    logger.info('Trial started', { subscriptionId: sub.id, userId, tier });
    return sub;
  }

  convertTrial(subscriptionId: string): LifecycleSubscription {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'trialing') {
      throw new Error(`Cannot convert non-trialing subscription ${subscriptionId} (status=${sub.status})`);
    }

    const now = new Date();
    const periodEnd = addDays(now, 30);
    const prev = sub.status;

    sub.status = 'active';
    sub.activatedAt = now.toISOString();
    sub.currentPeriodStart = now.toISOString();
    sub.currentPeriodEnd = periodEnd.toISOString();
    sub.trialEndsAt = now.toISOString();
    sub.updatedAt = now.toISOString();

    this.createEvent(sub, 'trial_converted', prev, 'active', sub.tier, sub.tier);
    logger.info('Trial converted to active', { subscriptionId, userId: sub.userId });
    return sub;
  }

  checkTrialExpiration(subscriptionId: string): boolean {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'trialing' || !sub.trialEndsAt) return false;

    if (new Date(sub.trialEndsAt) <= new Date()) {
      sub.status = 'expired';
      sub.expiredAt = new Date().toISOString();
      sub.updatedAt = new Date().toISOString();
      this.createEvent(sub, 'trial_expired', 'trialing', 'expired', sub.tier, sub.tier);
      logger.info('Trial expired', { subscriptionId });
      return true;
    }
    return false;
  }

  getTrialDaysRemaining(subscriptionId: string): number {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'trialing' || !sub.trialEndsAt) return 0;
    const remaining = daysBetween(new Date(), new Date(sub.trialEndsAt));
    return Math.max(0, Math.ceil(remaining));
  }

  // ---- grace period / payment failure -------------------------------------

  handlePaymentFailure(subscriptionId: string): LifecycleSubscription {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'active' && sub.status !== 'past_due') {
      throw new Error(`Cannot mark payment failed for status=${sub.status}`);
    }

    const now = new Date();
    const prevStatus = sub.status;
    sub.status = 'past_due';
    sub.gracePeriodEndsAt = addDays(now, this.config.gracePeriodDays).toISOString();
    sub.updatedAt = now.toISOString();

    if (prevStatus === 'active') {
      this.createEvent(sub, 'grace_period_started', 'active', 'past_due', sub.tier, sub.tier, {
        gracePeriodEndsAt: sub.gracePeriodEndsAt,
      });
    }
    this.createEvent(sub, 'payment_failed', prevStatus, 'past_due', sub.tier, sub.tier);
    logger.warn('Payment failed, grace period started', { subscriptionId, gracePeriodEndsAt: sub.gracePeriodEndsAt });
    return sub;
  }

  checkGracePeriodExpiration(subscriptionId: string): boolean {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'past_due' || !sub.gracePeriodEndsAt) return false;

    if (new Date(sub.gracePeriodEndsAt) <= new Date()) {
      sub.status = 'cancelled';
      sub.cancelledAt = new Date().toISOString();
      sub.updatedAt = new Date().toISOString();
      this.createEvent(sub, 'grace_period_ended', 'past_due', 'cancelled', sub.tier, sub.tier);
      logger.info('Grace period expired, subscription cancelled', { subscriptionId });
      return true;
    }
    return false;
  }

  // ---- pause / resume -----------------------------------------------------

  pauseSubscription(subscriptionId: string): LifecycleSubscription {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'active') {
      throw new Error(`Cannot pause subscription with status=${sub.status}`);
    }

    const now = new Date();
    sub.status = 'paused';
    sub.pausedAt = now.toISOString();
    sub.updatedAt = now.toISOString();

    this.createEvent(sub, 'paused', 'active', 'paused', sub.tier, sub.tier, {
      maxPauseDays: this.config.pauseMaxDurationDays,
    });
    logger.info('Subscription paused', { subscriptionId });
    return sub;
  }

  resumeSubscription(subscriptionId: string): LifecycleSubscription {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'paused') {
      throw new Error(`Cannot resume subscription with status=${sub.status}`);
    }

    if (sub.pausedAt) {
      const pausedDays = daysBetween(new Date(sub.pausedAt), new Date());
      if (pausedDays > this.config.pauseMaxDurationDays) {
        sub.status = 'cancelled';
        sub.cancelledAt = new Date().toISOString();
        sub.updatedAt = new Date().toISOString();
        this.createEvent(sub, 'cancelled', 'paused', 'cancelled', sub.tier, sub.tier, {
          reason: 'pause_duration_exceeded',
        });
        logger.warn('Pause duration exceeded, subscription cancelled', { subscriptionId, pausedDays });
        return sub;
      }
    }

    const now = new Date();
    const periodEnd = addDays(now, 30);
    sub.status = 'active';
    sub.resumedAt = now.toISOString();
    sub.currentPeriodStart = now.toISOString();
    sub.currentPeriodEnd = periodEnd.toISOString();
    sub.pausedAt = null;
    sub.updatedAt = now.toISOString();

    this.createEvent(sub, 'resumed', 'paused', 'active', sub.tier, sub.tier);
    logger.info('Subscription resumed', { subscriptionId });
    return sub;
  }

  // ---- plan changes (upgrade / downgrade) ---------------------------------

  changePlan(subscriptionId: string, newTier: SubscriptionTier): PlanChangeResult {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'active' && sub.status !== 'trialing') {
      throw new Error(`Cannot change plan for status=${sub.status}`);
    }

    const oldTier = sub.tier;
    if (oldTier === newTier) {
      throw new Error(`Subscription is already on the ${newTier} tier`);
    }

    const now = new Date();
    const periodEnd = new Date(sub.currentPeriodEnd);
    const periodStart = new Date(sub.currentPeriodStart);
    const totalDays = Math.max(1, daysBetween(periodStart, periodEnd));
    const remainingDays = Math.max(0, daysBetween(now, periodEnd));
    const fraction = remainingDays / totalDays;

    const oldPrice = this.tierPrice(oldTier);
    const newPrice = this.tierPrice(newTier);
    const creditAmount = parseFloat((oldPrice * fraction).toFixed(2));
    const chargeAmount = parseFloat((newPrice * fraction).toFixed(2));
    const proratedAmount = parseFloat((chargeAmount - creditAmount).toFixed(2));

    const isUpgrade = newPrice > oldPrice;
    const eventType: LifecycleEventType = isUpgrade ? 'upgraded' : 'downgraded';

    sub.previousTier = oldTier;
    sub.tier = newTier;
    sub.updatedAt = now.toISOString();

    this.createEvent(sub, eventType, sub.status, sub.status, oldTier, newTier, {
      proratedAmount,
      creditAmount,
      chargeAmount,
    });

    logger.info('Plan changed', { subscriptionId, oldTier, newTier, proratedAmount });

    return {
      subscription: sub,
      proratedAmount,
      creditAmount,
      chargeAmount,
      effectiveDate: now.toISOString(),
    };
  }

  // ---- renewal processing -------------------------------------------------

  processRenewal(subscriptionId: string, paymentSucceeded: boolean): RenewalResult {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status !== 'active' && sub.status !== 'past_due') {
      throw new Error(`Cannot renew subscription with status=${sub.status}`);
    }

    const now = new Date();
    sub.renewalAttempts += 1;
    sub.lastRenewalAttemptAt = now.toISOString();
    sub.updatedAt = now.toISOString();

    if (paymentSucceeded) {
      const periodEnd = addDays(now, 30);
      const prevStatus = sub.status;
      sub.status = 'active';
      sub.currentPeriodStart = now.toISOString();
      sub.currentPeriodEnd = periodEnd.toISOString();
      sub.gracePeriodEndsAt = null;
      sub.renewalAttempts = 0;

      this.createEvent(sub, 'renewed', prevStatus, 'active', sub.tier, sub.tier);
      logger.info('Subscription renewed', { subscriptionId });
      return { success: true, subscription: sub, attemptNumber: sub.renewalAttempts, nextRetryAt: null, error: null };
    }

    // Payment failed
    if (sub.renewalAttempts >= this.config.maxRenewalAttempts) {
      sub.status = 'cancelled';
      sub.cancelledAt = now.toISOString();
      this.createEvent(sub, 'cancelled', 'past_due', 'cancelled', sub.tier, sub.tier, {
        reason: 'max_renewal_attempts_exceeded',
      });
      logger.warn('Max renewal attempts exceeded, subscription cancelled', { subscriptionId });
      return {
        success: false,
        subscription: sub,
        attemptNumber: sub.renewalAttempts,
        nextRetryAt: null,
        error: 'Max renewal attempts exceeded',
      };
    }

    if (sub.status === 'active') {
      sub.status = 'past_due';
      sub.gracePeriodEndsAt = addDays(now, this.config.gracePeriodDays).toISOString();
    }

    const nextRetry = addHours(now, this.config.renewalRetryIntervalHours);
    this.createEvent(sub, 'renewal_retry', sub.status, sub.status, sub.tier, sub.tier, {
      attempt: sub.renewalAttempts,
      nextRetryAt: nextRetry.toISOString(),
    });

    logger.info('Renewal failed, retry scheduled', {
      subscriptionId,
      attempt: sub.renewalAttempts,
      nextRetryAt: nextRetry.toISOString(),
    });

    return {
      success: false,
      subscription: sub,
      attemptNumber: sub.renewalAttempts,
      nextRetryAt: nextRetry.toISOString(),
      error: 'Payment failed',
    };
  }

  // ---- cancel / expire ----------------------------------------------------

  cancelSubscription(subscriptionId: string, immediate = false): LifecycleSubscription {
    const sub = this.getOrThrow(subscriptionId);
    if (sub.status === 'cancelled' || sub.status === 'expired') {
      throw new Error(`Subscription already ${sub.status}`);
    }

    const now = new Date();
    const prevStatus = sub.status;

    if (immediate) {
      sub.status = 'cancelled';
      sub.cancelledAt = now.toISOString();
    } else {
      sub.cancelledAt = sub.currentPeriodEnd;
    }
    sub.updatedAt = now.toISOString();

    this.createEvent(sub, 'cancelled', prevStatus, immediate ? 'cancelled' : prevStatus, sub.tier, sub.tier, {
      immediate,
      effectiveDate: sub.cancelledAt,
    });
    logger.info('Subscription cancelled', { subscriptionId, immediate, effectiveDate: sub.cancelledAt });
    return sub;
  }

  expireSubscription(subscriptionId: string): LifecycleSubscription {
    const sub = this.getOrThrow(subscriptionId);
    const now = new Date();
    const prevStatus = sub.status;
    sub.status = 'expired';
    sub.expiredAt = now.toISOString();
    sub.updatedAt = now.toISOString();
    this.createEvent(sub, 'expired', prevStatus, 'expired', sub.tier, null);
    logger.info('Subscription expired', { subscriptionId });
    return sub;
  }

  // ---- queries ------------------------------------------------------------

  getSubscription(subscriptionId: string): LifecycleSubscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  getSubscriptionsByUser(userId: string): LifecycleSubscription[] {
    return [...this.subscriptions.values()].filter((s) => s.userId === userId);
  }

  getSubscriptionsByStatus(status: LifecycleStatus): LifecycleSubscription[] {
    return [...this.subscriptions.values()].filter((s) => s.status === status);
  }

  getEventsForSubscription(subscriptionId: string): LifecycleEvent[] {
    return this.events.filter((e) => e.subscriptionId === subscriptionId);
  }

  getConversionRate(): number {
    const trials = this.events.filter((e) => e.type === 'trial_started').length;
    const conversions = this.events.filter((e) => e.type === 'trial_converted').length;
    return trials === 0 ? 0 : parseFloat((conversions / trials).toFixed(4));
  }

  getRevenueImpactSummary(): Record<LifecycleEventType, number> {
    const summary = {} as Record<LifecycleEventType, number>;
    for (const evt of this.events) {
      summary[evt.type] = (summary[evt.type] || 0) + evt.revenueImpact;
    }
    return summary;
  }

  getActiveSubscriptionCount(): number {
    return [...this.subscriptions.values()].filter((s) => s.status === 'active').length;
  }

  // ---- internals ----------------------------------------------------------

  private getOrThrow(id: string): LifecycleSubscription {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new Error(`Subscription not found: ${id}`);
    return sub;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__subscriptionLifecycleManager__';

export function getSubscriptionLifecycleManager(
  config?: Partial<LifecycleConfig>,
): SubscriptionLifecycleManager {
  const g = globalThis as unknown as Record<string, SubscriptionLifecycleManager>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new SubscriptionLifecycleManager(config);
  }
  return g[GLOBAL_KEY];
}
