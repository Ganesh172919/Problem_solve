/**
 * @module intelligentQueryRouter
 * @description Intelligent database query routing engine with read/write splitting,
 * replica selection, query classification, cost-based optimizer integration,
 * and adaptive load balancing across database shards and replicas.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueryType = 'read' | 'write' | 'analytics' | 'schema' | 'transaction';
export type DatabaseRole = 'primary' | 'replica' | 'analytics' | 'archive';
export type RoutingStrategy = 'least_connections' | 'round_robin' | 'weighted' | 'latency_aware' | 'cost_aware';

export interface DatabaseNode {
  id: string;
  host: string;
  port: number;
  role: DatabaseRole;
  region: string;
  weight: number;
  maxConnections: number;
  currentConnections: number;
  avgLatencyMs: number;
  lastHealthCheck: number;
  healthy: boolean;
  readOnly: boolean;
  tags: string[];
}

export interface QueryContext {
  sql: string;
  tenantId: string;
  userId?: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  maxLatencyMs: number;
  requiresStrongConsistency: boolean;
  estimatedRows?: number;
  timeout?: number;
}

export interface RoutingDecision {
  nodeId: string;
  queryType: QueryType;
  strategy: RoutingStrategy;
  reason: string;
  estimatedLatencyMs: number;
  fallbackNodeIds: string[];
}

export interface QueryMetrics {
  totalQueries: number;
  readQueries: number;
  writeQueries: number;
  analyticsQueries: number;
  routingDecisions: Map<string, number>; // nodeId -> count
  avgLatencyByType: Map<QueryType, number>;
  cacheHitRate: number;
  replicationLag: Map<string, number>; // nodeId -> lag ms
}

export interface QueryPlan {
  queryId: string;
  sql: string;
  estimatedCost: number;
  estimatedRows: number;
  indexesUsed: string[];
  queryType: QueryType;
  cacheable: boolean;
  cacheKey: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'analytical';
}

// ── SQL Classifier ────────────────────────────────────────────────────────────

function classifyQuery(sql: string): QueryType {
  const normalized = sql.trim().toUpperCase();
  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) {
    if (/\b(GROUP BY|HAVING|WINDOW|ROLLUP|CUBE|GROUPING SETS)\b/.test(normalized)) {
      return 'analytics';
    }
    return 'read';
  }
  if (/^(INSERT|UPDATE|DELETE|MERGE|UPSERT)/.test(normalized)) return 'write';
  if (/^(CREATE|ALTER|DROP|TRUNCATE|RENAME)/.test(normalized)) return 'schema';
  if (/^(BEGIN|START TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)/.test(normalized)) return 'transaction';
  return 'read';
}

function estimateComplexity(sql: string): QueryPlan['complexity'] {
  const normalized = sql.toUpperCase();
  const joins = (normalized.match(/\bJOIN\b/g) ?? []).length;
  const subqueries = (normalized.match(/\(SELECT/g) ?? []).length;
  const aggregates = (normalized.match(/\b(COUNT|SUM|AVG|MAX|MIN|STDDEV)\s*\(/g) ?? []).length;

  const score = joins * 2 + subqueries * 3 + aggregates;
  if (score === 0) return 'simple';
  if (score <= 3) return 'moderate';
  if (score <= 8) return 'complex';
  return 'analytical';
}

function buildCacheKey(sql: string, tenantId: string): string {
  // Normalize whitespace and parameterize literals for cache key
  const normalized = sql.replace(/\s+/g, ' ').trim()
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+\b/g, '?');
  return `q:${tenantId}:${normalized.slice(0, 200)}`;
}

// ── Core Engine ───────────────────────────────────────────────────────────────

export class IntelligentQueryRouter {
  private nodes = new Map<string, DatabaseNode>();
  private rrCounters = new Map<DatabaseRole, number>();
  private latencyHistory = new Map<string, number[]>();
  private queryCount = new Map<string, number>();
  private metrics: QueryMetrics = {
    totalQueries: 0,
    readQueries: 0,
    writeQueries: 0,
    analyticsQueries: 0,
    routingDecisions: new Map(),
    avgLatencyByType: new Map(),
    cacheHitRate: 0,
    replicationLag: new Map(),
  };
  private latencyAccum = new Map<QueryType, number[]>();
  private cacheHits = 0;
  private cacheMisses = 0;

  registerNode(node: DatabaseNode): void {
    this.nodes.set(node.id, node);
    logger.info('Database node registered', { id: node.id, role: node.role, region: node.region });
  }

  deregisterNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    logger.info('Database node deregistered', { nodeId });
  }

  markNodeHealth(nodeId: string, healthy: boolean): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.healthy = healthy;
      node.lastHealthCheck = Date.now();
    }
  }

  recordReplicationLag(nodeId: string, lagMs: number): void {
    this.metrics.replicationLag.set(nodeId, lagMs);
  }

  planQuery(context: QueryContext): QueryPlan {
    const queryType = classifyQuery(context.sql);
    const complexity = estimateComplexity(context.sql);
    const cacheable = queryType === 'read' && complexity !== 'analytical';
    const cacheKey = buildCacheKey(context.sql, context.tenantId);
    const estimatedRows = context.estimatedRows ?? (complexity === 'simple' ? 10 : complexity === 'moderate' ? 100 : 10000);
    const estimatedCost = estimatedRows * (complexity === 'simple' ? 1 : complexity === 'moderate' ? 5 : 20);

    return {
      queryId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sql: context.sql,
      estimatedCost,
      estimatedRows,
      indexesUsed: [],
      queryType,
      cacheable,
      cacheKey,
      complexity,
    };
  }

  route(context: QueryContext, strategy: RoutingStrategy = 'latency_aware'): RoutingDecision {
    const queryType = classifyQuery(context.sql);
    this.metrics.totalQueries++;

    if (queryType === 'read' || queryType === 'analytics') this.metrics.readQueries++;
    else if (queryType === 'write') this.metrics.writeQueries++;
    if (queryType === 'analytics') this.metrics.analyticsQueries++;

    const targetRole = this.selectRole(queryType, context);
    const eligibleNodes = Array.from(this.nodes.values()).filter(n =>
      n.healthy &&
      n.role === targetRole &&
      n.currentConnections < n.maxConnections
    );

    if (eligibleNodes.length === 0) {
      // Fallback to primary
      const primary = Array.from(this.nodes.values()).find(n => n.role === 'primary' && n.healthy);
      if (!primary) throw new Error('No healthy database nodes available');
      return this.buildDecision(primary, queryType, strategy, 'fallback to primary - no eligible nodes', []);
    }

    let selected: DatabaseNode;
    switch (strategy) {
      case 'round_robin':
        selected = this.roundRobin(eligibleNodes, targetRole);
        break;
      case 'weighted':
        selected = this.weightedSelect(eligibleNodes);
        break;
      case 'least_connections':
        selected = eligibleNodes.reduce((a, b) => a.currentConnections < b.currentConnections ? a : b);
        break;
      case 'latency_aware':
        selected = this.latencyAwareSelect(eligibleNodes);
        break;
      case 'cost_aware':
        selected = this.costAwareSelect(eligibleNodes, context);
        break;
      default:
        selected = eligibleNodes[0]!;
    }

    const fallbacks = eligibleNodes
      .filter(n => n.id !== selected.id)
      .slice(0, 2)
      .map(n => n.id);

    const decision = this.buildDecision(selected, queryType, strategy, `selected via ${strategy}`, fallbacks);

    // Update metrics
    const count = this.metrics.routingDecisions.get(selected.id) ?? 0;
    this.metrics.routingDecisions.set(selected.id, count + 1);

    logger.debug('Query routed', {
      nodeId: selected.id,
      queryType,
      strategy,
      tenantId: context.tenantId,
    });

    return decision;
  }

  recordQueryExecution(nodeId: string, queryType: QueryType, latencyMs: number, cacheHit: boolean): void {
    // Update node latency
    const node = this.nodes.get(nodeId);
    if (node) {
      const history = this.latencyHistory.get(nodeId) ?? [];
      history.push(latencyMs);
      if (history.length > 100) history.shift();
      this.latencyHistory.set(nodeId, history);
      node.avgLatencyMs = history.reduce((s, v) => s + v, 0) / history.length;
    }

    // Update latency by type
    const typeHistory = this.latencyAccum.get(queryType) ?? [];
    typeHistory.push(latencyMs);
    if (typeHistory.length > 500) typeHistory.shift();
    this.latencyAccum.set(queryType, typeHistory);
    this.metrics.avgLatencyByType.set(
      queryType,
      typeHistory.reduce((s, v) => s + v, 0) / typeHistory.length
    );

    if (cacheHit) this.cacheHits++;
    else this.cacheMisses++;
    const total = this.cacheHits + this.cacheMisses;
    this.metrics.cacheHitRate = total > 0 ? this.cacheHits / total : 0;
  }

  private selectRole(queryType: QueryType, context: QueryContext): DatabaseRole {
    if (queryType === 'write' || queryType === 'schema' || queryType === 'transaction') return 'primary';
    if (queryType === 'analytics') {
      const hasAnalytics = Array.from(this.nodes.values()).some(n => n.role === 'analytics' && n.healthy);
      if (hasAnalytics) return 'analytics';
    }
    if (context.requiresStrongConsistency) return 'primary';
    return 'replica';
  }

  private roundRobin(nodes: DatabaseNode[], role: DatabaseRole): DatabaseNode {
    const counter = this.rrCounters.get(role) ?? 0;
    const selected = nodes[counter % nodes.length]!;
    this.rrCounters.set(role, counter + 1);
    return selected;
  }

  private weightedSelect(nodes: DatabaseNode[]): DatabaseNode {
    const totalWeight = nodes.reduce((s, n) => s + n.weight, 0);
    let random = Math.random() * totalWeight;
    for (const node of nodes) {
      random -= node.weight;
      if (random <= 0) return node;
    }
    return nodes[nodes.length - 1]!;
  }

  private latencyAwareSelect(nodes: DatabaseNode[]): DatabaseNode {
    return nodes.reduce((best, node) => {
      const bestLatency = this.latencyHistory.get(best.id)?.[0] ?? best.avgLatencyMs;
      const nodeLatency = this.latencyHistory.get(node.id)?.[0] ?? node.avgLatencyMs;
      return nodeLatency < bestLatency ? node : best;
    });
  }

  private costAwareSelect(nodes: DatabaseNode[], context: QueryContext): DatabaseNode {
    // Score = latency * (connections/maxConnections) - prefer low latency, low load
    return nodes.reduce((best, node) => {
      const loadScore = node.currentConnections / node.maxConnections;
      const latencyScore = node.avgLatencyMs / (context.maxLatencyMs || 1000);
      const nodeScore = loadScore * 0.4 + latencyScore * 0.6;

      const bestLoad = best.currentConnections / best.maxConnections;
      const bestLatency = best.avgLatencyMs / (context.maxLatencyMs || 1000);
      const bestScore = bestLoad * 0.4 + bestLatency * 0.6;

      return nodeScore < bestScore ? node : best;
    });
  }

  private buildDecision(
    node: DatabaseNode,
    queryType: QueryType,
    strategy: RoutingStrategy,
    reason: string,
    fallbacks: string[]
  ): RoutingDecision {
    return {
      nodeId: node.id,
      queryType,
      strategy,
      reason,
      estimatedLatencyMs: node.avgLatencyMs,
      fallbackNodeIds: fallbacks,
    };
  }

  getMetrics(): QueryMetrics {
    return { ...this.metrics };
  }

  getNodes(): DatabaseNode[] {
    return Array.from(this.nodes.values());
  }

  getHealthyNodes(role?: DatabaseRole): DatabaseNode[] {
    return Array.from(this.nodes.values()).filter(n =>
      n.healthy && (role === undefined || n.role === role)
    );
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
   
  var __intelligentQueryRouter__: IntelligentQueryRouter | undefined;
}

export function getQueryRouter(): IntelligentQueryRouter {
  if (!globalThis.__intelligentQueryRouter__) {
    globalThis.__intelligentQueryRouter__ = new IntelligentQueryRouter();
  }
  return globalThis.__intelligentQueryRouter__;
}
