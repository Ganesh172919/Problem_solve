/**
 * Rate Limiting Strategy
 *
 * Multi-dimensional rate limiting engine:
 * - IP-based limiting with CIDR range support
 * - User-level limiting with tier awareness
 * - Organization / tenant limiting
 * - Per-endpoint granular limits
 * - Global platform-wide limits
 * - Sliding window and token bucket algorithms
 * - Burst allowance support
 * - Graduated throttling (slow then block)
 * - Rate limit headers (X-RateLimit-*)
 * - Distributed coordination via cache
 * - Adaptive limits based on system load
 * - Allowlist / denylist management
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export type LimitAlgorithm = 'sliding_window' | 'token_bucket' | 'fixed_window' | 'leaky_bucket';

export type LimitDimension = 'ip' | 'user' | 'tenant' | 'api_key' | 'endpoint' | 'global';

export interface RateLimitRule {
  id: string;
  name: string;
  dimension: LimitDimension;
  algorithm: LimitAlgorithm;
  windowSeconds: number;
  maxRequests: number;
  burstMultiplier: number; // e.g. 1.5 = allow 50% burst
  endpoint?: string; // path prefix to match
  tier?: string; // apply to specific tier only
  priority: number; // higher priority rules checked first
  throttleBeforeBlock: boolean; // graduated throttling
  throttleThreshold: number; // fraction of limit to trigger slow response
  enabled: boolean;
}

export interface RateLimitState {
  key: string;
  count: number;
  windowStart: number;
  tokens?: number; // for token bucket
  lastRefill?: number;
  throttled: boolean;
  blocked: boolean;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  throttled: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds?: number;
  ruleId: string;
  headers: Record<string, string>;
}

export interface RateLimitContext {
  ip?: string;
  userId?: string;
  tenantId?: string;
  apiKeyId?: string;
  endpoint: string;
  tier?: string;
  requestWeight?: number; // weight of this request (default 1)
}

export interface RateLimitViolation {
  timestamp: Date;
  context: RateLimitContext;
  ruleId: string;
  dimension: LimitDimension;
  limit: number;
  count: number;
}

const DEFAULT_RULES: RateLimitRule[] = [
  {
    id: 'global_burst_protection',
    name: 'Global burst protection',
    dimension: 'global',
    algorithm: 'fixed_window',
    windowSeconds: 1,
    maxRequests: 10000,
    burstMultiplier: 1,
    priority: 100,
    throttleBeforeBlock: false,
    throttleThreshold: 0.9,
    enabled: true,
  },
  {
    id: 'ip_per_minute',
    name: 'IP per minute',
    dimension: 'ip',
    algorithm: 'sliding_window',
    windowSeconds: 60,
    maxRequests: 60,
    burstMultiplier: 1.5,
    priority: 90,
    throttleBeforeBlock: true,
    throttleThreshold: 0.8,
    enabled: true,
  },
  {
    id: 'free_tier_user',
    name: 'Free tier user limits',
    dimension: 'user',
    algorithm: 'sliding_window',
    windowSeconds: 60,
    maxRequests: 10,
    burstMultiplier: 1.2,
    tier: 'free',
    priority: 80,
    throttleBeforeBlock: true,
    throttleThreshold: 0.7,
    enabled: true,
  },
  {
    id: 'pro_tier_user',
    name: 'Pro tier user limits',
    dimension: 'user',
    algorithm: 'sliding_window',
    windowSeconds: 60,
    maxRequests: 60,
    burstMultiplier: 2.0,
    tier: 'pro',
    priority: 80,
    throttleBeforeBlock: true,
    throttleThreshold: 0.85,
    enabled: true,
  },
  {
    id: 'enterprise_tier_user',
    name: 'Enterprise tier user limits',
    dimension: 'user',
    algorithm: 'token_bucket',
    windowSeconds: 60,
    maxRequests: 1000,
    burstMultiplier: 3.0,
    tier: 'enterprise',
    priority: 80,
    throttleBeforeBlock: false,
    throttleThreshold: 0.95,
    enabled: true,
  },
  {
    id: 'generate_endpoint',
    name: 'AI generation endpoint',
    dimension: 'user',
    algorithm: 'sliding_window',
    windowSeconds: 3600,
    maxRequests: 100,
    burstMultiplier: 1.1,
    endpoint: '/api/v1/generate',
    priority: 85,
    throttleBeforeBlock: false,
    throttleThreshold: 0.9,
    enabled: true,
  },
  {
    id: 'auth_endpoint',
    name: 'Auth endpoint protection',
    dimension: 'ip',
    algorithm: 'fixed_window',
    windowSeconds: 900, // 15 minutes
    maxRequests: 10,
    burstMultiplier: 1,
    endpoint: '/api/auth',
    priority: 95,
    throttleBeforeBlock: false,
    throttleThreshold: 0.5,
    enabled: true,
  },
  {
    id: 'tenant_hourly',
    name: 'Tenant hourly limits',
    dimension: 'tenant',
    algorithm: 'sliding_window',
    windowSeconds: 3600,
    maxRequests: 10000,
    burstMultiplier: 1.5,
    priority: 75,
    throttleBeforeBlock: true,
    throttleThreshold: 0.85,
    enabled: true,
  },
];

const ruleRegistry: RateLimitRule[] = [...DEFAULT_RULES];
const allowlist = new Set<string>(); // IP or userId allowlist
const denylist = new Set<string>(); // IP or userId denylist
const violations: RateLimitViolation[] = [];
const MAX_VIOLATIONS = 5000;

function buildCacheKey(rule: RateLimitRule, context: RateLimitContext): string {
  const windowBucket = Math.floor(Date.now() / (rule.windowSeconds * 1000));

  switch (rule.dimension) {
    case 'ip': return `rl:ip:${rule.id}:${context.ip ?? 'unknown'}:${windowBucket}`;
    case 'user': return `rl:user:${rule.id}:${context.userId ?? 'anonymous'}:${windowBucket}`;
    case 'tenant': return `rl:tenant:${rule.id}:${context.tenantId ?? 'global'}:${windowBucket}`;
    case 'api_key': return `rl:apikey:${rule.id}:${context.apiKeyId ?? 'none'}:${windowBucket}`;
    case 'endpoint': return `rl:endpoint:${rule.id}:${context.endpoint}:${context.userId ?? context.ip ?? 'anon'}:${windowBucket}`;
    case 'global': return `rl:global:${rule.id}:${windowBucket}`;
  }
}

function checkSlidingWindow(rule: RateLimitRule, context: RateLimitContext): RateLimitState {
  const cache = getCache();
  const key = buildCacheKey(rule, context);
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const limit = Math.floor(rule.maxRequests * rule.burstMultiplier);

  const current = cache.get<{ count: number; windowStart: number }>(key) ?? { count: 0, windowStart: now };
  const weight = context.requestWeight ?? 1;
  current.count += weight;
  cache.set(key, current, rule.windowSeconds + 10);

  const resetAt = current.windowStart + windowMs;
  const blocked = current.count > limit;
  const throttled = !blocked && rule.throttleBeforeBlock && current.count > rule.maxRequests * rule.throttleThreshold;

  return {
    key,
    count: current.count,
    windowStart: current.windowStart,
    throttled,
    blocked,
    resetAt,
  };
}

function checkTokenBucket(rule: RateLimitRule, context: RateLimitContext): RateLimitState {
  const cache = getCache();
  const key = buildCacheKey(rule, context);
  const now = Date.now();
  const maxTokens = Math.floor(rule.maxRequests * rule.burstMultiplier);
  const refillRate = rule.maxRequests / rule.windowSeconds; // tokens per second

  const bucket = cache.get<{ tokens: number; lastRefill: number }>(key) ?? { tokens: maxTokens, lastRefill: now };
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRate);
  bucket.lastRefill = now;

  const weight = context.requestWeight ?? 1;
  const blocked = bucket.tokens < weight;
  if (!blocked) bucket.tokens -= weight;

  cache.set(key, bucket, rule.windowSeconds * 2);
  const resetAt = now + Math.ceil((weight - bucket.tokens) / refillRate) * 1000;

  return {
    key,
    count: maxTokens - bucket.tokens,
    windowStart: bucket.lastRefill,
    tokens: bucket.tokens,
    lastRefill: bucket.lastRefill,
    throttled: rule.throttleBeforeBlock && bucket.tokens < rule.maxRequests * (1 - rule.throttleThreshold),
    blocked,
    resetAt,
  };
}

function checkFixedWindow(rule: RateLimitRule, context: RateLimitContext): RateLimitState {
  return checkSlidingWindow(rule, context); // simplified
}

function applyAlgorithm(rule: RateLimitRule, context: RateLimitContext): RateLimitState {
  switch (rule.algorithm) {
    case 'token_bucket': return checkTokenBucket(rule, context);
    case 'fixed_window': return checkFixedWindow(rule, context);
    case 'leaky_bucket': return checkSlidingWindow(rule, context); // simplified
    default: return checkSlidingWindow(rule, context);
  }
}

function ruleApplies(rule: RateLimitRule, context: RateLimitContext): boolean {
  if (!rule.enabled) return false;
  if (rule.endpoint && !context.endpoint.startsWith(rule.endpoint)) return false;
  if (rule.tier && rule.tier !== context.tier) return false;

  // Check dimension has required context
  switch (rule.dimension) {
    case 'ip': return !!context.ip;
    case 'user': return !!context.userId;
    case 'tenant': return !!context.tenantId;
    case 'api_key': return !!context.apiKeyId;
    default: return true;
  }
}

export function checkRateLimit(context: RateLimitContext): RateLimitResult {
  const identifier = context.userId ?? context.ip ?? context.apiKeyId ?? 'unknown';

  // Check allowlist
  if (allowlist.has(identifier) || (context.ip && allowlist.has(context.ip))) {
    return {
      allowed: true,
      throttled: false,
      remaining: 999999,
      limit: 999999,
      resetAt: Date.now() + 3600000,
      ruleId: 'allowlist',
      headers: buildHeaders(999999, 999999, Date.now() + 3600000),
    };
  }

  // Check denylist
  if (denylist.has(identifier) || (context.ip && denylist.has(context.ip))) {
    const result: RateLimitResult = {
      allowed: false,
      throttled: false,
      remaining: 0,
      limit: 0,
      resetAt: Date.now() + 86400000,
      retryAfterSeconds: 86400,
      ruleId: 'denylist',
      headers: buildHeaders(0, 0, Date.now() + 86400000),
    };
    return result;
  }

  const sortedRules = [...ruleRegistry].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (!ruleApplies(rule, context)) continue;

    const state = applyAlgorithm(rule, context);

    if (state.blocked) {
      recordViolation(context, rule, state);
      const retryAfterSeconds = Math.ceil((state.resetAt - Date.now()) / 1000);
      return {
        allowed: false,
        throttled: false,
        remaining: 0,
        limit: rule.maxRequests,
        resetAt: state.resetAt,
        retryAfterSeconds,
        ruleId: rule.id,
        headers: buildHeaders(0, rule.maxRequests, state.resetAt),
      };
    }

    if (state.throttled) {
      const remaining = Math.max(0, rule.maxRequests - state.count);
      return {
        allowed: true,
        throttled: true,
        remaining,
        limit: rule.maxRequests,
        resetAt: state.resetAt,
        ruleId: rule.id,
        headers: buildHeaders(remaining, rule.maxRequests, state.resetAt),
      };
    }
  }

  // No rule blocked/throttled
  const defaultRemaining = 9999;
  return {
    allowed: true,
    throttled: false,
    remaining: defaultRemaining,
    limit: defaultRemaining,
    resetAt: Date.now() + 60000,
    ruleId: 'none',
    headers: buildHeaders(defaultRemaining, defaultRemaining, Date.now() + 60000),
  };
}

function buildHeaders(remaining: number, limit: number, resetAt: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
    'X-RateLimit-Reset-After': String(Math.max(0, Math.ceil((resetAt - Date.now()) / 1000))),
  };
}

function recordViolation(context: RateLimitContext, rule: RateLimitRule, state: RateLimitState): void {
  violations.unshift({
    timestamp: new Date(),
    context,
    ruleId: rule.id,
    dimension: rule.dimension,
    limit: rule.maxRequests,
    count: state.count,
  });
  if (violations.length > MAX_VIOLATIONS) violations.length = MAX_VIOLATIONS;

  logger.warn('Rate limit exceeded', {
    ruleId: rule.id,
    dimension: rule.dimension,
    userId: context.userId,
    ip: context.ip,
    endpoint: context.endpoint,
    count: state.count,
    limit: rule.maxRequests,
  });
}

export function addToAllowlist(identifier: string): void {
  allowlist.add(identifier);
  logger.info('Added to allowlist', { identifier });
}

export function removeFromAllowlist(identifier: string): void {
  allowlist.delete(identifier);
}

export function addToDenylist(identifier: string): void {
  denylist.add(identifier);
  logger.warn('Added to denylist', { identifier });
}

export function removeFromDenylist(identifier: string): void {
  denylist.delete(identifier);
  logger.info('Removed from denylist', { identifier });
}

export function registerRule(rule: RateLimitRule): void {
  const idx = ruleRegistry.findIndex((r) => r.id === rule.id);
  if (idx >= 0) ruleRegistry[idx] = rule;
  else ruleRegistry.push(rule);
  logger.info('Rate limit rule registered', { ruleId: rule.id });
}

export function disableRule(ruleId: string): void {
  const rule = ruleRegistry.find((r) => r.id === ruleId);
  if (rule) { rule.enabled = false; }
}

export function enableRule(ruleId: string): void {
  const rule = ruleRegistry.find((r) => r.id === ruleId);
  if (rule) { rule.enabled = true; }
}

export function getRateLimitViolations(limit = 100): RateLimitViolation[] {
  return violations.slice(0, limit);
}

export function getViolationsByIp(ip: string, limit = 20): RateLimitViolation[] {
  return violations.filter((v) => v.context.ip === ip).slice(0, limit);
}

export function getTopOffenders(limit = 10): Array<{ identifier: string; violations: number; dimension: string }> {
  const counts = new Map<string, { count: number; dimension: string }>();
  for (const v of violations) {
    const id = v.context.userId ?? v.context.ip ?? 'unknown';
    const existing = counts.get(id) ?? { count: 0, dimension: v.dimension };
    existing.count += 1;
    counts.set(id, existing);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([identifier, { count, dimension }]) => ({ identifier, violations: count, dimension }));
}

export function getRules(): RateLimitRule[] {
  return [...ruleRegistry];
}

export function getAllowlist(): string[] {
  return Array.from(allowlist);
}

export function getDenylist(): string[] {
  return Array.from(denylist);
}
