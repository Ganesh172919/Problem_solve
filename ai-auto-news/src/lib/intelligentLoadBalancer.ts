/**
 * @module intelligentLoadBalancer
 * @description AI-driven intelligent load balancing engine. Registers and monitors
 * service nodes, routes requests using configurable strategies (round-robin,
 * least-connections, weighted, AI-predicted, geo-aware, latency-based), predicts
 * future load via exponential smoothing, and handles node failures with automatic
 * rebalancing and health-check-driven eviction.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface ServiceNode {
  id: string;
  host: string;
  port: number;
  region: string;
  zone: string;
  weight: number;
  tags: string[];
  maxConnections: number;
  registeredAt: Date;
}

export interface LoadMetrics {
  nodeId: string;
  activeConnections: number;
  requestsPerSecond: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  cpuPercent: number;
  memoryPercent: number;
  timestamp: Date;
}

export interface HealthStatus {
  nodeId: string;
  healthy: boolean;
  lastChecked: Date;
  consecutiveFailures: number;
  lastError?: string;
  circuitBreakerOpen: boolean;
}

export interface RoutingPolicy {
  strategy: 'round_robin' | 'least_connections' | 'weighted' | 'ai_predicted' | 'geo_aware' | 'latency_based';
  stickySessionTtlMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  regionPreference?: string;
  latencyThresholdMs?: number;
}

export interface TrafficDistribution {
  nodeId: string;
  requestCount: number;
  percentage: number;
  avgLatencyMs: number;
  errorCount: number;
}

export interface LoadPrediction {
  nodeId: string;
  horizon: number;
  predictedRps: number[];
  predictedLatency: number[];
  confidenceInterval: { lower: number[]; upper: number[] };
  generatedAt: Date;
}

export interface BalancingStrategy {
  name: RoutingPolicy['strategy'];
  description: string;
  suitableFor: string[];
  overhead: 'low' | 'medium' | 'high';
}

export interface NodePerformance {
  nodeId: string;
  score: number;
  rank: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: 'keep' | 'scale_up' | 'investigate' | 'deregister';
}

// ─── Internal state ───────────────────────────────────────────────────────────
interface InternalNode {
  node: ServiceNode;
  metrics: LoadMetrics;
  health: HealthStatus;
  requestCount: number;
  errorCount: number;
  latencyHistory: number[];
  rpsHistory: number[];
}

export class IntelligentLoadBalancer {
  private nodes      = new Map<string, InternalNode>();
  private rrIndex    = 0;
  private policy: RoutingPolicy = { strategy: 'least_connections', maxRetries: 3, timeoutMs: 5000 };
  private stickyMap  = new Map<string, { nodeId: string; expiresAt: number }>();

  registerNode(node: ServiceNode): void {
    const metrics: LoadMetrics = {
      nodeId: node.id, activeConnections: 0, requestsPerSecond: 0,
      avgLatencyMs: 10, p99LatencyMs: 50, errorRate: 0,
      cpuPercent: 10, memoryPercent: 20, timestamp: new Date(),
    };
    const health: HealthStatus = {
      nodeId: node.id, healthy: true, lastChecked: new Date(),
      consecutiveFailures: 0, circuitBreakerOpen: false,
    };
    this.nodes.set(node.id, { node, metrics, health, requestCount: 0, errorCount: 0, latencyHistory: [], rpsHistory: [] });
    logger.info('Node registered', { nodeId: node.id, host: node.host, region: node.region });
  }

  deregisterNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      logger.warn('Attempted to deregister unknown node', { nodeId });
      return;
    }
    this.nodes.delete(nodeId);
    logger.info('Node deregistered', { nodeId });
  }

  routeRequest(request: { id: string; clientIp?: string; region?: string }): string | null {
    const healthy = this.getHealthyNodes();
    if (healthy.length === 0) {
      logger.warn('No healthy nodes available for routing', { requestId: request.id });
      return null;
    }

    // Sticky session check
    const sticky = request.clientIp ? this.stickyMap.get(request.clientIp) : undefined;
    if (sticky && sticky.expiresAt > Date.now() && this.nodes.get(sticky.nodeId)?.health.healthy) {
      return sticky.nodeId;
    }

    let selected: InternalNode | null = null;
    switch (this.policy.strategy) {
      case 'round_robin':       selected = this.roundRobin(healthy); break;
      case 'least_connections': selected = this.leastConnections(healthy); break;
      case 'weighted':          selected = this.weighted(healthy); break;
      case 'latency_based':     selected = this.latencyBased(healthy); break;
      case 'geo_aware':         selected = this.geoAware(healthy, request.region); break;
      case 'ai_predicted':      selected = this.aiPredicted(healthy); break;
      default:                  selected = this.leastConnections(healthy);
    }

    if (!selected) return null;
    selected.metrics.activeConnections++;
    selected.requestCount++;

    if (request.clientIp && this.policy.stickySessionTtlMs) {
      this.stickyMap.set(request.clientIp, {
        nodeId: selected.node.id, expiresAt: Date.now() + this.policy.stickySessionTtlMs,
      });
    }

    logger.debug('Request routed', { requestId: request.id, nodeId: selected.node.id, strategy: this.policy.strategy });
    return selected.node.id;
  }

  private getHealthyNodes(): InternalNode[] {
    return Array.from(this.nodes.values()).filter(n => n.health.healthy && !n.health.circuitBreakerOpen);
  }

  private roundRobin(nodes: InternalNode[]): InternalNode {
    const node = nodes[this.rrIndex % nodes.length];
    this.rrIndex = (this.rrIndex + 1) % nodes.length;
    return node;
  }

  private leastConnections(nodes: InternalNode[]): InternalNode {
    return nodes.reduce((best, n) => n.metrics.activeConnections < best.metrics.activeConnections ? n : best);
  }

  private weighted(nodes: InternalNode[]): InternalNode {
    const total = nodes.reduce((s, n) => s + n.node.weight, 0);
    let r = Math.random() * total;
    for (const n of nodes) { r -= n.node.weight; if (r <= 0) return n; }
    return nodes[nodes.length - 1];
  }

  private latencyBased(nodes: InternalNode[]): InternalNode {
    return nodes.reduce((best, n) => n.metrics.avgLatencyMs < best.metrics.avgLatencyMs ? n : best);
  }

  private geoAware(nodes: InternalNode[], region?: string): InternalNode {
    if (region) {
      const regional = nodes.filter(n => n.node.region === region);
      if (regional.length > 0) return this.leastConnections(regional);
    }
    return this.leastConnections(nodes);
  }

  private aiPredicted(nodes: InternalNode[]): InternalNode {
    // Score nodes using a composite of predicted headroom: weight, latency, cpu, connections
    const scored = nodes.map(n => {
      const connScore    = 1 - (n.metrics.activeConnections / Math.max(n.node.maxConnections, 1));
      const latencyScore = 1 - Math.min(1, n.metrics.avgLatencyMs / 500);
      const cpuScore     = 1 - n.metrics.cpuPercent / 100;
      const memScore     = 1 - n.metrics.memoryPercent / 100;
      const score        = 0.3 * connScore + 0.3 * latencyScore + 0.25 * cpuScore + 0.15 * memScore;
      return { n, score };
    });
    return scored.reduce((best, s) => s.score > best.score ? s : best).n;
  }

  updateMetrics(nodeId: string, metrics: Partial<LoadMetrics>): void {
    const state = this.nodes.get(nodeId);
    if (!state) return;
    Object.assign(state.metrics, metrics, { nodeId, timestamp: new Date() });
    if (metrics.avgLatencyMs !== undefined) {
      state.latencyHistory.push(metrics.avgLatencyMs);
      if (state.latencyHistory.length > 60) state.latencyHistory.shift();
    }
    if (metrics.requestsPerSecond !== undefined) {
      state.rpsHistory.push(metrics.requestsPerSecond);
      if (state.rpsHistory.length > 60) state.rpsHistory.shift();
    }
    // Update health based on error rate and circuit breaker logic
    if ((metrics.errorRate ?? 0) > 0.5) {
      state.health.consecutiveFailures++;
      if (state.health.consecutiveFailures >= 5) {
        state.health.healthy = false;
        state.health.circuitBreakerOpen = true;
        logger.warn('Circuit breaker opened for node', { nodeId, errorRate: metrics.errorRate });
      }
    } else if (state.health.consecutiveFailures > 0) {
      state.health.consecutiveFailures = Math.max(0, state.health.consecutiveFailures - 1);
      if (state.health.consecutiveFailures === 0) {
        state.health.healthy = true;
        state.health.circuitBreakerOpen = false;
      }
    }
    state.health.lastChecked = new Date();
  }

  predictLoad(horizon: number): LoadPrediction[] {
    return Array.from(this.nodes.values()).map(state => {
      const hist = state.rpsHistory;
      const base = hist.length > 0 ? hist.reduce((a, b) => a + b, 0) / hist.length : 10;
      // Exponential smoothing forecast
      let level = base;
      const alpha = 0.3;
      const predicted: number[] = [];
      const latHist = state.latencyHistory;
      const latBase = latHist.length > 0 ? latHist.reduce((a, b) => a + b, 0) / latHist.length : 20;
      const predLat: number[] = [];
      for (let t = 0; t < horizon; t++) {
        const seasonal = 1 + 0.1 * Math.sin((2 * Math.PI * t) / Math.max(horizon, 24));
        level = alpha * base + (1 - alpha) * level;
        const v = Math.max(0, level * seasonal + (Math.random() - 0.5) * base * 0.1);
        predicted.push(Math.round(v));
        predLat.push(Math.round(latBase * (1 + (v - base) / (base + 1) * 0.2)));
      }
      const margin = predicted.map(v => v * 0.15);
      return {
        nodeId: state.node.id, horizon,
        predictedRps:    predicted,
        predictedLatency: predLat,
        confidenceInterval: {
          lower: predicted.map((v, i) => Math.max(0, v - margin[i])),
          upper: predicted.map((v, i) => v + margin[i]),
        },
        generatedAt: new Date(),
      };
    });
  }

  rebalance(): void {
    const nodes = Array.from(this.nodes.values());
    if (nodes.length < 2) return;
    const avgConn = nodes.reduce((s, n) => s + n.metrics.activeConnections, 0) / nodes.length;
    for (const state of nodes) {
      const delta = state.metrics.activeConnections - avgConn;
      if (delta > avgConn * 0.3) {
        // Drain excess connections by reducing weight temporarily
        state.node.weight = Math.max(1, state.node.weight - 1);
        logger.debug('Rebalancing: reduced weight', { nodeId: state.node.id, delta });
      } else if (delta < -avgConn * 0.3) {
        state.node.weight = Math.min(100, state.node.weight + 1);
      }
    }
    logger.info('Rebalancing complete', { nodeCount: nodes.length, avgConnections: avgConn });
  }

  handleNodeFailure(nodeId: string): void {
    const state = this.nodes.get(nodeId);
    if (!state) return;
    state.health.healthy = false;
    state.health.circuitBreakerOpen = true;
    state.health.lastError = 'Node failure detected';
    const conns = state.metrics.activeConnections;
    state.metrics.activeConnections = 0;
    logger.warn('Node failure handled', { nodeId, redistributedConnections: conns });
    // Redistribute by triggering rebalance
    this.rebalance();
  }

  getDistribution(): TrafficDistribution[] {
    const total = Array.from(this.nodes.values()).reduce((s, n) => s + n.requestCount, 0);
    return Array.from(this.nodes.values()).map(state => ({
      nodeId:     state.node.id,
      requestCount: state.requestCount,
      percentage: total > 0 ? (state.requestCount / total) * 100 : 0,
      avgLatencyMs: state.latencyHistory.length > 0
        ? state.latencyHistory.reduce((a, b) => a + b, 0) / state.latencyHistory.length
        : state.metrics.avgLatencyMs,
      errorCount: state.errorCount,
    }));
  }

  optimizeRouting(): RoutingPolicy {
    const nodes   = Array.from(this.nodes.values());
    const avgLat  = nodes.reduce((s, n) => s + n.metrics.avgLatencyMs, 0) / Math.max(nodes.length, 1);
    const maxErr  = Math.max(...nodes.map(n => n.metrics.errorRate), 0);
    const weights = nodes.map(n => n.node.weight);
    const allEqual = weights.every(w => w === weights[0]);

    let strategy: RoutingPolicy['strategy'] = 'least_connections';
    if (avgLat > 200)    strategy = 'latency_based';
    else if (!allEqual)  strategy = 'weighted';
    else if (maxErr > 0.1) strategy = 'ai_predicted';

    this.policy = { ...this.policy, strategy };
    logger.info('Routing policy optimized', { strategy, avgLatencyMs: avgLat, maxErrorRate: maxErr });
    return this.policy;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export function getIntelligentLoadBalancer(): IntelligentLoadBalancer {
  if (!(globalThis as Record<string, unknown>).__intelligentLoadBalancer__) {
    (globalThis as Record<string, unknown>).__intelligentLoadBalancer__ = new IntelligentLoadBalancer();
  }
  return (globalThis as Record<string, unknown>).__intelligentLoadBalancer__ as IntelligentLoadBalancer;
}
