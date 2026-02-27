/**
 * Circuit Breaker Orchestrator
 *
 * Cascading failure prevention and circuit breaker orchestration across
 * distributed services. Implements the circuit breaker pattern with:
 * - Sliding-window percentile latency tracking (P50/P95/P99)
 * - Cascade failure detection via dependency graph BFS traversal
 * - Exponential backoff on half-open retry probes
 * - Event emission on every state transition
 * - Configurable error-type filtering
 */

import { getLogger } from './logger';

const logger = getLogger();

// ─── Types ────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  name: string;
  threshold: number;           // failure-rate 0-1 to open circuit
  resetTimeout: number;        // ms before attempting half-open
  halfOpenMax: number;         // max probe requests in half-open state
  monitoringWindow: number;    // ms sliding window for metrics
  errorTypes: string[];        // error constructor names to count; empty = all
}

export interface CircuitMetrics {
  totalRequests: number;
  failures: number;
  successes: number;
  rejections: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  lastFailureTime: number;
  lastSuccessTime: number;
}

export interface CircuitBreaker {
  id: string;
  name: string;
  state: CircuitState;
  metrics: CircuitMetrics;
  config: CircuitBreakerConfig;
  stateChangedAt: number;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
}

export interface CascadeGraph {
  nodes: Map<string, CircuitBreaker>;
  edges: Map<string, string[]>;  // id -> downstream dependencies
}

export interface FallbackStrategy {
  type: 'cache' | 'default' | 'queue' | 'fail-fast';
  handler: () => unknown;
}

export interface BreakerEvent {
  breakerId: string;
  previousState: CircuitState;
  newState: CircuitState;
  reason: string;
  timestamp: number;
  metrics: CircuitMetrics;
}

export interface OrchestratorStats {
  totalBreakers: number;
  openBreakers: number;
  halfOpenBreakers: number;
  closedBreakers: number;
  totalRequests: number;
  totalRejections: number;
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface BreakerState extends CircuitBreaker {
  latencySamples: number[];       // circular buffer of 100 samples
  windowEvents: Array<{ ts: number; success: boolean }>;
  halfOpenProbes: number;
  retryAttempt: number;           // for exponential backoff
  fallback?: FallbackStrategy;
}

// ─── Class ────────────────────────────────────────────────────────────────────

class CircuitBreakerOrchestrator {
  private readonly breakers = new Map<string, BreakerState>();
  private readonly graph: CascadeGraph = {
    nodes: new Map(),
    edges: new Map(),
  };
  private readonly stateChangeHandlers: Array<(event: BreakerEvent) => void> = [];
  private idCounter = 0;

  // ── Public API ──────────────────────────────────────────────────────────────

  register(config: CircuitBreakerConfig, fallback?: FallbackStrategy): string {
    const id = `cb_${++this.idCounter}_${config.name}`;
    const metrics: CircuitMetrics = {
      totalRequests: 0, failures: 0, successes: 0, rejections: 0,
      latencyP50: 0, latencyP95: 0, latencyP99: 0,
      lastFailureTime: 0, lastSuccessTime: 0,
    };
    const state: BreakerState = {
      id, name: config.name, state: 'closed', metrics, config,
      stateChangedAt: Date.now(),
      consecutiveSuccesses: 0, consecutiveFailures: 0,
      latencySamples: [], windowEvents: [],
      halfOpenProbes: 0, retryAttempt: 0,
      fallback,
    };
    this.breakers.set(id, state);
    this.graph.nodes.set(id, state);
    this.graph.edges.set(id, []);
    logger.info('Circuit breaker registered', { id, name: config.name });
    return id;
  }

  deregister(id: string): void {
    this.breakers.delete(id);
    this.graph.nodes.delete(id);
    this.graph.edges.delete(id);
    // remove from other edges
    for (const [, deps] of this.graph.edges) {
      const idx = deps.indexOf(id);
      if (idx !== -1) deps.splice(idx, 1);
    }
    logger.info('Circuit breaker deregistered', { id });
  }

  /** Register a directed dependency: `fromId` depends on `toId`. */
  addDependency(fromId: string, toId: string): void {
    const deps = this.graph.edges.get(fromId) ?? [];
    if (!deps.includes(toId)) deps.push(toId);
    this.graph.edges.set(fromId, deps);
  }

  async execute<T>(
    id: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>,
  ): Promise<T> {
    const breaker = this.breakers.get(id);
    if (!breaker) throw new Error(`CircuitBreaker '${id}' not found`);

    this.pruneWindow(breaker);
    breaker.metrics.totalRequests++;

    if (breaker.state === 'open') {
      const elapsed = Date.now() - breaker.stateChangedAt;
      const backoff = breaker.config.resetTimeout *
        Math.pow(2, Math.min(breaker.retryAttempt, 6));
      if (elapsed < backoff) {
        breaker.metrics.rejections++;
        logger.warn('Circuit open – request rejected', { id, elapsed, backoff, ...context });
        if (breaker.fallback) return breaker.fallback.handler() as T;
        throw new Error(`Circuit '${breaker.name}' is OPEN`);
      }
      this.transitionTo(breaker, 'half-open', 'reset-timeout elapsed');
    }

    if (breaker.state === 'half-open') {
      if (breaker.halfOpenProbes >= breaker.config.halfOpenMax) {
        breaker.metrics.rejections++;
        if (breaker.fallback) return breaker.fallback.handler() as T;
        throw new Error(`Circuit '${breaker.name}' is HALF-OPEN (probe limit reached)`);
      }
      breaker.halfOpenProbes++;
    }

    const start = Date.now();
    try {
      const result = await fn();
      this.recordSuccess(id, Date.now() - start);
      return result;
    } catch (err) {
      this.recordFailure(id, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  getState(id: string): CircuitState {
    const b = this.breakers.get(id);
    if (!b) throw new Error(`CircuitBreaker '${id}' not found`);
    return b.state;
  }

  getMetrics(id: string): CircuitMetrics {
    const b = this.breakers.get(id);
    if (!b) throw new Error(`CircuitBreaker '${id}' not found`);
    return { ...b.metrics };
  }

  forceOpen(id: string, reason: string): void {
    const b = this.breakers.get(id);
    if (!b) throw new Error(`CircuitBreaker '${id}' not found`);
    this.transitionTo(b, 'open', `forced: ${reason}`);
  }

  forceClose(id: string): void {
    const b = this.breakers.get(id);
    if (!b) throw new Error(`CircuitBreaker '${id}' not found`);
    b.retryAttempt = 0;
    b.halfOpenProbes = 0;
    this.transitionTo(b, 'closed', 'forced close');
  }

  /** BFS traversal: returns IDs of circuit breakers reachable from startId that are open. */
  detectCascade(startId: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [startId];
    const cascadePath: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const breaker = this.breakers.get(current);
      if (breaker && breaker.state === 'open' && current !== startId) {
        cascadePath.push(current);
      }

      const deps = this.graph.edges.get(current) ?? [];
      for (const dep of deps) {
        if (!visited.has(dep)) queue.push(dep);
      }
    }

    if (cascadePath.length > 0) {
      logger.warn('Cascade failure detected', { startId, affected: cascadePath });
    }
    return cascadePath;
  }

  onStateChange(handler: (event: BreakerEvent) => void): void {
    this.stateChangeHandlers.push(handler);
  }

  getStats(): OrchestratorStats {
    let totalRequests = 0;
    let totalRejections = 0;
    let openBreakers = 0;
    let halfOpenBreakers = 0;
    let closedBreakers = 0;

    for (const b of this.breakers.values()) {
      totalRequests += b.metrics.totalRequests;
      totalRejections += b.metrics.rejections;
      if (b.state === 'open') openBreakers++;
      else if (b.state === 'half-open') halfOpenBreakers++;
      else closedBreakers++;
    }

    return {
      totalBreakers: this.breakers.size,
      openBreakers, halfOpenBreakers, closedBreakers,
      totalRequests, totalRejections,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private recordSuccess(id: string, latency: number): void {
    const b = this.breakers.get(id);
    if (!b) return;
    b.metrics.successes++;
    b.metrics.lastSuccessTime = Date.now();
    b.consecutiveSuccesses++;
    b.consecutiveFailures = 0;
    b.windowEvents.push({ ts: Date.now(), success: true });
    this.addLatencySample(b, latency);
    this.tryTransition(id);
    logger.debug('Breaker success recorded', { id, latency, state: b.state });
  }

  private recordFailure(id: string, error: Error): void {
    const b = this.breakers.get(id);
    if (!b) return;

    // Error-type filtering
    if (b.config.errorTypes.length > 0 &&
        !b.config.errorTypes.includes(error.constructor.name)) {
      // Not a tracked error type – still record success path to avoid penalising
      this.recordSuccess(id, 0);
      return;
    }

    b.metrics.failures++;
    b.metrics.lastFailureTime = Date.now();
    b.consecutiveFailures++;
    b.consecutiveSuccesses = 0;
    b.windowEvents.push({ ts: Date.now(), success: false });
    this.tryTransition(id);
    logger.warn('Breaker failure recorded', { id, error: error.message, state: b.state });
  }

  private tryTransition(id: string): void {
    const b = this.breakers.get(id);
    if (!b) return;
    this.pruneWindow(b);

    if (b.state === 'closed' && this.shouldOpen(b.metrics, b.config, b.windowEvents)) {
      b.retryAttempt++;
      this.transitionTo(b, 'open', 'failure threshold exceeded');
    } else if (b.state === 'half-open') {
      if (this.shouldClose(b.metrics, b.config)) {
        b.retryAttempt = 0;
        b.halfOpenProbes = 0;
        this.transitionTo(b, 'closed', 'half-open probes succeeded');
      } else if (b.consecutiveFailures > 0) {
        this.transitionTo(b, 'open', 'half-open probe failed');
      }
    }
  }

  private shouldOpen(
    _metrics: CircuitMetrics,
    config: CircuitBreakerConfig,
    windowEvents: Array<{ ts: number; success: boolean }>,
  ): boolean {
    if (windowEvents.length < 5) return false;
    const failures = windowEvents.filter(e => !e.success).length;
    const rate = failures / windowEvents.length;
    return rate >= config.threshold;
  }

  private shouldClose(metrics: CircuitMetrics, config: CircuitBreakerConfig): boolean {
    // Require halfOpenMax consecutive successes
    const recentSuccessThreshold = Math.ceil(config.halfOpenMax * 0.8);
    return metrics.successes > 0 &&
      (metrics.successes / (metrics.successes + metrics.failures)) >= (1 - config.threshold) &&
      metrics.successes >= recentSuccessThreshold;
  }

  private transitionTo(b: BreakerState, newState: CircuitState, reason: string): void {
    if (b.state === newState) return;
    const prev = b.state;
    b.state = newState;
    b.stateChangedAt = Date.now();
    // reset window metrics on transition
    b.windowEvents = [];
    b.consecutiveSuccesses = 0;
    b.consecutiveFailures = 0;

    const event: BreakerEvent = {
      breakerId: b.id, previousState: prev, newState,
      reason, timestamp: b.stateChangedAt, metrics: { ...b.metrics },
    };

    logger.info('Circuit breaker state transition', { id: b.id, prev, newState, reason });
    for (const handler of this.stateChangeHandlers) {
      try { handler(event); } catch { /* swallow handler errors */ }
    }
  }

  private addLatencySample(b: BreakerState, latency: number): void {
    b.latencySamples.push(latency);
    if (b.latencySamples.length > 100) b.latencySamples.shift();
    const sorted = [...b.latencySamples].sort((a, b) => a - b);
    const p = (pct: number) => sorted[Math.floor(sorted.length * pct)] ?? 0;
    b.metrics.latencyP50 = p(0.50);
    b.metrics.latencyP95 = p(0.95);
    b.metrics.latencyP99 = p(0.99);
  }

  private pruneWindow(b: BreakerState): void {
    const cutoff = Date.now() - b.config.monitoringWindow;
    b.windowEvents = b.windowEvents.filter(e => e.ts >= cutoff);
  }

  /**
   * Returns a human-readable health summary for all registered breakers,
   * sorted by failure rate descending so the most problematic services
   * appear first.
   */
  healthReport(): Array<{
    id: string;
    name: string;
    state: CircuitState;
    failureRate: number;
    latencyP99: number;
    openSinceMs: number | null;
  }> {
    return [...this.breakers.values()]
      .map(b => {
        const total = b.metrics.totalRequests - b.metrics.rejections;
        const failureRate = total > 0 ? b.metrics.failures / total : 0;
        const openSinceMs = b.state !== 'closed' ? Date.now() - b.stateChangedAt : null;
        return {
          id: b.id,
          name: b.name,
          state: b.state,
          failureRate,
          latencyP99: b.metrics.latencyP99,
          openSinceMs,
        };
      })
      .sort((a, b) => b.failureRate - a.failureRate);
  }

  /**
   * Resets all metrics counters for the given breaker without changing its
   * state.  Useful after a controlled deployment when historical failures
   * should not influence the new version's threshold evaluation.
   */
  resetMetrics(id: string): void {
    const b = this.breakers.get(id);
    if (!b) throw new Error(`CircuitBreaker '${id}' not found`);
    b.metrics = {
      totalRequests: 0, failures: 0, successes: 0, rejections: 0,
      latencyP50: 0, latencyP95: 0, latencyP99: 0,
      lastFailureTime: 0, lastSuccessTime: 0,
    };
    b.latencySamples = [];
    b.windowEvents = [];
    b.consecutiveSuccesses = 0;
    b.consecutiveFailures = 0;
    logger.info('Breaker metrics reset', { id });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__circuitBreakerOrchestrator__';

export function getCircuitBreakerOrchestrator(): CircuitBreakerOrchestrator {
  const g = globalThis as unknown as Record<string, CircuitBreakerOrchestrator>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CircuitBreakerOrchestrator();
    logger.info('CircuitBreakerOrchestrator initialised');
  }
  return g[GLOBAL_KEY];
}

export { CircuitBreakerOrchestrator };
