/**
 * @module intelligentApiComposer
 * @description Dynamic API composition engine with service registry, request routing graph,
 * parallel fan-out aggregation, schema stitching, response transformation pipeline,
 * per-upstream circuit breaker, composed response cache, request/response logging with
 * redaction, SLA enforcement, and composition versioning.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface ServiceEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  timeout: number;
  version: string;
  tags: string[];
  healthCheckPath: string;
  slaMs: number;
  registeredAt: number;
}

export interface CompositionRoute {
  id: string;
  name: string;
  version: string;
  steps: CompositionStep[];
  cacheTtlMs?: number;
  slaMs: number;
  createdAt: number;
}

export interface CompositionStep {
  stepId: string;
  serviceId: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  dependsOn: string[]; // stepIds that must complete first
  inputMapping: Record<string, string>; // output field -> input param
  outputKey: string; // key in aggregated response
  redactFields: string[];
}

export interface ComposedResponse {
  compositionId: string;
  routeId: string;
  routeVersion: string;
  data: Record<string, unknown>;
  stepDurations: Record<string, number>;
  totalDurationMs: number;
  cacheHit: boolean;
  slaBreached: boolean;
  composedAt: number;
}

export interface CircuitBreakerState {
  serviceId: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt?: number;
  openedAt?: number;
  halfOpenAt?: number;
  threshold: number;
  recoveryMs: number;
}

export interface ApiCompositionConfig {
  circuitBreakerThreshold: number;
  circuitBreakerRecoveryMs: number;
  defaultCacheTtlMs: number;
  redactPatterns: RegExp[];
}

export interface RoutingDecision {
  routeId: string;
  selectedSteps: string[];
  reason: string;
  decidedAt: number;
}

export interface ApiComposerSummary {
  totalEndpoints: number;
  totalRoutes: number;
  totalCompositions: number;
  cacheHitRate: number;
  avgDurationMs: number;
  slaBreachRate: number;
  openCircuits: string[];
  totalCacheEntries: number;
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class IntelligentApiComposer {
  private endpoints: Map<string, ServiceEndpoint> = new Map();
  private routes: Map<string, CompositionRoute[]> = new Map(); // routeId -> versions
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private cache: Map<string, { data: ComposedResponse; expiresAt: number }> = new Map();
  private compositionLog: ComposedResponse[] = [];
  private config: ApiCompositionConfig;

  constructor(config?: Partial<ApiCompositionConfig>) {
    this.config = {
      circuitBreakerThreshold: 5,
      circuitBreakerRecoveryMs: 30000,
      defaultCacheTtlMs: 60000,
      redactPatterns: [/password/i, /secret/i, /token/i, /api.?key/i],
      ...config,
    };
    logger.info('[IntelligentApiComposer] Initialized API composition engine');
  }

  /**
   * Register a service endpoint in the registry.
   */
  registerEndpoint(endpoint: ServiceEndpoint): void {
    this.endpoints.set(endpoint.id, { ...endpoint, registeredAt: endpoint.registeredAt || Date.now() });
    // Initialize circuit breaker for this service
    if (!this.circuitBreakers.has(endpoint.id)) {
      this.circuitBreakers.set(endpoint.id, {
        serviceId: endpoint.id,
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        threshold: this.config.circuitBreakerThreshold,
        recoveryMs: this.config.circuitBreakerRecoveryMs,
      });
    }
    logger.info(`[IntelligentApiComposer] Endpoint '${endpoint.id}' registered (v${endpoint.version})`);
  }

  /**
   * Define a new composition route, supporting versioning.
   */
  defineComposition(route: CompositionRoute): void {
    const versions = this.routes.get(route.id) ?? [];
    versions.push({ ...route, createdAt: route.createdAt || Date.now() });
    versions.sort((a, b) => b.createdAt - a.createdAt);
    this.routes.set(route.id, versions);
    logger.info(`[IntelligentApiComposer] Route '${route.id}' v${route.version} defined (${route.steps.length} steps)`);
  }

  /**
   * Execute a composition route, respecting circuit breakers and cache.
   */
  async executeComposition(
    routeId: string,
    inputParams: Record<string, unknown>,
    version?: string,
  ): Promise<ComposedResponse> {
    const versions = this.routes.get(routeId);
    if (!versions || versions.length === 0) throw new Error(`Route not found: ${routeId}`);

    const route = version
      ? (versions.find(r => r.version === version) ?? versions[0])
      : versions[0];

    // Check cache
    const cacheKey = this.buildCacheKey(routeId, route.version, inputParams);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug(`[IntelligentApiComposer] Cache hit for ${routeId} v${route.version}`);
      return { ...cached.data, cacheHit: true };
    }

    const startAt = Date.now();
    const stepDurations: Record<string, number> = {};
    const aggregatedData: Record<string, unknown> = { ...inputParams };

    // Execute steps respecting dependency order
    const executionOrder = this.resolveExecutionOrder(route.steps);
    for (const batch of executionOrder) {
      await Promise.all(batch.map(async (step) => {
        const svc = this.endpoints.get(step.serviceId);
        if (!svc) {
          logger.warn(`[IntelligentApiComposer] Unknown service ${step.serviceId} in step ${step.stepId}`);
          return;
        }

        const cb = this.enforceCircuitBreaker(step.serviceId);
        if (cb.state === 'open') {
          logger.warn(`[IntelligentApiComposer] Circuit open for ${step.serviceId}, skipping step ${step.stepId}`);
          aggregatedData[step.outputKey] = null;
          return;
        }

        const stepInput = this.mapInputs(step.inputMapping, aggregatedData);
        const stepStart = Date.now();

        // Simulate upstream call
        const stepResult = await this.simulateUpstreamCall(svc, step, stepInput);
        stepDurations[step.stepId] = Date.now() - stepStart;

        if (stepResult.success) {
          this.recordCircuitSuccess(step.serviceId);
          const redacted = this.redactResponse(stepResult.data, step.redactFields);
          aggregatedData[step.outputKey] = redacted;
        } else {
          this.recordCircuitFailure(step.serviceId);
          aggregatedData[step.outputKey] = { error: stepResult.error };
        }
      }));
    }

    const totalDurationMs = Date.now() - startAt;
    const slaBreached = totalDurationMs > route.slaMs;
    if (slaBreached) {
      logger.warn(`[IntelligentApiComposer] SLA breached for route ${routeId}: ${totalDurationMs}ms > ${route.slaMs}ms`);
    }

    const composed: ComposedResponse = {
      compositionId: `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      routeId,
      routeVersion: route.version,
      data: aggregatedData,
      stepDurations,
      totalDurationMs,
      cacheHit: false,
      slaBreached,
      composedAt: Date.now(),
    };

    this.compositionLog.push(composed);
    const ttl = route.cacheTtlMs ?? this.config.defaultCacheTtlMs;
    if (ttl > 0) {
      this.cache.set(cacheKey, { data: composed, expiresAt: Date.now() + ttl });
    }

    logger.info(`[IntelligentApiComposer] Composition ${composed.compositionId} in ${totalDurationMs}ms`);
    return composed;
  }

  /**
   * Aggregate parallel step responses with schema merging.
   */
  aggregateResponses(stepOutputs: Record<string, unknown>[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const output of stepOutputs) {
      for (const [key, value] of Object.entries(output)) {
        if (key in merged) {
          // Merge arrays, prefer objects with more keys
          if (Array.isArray(merged[key]) && Array.isArray(value)) {
            merged[key] = [...(merged[key] as unknown[]), ...value];
          } else if (typeof merged[key] === 'object' && typeof value === 'object' && value !== null) {
            merged[key] = { ...(merged[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
          }
        } else {
          merged[key] = value;
        }
      }
    }
    return merged;
  }

  /**
   * Apply a transformation pipeline to a composed response.
   */
  transformResponse(
    response: Record<string, unknown>,
    transformations: Array<{ field: string; transform: 'uppercase' | 'lowercase' | 'stringify' | 'truncate'; arg?: number }>,
  ): Record<string, unknown> {
    const result = { ...response };
    for (const t of transformations) {
      const val = result[t.field];
      if (val === undefined) continue;
      switch (t.transform) {
        case 'uppercase':
          result[t.field] = typeof val === 'string' ? val.toUpperCase() : val;
          break;
        case 'lowercase':
          result[t.field] = typeof val === 'string' ? val.toLowerCase() : val;
          break;
        case 'stringify':
          result[t.field] = JSON.stringify(val);
          break;
        case 'truncate':
          result[t.field] = typeof val === 'string' ? val.slice(0, t.arg ?? 100) : val;
          break;
      }
    }
    return result;
  }

  /**
   * Enforce circuit breaker logic and return current state.
   */
  enforceCircuitBreaker(serviceId: string): CircuitBreakerState {
    const cb = this.circuitBreakers.get(serviceId);
    if (!cb) {
      const newCb: CircuitBreakerState = {
        serviceId, state: 'closed', failureCount: 0, successCount: 0,
        threshold: this.config.circuitBreakerThreshold,
        recoveryMs: this.config.circuitBreakerRecoveryMs,
      };
      this.circuitBreakers.set(serviceId, newCb);
      return newCb;
    }

    const now = Date.now();
    if (cb.state === 'open' && cb.openedAt) {
      if (now - cb.openedAt > cb.recoveryMs) {
        cb.state = 'half_open';
        cb.halfOpenAt = now;
        logger.info(`[IntelligentApiComposer] Circuit half-open for ${serviceId}`);
      }
    }
    return cb;
  }

  /**
   * Invalidate cache entries for a route (or all entries if no routeId given).
   */
  invalidateCache(routeId?: string): number {
    if (!routeId) {
      const count = this.cache.size;
      this.cache.clear();
      logger.info(`[IntelligentApiComposer] Cache cleared (${count} entries)`);
      return count;
    }
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${routeId}:`)) {
        this.cache.delete(key);
        removed++;
      }
    }
    logger.info(`[IntelligentApiComposer] Cache invalidated for route ${routeId}: ${removed} entries`);
    return removed;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private resolveExecutionOrder(steps: CompositionStep[]): CompositionStep[][] {
    const remaining = [...steps];
    const completed = new Set<string>();
    const batches: CompositionStep[][] = [];

    while (remaining.length > 0) {
      const batch = remaining.filter(s => s.dependsOn.every(dep => completed.has(dep)));
      if (batch.length === 0) {
        // Break cycle: add all remaining
        batches.push([...remaining]);
        break;
      }
      batches.push(batch);
      for (const s of batch) {
        completed.add(s.stepId);
        remaining.splice(remaining.indexOf(s), 1);
      }
    }
    return batches;
  }

  private mapInputs(mapping: Record<string, string>, context: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [outputField, inputParam] of Object.entries(mapping)) {
      result[inputParam] = context[outputField];
    }
    return result;
  }

  private async simulateUpstreamCall(
    _svc: ServiceEndpoint,
    _step: CompositionStep,
    input: Record<string, unknown>,
  ): Promise<{ success: boolean; data: Record<string, unknown>; error?: string }> {
    // Simulate 95% success rate with realistic response time
    await new Promise(r => setTimeout(r, 5 + Math.random() * 20));
    if (Math.random() < 0.05) {
      return { success: false, data: {}, error: 'Upstream service error' };
    }
    return { success: true, data: { ...input, _responseTime: Date.now() } };
  }

  private redactResponse(data: Record<string, unknown>, redactFields: string[]): Record<string, unknown> {
    const result = { ...data };
    for (const field of redactFields) {
      if (field in result) result[field] = '[REDACTED]';
    }
    // Also apply global patterns
    for (const [key] of Object.entries(result)) {
      if (this.config.redactPatterns.some(p => p.test(key))) {
        result[key] = '[REDACTED]';
      }
    }
    return result;
  }

  private recordCircuitSuccess(serviceId: string): void {
    const cb = this.circuitBreakers.get(serviceId);
    if (!cb) return;
    cb.successCount++;
    if (cb.state === 'half_open') {
      cb.state = 'closed';
      cb.failureCount = 0;
      logger.info(`[IntelligentApiComposer] Circuit closed for ${serviceId}`);
    }
  }

  private recordCircuitFailure(serviceId: string): void {
    const cb = this.circuitBreakers.get(serviceId);
    if (!cb) return;
    cb.failureCount++;
    cb.lastFailureAt = Date.now();
    if (cb.failureCount >= cb.threshold && cb.state === 'closed') {
      cb.state = 'open';
      cb.openedAt = Date.now();
      logger.warn(`[IntelligentApiComposer] Circuit opened for ${serviceId} (${cb.failureCount} failures)`);
    }
  }

  private buildCacheKey(routeId: string, version: string, params: Record<string, unknown>): string {
    return `${routeId}:${version}:${JSON.stringify(params)}`;
  }

  /**
   * Return a high-level summary of the API composition engine.
   */
  getSummary(): ApiComposerSummary {
    const totalComp = this.compositionLog.length;
    const cacheHits = this.compositionLog.filter(c => c.cacheHit).length;
    const avgDuration = totalComp > 0
      ? this.compositionLog.reduce((s, c) => s + c.totalDurationMs, 0) / totalComp : 0;
    const slaBreaches = this.compositionLog.filter(c => c.slaBreached).length;
    const openCircuits = Array.from(this.circuitBreakers.values())
      .filter(cb => cb.state === 'open')
      .map(cb => cb.serviceId);

    return {
      totalEndpoints: this.endpoints.size,
      totalRoutes: this.routes.size,
      totalCompositions: totalComp,
      cacheHitRate: totalComp > 0 ? parseFloat((cacheHits / totalComp).toFixed(4)) : 0,
      avgDurationMs: parseFloat(avgDuration.toFixed(2)),
      slaBreachRate: totalComp > 0 ? parseFloat((slaBreaches / totalComp).toFixed(4)) : 0,
      openCircuits,
      totalCacheEntries: this.cache.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__intelligentApiComposer__';
export function getIntelligentApiComposer(): IntelligentApiComposer {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new IntelligentApiComposer();
  }
  return (globalThis as Record<string, unknown>)[KEY] as IntelligentApiComposer;
}
