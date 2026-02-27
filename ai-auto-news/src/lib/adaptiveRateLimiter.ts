/**
 * Adaptive Rate Limiter
 *
 * ML-based adaptive rate limiting with dynamic quota adjustment,
 * behavioral profiling, anomaly-based throttling, fairness enforcement,
 * and real-time policy updates.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface RateLimitPolicy {
  id: string;
  name: string;
  tier: 'free' | 'pro' | 'enterprise' | 'internal';
  baseQuota: QuotaConfig;
  burstConfig: BurstConfig;
  adaptiveConfig: AdaptiveConfig;
  penaltyConfig: PenaltyConfig;
  fairnessConfig: FairnessConfig;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface QuotaConfig {
  requestsPerSecond: number;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerRequest: number;
  maxConcurrent: number;
  maxPayloadBytes: number;
}

export interface BurstConfig {
  enabled: boolean;
  burstMultiplier: number;
  burstWindowMs: number;
  cooldownMs: number;
  maxBurstTokens: number;
}

export interface AdaptiveConfig {
  enabled: boolean;
  learningRate: number;
  adjustmentInterval: number;
  minQuotaFraction: number;
  maxQuotaMultiplier: number;
  anomalyThreshold: number;
  patternWindowMs: number;
}

export interface PenaltyConfig {
  enabled: boolean;
  violationThreshold: number;
  penaltyMultiplier: number;
  penaltyDurationMs: number;
  escalationSteps: number;
  autoRecovery: boolean;
}

export interface FairnessConfig {
  algorithm: 'token-bucket' | 'leaky-bucket' | 'sliding-window' | 'fixed-window' | 'wfq';
  weightByTier: Record<string, number>;
  minGuaranteedFraction: number;
}

export interface ClientProfile {
  clientId: string;
  tenantId: string;
  policyId: string;
  buckets: RateBuckets;
  burstState: BurstState;
  behaviorProfile: BehaviorProfile;
  penaltyState: PenaltyState;
  adaptiveQuota: AdaptiveQuota;
  stats: ClientStats;
  lastSeen: number;
  createdAt: number;
}

export interface RateBuckets {
  second: TokenBucket;
  minute: TokenBucket;
  hour: TokenBucket;
  day: TokenBucket;
  concurrent: SemaphoreBucket;
}

export interface TokenBucket {
  tokens: number;
  capacity: number;
  refillRate: number;
  lastRefill: number;
  windowStart: number;
  windowRequests: number;
}

export interface SemaphoreBucket {
  active: number;
  capacity: number;
  waitQueue: number;
}

export interface BurstState {
  isBursting: boolean;
  burstStart: number;
  burstTokensUsed: number;
  cooldownUntil: number;
  burstCount: number;
}

export interface BehaviorProfile {
  requestPattern: number[];
  avgRequestsPerSecond: number;
  peakRequestsPerSecond: number;
  requestVariance: number;
  patternType: 'steady' | 'bursty' | 'periodic' | 'anomalous';
  lastUpdated: number;
  anomalyScore: number;
}

export interface PenaltyState {
  inPenalty: boolean;
  penaltyUntil: number;
  penaltyLevel: number;
  violationCount: number;
  totalViolations: number;
  lastViolation: number;
}

export interface AdaptiveQuota {
  current: Partial<QuotaConfig>;
  baseline: Partial<QuotaConfig>;
  adjustmentFactor: number;
  lastAdjusted: number;
  adjustmentHistory: QuotaAdjustment[];
}

export interface QuotaAdjustment {
  timestamp: number;
  reason: string;
  oldFactor: number;
  newFactor: number;
  trigger: 'behavioral' | 'load' | 'anomaly' | 'manual';
}

export interface ClientStats {
  totalRequests: number;
  allowedRequests: number;
  deniedRequests: number;
  throttledRequests: number;
  totalTokensUsed: number;
  avgLatencyMs: number;
  errorRate: number;
  successRate: number;
  lastHourRequests: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  remainingQuota: RemainingQuota;
  headers: Record<string, string>;
  policyApplied: string;
  adaptiveAdjustment?: number;
  penaltyApplied?: boolean;
  burstUsed?: boolean;
}

export interface RemainingQuota {
  second: number;
  minute: number;
  hour: number;
  day: number;
  concurrent: number;
}

export interface SystemLoadMetrics {
  cpuUtilization: number;
  memoryUtilization: number;
  requestQueueDepth: number;
  avgResponseTimeMs: number;
  errorRate: number;
  activeConnections: number;
  timestamp: number;
}

export interface RateLimiterStats {
  totalClients: number;
  activePolicies: number;
  globalAllowRate: number;
  globalDenyRate: number;
  topThrottledClients: Array<{ clientId: string; deniedCount: number }>;
  penalizedClients: number;
  burstingClients: number;
  anomalousClients: number;
  systemLoad: SystemLoadMetrics;
}

export class AdaptiveRateLimiter {
  private policies = new Map<string, RateLimitPolicy>();
  private clients = new Map<string, ClientProfile>();
  private systemLoad: SystemLoadMetrics = {
    cpuUtilization: 0,
    memoryUtilization: 0,
    requestQueueDepth: 0,
    avgResponseTimeMs: 0,
    errorRate: 0,
    activeConnections: 0,
    timestamp: Date.now(),
  };
  private globalStats = { allowed: 0, denied: 0, throttled: 0 };
  private adaptiveInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.createDefaultPolicies();
    this.startAdaptiveEngine();
  }

  private createDefaultPolicies(): void {
    const tiers: Array<[string, RateLimitPolicy['tier'], Partial<QuotaConfig>]> = [
      ['free', 'free', { requestsPerSecond: 10, requestsPerMinute: 100, requestsPerHour: 1000, requestsPerDay: 5000, maxConcurrent: 5 }],
      ['pro', 'pro', { requestsPerSecond: 100, requestsPerMinute: 1000, requestsPerHour: 20000, requestsPerDay: 100000, maxConcurrent: 50 }],
      ['enterprise', 'enterprise', { requestsPerSecond: 1000, requestsPerMinute: 50000, requestsPerHour: 500000, requestsPerDay: 5000000, maxConcurrent: 500 }],
      ['internal', 'internal', { requestsPerSecond: 10000, requestsPerMinute: 500000, requestsPerHour: 5000000, requestsPerDay: 50000000, maxConcurrent: 5000 }],
    ];

    tiers.forEach(([id, tier, quota]) => {
      const policy: RateLimitPolicy = {
        id,
        name: `${tier.charAt(0).toUpperCase()}${tier.slice(1)} Tier`,
        tier,
        baseQuota: {
          requestsPerSecond: quota.requestsPerSecond ?? 10,
          requestsPerMinute: quota.requestsPerMinute ?? 100,
          requestsPerHour: quota.requestsPerHour ?? 1000,
          requestsPerDay: quota.requestsPerDay ?? 5000,
          tokensPerRequest: 1,
          maxConcurrent: quota.maxConcurrent ?? 5,
          maxPayloadBytes: 1_048_576,
        },
        burstConfig: {
          enabled: tier !== 'free',
          burstMultiplier: tier === 'enterprise' ? 3 : 2,
          burstWindowMs: 5000,
          cooldownMs: 30000,
          maxBurstTokens: (quota.requestsPerSecond ?? 10) * 5,
        },
        adaptiveConfig: {
          enabled: true,
          learningRate: 0.1,
          adjustmentInterval: 60000,
          minQuotaFraction: 0.5,
          maxQuotaMultiplier: 2.0,
          anomalyThreshold: 3.0,
          patternWindowMs: 300000,
        },
        penaltyConfig: {
          enabled: true,
          violationThreshold: 5,
          penaltyMultiplier: 0.5,
          penaltyDurationMs: 60000,
          escalationSteps: 3,
          autoRecovery: true,
        },
        fairnessConfig: {
          algorithm: 'token-bucket',
          weightByTier: { free: 1, pro: 10, enterprise: 100, internal: 1000 },
          minGuaranteedFraction: 0.1,
        },
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.policies.set(id, policy);
    });
  }

  check(
    clientId: string,
    tenantId: string,
    policyId: string = 'free',
    requestWeight: number = 1
  ): RateLimitDecision {
    const policy = this.policies.get(policyId);
    if (!policy) {
      return this.denyDecision('policy_not_found', 'Unknown policy', 60000);
    }

    const client = this.getOrCreateClient(clientId, tenantId, policyId, policy);
    const now = Date.now();

    if (client.penaltyState.inPenalty && now < client.penaltyState.penaltyUntil) {
      const retryAfter = client.penaltyState.penaltyUntil - now;
      return this.denyDecision('penalty', `Client under penalty`, retryAfter, client, policy);
    } else if (client.penaltyState.inPenalty) {
      this.recoverFromPenalty(client, policy);
    }

    this.refillBuckets(client, policy, now);

    const loadFactor = this.computeLoadFactor();
    const effectiveQuota = this.computeEffectiveQuota(client, policy, loadFactor);

    const checkResult = this.checkBuckets(client, effectiveQuota, requestWeight, now);

    if (!checkResult.allowed) {
      client.stats.deniedRequests++;
      this.globalStats.denied++;
      this.recordViolation(client, policy, now);

      this.updateBehaviorProfile(client, now, false);

      return {
        allowed: false,
        reason: checkResult.reason,
        retryAfterMs: checkResult.retryAfterMs,
        remainingQuota: this.getRemainingQuota(client),
        headers: this.buildHeaders(client, policy, checkResult.retryAfterMs),
        policyApplied: policyId,
        penaltyApplied: client.penaltyState.inPenalty,
      };
    }

    this.consumeBuckets(client, requestWeight, now);
    client.stats.totalRequests++;
    client.stats.allowedRequests++;
    client.stats.totalTokensUsed += requestWeight;
    client.stats.lastHourRequests++;
    client.lastSeen = now;
    this.globalStats.allowed++;

    this.updateBehaviorProfile(client, now, true);

    return {
      allowed: true,
      remainingQuota: this.getRemainingQuota(client),
      headers: this.buildHeaders(client, policy),
      policyApplied: policyId,
      adaptiveAdjustment: client.adaptiveQuota.adjustmentFactor,
      burstUsed: client.burstState.isBursting,
    };
  }

  release(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.buckets.concurrent.active = Math.max(0, client.buckets.concurrent.active - 1);
    }
  }

  updateSystemLoad(metrics: Partial<SystemLoadMetrics>): void {
    this.systemLoad = {
      ...this.systemLoad,
      ...metrics,
      timestamp: Date.now(),
    };
  }

  updatePolicy(policyId: string, updates: Partial<RateLimitPolicy>): void {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Policy ${policyId} not found`);
    Object.assign(policy, updates, { updatedAt: Date.now() });
    logger.info('Rate limit policy updated', { policyId });
  }

  getClientProfile(clientId: string): ClientProfile | undefined {
    return this.clients.get(clientId);
  }

  getStats(): RateLimiterStats {
    const all = Array.from(this.clients.values());
    const topThrottled = all
      .sort((a, b) => b.stats.deniedRequests - a.stats.deniedRequests)
      .slice(0, 10)
      .map(c => ({ clientId: c.clientId, deniedCount: c.stats.deniedRequests }));

    return {
      totalClients: all.length,
      activePolicies: Array.from(this.policies.values()).filter(p => p.active).length,
      globalAllowRate: this.globalStats.allowed / Math.max(this.globalStats.allowed + this.globalStats.denied, 1),
      globalDenyRate: this.globalStats.denied / Math.max(this.globalStats.allowed + this.globalStats.denied, 1),
      topThrottledClients: topThrottled,
      penalizedClients: all.filter(c => c.penaltyState.inPenalty).length,
      burstingClients: all.filter(c => c.burstState.isBursting).length,
      anomalousClients: all.filter(c => c.behaviorProfile.anomalyScore > 2).length,
      systemLoad: this.systemLoad,
    };
  }

  destroy(): void {
    if (this.adaptiveInterval) {
      clearInterval(this.adaptiveInterval);
      this.adaptiveInterval = null;
    }
  }

  private getOrCreateClient(
    clientId: string,
    tenantId: string,
    policyId: string,
    policy: RateLimitPolicy
  ): ClientProfile {
    if (!this.clients.has(clientId)) {
      const now = Date.now();
      const q = policy.baseQuota;
      const client: ClientProfile = {
        clientId,
        tenantId,
        policyId,
        buckets: {
          second: this.newBucket(q.requestsPerSecond, q.requestsPerSecond, 1000),
          minute: this.newBucket(q.requestsPerMinute, q.requestsPerMinute, 60000),
          hour: this.newBucket(q.requestsPerHour, q.requestsPerHour, 3600000),
          day: this.newBucket(q.requestsPerDay, q.requestsPerDay, 86400000),
          concurrent: { active: 0, capacity: q.maxConcurrent, waitQueue: 0 },
        },
        burstState: {
          isBursting: false,
          burstStart: 0,
          burstTokensUsed: 0,
          cooldownUntil: 0,
          burstCount: 0,
        },
        behaviorProfile: {
          requestPattern: [],
          avgRequestsPerSecond: 0,
          peakRequestsPerSecond: 0,
          requestVariance: 0,
          patternType: 'steady',
          lastUpdated: now,
          anomalyScore: 0,
        },
        penaltyState: {
          inPenalty: false,
          penaltyUntil: 0,
          penaltyLevel: 0,
          violationCount: 0,
          totalViolations: 0,
          lastViolation: 0,
        },
        adaptiveQuota: {
          current: {},
          baseline: {},
          adjustmentFactor: 1.0,
          lastAdjusted: now,
          adjustmentHistory: [],
        },
        stats: {
          totalRequests: 0,
          allowedRequests: 0,
          deniedRequests: 0,
          throttledRequests: 0,
          totalTokensUsed: 0,
          avgLatencyMs: 0,
          errorRate: 0,
          successRate: 1,
          lastHourRequests: 0,
        },
        lastSeen: now,
        createdAt: now,
      };
      this.clients.set(clientId, client);
    }
    return this.clients.get(clientId)!;
  }

  private newBucket(capacity: number, tokens: number, windowMs: number): TokenBucket {
    const now = Date.now();
    return {
      tokens,
      capacity,
      refillRate: capacity / (windowMs / 1000),
      lastRefill: now,
      windowStart: now,
      windowRequests: 0,
    };
  }

  private refillBuckets(client: ClientProfile, policy: RateLimitPolicy, now: number): void {
    const { buckets } = client;
    const q = policy.baseQuota;

    const refillBucket = (bucket: TokenBucket, windowMs: number, capacity: number) => {
      const elapsed = (now - bucket.lastRefill) / 1000;
      const newTokens = elapsed * (capacity / (windowMs / 1000));
      bucket.tokens = Math.min(capacity, bucket.tokens + newTokens);
      bucket.lastRefill = now;

      if (now - bucket.windowStart >= windowMs) {
        bucket.windowStart = now;
        bucket.windowRequests = 0;
      }
    };

    refillBucket(buckets.second, 1000, q.requestsPerSecond);
    refillBucket(buckets.minute, 60000, q.requestsPerMinute);
    refillBucket(buckets.hour, 3600000, q.requestsPerHour);
    refillBucket(buckets.day, 86400000, q.requestsPerDay);
  }

  private computeLoadFactor(): number {
    const cpu = this.systemLoad.cpuUtilization;
    const mem = this.systemLoad.memoryUtilization;
    const errRate = this.systemLoad.errorRate;
    return Math.max(0.1, 1 - (cpu * 0.4 + mem * 0.3 + errRate * 0.3));
  }

  private computeEffectiveQuota(
    client: ClientProfile,
    policy: RateLimitPolicy,
    loadFactor: number
  ): QuotaConfig {
    const adaptive = client.adaptiveQuota.adjustmentFactor;
    const penalty = client.penaltyState.inPenalty ? policy.penaltyConfig.penaltyMultiplier : 1;
    const factor = Math.min(
      policy.adaptiveConfig.maxQuotaMultiplier,
      Math.max(policy.adaptiveConfig.minQuotaFraction, adaptive * loadFactor * penalty)
    );

    const q = policy.baseQuota;
    return {
      requestsPerSecond: Math.ceil(q.requestsPerSecond * factor),
      requestsPerMinute: Math.ceil(q.requestsPerMinute * factor),
      requestsPerHour: Math.ceil(q.requestsPerHour * factor),
      requestsPerDay: Math.ceil(q.requestsPerDay * factor),
      tokensPerRequest: q.tokensPerRequest,
      maxConcurrent: Math.ceil(q.maxConcurrent * factor),
      maxPayloadBytes: q.maxPayloadBytes,
    };
  }

  private checkBuckets(
    client: ClientProfile,
    quota: QuotaConfig,
    weight: number,
    now: number
  ): { allowed: boolean; reason?: string; retryAfterMs?: number } {
    const { buckets, burstState } = client;

    if (buckets.second.tokens < weight) {
      const retryAfter = Math.ceil((weight - buckets.second.tokens) / buckets.second.refillRate * 1000);
      return { allowed: false, reason: 'rate_limit_second', retryAfterMs: retryAfter };
    }
    if (buckets.minute.tokens < weight) {
      const retryAfter = 60000 - (now - buckets.minute.windowStart);
      return { allowed: false, reason: 'rate_limit_minute', retryAfterMs: Math.max(0, retryAfter) };
    }
    if (buckets.hour.tokens < weight) {
      const retryAfter = 3600000 - (now - buckets.hour.windowStart);
      return { allowed: false, reason: 'rate_limit_hour', retryAfterMs: Math.max(0, retryAfter) };
    }
    if (buckets.day.tokens < weight) {
      const retryAfter = 86400000 - (now - buckets.day.windowStart);
      return { allowed: false, reason: 'rate_limit_day', retryAfterMs: Math.max(0, retryAfter) };
    }
    if (buckets.concurrent.active >= quota.maxConcurrent) {
      return { allowed: false, reason: 'concurrency_limit', retryAfterMs: 1000 };
    }

    return { allowed: true };
  }

  private consumeBuckets(client: ClientProfile, weight: number, now: number): void {
    client.buckets.second.tokens -= weight;
    client.buckets.minute.tokens -= weight;
    client.buckets.hour.tokens -= weight;
    client.buckets.day.tokens -= weight;
    client.buckets.concurrent.active++;
    client.buckets.second.windowRequests++;
    client.buckets.minute.windowRequests++;
  }

  private getRemainingQuota(client: ClientProfile): RemainingQuota {
    return {
      second: Math.max(0, Math.floor(client.buckets.second.tokens)),
      minute: Math.max(0, Math.floor(client.buckets.minute.tokens)),
      hour: Math.max(0, Math.floor(client.buckets.hour.tokens)),
      day: Math.max(0, Math.floor(client.buckets.day.tokens)),
      concurrent: Math.max(0, client.buckets.concurrent.capacity - client.buckets.concurrent.active),
    };
  }

  private buildHeaders(
    client: ClientProfile,
    policy: RateLimitPolicy,
    retryAfterMs?: number
  ): Record<string, string> {
    const remaining = this.getRemainingQuota(client);
    const headers: Record<string, string> = {
      'X-RateLimit-Limit-Second': String(policy.baseQuota.requestsPerSecond),
      'X-RateLimit-Remaining-Second': String(remaining.second),
      'X-RateLimit-Limit-Minute': String(policy.baseQuota.requestsPerMinute),
      'X-RateLimit-Remaining-Minute': String(remaining.minute),
      'X-RateLimit-Limit-Hour': String(policy.baseQuota.requestsPerHour),
      'X-RateLimit-Remaining-Hour': String(remaining.hour),
      'X-RateLimit-Policy': policy.id,
    };

    if (retryAfterMs !== undefined) {
      headers['Retry-After'] = String(Math.ceil(retryAfterMs / 1000));
      headers['X-RateLimit-Reset'] = String(Date.now() + retryAfterMs);
    }

    return headers;
  }

  private recordViolation(client: ClientProfile, policy: RateLimitPolicy, now: number): void {
    if (!policy.penaltyConfig.enabled) return;
    client.penaltyState.violationCount++;
    client.penaltyState.totalViolations++;
    client.penaltyState.lastViolation = now;

    if (client.penaltyState.violationCount >= policy.penaltyConfig.violationThreshold) {
      const level = Math.min(
        client.penaltyState.penaltyLevel + 1,
        policy.penaltyConfig.escalationSteps
      );
      const duration = policy.penaltyConfig.penaltyDurationMs * Math.pow(2, level - 1);
      client.penaltyState.inPenalty = true;
      client.penaltyState.penaltyUntil = now + duration;
      client.penaltyState.penaltyLevel = level;
      client.penaltyState.violationCount = 0;

      logger.warn('Client entering penalty state', {
        clientId: client.clientId,
        level,
        durationMs: duration,
      });
    }
  }

  private recoverFromPenalty(client: ClientProfile, policy: RateLimitPolicy): void {
    if (!policy.penaltyConfig.autoRecovery) return;
    client.penaltyState.inPenalty = false;
    client.penaltyState.penaltyLevel = Math.max(0, client.penaltyState.penaltyLevel - 1);
    logger.debug('Client recovered from penalty', { clientId: client.clientId });
  }

  private updateBehaviorProfile(client: ClientProfile, now: number, allowed: boolean): void {
    const profile = client.behaviorProfile;
    const windowMs = 10000;

    profile.requestPattern.push(now);
    profile.requestPattern = profile.requestPattern.filter(t => now - t < windowMs);

    const rps = profile.requestPattern.length / (windowMs / 1000);
    profile.peakRequestsPerSecond = Math.max(profile.peakRequestsPerSecond, rps);
    profile.avgRequestsPerSecond =
      profile.avgRequestsPerSecond * 0.9 + rps * 0.1;

    const variance = Math.abs(rps - profile.avgRequestsPerSecond);
    profile.requestVariance = profile.requestVariance * 0.9 + variance * 0.1;

    if (profile.requestVariance < 0.5) profile.patternType = 'steady';
    else if (profile.requestVariance > 5) profile.patternType = 'bursty';
    else profile.patternType = 'periodic';

    const zScore = profile.avgRequestsPerSecond > 0
      ? Math.abs(rps - profile.avgRequestsPerSecond) / Math.max(0.1, profile.requestVariance)
      : 0;
    profile.anomalyScore = profile.anomalyScore * 0.95 + zScore * 0.05;

    if (profile.anomalyScore > 3) {
      profile.patternType = 'anomalous';
    }

    profile.lastUpdated = now;
  }

  private startAdaptiveEngine(): void {
    this.adaptiveInterval = setInterval(() => {
      this.runAdaptiveCycle();
    }, 60000);
  }

  private runAdaptiveCycle(): void {
    const now = Date.now();
    this.clients.forEach((client, clientId) => {
      const policy = this.policies.get(client.policyId);
      if (!policy?.adaptiveConfig.enabled) return;

      const ac = policy.adaptiveConfig;
      if (now - client.adaptiveQuota.lastAdjusted < ac.adjustmentInterval) return;

      const utilizationRate =
        client.stats.allowedRequests / Math.max(client.stats.totalRequests, 1);
      const denialRate =
        client.stats.deniedRequests / Math.max(client.stats.totalRequests, 1);
      const anomalyScore = client.behaviorProfile.anomalyScore;

      let newFactor = client.adaptiveQuota.adjustmentFactor;

      if (anomalyScore > ac.anomalyThreshold) {
        newFactor = Math.max(ac.minQuotaFraction, newFactor - ac.learningRate * 0.5);
        logger.debug('Adaptive quota reduced due to anomaly', { clientId, anomalyScore });
      } else if (denialRate > 0.3) {
        newFactor = Math.min(ac.maxQuotaMultiplier, newFactor + ac.learningRate * 0.1);
      } else if (utilizationRate < 0.5) {
        newFactor = Math.max(ac.minQuotaFraction, newFactor - ac.learningRate * 0.05);
      }

      if (newFactor !== client.adaptiveQuota.adjustmentFactor) {
        const adjustment: QuotaAdjustment = {
          timestamp: now,
          reason: anomalyScore > ac.anomalyThreshold ? 'anomaly' : 'utilization',
          oldFactor: client.adaptiveQuota.adjustmentFactor,
          newFactor,
          trigger: anomalyScore > ac.anomalyThreshold ? 'anomaly' : 'behavioral',
        };
        client.adaptiveQuota.adjustmentHistory.push(adjustment);
        if (client.adaptiveQuota.adjustmentHistory.length > 100) {
          client.adaptiveQuota.adjustmentHistory.shift();
        }
        client.adaptiveQuota.adjustmentFactor = newFactor;
        client.adaptiveQuota.lastAdjusted = now;
      }
    });
  }

  private denyDecision(
    reason: string,
    message: string,
    retryAfterMs: number,
    client?: ClientProfile,
    policy?: RateLimitPolicy
  ): RateLimitDecision {
    return {
      allowed: false,
      reason,
      retryAfterMs,
      remainingQuota: client
        ? this.getRemainingQuota(client)
        : { second: 0, minute: 0, hour: 0, day: 0, concurrent: 0 },
      headers: client && policy ? this.buildHeaders(client, policy, retryAfterMs) : {},
      policyApplied: policy?.id ?? 'unknown',
      penaltyApplied: client?.penaltyState.inPenalty,
    };
  }
}

let _limiter: AdaptiveRateLimiter | null = null;

export function getAdaptiveRateLimiter(): AdaptiveRateLimiter {
  if (!_limiter) {
    _limiter = new AdaptiveRateLimiter();
  }
  return _limiter;
}
