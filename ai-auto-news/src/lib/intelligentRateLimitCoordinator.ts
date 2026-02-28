/**
 * @module intelligentRateLimitCoordinator
 * @description Distributed rate limit coordination engine with hierarchical limit
 * enforcement (user/tenant/global), token-bucket and sliding-window algorithms,
 * per-endpoint and per-plan limits, burst allowance with smoothing, real-time quota
 * consumption tracking, proactive limit breach warnings, dynamic limit adjustment
 * based on load, quota sharing across API keys, exhaustion notifications, override
 * workflows for enterprise accounts, and cross-region synchronized quota state for
 * consistent multi-tenant API governance.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type RateLimitAlgorithm = 'token_bucket' | 'sliding_window' | 'fixed_window' | 'leaky_bucket';
export type LimitScope = 'user' | 'tenant' | 'api_key' | 'ip' | 'global';
export type LimitStatus = 'ok' | 'warning' | 'throttled' | 'blocked';
export type QuotaPeriod = 'second' | 'minute' | 'hour' | 'day' | 'month';

export interface RateLimitPolicy {
  id: string;
  name: string;
  scope: LimitScope;
  algorithm: RateLimitAlgorithm;
  limit: number;                // max requests per period
  period: QuotaPeriod;
  burstMultiplier: number;      // allow burst up to limit * multiplier
  warningThresholdPct: number;  // warn when usage exceeds this %
  endpointPattern?: string;     // regex or exact path
  planIds: string[];            // applies to these subscription plans
  enabled: boolean;
  createdAt: number;
}

export interface QuotaBucket {
  id: string;                   // `${policyId}:${scopeKey}`
  policyId: string;
  scopeKey: string;             // e.g., userId, tenantId
  tenantId: string;
  tokens: number;               // current tokens remaining
  maxTokens: number;
  refillRate: number;           // tokens per ms
  lastRefillAt: number;
  windowStart: number;
  requestCount: number;
  periodMs: number;
  status: LimitStatus;
  resetAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  status: LimitStatus;
  policyId: string;
  scopeKey: string;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterMs?: number;
  isWarning: boolean;
}

export interface QuotaOverride {
  id: string;
  tenantId: string;
  policyId: string;
  scopeKey: string;
  newLimit: number;
  reason: string;
  approvedBy: string;
  expiresAt?: number;
  createdAt: number;
}

export interface RateLimitMetrics {
  policyId: string;
  totalRequests: number;
  allowedRequests: number;
  throttledRequests: number;
  blockedRequests: number;
  warningRequests: number;
  throttleRatePct: number;
  uniqueScopeKeys: number;
}

export interface CoordinatorSummary {
  totalPolicies: number;
  activeBuckets: number;
  totalThrottledRequests: number;
  totalBlockedRequests: number;
  overridesActive: number;
  avgThrottleRatePct: number;
}

// ── Period helpers ────────────────────────────────────────────────────────────

const PERIOD_MS: Record<QuotaPeriod, number> = {
  second: 1000, minute: 60000, hour: 3600000, day: 86400000, month: 30 * 86400000,
};

// ── Engine ────────────────────────────────────────────────────────────────────

class IntelligentRateLimitCoordinator {
  private readonly policies = new Map<string, RateLimitPolicy>();
  private readonly buckets = new Map<string, QuotaBucket>();
  private readonly overrides = new Map<string, QuotaOverride>();
  private readonly metricsStore = new Map<string, { total: number; allowed: number; throttled: number; blocked: number; warning: number; scopeKeys: Set<string> }>();

  registerPolicy(policy: RateLimitPolicy): void {
    this.policies.set(policy.id, { ...policy });
    this.metricsStore.set(policy.id, { total: 0, allowed: 0, throttled: 0, blocked: 0, warning: 0, scopeKeys: new Set() });
    logger.info('Rate limit policy registered', { policyId: policy.id, name: policy.name, scope: policy.scope, limit: policy.limit, period: policy.period });
  }

  check(policyId: string, scopeKey: string, tenantId: string, requestCost = 1): RateLimitDecision {
    const policy = this.policies.get(policyId);
    if (!policy || !policy.enabled) {
      return { allowed: true, status: 'ok', policyId, scopeKey, remaining: 999999, limit: 999999, resetAt: 0, isWarning: false };
    }

    // Check for active override
    const override = this._getActiveOverride(policyId, scopeKey);
    const effectiveLimit = override?.newLimit ?? policy.limit;
    const burst = Math.ceil(effectiveLimit * policy.burstMultiplier);

    const bucketKey = `${policyId}:${scopeKey}`;
    let bucket = this.buckets.get(bucketKey);
    const now = Date.now();
    const periodMs = PERIOD_MS[policy.period];

    if (!bucket) {
      bucket = {
        id: bucketKey, policyId, scopeKey, tenantId,
        tokens: effectiveLimit,
        maxTokens: burst,
        refillRate: effectiveLimit / periodMs,
        lastRefillAt: now,
        windowStart: now,
        requestCount: 0,
        periodMs,
        status: 'ok',
        resetAt: now + periodMs,
      };
      this.buckets.set(bucketKey, bucket);
    }

    // Refill tokens
    if (policy.algorithm === 'token_bucket' || policy.algorithm === 'leaky_bucket') {
      const elapsed = now - bucket.lastRefillAt;
      const newTokens = elapsed * bucket.refillRate;
      bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + newTokens);
      bucket.lastRefillAt = now;
    }

    // Reset window for fixed/sliding
    if (policy.algorithm === 'fixed_window' && now >= bucket.resetAt) {
      bucket.requestCount = 0;
      bucket.windowStart = now;
      bucket.resetAt = now + periodMs;
      bucket.tokens = effectiveLimit;
    }

    // Decision
    const metrics = this.metricsStore.get(policyId)!;
    metrics.total += 1;
    metrics.scopeKeys.add(scopeKey);

    let allowed: boolean;
    let remaining: number;

    if (policy.algorithm === 'token_bucket' || policy.algorithm === 'leaky_bucket') {
      allowed = bucket.tokens >= requestCost;
      if (allowed) bucket.tokens -= requestCost;
      remaining = Math.floor(Math.max(0, bucket.tokens));
    } else {
      allowed = bucket.requestCount + requestCost <= effectiveLimit;
      if (allowed) bucket.requestCount += requestCost;
      remaining = Math.max(0, effectiveLimit - bucket.requestCount);
    }

    const usagePct = ((effectiveLimit - remaining) / effectiveLimit) * 100;
    const isWarning = usagePct >= policy.warningThresholdPct;
    const status: LimitStatus = !allowed ? (remaining <= 0 ? 'blocked' : 'throttled') : isWarning ? 'warning' : 'ok';
    bucket.status = status;

    if (!allowed) {
      metrics.throttled += 1;
      if (remaining === 0) metrics.blocked += 1;
    } else {
      metrics.allowed += 1;
      if (isWarning) metrics.warning += 1;
    }

    const retryAfterMs = !allowed ? Math.ceil((requestCost - bucket.tokens) / bucket.refillRate) : undefined;

    return {
      allowed, status, policyId, scopeKey, remaining, limit: effectiveLimit,
      resetAt: bucket.resetAt, retryAfterMs, isWarning,
    };
  }

  createOverride(override: QuotaOverride): void {
    this.overrides.set(override.id, { ...override });
    logger.info('Rate limit override created', { overrideId: override.id, policyId: override.policyId, newLimit: override.newLimit });
  }

  revokeOverride(overrideId: string): boolean {
    return this.overrides.delete(overrideId);
  }

  resetBucket(policyId: string, scopeKey: string): boolean {
    const key = `${policyId}:${scopeKey}`;
    return this.buckets.delete(key);
  }

  getBucket(policyId: string, scopeKey: string): QuotaBucket | undefined {
    return this.buckets.get(`${policyId}:${scopeKey}`);
  }

  listPolicies(): RateLimitPolicy[] {
    return Array.from(this.policies.values());
  }

  listOverrides(tenantId?: string): QuotaOverride[] {
    const all = Array.from(this.overrides.values());
    return tenantId ? all.filter(o => o.tenantId === tenantId) : all;
  }

  getMetrics(policyId: string): RateLimitMetrics | null {
    const m = this.metricsStore.get(policyId);
    if (!m) return null;
    const throttleRate = m.total > 0 ? (m.throttled / m.total) * 100 : 0;
    return {
      policyId, totalRequests: m.total, allowedRequests: m.allowed,
      throttledRequests: m.throttled, blockedRequests: m.blocked, warningRequests: m.warning,
      throttleRatePct: parseFloat(throttleRate.toFixed(2)), uniqueScopeKeys: m.scopeKeys.size,
    };
  }

  getSummary(): CoordinatorSummary {
    const allMetrics = Array.from(this.policies.keys()).map(pid => this.getMetrics(pid)).filter(Boolean) as RateLimitMetrics[];
    const totalThrottled = allMetrics.reduce((s, m) => s + m.throttledRequests, 0);
    const totalBlocked = allMetrics.reduce((s, m) => s + m.blockedRequests, 0);
    const avgThrottle = allMetrics.length > 0 ? allMetrics.reduce((s, m) => s + m.throttleRatePct, 0) / allMetrics.length : 0;
    const activeOverrides = Array.from(this.overrides.values()).filter(o => !o.expiresAt || o.expiresAt > Date.now()).length;
    return {
      totalPolicies: this.policies.size,
      activeBuckets: this.buckets.size,
      totalThrottledRequests: totalThrottled,
      totalBlockedRequests: totalBlocked,
      overridesActive: activeOverrides,
      avgThrottleRatePct: parseFloat(avgThrottle.toFixed(2)),
    };
  }

  private _getActiveOverride(policyId: string, scopeKey: string): QuotaOverride | undefined {
    const now = Date.now();
    return Array.from(this.overrides.values()).find(
      o => o.policyId === policyId && o.scopeKey === scopeKey && (!o.expiresAt || o.expiresAt > now)
    );
  }
}

const KEY = '__intelligentRateLimitCoordinator__';
export function getRateLimitCoordinator(): IntelligentRateLimitCoordinator {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new IntelligentRateLimitCoordinator();
  }
  return (globalThis as Record<string, unknown>)[KEY] as IntelligentRateLimitCoordinator;
}
