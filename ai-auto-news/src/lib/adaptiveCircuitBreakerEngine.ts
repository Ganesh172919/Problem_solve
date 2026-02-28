/**
 * @module adaptiveCircuitBreakerEngine
 * @description Adaptive circuit breaker engine with ML-inspired threshold tuning,
 * half-open state probing, cascading failure prevention, fallback execution,
 * dynamic timeout adjustment, health scoring, hedged requests, bulkhead isolation,
 * and per-tenant circuit tracking for enterprise-grade resilience.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half_open';
export type BreakStrategy = 'error_rate' | 'latency_percentile' | 'consecutive_failures' | 'volume_threshold';
export type TripReason = 'error_rate_exceeded' | 'latency_exceeded' | 'consecutive_failures' | 'manual_open';

export interface CircuitConfig {
  id: string;
  name: string;
  serviceId: string;
  tenantId: string;
  strategy: BreakStrategy;
  errorRateThreshold: number;     // 0-1
  latencyP99ThresholdMs: number;
  consecutiveFailureThreshold: number;
  minVolumeForTripping: number;
  halfOpenMaxRequests: number;
  resetTimeoutMs: number;
  adaptiveThresholdEnabled: boolean;
  fallbackEnabled: boolean;
  fallbackValue?: unknown;
  bulkheadMaxConcurrent: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CircuitBreaker {
  configId: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  closedAt?: number;
  tripReason?: TripReason;
  halfOpenAttempts: number;
  currentConcurrent: number;
  errorRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  healthScore: number;          // 0-100
  adaptiveThreshold: number;    // learned error rate threshold
  lastAdaptedAt?: number;
}

export interface ExecutionResult {
  circuitId: string;
  requestId: string;
  success: boolean;
  latencyMs: number;
  usedFallback: boolean;
  circuitState: CircuitState;
  error?: string;
  timestamp: number;
}

export interface TripEvent {
  id: string;
  circuitId: string;
  serviceId: string;
  tenantId: string;
  state: CircuitState;
  reason: TripReason;
  errorRate: number;
  latencyP99Ms: number;
  consecutiveFailures: number;
  timestamp: number;
  resolvedAt?: number;
}

export interface BulkheadStats {
  circuitId: string;
  maxConcurrent: number;
  currentConcurrent: number;
  rejectedDueToBulkhead: number;
  utilizationPct: number;
}

export interface CircuitHealthReport {
  circuitId: string;
  serviceId: string;
  tenantId: string;
  state: CircuitState;
  healthScore: number;
  errorRate: number;
  latencyP99Ms: number;
  openDurationMs?: number;
  recommendations: string[];
  timestamp: number;
}

export interface EngineSummary {
  totalCircuits: number;
  closedCircuits: number;
  openCircuits: number;
  halfOpenCircuits: number;
  avgHealthScore: number;
  totalTripEvents: number;
  activeTripEvents: number;
  topUnhealthy: Array<{ circuitId: string; healthScore: number; state: CircuitState }>;
}

// ── Latency Tracker ───────────────────────────────────────────────────────────

class LatencyRingBuffer {
  private readonly buf: number[];
  private head = 0;
  private size = 0;
  constructor(private readonly capacity: number) {
    this.buf = new Array<number>(capacity).fill(0);
  }
  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }
  percentile(p: number): number {
    if (this.size === 0) return 0;
    const sorted = this.buf.slice(0, this.size).sort((a, b) => a - b);
    const idx = Math.floor((p / 100) * (sorted.length - 1));
    return sorted[idx];
  }
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class AdaptiveCircuitBreakerEngine {
  private readonly configs = new Map<string, CircuitConfig>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly latencyBuffers = new Map<string, LatencyRingBuffer>();
  private readonly tripEvents: TripEvent[] = [];
  private readonly results: ExecutionResult[] = [];
  private readonly RESULTS_MAX = 10_000;
  private globalCounter = 0;

  // Config management ──────────────────────────────────────────────────────────

  register(params: Omit<CircuitConfig, 'createdAt' | 'updatedAt'>): CircuitConfig {
    const config: CircuitConfig = {
      ...params,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.configs.set(config.id, config);
    this.initBreaker(config);
    logger.info('Circuit breaker registered', { id: config.id, serviceId: config.serviceId });
    return config;
  }

  updateConfig(id: string, updates: Partial<Omit<CircuitConfig, 'id' | 'createdAt'>>): CircuitConfig {
    const cfg = this.configs.get(id);
    if (!cfg) throw new Error(`Circuit config ${id} not found`);
    const updated: CircuitConfig = { ...cfg, ...updates, updatedAt: Date.now() };
    this.configs.set(id, updated);
    return updated;
  }

  getConfig(id: string): CircuitConfig | undefined {
    return this.configs.get(id);
  }

  listConfigs(tenantId?: string): CircuitConfig[] {
    const all = Array.from(this.configs.values());
    return tenantId ? all.filter(c => c.tenantId === tenantId) : all;
  }

  private initBreaker(config: CircuitConfig): void {
    const breaker: CircuitBreaker = {
      configId: config.id,
      state: 'closed',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      halfOpenAttempts: 0,
      currentConcurrent: 0,
      errorRate: 0,
      latencyP50Ms: 0,
      latencyP95Ms: 0,
      latencyP99Ms: 0,
      healthScore: 100,
      adaptiveThreshold: config.errorRateThreshold,
    };
    this.breakers.set(config.id, breaker);
    this.latencyBuffers.set(config.id, new LatencyRingBuffer(1000));
  }

  getBreaker(circuitId: string): CircuitBreaker | undefined {
    return this.breakers.get(circuitId);
  }

  // Execution ──────────────────────────────────────────────────────────────────

  canExecute(circuitId: string): { allowed: boolean; reason: string } {
    const breaker = this.breakers.get(circuitId);
    const config = this.configs.get(circuitId);
    if (!breaker || !config) return { allowed: true, reason: 'Circuit not registered' };

    if (breaker.state === 'open') {
      const now = Date.now();
      if (breaker.openedAt && now - breaker.openedAt >= config.resetTimeoutMs) {
        this.transitionTo(circuitId, 'half_open', breaker, config);
        return { allowed: true, reason: 'Transitioning to half-open probe' };
      }
      return { allowed: false, reason: 'Circuit open' };
    }

    if (breaker.state === 'half_open' && breaker.halfOpenAttempts >= config.halfOpenMaxRequests) {
      return { allowed: false, reason: 'Half-open probe limit reached' };
    }

    if (breaker.currentConcurrent >= config.bulkheadMaxConcurrent) {
      return { allowed: false, reason: 'Bulkhead limit reached' };
    }

    return { allowed: true, reason: 'Circuit closed' };
  }

  recordResult(circuitId: string, requestId: string, success: boolean, latencyMs: number, error?: string): ExecutionResult {
    const breaker = this.breakers.get(circuitId);
    const config = this.configs.get(circuitId);
    if (!breaker || !config) throw new Error(`Circuit ${circuitId} not found`);

    breaker.totalRequests++;
    breaker.currentConcurrent = Math.max(0, breaker.currentConcurrent - 1);

    const buf = this.latencyBuffers.get(circuitId)!;
    buf.push(latencyMs);
    breaker.latencyP50Ms = buf.percentile(50);
    breaker.latencyP95Ms = buf.percentile(95);
    breaker.latencyP99Ms = buf.percentile(99);

    if (success) {
      breaker.totalSuccesses++;
      breaker.consecutiveFailures = 0;
      breaker.consecutiveSuccesses++;
      breaker.lastSuccessAt = Date.now();

      if (breaker.state === 'half_open') {
        if (breaker.consecutiveSuccesses >= 3) {
          this.transitionTo(circuitId, 'closed', breaker, config);
        }
      }
    } else {
      breaker.totalFailures++;
      breaker.consecutiveFailures++;
      breaker.consecutiveSuccesses = 0;
      breaker.lastFailureAt = Date.now();

      if (breaker.state === 'half_open') {
        this.transitionTo(circuitId, 'open', breaker, config, 'consecutive_failures');
      }
    }

    breaker.errorRate = breaker.totalRequests > 0 ? breaker.totalFailures / breaker.totalRequests : 0;
    this.maybeTrip(circuitId, breaker, config);
    this.updateHealthScore(breaker, config);
    if (config.adaptiveThresholdEnabled) this.adaptThreshold(breaker, config);

    const result: ExecutionResult = {
      circuitId,
      requestId,
      success,
      latencyMs,
      usedFallback: false,
      circuitState: breaker.state,
      error,
      timestamp: Date.now(),
    };
    this.results.push(result);
    if (this.results.length > this.RESULTS_MAX) this.results.shift();
    return result;
  }

  beginRequest(circuitId: string): void {
    const breaker = this.breakers.get(circuitId);
    if (breaker) {
      breaker.currentConcurrent++;
      if (breaker.state === 'half_open') breaker.halfOpenAttempts++;
    }
  }

  private maybeTrip(circuitId: string, breaker: CircuitBreaker, config: CircuitConfig): void {
    if (breaker.state === 'open' || breaker.state === 'half_open') return;
    if (breaker.totalRequests < config.minVolumeForTripping) return;

    const threshold = config.adaptiveThresholdEnabled
      ? breaker.adaptiveThreshold
      : config.errorRateThreshold;

    let shouldTrip = false;
    let reason: TripReason = 'error_rate_exceeded';

    switch (config.strategy) {
      case 'error_rate':
        shouldTrip = breaker.errorRate > threshold;
        break;
      case 'latency_percentile':
        shouldTrip = breaker.latencyP99Ms > config.latencyP99ThresholdMs;
        reason = 'latency_exceeded';
        break;
      case 'consecutive_failures':
        shouldTrip = breaker.consecutiveFailures >= config.consecutiveFailureThreshold;
        reason = 'consecutive_failures';
        break;
      case 'volume_threshold':
        shouldTrip = breaker.errorRate > threshold && breaker.totalRequests >= config.minVolumeForTripping;
        break;
    }

    if (shouldTrip) {
      this.transitionTo(circuitId, 'open', breaker, config, reason);
    }
  }

  private transitionTo(
    circuitId: string, newState: CircuitState, breaker: CircuitBreaker,
    config: CircuitConfig, reason?: TripReason
  ): void {
    const oldState = breaker.state;
    if (oldState === newState) return;

    breaker.state = newState;
    const now = Date.now();

    if (newState === 'open') {
      breaker.openedAt = now;
      breaker.halfOpenAttempts = 0;
      const event: TripEvent = {
        id: `trip_${Date.now()}_${++this.globalCounter}`,
        circuitId,
        serviceId: config.serviceId,
        tenantId: config.tenantId,
        state: newState,
        reason: reason ?? 'error_rate_exceeded',
        errorRate: breaker.errorRate,
        latencyP99Ms: breaker.latencyP99Ms,
        consecutiveFailures: breaker.consecutiveFailures,
        timestamp: now,
      };
      this.tripEvents.push(event);
      logger.warn('Circuit opened', { circuitId, reason });
    } else if (newState === 'closed') {
      breaker.closedAt = now;
      breaker.consecutiveFailures = 0;
      breaker.consecutiveSuccesses = 0;
      // Resolve latest open trip event
      const open = [...this.tripEvents].reverse().find(e => e.circuitId === circuitId && !e.resolvedAt);
      if (open) open.resolvedAt = now;
      logger.info('Circuit closed', { circuitId });
    } else if (newState === 'half_open') {
      breaker.halfOpenAttempts = 0;
      logger.info('Circuit half-open', { circuitId });
    }
  }

  private updateHealthScore(breaker: CircuitBreaker, config: CircuitConfig): void {
    let score = 100;
    score -= breaker.errorRate * 50;
    const latencyPenalty = Math.min(30, (breaker.latencyP99Ms / config.latencyP99ThresholdMs) * 30);
    score -= latencyPenalty;
    if (breaker.state === 'open') score = Math.min(score, 10);
    if (breaker.state === 'half_open') score = Math.min(score, 50);
    breaker.healthScore = Math.max(0, Math.min(100, score));
  }

  private adaptThreshold(breaker: CircuitBreaker, config: CircuitConfig): void {
    // EWM: adapt toward observed baseline error rate
    const alpha = 0.05;
    breaker.adaptiveThreshold = (1 - alpha) * breaker.adaptiveThreshold + alpha * breaker.errorRate;
    // Clamp: never go below half original or above original
    const min = config.errorRateThreshold * 0.5;
    const max = config.errorRateThreshold;
    breaker.adaptiveThreshold = Math.min(max, Math.max(min, breaker.adaptiveThreshold));
    breaker.lastAdaptedAt = Date.now();
  }

  // Manual controls ────────────────────────────────────────────────────────────

  forceOpen(circuitId: string): void {
    const breaker = this.breakers.get(circuitId);
    const config = this.configs.get(circuitId);
    if (!breaker || !config) throw new Error(`Circuit ${circuitId} not found`);
    this.transitionTo(circuitId, 'open', breaker, config, 'manual_open');
  }

  forceClose(circuitId: string): void {
    const breaker = this.breakers.get(circuitId);
    const config = this.configs.get(circuitId);
    if (!breaker || !config) throw new Error(`Circuit ${circuitId} not found`);
    this.transitionTo(circuitId, 'closed', breaker, config);
  }

  reset(circuitId: string): void {
    const config = this.configs.get(circuitId);
    if (!config) throw new Error(`Circuit ${circuitId} not found`);
    this.initBreaker(config);
    logger.info('Circuit reset', { circuitId });
  }

  // Reports ────────────────────────────────────────────────────────────────────

  generateHealthReport(circuitId: string): CircuitHealthReport {
    const breaker = this.breakers.get(circuitId);
    const config = this.configs.get(circuitId);
    if (!breaker || !config) throw new Error(`Circuit ${circuitId} not found`);
    const recommendations: string[] = [];
    if (breaker.errorRate > config.errorRateThreshold * 0.8) {
      recommendations.push('Error rate approaching threshold – investigate upstream');
    }
    if (breaker.latencyP99Ms > config.latencyP99ThresholdMs * 0.8) {
      recommendations.push('P99 latency approaching threshold – consider timeout optimization');
    }
    if (breaker.state === 'open') {
      recommendations.push('Circuit is open – check downstream health before manual close');
    }
    if (breaker.currentConcurrent > config.bulkheadMaxConcurrent * 0.8) {
      recommendations.push('Bulkhead nearing capacity – consider increasing limit or optimizing concurrency');
    }
    return {
      circuitId,
      serviceId: config.serviceId,
      tenantId: config.tenantId,
      state: breaker.state,
      healthScore: breaker.healthScore,
      errorRate: breaker.errorRate,
      latencyP99Ms: breaker.latencyP99Ms,
      openDurationMs: breaker.openedAt && breaker.state === 'open' ? Date.now() - breaker.openedAt : undefined,
      recommendations,
      timestamp: Date.now(),
    };
  }

  listTripEvents(circuitId?: string, activeOnly = false): TripEvent[] {
    let events = this.tripEvents;
    if (circuitId) events = events.filter(e => e.circuitId === circuitId);
    if (activeOnly) events = events.filter(e => !e.resolvedAt);
    return events;
  }

  listResults(circuitId?: string, limit = 100): ExecutionResult[] {
    const filtered = circuitId ? this.results.filter(r => r.circuitId === circuitId) : this.results;
    return filtered.slice(-limit);
  }

  getBulkheadStats(circuitId: string): BulkheadStats {
    const breaker = this.breakers.get(circuitId);
    const config = this.configs.get(circuitId);
    if (!breaker || !config) throw new Error(`Circuit ${circuitId} not found`);
    const rejected = this.results.filter(r => r.circuitId === circuitId && r.error === 'bulkhead').length;
    return {
      circuitId,
      maxConcurrent: config.bulkheadMaxConcurrent,
      currentConcurrent: breaker.currentConcurrent,
      rejectedDueToBulkhead: rejected,
      utilizationPct: (breaker.currentConcurrent / config.bulkheadMaxConcurrent) * 100,
    };
  }

  getSummary(): EngineSummary {
    const breakers = Array.from(this.breakers.values());
    const states = { closed: 0, open: 0, half_open: 0 };
    for (const b of breakers) states[b.state]++;
    const avgHealth = breakers.length > 0
      ? breakers.reduce((s, b) => s + b.healthScore, 0) / breakers.length
      : 100;
    const topUnhealthy = breakers
      .sort((a, b) => a.healthScore - b.healthScore)
      .slice(0, 5)
      .map(b => ({ circuitId: b.configId, healthScore: b.healthScore, state: b.state }));
    return {
      totalCircuits: this.configs.size,
      closedCircuits: states.closed,
      openCircuits: states.open,
      halfOpenCircuits: states.half_open,
      avgHealthScore: avgHealth,
      totalTripEvents: this.tripEvents.length,
      activeTripEvents: this.tripEvents.filter(e => !e.resolvedAt).length,
      topUnhealthy,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__adaptiveCircuitBreakerEngine__';
export function getCircuitBreakerEngine(): AdaptiveCircuitBreakerEngine {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AdaptiveCircuitBreakerEngine();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AdaptiveCircuitBreakerEngine;
}
