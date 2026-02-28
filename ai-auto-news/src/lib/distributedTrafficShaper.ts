/**
 * @module distributedTrafficShaper
 * @description Distributed traffic shaping engine implementing QoS priority queuing,
 * token-bucket rate limiting per tenant/service, adaptive bandwidth allocation,
 * congestion detection, traffic classification, burst allowances, backpressure
 * signaling, fair queuing, and real-time traffic analytics for multi-tenant
 * production environments.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type TrafficClass = 'critical' | 'high' | 'normal' | 'low' | 'bulk';
export type ShapingStrategy = 'token_bucket' | 'leaky_bucket' | 'sliding_window' | 'fixed_window';
export type CongestionLevel = 'none' | 'mild' | 'moderate' | 'severe' | 'critical';
export type BackpressureSignal = 'none' | 'slow_down' | 'pause' | 'reject';

export interface TrafficPolicy {
  id: string;
  name: string;
  tenantId: string;
  serviceId: string;
  trafficClass: TrafficClass;
  strategy: ShapingStrategy;
  rateLimit: number;        // requests per second
  burstLimit: number;       // max burst tokens
  bandwidthKbps: number;    // bandwidth allocation in Kbps
  priorityWeight: number;   // 1-100 for weighted fair queuing
  enabled: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TokenBucket {
  policyId: string;
  tokens: number;
  maxTokens: number;
  refillRate: number;     // tokens per second
  lastRefillAt: number;
  consumedTotal: number;
  rejectedTotal: number;
}

export interface TrafficRequest {
  id: string;
  policyId: string;
  tenantId: string;
  serviceId: string;
  trafficClass: TrafficClass;
  payloadBytes: number;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface ShapingDecision {
  requestId: string;
  policyId: string;
  allowed: boolean;
  delayMs: number;
  backpressure: BackpressureSignal;
  remainingTokens: number;
  reason: string;
  timestamp: number;
}

export interface TrafficMetrics {
  policyId: string;
  tenantId: string;
  serviceId: string;
  windowStart: number;
  windowEnd: number;
  totalRequests: number;
  allowedRequests: number;
  rejectedRequests: number;
  delayedRequests: number;
  avgDelayMs: number;
  peakRps: number;
  avgRps: number;
  totalBytesKb: number;
  congestionLevel: CongestionLevel;
}

export interface QueueEntry {
  requestId: string;
  policyId: string;
  trafficClass: TrafficClass;
  priorityWeight: number;
  enqueuedAt: number;
  payloadBytes: number;
}

export interface CongestionEvent {
  id: string;
  serviceId: string;
  tenantId: string;
  level: CongestionLevel;
  detectedAt: number;
  resolvedAt?: number;
  affectedPolicies: string[];
  peakRps: number;
  backpressureApplied: BackpressureSignal;
}

export interface BandwidthAllocation {
  serviceId: string;
  tenantId: string;
  allocatedKbps: number;
  usedKbps: number;
  utilizationPct: number;
  throttled: boolean;
}

export interface TrafficSummary {
  totalPolicies: number;
  activePolicies: number;
  totalRequests: number;
  allowedRequests: number;
  rejectedRequests: number;
  overallAllowRatePct: number;
  activeCongestions: number;
  avgCongestionLevel: CongestionLevel;
  topConsumers: Array<{ tenantId: string; rps: number }>;
  bandwidthUtilization: BandwidthAllocation[];
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class DistributedTrafficShaper {
  private readonly policies = new Map<string, TrafficPolicy>();
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly metrics = new Map<string, TrafficMetrics>();
  private readonly queue: QueueEntry[] = [];
  private readonly congestions = new Map<string, CongestionEvent>();
  private readonly decisions: ShapingDecision[] = [];
  private readonly DECISIONS_MAX = 10_000;
  private readonly METRICS_WINDOW_MS = 60_000;
  private globalCounter = 0;

  // Policy management ──────────────────────────────────────────────────────────

  createPolicy(
    params: Omit<TrafficPolicy, 'id' | 'createdAt' | 'updatedAt'>
  ): TrafficPolicy {
    const id = `policy_${Date.now()}_${++this.globalCounter}`;
    const policy: TrafficPolicy = {
      ...params,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.policies.set(id, policy);
    this.initBucket(policy);
    this.initMetrics(policy);
    logger.info('Traffic policy created', { id, tenantId: policy.tenantId, rateLimit: policy.rateLimit });
    return policy;
  }

  updatePolicy(id: string, updates: Partial<Omit<TrafficPolicy, 'id' | 'createdAt'>>): TrafficPolicy {
    const policy = this.policies.get(id);
    if (!policy) throw new Error(`Policy ${id} not found`);
    const updated: TrafficPolicy = { ...policy, ...updates, updatedAt: Date.now() };
    this.policies.set(id, updated);
    if (updates.rateLimit !== undefined || updates.burstLimit !== undefined) {
      this.resetBucket(updated);
    }
    logger.info('Traffic policy updated', { id });
    return updated;
  }

  deletePolicy(id: string): void {
    if (!this.policies.has(id)) throw new Error(`Policy ${id} not found`);
    this.policies.delete(id);
    this.buckets.delete(id);
    this.metrics.delete(id);
    logger.info('Traffic policy deleted', { id });
  }

  getPolicy(id: string): TrafficPolicy | undefined {
    return this.policies.get(id);
  }

  listPolicies(tenantId?: string): TrafficPolicy[] {
    const all = Array.from(this.policies.values());
    return tenantId ? all.filter(p => p.tenantId === tenantId) : all;
  }

  // Token bucket management ────────────────────────────────────────────────────

  private initBucket(policy: TrafficPolicy): void {
    const bucket: TokenBucket = {
      policyId: policy.id,
      tokens: policy.burstLimit,
      maxTokens: policy.burstLimit,
      refillRate: policy.rateLimit,
      lastRefillAt: Date.now(),
      consumedTotal: 0,
      rejectedTotal: 0,
    };
    this.buckets.set(policy.id, bucket);
  }

  private resetBucket(policy: TrafficPolicy): void {
    const existing = this.buckets.get(policy.id);
    if (existing) {
      existing.maxTokens = policy.burstLimit;
      existing.refillRate = policy.rateLimit;
      existing.tokens = Math.min(existing.tokens, policy.burstLimit);
    }
  }

  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefillAt) / 1000;
    const newTokens = elapsed * bucket.refillRate;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + newTokens);
    bucket.lastRefillAt = now;
  }

  // Traffic shaping ────────────────────────────────────────────────────────────

  evaluateRequest(request: TrafficRequest): ShapingDecision {
    const policy = this.policies.get(request.policyId);
    if (!policy) {
      return this.buildDecision(request.id, request.policyId, false, 0, 'reject', 0, 'Policy not found');
    }

    if (!policy.enabled) {
      return this.buildDecision(request.id, request.policyId, true, 0, 'none', -1, 'Policy disabled – pass through');
    }

    const bucket = this.buckets.get(request.policyId);
    if (!bucket) {
      return this.buildDecision(request.id, request.policyId, false, 0, 'reject', 0, 'Bucket not found');
    }

    this.refillBucket(bucket);

    const congestionKey = `${request.tenantId}:${request.serviceId}`;
    const activeCongestion = this.congestions.get(congestionKey);
    const backpressure = this.computeBackpressure(activeCongestion, bucket);

    if (backpressure === 'reject') {
      bucket.rejectedTotal++;
      const decision = this.buildDecision(request.id, request.policyId, false, 0, 'reject', bucket.tokens, 'Congestion reject');
      this.recordDecision(decision);
      this.updateMetrics(policy, false, 0);
      return decision;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.consumedTotal++;
      const delay = backpressure === 'slow_down' ? this.computeSlowdownDelay(bucket) : 0;
      const decision = this.buildDecision(request.id, request.policyId, true, delay, backpressure, bucket.tokens, 'Allowed');
      this.recordDecision(decision);
      this.updateMetrics(policy, true, delay);
      return decision;
    }

    // Insufficient tokens – queue or reject based on class
    if (request.trafficClass === 'critical' || request.trafficClass === 'high') {
      const delay = this.computeQueueDelay(bucket);
      this.enqueue(request, policy);
      const decision = this.buildDecision(request.id, request.policyId, true, delay, 'slow_down', bucket.tokens, 'Queued – high priority');
      this.recordDecision(decision);
      this.updateMetrics(policy, true, delay);
      return decision;
    }

    bucket.rejectedTotal++;
    const decision = this.buildDecision(request.id, request.policyId, false, 0, 'reject', bucket.tokens, 'Rate limit exceeded');
    this.recordDecision(decision);
    this.updateMetrics(policy, false, 0);
    return decision;
  }

  private buildDecision(
    requestId: string, policyId: string, allowed: boolean, delayMs: number,
    backpressure: BackpressureSignal, remainingTokens: number, reason: string
  ): ShapingDecision {
    return { requestId, policyId, allowed, delayMs, backpressure, remainingTokens, reason, timestamp: Date.now() };
  }

  private computeBackpressure(
    congestion: CongestionEvent | undefined,
    bucket: TokenBucket
  ): BackpressureSignal {
    if (!congestion) {
      const fillPct = bucket.tokens / bucket.maxTokens;
      if (fillPct < 0.05) return 'slow_down';
      return 'none';
    }
    switch (congestion.level) {
      case 'critical': return 'reject';
      case 'severe': return 'pause';
      case 'moderate': return 'slow_down';
      default: return 'none';
    }
  }

  private computeSlowdownDelay(bucket: TokenBucket): number {
    const utilization = 1 - bucket.tokens / bucket.maxTokens;
    return Math.floor(utilization * 200); // up to 200ms delay
  }

  private computeQueueDelay(bucket: TokenBucket): number {
    const tokensNeeded = 1;
    const timeToRefill = (tokensNeeded / bucket.refillRate) * 1000;
    return Math.ceil(timeToRefill);
  }

  // Queue management ───────────────────────────────────────────────────────────

  private enqueue(request: TrafficRequest, policy: TrafficPolicy): void {
    const entry: QueueEntry = {
      requestId: request.id,
      policyId: request.policyId,
      trafficClass: request.trafficClass,
      priorityWeight: policy.priorityWeight,
      enqueuedAt: Date.now(),
      payloadBytes: request.payloadBytes,
    };
    this.queue.push(entry);
    // Sort by priority weight descending (higher weight = higher priority)
    this.queue.sort((a, b) => b.priorityWeight - a.priorityWeight);
    // Cap queue size
    while (this.queue.length > 1000) this.queue.pop();
  }

  dequeueNext(policyId?: string): QueueEntry | undefined {
    const idx = policyId
      ? this.queue.findIndex(e => e.policyId === policyId)
      : 0;
    if (idx === -1) return undefined;
    return this.queue.splice(idx, 1)[0];
  }

  getQueueDepth(policyId?: string): number {
    return policyId ? this.queue.filter(e => e.policyId === policyId).length : this.queue.length;
  }

  // Congestion detection ───────────────────────────────────────────────────────

  recordCongestion(serviceId: string, tenantId: string, rps: number): CongestionEvent {
    const level = this.classifyCongestion(rps);
    const key = `${tenantId}:${serviceId}`;
    const existing = this.congestions.get(key);

    if (existing && !existing.resolvedAt) {
      existing.level = level;
      existing.peakRps = Math.max(existing.peakRps, rps);
      existing.backpressureApplied = this.congestionToBackpressure(level);
      return existing;
    }

    const affectedPolicies = Array.from(this.policies.values())
      .filter(p => p.serviceId === serviceId && p.tenantId === tenantId)
      .map(p => p.id);

    const event: CongestionEvent = {
      id: `cong_${Date.now()}_${++this.globalCounter}`,
      serviceId,
      tenantId,
      level,
      detectedAt: Date.now(),
      affectedPolicies,
      peakRps: rps,
      backpressureApplied: this.congestionToBackpressure(level),
    };
    this.congestions.set(key, event);
    logger.warn('Congestion detected', { serviceId, tenantId, level, rps });
    return event;
  }

  resolveCongestion(serviceId: string, tenantId: string): void {
    const key = `${tenantId}:${serviceId}`;
    const event = this.congestions.get(key);
    if (event && !event.resolvedAt) {
      event.resolvedAt = Date.now();
      logger.info('Congestion resolved', { serviceId, tenantId });
    }
  }

  private classifyCongestion(rps: number): CongestionLevel {
    if (rps > 10_000) return 'critical';
    if (rps > 5_000) return 'severe';
    if (rps > 2_000) return 'moderate';
    if (rps > 500) return 'mild';
    return 'none';
  }

  private congestionToBackpressure(level: CongestionLevel): BackpressureSignal {
    switch (level) {
      case 'critical': return 'reject';
      case 'severe': return 'pause';
      case 'moderate': return 'slow_down';
      default: return 'none';
    }
  }

  listCongestions(activeOnly = false): CongestionEvent[] {
    const all = Array.from(this.congestions.values());
    return activeOnly ? all.filter(c => !c.resolvedAt) : all;
  }

  // Metrics ────────────────────────────────────────────────────────────────────

  private initMetrics(policy: TrafficPolicy): void {
    const now = Date.now();
    const m: TrafficMetrics = {
      policyId: policy.id,
      tenantId: policy.tenantId,
      serviceId: policy.serviceId,
      windowStart: now,
      windowEnd: now + this.METRICS_WINDOW_MS,
      totalRequests: 0,
      allowedRequests: 0,
      rejectedRequests: 0,
      delayedRequests: 0,
      avgDelayMs: 0,
      peakRps: 0,
      avgRps: 0,
      totalBytesKb: 0,
      congestionLevel: 'none',
    };
    this.metrics.set(policy.id, m);
  }

  private updateMetrics(policy: TrafficPolicy, allowed: boolean, delayMs: number): void {
    const m = this.metrics.get(policy.id);
    if (!m) return;
    const now = Date.now();
    if (now > m.windowEnd) {
      m.windowStart = now;
      m.windowEnd = now + this.METRICS_WINDOW_MS;
      m.totalRequests = 0;
      m.allowedRequests = 0;
      m.rejectedRequests = 0;
      m.delayedRequests = 0;
      m.avgDelayMs = 0;
      m.peakRps = 0;
    }
    m.totalRequests++;
    if (allowed) m.allowedRequests++;
    else m.rejectedRequests++;
    if (delayMs > 0) {
      m.delayedRequests++;
      m.avgDelayMs = (m.avgDelayMs * (m.delayedRequests - 1) + delayMs) / m.delayedRequests;
    }
    const elapsedSec = Math.max(1, (now - m.windowStart) / 1000);
    m.avgRps = m.totalRequests / elapsedSec;
    m.peakRps = Math.max(m.peakRps, m.avgRps);
  }

  getMetrics(policyId: string): TrafficMetrics | undefined {
    return this.metrics.get(policyId);
  }

  listMetrics(tenantId?: string): TrafficMetrics[] {
    const all = Array.from(this.metrics.values());
    return tenantId ? all.filter(m => m.tenantId === tenantId) : all;
  }

  // Bandwidth allocation ───────────────────────────────────────────────────────

  computeBandwidthAllocations(): BandwidthAllocation[] {
    const grouped = new Map<string, { allocated: number; used: number }>();
    for (const policy of this.policies.values()) {
      const key = `${policy.tenantId}:${policy.serviceId}`;
      const entry = grouped.get(key) ?? { allocated: 0, used: 0 };
      entry.allocated += policy.bandwidthKbps;
      const m = this.metrics.get(policy.id);
      if (m) entry.used += m.totalBytesKb;
      grouped.set(key, entry);
    }
    return Array.from(grouped.entries()).map(([key, v]) => {
      const [tenantId, serviceId] = key.split(':');
      const utilPct = v.allocated > 0 ? (v.used / v.allocated) * 100 : 0;
      return {
        serviceId,
        tenantId,
        allocatedKbps: v.allocated,
        usedKbps: v.used,
        utilizationPct: utilPct,
        throttled: utilPct > 90,
      };
    });
  }

  // Decisions log ──────────────────────────────────────────────────────────────

  private recordDecision(decision: ShapingDecision): void {
    this.decisions.push(decision);
    if (this.decisions.length > this.DECISIONS_MAX) this.decisions.shift();
  }

  listDecisions(policyId?: string, limit = 100): ShapingDecision[] {
    const filtered = policyId ? this.decisions.filter(d => d.policyId === policyId) : this.decisions;
    return filtered.slice(-limit);
  }

  // Bucket inspection ──────────────────────────────────────────────────────────

  getBucket(policyId: string): TokenBucket | undefined {
    const bucket = this.buckets.get(policyId);
    if (bucket) this.refillBucket(bucket);
    return bucket;
  }

  listBuckets(): TokenBucket[] {
    return Array.from(this.buckets.values()).map(b => {
      this.refillBucket(b);
      return { ...b };
    });
  }

  // Summary ────────────────────────────────────────────────────────────────────

  getSummary(): TrafficSummary {
    const allMetrics = Array.from(this.metrics.values());
    const totalReq = allMetrics.reduce((s, m) => s + m.totalRequests, 0);
    const allowedReq = allMetrics.reduce((s, m) => s + m.allowedRequests, 0);
    const rejectedReq = allMetrics.reduce((s, m) => s + m.rejectedRequests, 0);
    const activeCong = Array.from(this.congestions.values()).filter(c => !c.resolvedAt);

    // Top consumers by RPS
    const rpsByTenant = new Map<string, number>();
    for (const m of allMetrics) {
      rpsByTenant.set(m.tenantId, (rpsByTenant.get(m.tenantId) ?? 0) + m.avgRps);
    }
    const topConsumers = Array.from(rpsByTenant.entries())
      .map(([tenantId, rps]) => ({ tenantId, rps }))
      .sort((a, b) => b.rps - a.rps)
      .slice(0, 10);

    const congestionLevels: CongestionLevel[] = ['none', 'mild', 'moderate', 'severe', 'critical'];
    const maxIdx = activeCong.reduce((max, c) => Math.max(max, congestionLevels.indexOf(c.level)), 0);

    return {
      totalPolicies: this.policies.size,
      activePolicies: Array.from(this.policies.values()).filter(p => p.enabled).length,
      totalRequests: totalReq,
      allowedRequests: allowedReq,
      rejectedRequests: rejectedReq,
      overallAllowRatePct: totalReq > 0 ? (allowedReq / totalReq) * 100 : 100,
      activeCongestions: activeCong.length,
      avgCongestionLevel: congestionLevels[maxIdx],
      topConsumers,
      bandwidthUtilization: this.computeBandwidthAllocations(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__distributedTrafficShaper__';
export function getTrafficShaper(): DistributedTrafficShaper {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new DistributedTrafficShaper();
  }
  return (globalThis as Record<string, unknown>)[KEY] as DistributedTrafficShaper;
}
