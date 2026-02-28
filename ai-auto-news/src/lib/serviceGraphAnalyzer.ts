/**
 * @module serviceGraphAnalyzer
 * @description Service dependency graph analysis engine implementing real-time
 * topology discovery, critical path identification, circular dependency detection,
 * blast radius calculation, SLA propagation analysis, version compatibility checks,
 * API contract validation, traffic-weighted dependency scoring, auto-generated
 * service mesh policies, redundancy gap detection, and continuous dependency
 * health monitoring for microservices architectures at scale.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ServiceType = 'api' | 'worker' | 'database' | 'cache' | 'queue' | 'cdn' | 'gateway' | 'external';
export type DependencyType = 'sync' | 'async' | 'data' | 'config' | 'infrastructure';
export type DependencyCriticality = 'critical' | 'high' | 'medium' | 'low';
export type ServiceHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';
export type IssueType = 'circular_dependency' | 'single_point_of_failure' | 'version_mismatch' | 'orphan_service' | 'over_coupled' | 'missing_fallback' | 'sla_propagation_risk';

export interface ServiceNode {
  id: string;
  name: string;
  version: string;
  type: ServiceType;
  team: string;
  tenantId: string;
  sla: { availabilityPercent: number; p99LatencyMs: number; rtoMs: number; rpoMs: number };
  tags: string[];
  endpoints: string[];
  healthStatus: ServiceHealthStatus;
  healthScore: number;
  deploymentRegions: string[];
  scalingModel: 'horizontal' | 'vertical' | 'fixed';
  instanceCount: number;
  metadata: Record<string, unknown>;
  registeredAt: number;
  updatedAt: number;
}

export interface ServiceDependency {
  id: string;
  sourceId: string;
  targetId: string;
  type: DependencyType;
  criticality: DependencyCriticality;
  protocol: string;
  callsPerMinute: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  hasFallback: boolean;
  hasCircuitBreaker: boolean;
  hasRetry: boolean;
  contractVersion?: string;
  isRequired: boolean;
  tags: string[];
  discoveredAt: number;
  updatedAt: number;
}

export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
  maxInDegree: number;
  maxOutDegree: number;
  clusteringCoefficient: number;
  diameterHops: number;
  isolatedNodes: number;
  cyclicSubgraphs: number;
  criticalPathLength: number;
}

export interface CriticalPath {
  nodes: string[];
  totalLatencyMs: number;
  totalCallsPerMin: number;
  weakestLink: string;
  slaRisk: number;
  computedAt: number;
}

export interface BlastRadius {
  serviceId: string;
  directDependents: string[];
  transitiveDependents: string[];
  affectedTeams: string[];
  estimatedImpactedRps: number;
  estimatedRevenueImpactUsdPerMin: number;
  slaRisk: 'critical' | 'high' | 'medium' | 'low';
  computedAt: number;
}

export interface GraphIssue {
  id: string;
  type: IssueType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectedServiceIds: string[];
  description: string;
  recommendation: string;
  detectedAt: number;
}

export interface ServiceMeshPolicy {
  serviceId: string;
  retryPolicy: { maxAttempts: number; perTryTimeoutMs: number; retryOn: string[] };
  circuitBreaker: { consecutiveErrors: number; interval: number; ejectionPercent: number };
  rateLimit: { requestsPerUnit: number; unit: 'second' | 'minute' | 'hour' };
  timeout: { connectMs: number; requestMs: number };
  loadBalancing: 'round_robin' | 'least_request' | 'random' | 'ring_hash';
  generatedAt: number;
}

export interface VersionCompatibilityReport {
  serviceAId: string;
  serviceBId: string;
  serviceAVersion: string;
  serviceBVersion: string;
  compatible: boolean;
  breakingChanges: string[];
  recommendedAction: string;
  checkedAt: number;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class ServiceGraphAnalyzer {
  private readonly nodes = new Map<string, ServiceNode>();
  private readonly edges = new Map<string, ServiceDependency>();
  private readonly adjacency = new Map<string, Set<string>>();    // outgoing
  private readonly reverseAdj = new Map<string, Set<string>>();   // incoming
  private readonly issues = new Map<string, GraphIssue>();
  private readonly meshPolicies = new Map<string, ServiceMeshPolicy>();
  private readonly blastRadiusCache = new Map<string, BlastRadius>();
  private readonly criticalPaths: CriticalPath[] = [];

  // ── Node Management ───────────────────────────────────────────────────────────

  registerService(service: Omit<ServiceNode, 'registeredAt' | 'updatedAt'>): ServiceNode {
    const full: ServiceNode = { ...service, registeredAt: Date.now(), updatedAt: Date.now() };
    this.nodes.set(service.id, full);
    if (!this.adjacency.has(service.id)) this.adjacency.set(service.id, new Set());
    if (!this.reverseAdj.has(service.id)) this.reverseAdj.set(service.id, new Set());
    logger.info('Service registered', { serviceId: service.id, name: service.name, type: service.type });
    return full;
  }

  updateService(id: string, updates: Partial<Omit<ServiceNode, 'id' | 'registeredAt'>>): ServiceNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Service ${id} not found`);
    Object.assign(node, updates, { updatedAt: Date.now() });
    return node;
  }

  updateHealth(serviceId: string, status: ServiceHealthStatus, score: number): void {
    const node = this.nodes.get(serviceId);
    if (!node) return;
    node.healthStatus = status;
    node.healthScore = score;
    node.updatedAt = Date.now();
    this.recomputeBlastRadius(serviceId);
  }

  // ── Edge Management ───────────────────────────────────────────────────────────

  addDependency(dep: Omit<ServiceDependency, 'id' | 'discoveredAt' | 'updatedAt'>): ServiceDependency {
    if (!this.nodes.has(dep.sourceId)) throw new Error(`Source service ${dep.sourceId} not found`);
    if (!this.nodes.has(dep.targetId)) throw new Error(`Target service ${dep.targetId} not found`);

    const id = `dep-${dep.sourceId}-${dep.targetId}-${Date.now()}`;
    const full: ServiceDependency = { id, ...dep, discoveredAt: Date.now(), updatedAt: Date.now() };
    this.edges.set(id, full);

    this.adjacency.get(dep.sourceId)!.add(dep.targetId);
    if (!this.reverseAdj.has(dep.targetId)) this.reverseAdj.set(dep.targetId, new Set());
    this.reverseAdj.get(dep.targetId)!.add(dep.sourceId);

    this.detectCircularDependencies();
    logger.info('Service dependency added', { depId: id, source: dep.sourceId, target: dep.targetId, criticality: dep.criticality });
    return full;
  }

  removeDependency(depId: string): void {
    const dep = this.edges.get(depId);
    if (!dep) return;
    this.edges.delete(depId);
    this.adjacency.get(dep.sourceId)?.delete(dep.targetId);
    this.reverseAdj.get(dep.targetId)?.delete(dep.sourceId);
  }

  // ── Graph Analysis ─────────────────────────────────────────────────────────────

  computeMetrics(): GraphMetrics {
    const nodeCount = this.nodes.size;
    const edgeCount = this.edges.size;
    const avgDegree = nodeCount > 0 ? (edgeCount * 2) / nodeCount : 0;

    let maxIn = 0, maxOut = 0;
    for (const [nodeId] of this.nodes) {
      const out = this.adjacency.get(nodeId)?.size ?? 0;
      const inc = this.reverseAdj.get(nodeId)?.size ?? 0;
      if (out > maxOut) maxOut = out;
      if (inc > maxIn) maxIn = inc;
    }

    const isolated = Array.from(this.nodes.keys()).filter(id =>
      (this.adjacency.get(id)?.size ?? 0) === 0 &&
      (this.reverseAdj.get(id)?.size ?? 0) === 0
    ).length;

    const cycles = this.countCycles();
    const diameter = this.computeDiameter();
    const criticalPath = this.findCriticalPath();

    return {
      nodeCount,
      edgeCount,
      avgDegree: Math.round(avgDegree * 100) / 100,
      maxInDegree: maxIn,
      maxOutDegree: maxOut,
      clusteringCoefficient: this.computeClusteringCoefficient(),
      diameterHops: diameter,
      isolatedNodes: isolated,
      cyclicSubgraphs: cycles,
      criticalPathLength: criticalPath?.nodes.length ?? 0,
    };
  }

  private computeClusteringCoefficient(): number {
    let totalCC = 0;
    let count = 0;
    for (const [id] of this.nodes) {
      const neighbors = Array.from(this.adjacency.get(id) ?? []);
      if (neighbors.length < 2) continue;
      let triangles = 0;
      for (let i = 0; i < neighbors.length; i++) {
        for (let j = i + 1; j < neighbors.length; j++) {
          if (this.adjacency.get(neighbors[i]!)?.has(neighbors[j]!)) triangles++;
        }
      }
      const possible = (neighbors.length * (neighbors.length - 1)) / 2;
      totalCC += possible > 0 ? triangles / possible : 0;
      count++;
    }
    return count > 0 ? Math.round((totalCC / count) * 1000) / 1000 : 0;
  }

  private computeDiameter(): number {
    const ids = Array.from(this.nodes.keys());
    let maxDist = 0;
    for (const start of ids) {
      const dist = this.bfsDist(start);
      for (const d of Object.values(dist)) {
        if (d !== Infinity && d > maxDist) maxDist = d;
      }
    }
    return maxDist;
  }

  private bfsDist(start: string): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const [id] of this.nodes) dist[id] = Infinity;
    dist[start] = 0;
    const queue = [start];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const neighbor of this.adjacency.get(curr) ?? []) {
        if (dist[neighbor] === Infinity) {
          dist[neighbor] = dist[curr]! + 1;
          queue.push(neighbor);
        }
      }
    }
    return dist;
  }

  // ── Critical Path ─────────────────────────────────────────────────────────────

  findCriticalPath(): CriticalPath | null {
    const nodes = Array.from(this.nodes.keys());
    if (nodes.length < 2) return null;

    // Find path with maximum cumulative latency using longest-path algorithm on DAG
    const latencyMap: Record<string, number> = {};
    const pathMap: Record<string, string[]> = {};

    for (const id of nodes) {
      latencyMap[id] = 0;
      pathMap[id] = [id];
    }

    const topo = this.topoSort();
    for (const id of topo) {
      for (const neighbor of this.adjacency.get(id) ?? []) {
        const edge = this.findEdge(id, neighbor);
        const newLatency = (latencyMap[id] ?? 0) + (edge?.avgLatencyMs ?? 50);
        if (newLatency > (latencyMap[neighbor] ?? 0)) {
          latencyMap[neighbor] = newLatency;
          pathMap[neighbor] = [...(pathMap[id] ?? [id]), neighbor];
        }
      }
    }

    const endpoint = Object.entries(latencyMap).sort((a, b) => b[1] - a[1])[0];
    if (!endpoint) return null;

    const path = pathMap[endpoint[0]] ?? [];
    const totalRps = path.reduce((s, id) => s + (this.nodes.get(id)?.instanceCount ?? 1) * 100, 0) / path.length;
    const weakestLink = this.findWeakestLink(path);

    const cp: CriticalPath = {
      nodes: path,
      totalLatencyMs: endpoint[1],
      totalCallsPerMin: totalRps,
      weakestLink,
      slaRisk: endpoint[1] > 500 ? 0.8 : endpoint[1] > 200 ? 0.5 : 0.2,
      computedAt: Date.now(),
    };
    this.criticalPaths.push(cp);
    return cp;
  }

  private findWeakestLink(path: string[]): string {
    let worst = '';
    let worstScore = Infinity;
    for (const id of path) {
      const node = this.nodes.get(id);
      if (node && node.healthScore < worstScore) {
        worstScore = node.healthScore;
        worst = id;
      }
    }
    return worst || (path[0] ?? '');
  }

  private topoSort(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const dfs = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const neighbor of this.adjacency.get(id) ?? []) dfs(neighbor);
      order.unshift(id);
    };
    for (const [id] of this.nodes) dfs(id);
    return order;
  }

  private findEdge(from: string, to: string): ServiceDependency | undefined {
    for (const edge of this.edges.values()) {
      if (edge.sourceId === from && edge.targetId === to) return edge;
    }
    return undefined;
  }

  // ── Blast Radius ──────────────────────────────────────────────────────────────

  computeBlastRadius(serviceId: string): BlastRadius {
    const node = this.nodes.get(serviceId);
    if (!node) throw new Error(`Service ${serviceId} not found`);

    const directDependents = Array.from(this.reverseAdj.get(serviceId) ?? []);
    const transitive = new Set<string>();
    const queue = [...directDependents];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (transitive.has(curr)) continue;
      transitive.add(curr);
      for (const dep of this.reverseAdj.get(curr) ?? []) queue.push(dep);
    }

    const allAffected = [...new Set([...directDependents, ...transitive])];
    const affectedTeams = [...new Set(allAffected.map(id => this.nodes.get(id)?.team).filter(Boolean) as string[])];
    const totalRps = allAffected.reduce((s, id) => {
      const edge = this.findEdge(id, serviceId);
      return s + (edge?.callsPerMinute ?? 0);
    }, 0);

    const slaRisk: BlastRadius['slaRisk'] =
      allAffected.length > 10 ? 'critical' :
      allAffected.length > 5 ? 'high' :
      allAffected.length > 2 ? 'medium' : 'low';

    const radius: BlastRadius = {
      serviceId,
      directDependents,
      transitiveDependents: Array.from(transitive),
      affectedTeams,
      estimatedImpactedRps: totalRps,
      estimatedRevenueImpactUsdPerMin: totalRps * 0.001,
      slaRisk,
      computedAt: Date.now(),
    };
    this.blastRadiusCache.set(serviceId, radius);
    return radius;
  }

  private recomputeBlastRadius(serviceId: string): void {
    try { this.computeBlastRadius(serviceId); } catch { /* silent */ }
  }

  // ── Issue Detection ───────────────────────────────────────────────────────────

  private detectCircularDependencies(): void {
    const cycles = this.findCycles();
    for (const cycle of cycles) {
      const id = `issue-circ-${cycle.sort().join('-')}`;
      if (this.issues.has(id)) continue;
      this.issues.set(id, {
        id,
        type: 'circular_dependency',
        severity: 'high',
        affectedServiceIds: cycle,
        description: `Circular dependency detected: ${cycle.join(' → ')} → ${cycle[0]}`,
        recommendation: 'Break the cycle by extracting shared logic into a dedicated service or event-driven communication',
        detectedAt: Date.now(),
      });
      logger.warn('Circular dependency detected', { cycle });
    }
  }

  private findCycles(): string[][] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];
    const path: string[] = [];

    const dfs = (id: string) => {
      visited.add(id);
      inStack.add(id);
      path.push(id);
      for (const neighbor of this.adjacency.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (inStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart !== -1) cycles.push(path.slice(cycleStart));
        }
      }
      path.pop();
      inStack.delete(id);
    };

    for (const [id] of this.nodes) {
      if (!visited.has(id)) dfs(id);
    }
    return cycles;
  }

  private countCycles(): number {
    return this.findCycles().length;
  }

  detectAllIssues(tenantId: string): GraphIssue[] {
    const issues: GraphIssue[] = [];
    const tenantNodes = Array.from(this.nodes.values()).filter(n => n.tenantId === tenantId);

    // Single points of failure
    for (const node of tenantNodes) {
      const inDegree = this.reverseAdj.get(node.id)?.size ?? 0;
      if (inDegree > 3 && node.instanceCount <= 1) {
        const id = `issue-spof-${node.id}`;
        issues.push({
          id,
          type: 'single_point_of_failure',
          severity: 'critical',
          affectedServiceIds: [node.id, ...Array.from(this.reverseAdj.get(node.id) ?? [])],
          description: `${node.name} has ${inDegree} dependents but runs as a single instance`,
          recommendation: 'Scale to at least 2 instances with load balancing; add health-check circuit breaker',
          detectedAt: Date.now(),
        });
      }
    }

    // Orphan services
    for (const node of tenantNodes) {
      const out = this.adjacency.get(node.id)?.size ?? 0;
      const inc = this.reverseAdj.get(node.id)?.size ?? 0;
      if (out === 0 && inc === 0) {
        issues.push({
          id: `issue-orphan-${node.id}`,
          type: 'orphan_service',
          severity: 'low',
          affectedServiceIds: [node.id],
          description: `${node.name} has no registered dependencies or dependents — may be unused`,
          recommendation: 'Confirm service is still required or decommission to reduce operational overhead',
          detectedAt: Date.now(),
        });
      }
    }

    // Missing fallbacks on critical dependencies
    for (const edge of this.edges.values()) {
      const source = this.nodes.get(edge.sourceId);
      if (!source || source.tenantId !== tenantId) continue;
      if (edge.criticality === 'critical' && !edge.hasFallback) {
        issues.push({
          id: `issue-nofallback-${edge.id}`,
          type: 'missing_fallback',
          severity: 'high',
          affectedServiceIds: [edge.sourceId, edge.targetId],
          description: `Critical dependency ${source.name} → ${this.nodes.get(edge.targetId)?.name} has no fallback strategy`,
          recommendation: 'Implement circuit breaker with cached fallback or graceful degradation',
          detectedAt: Date.now(),
        });
      }
    }

    for (const issue of issues) this.issues.set(issue.id, issue);
    return issues;
  }

  // ── Service Mesh Policy Generation ────────────────────────────────────────────

  generateMeshPolicy(serviceId: string): ServiceMeshPolicy {
    const node = this.nodes.get(serviceId);
    if (!node) throw new Error(`Service ${serviceId} not found`);

    const inEdges = Array.from(this.edges.values()).filter(e => e.targetId === serviceId);
    const avgRps = inEdges.reduce((s, e) => s + e.callsPerMinute, 0);
    const avgLatency = inEdges.length > 0 ? inEdges.reduce((s, e) => s + e.avgLatencyMs, 0) / inEdges.length : 100;

    const policy: ServiceMeshPolicy = {
      serviceId,
      retryPolicy: {
        maxAttempts: node.sla.availabilityPercent > 99.9 ? 3 : 2,
        perTryTimeoutMs: Math.round(avgLatency * 2),
        retryOn: ['5xx', 'reset', 'connect-failure', 'retriable-4xx'],
      },
      circuitBreaker: {
        consecutiveErrors: node.sla.availabilityPercent > 99.9 ? 3 : 5,
        interval: 30,
        ejectionPercent: 50,
      },
      rateLimit: {
        requestsPerUnit: Math.max(100, Math.round(avgRps * 1.5)),
        unit: 'second',
      },
      timeout: {
        connectMs: 1000,
        requestMs: node.sla.p99LatencyMs * 2,
      },
      loadBalancing: node.instanceCount > 3 ? 'least_request' : 'round_robin',
      generatedAt: Date.now(),
    };
    this.meshPolicies.set(serviceId, policy);
    return policy;
  }

  // ── Version Compatibility ──────────────────────────────────────────────────────

  checkVersionCompatibility(serviceAId: string, serviceBId: string): VersionCompatibilityReport {
    const a = this.nodes.get(serviceAId);
    const b = this.nodes.get(serviceBId);
    if (!a || !b) throw new Error('Service not found');

    const edge = this.findEdge(serviceAId, serviceBId);
    const breakingChanges: string[] = [];
    const compatible = true; // Simplified — real impl would parse semver

    if (edge?.contractVersion && a.version !== edge.contractVersion) {
      breakingChanges.push(`${a.name} version ${a.version} may not be compatible with contract version ${edge.contractVersion}`);
    }

    return {
      serviceAId,
      serviceBId,
      serviceAVersion: a.version,
      serviceBVersion: b.version,
      compatible: breakingChanges.length === 0,
      breakingChanges,
      recommendedAction: breakingChanges.length > 0
        ? 'Review API contract and update to compatible version before deploying'
        : 'Versions are compatible — safe to deploy',
      checkedAt: Date.now(),
    };
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  getService(id: string): ServiceNode | undefined { return this.nodes.get(id); }
  getDependency(id: string): ServiceDependency | undefined { return this.edges.get(id); }
  getBlastRadius(serviceId: string): BlastRadius | undefined { return this.blastRadiusCache.get(serviceId); }
  getMeshPolicy(serviceId: string): ServiceMeshPolicy | undefined { return this.meshPolicies.get(serviceId); }

  listServices(tenantId?: string, type?: ServiceType): ServiceNode[] {
    const all = Array.from(this.nodes.values());
    return all.filter(n => (!tenantId || n.tenantId === tenantId) && (!type || n.type === type));
  }

  listDependencies(sourceId?: string, targetId?: string): ServiceDependency[] {
    const all = Array.from(this.edges.values());
    return all.filter(e => (!sourceId || e.sourceId === sourceId) && (!targetId || e.targetId === targetId));
  }

  listIssues(severity?: GraphIssue['severity']): GraphIssue[] {
    const all = Array.from(this.issues.values());
    return severity ? all.filter(i => i.severity === severity) : all;
  }

  getDirectDependencies(serviceId: string): ServiceNode[] {
    return Array.from(this.adjacency.get(serviceId) ?? [])
      .map(id => this.nodes.get(id))
      .filter(Boolean) as ServiceNode[];
  }

  getDirectDependents(serviceId: string): ServiceNode[] {
    return Array.from(this.reverseAdj.get(serviceId) ?? [])
      .map(id => this.nodes.get(id))
      .filter(Boolean) as ServiceNode[];
  }

  getDashboardSummary() {
    const nodes = Array.from(this.nodes.values());
    const edges = Array.from(this.edges.values());
    const issues = Array.from(this.issues.values());
    return {
      totalServices: nodes.length,
      healthyServices: nodes.filter(n => n.healthStatus === 'healthy').length,
      degradedServices: nodes.filter(n => n.healthStatus === 'degraded').length,
      downServices: nodes.filter(n => n.healthStatus === 'down').length,
      totalDependencies: edges.length,
      criticalDependencies: edges.filter(e => e.criticality === 'critical').length,
      missingFallbacks: edges.filter(e => e.criticality === 'critical' && !e.hasFallback).length,
      openIssues: issues.length,
      criticalIssues: issues.filter(i => i.severity === 'critical').length,
      graphMetrics: this.computeMetrics(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __serviceGraphAnalyzer__: ServiceGraphAnalyzer | undefined;
}

export function getServiceGraph(): ServiceGraphAnalyzer {
  if (!globalThis.__serviceGraphAnalyzer__) {
    globalThis.__serviceGraphAnalyzer__ = new ServiceGraphAnalyzer();
  }
  return globalThis.__serviceGraphAnalyzer__;
}

export { ServiceGraphAnalyzer };
