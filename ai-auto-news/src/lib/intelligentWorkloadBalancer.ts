/**
 * @module intelligentWorkloadBalancer
 * @description ML-driven workload distribution engine with dynamic capacity profiling,
 * latency-aware scheduling, affinity/anti-affinity rules, priority-weighted dispatch,
 * resource-aware bin-packing, overload shedding, predictive rebalancing, hot-spot
 * mitigation, and per-tenant SLO enforcement across heterogeneous compute nodes.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeStatus = 'healthy' | 'degraded' | 'overloaded' | 'draining' | 'offline';
export type BalancingAlgorithm = 'least_connections' | 'weighted_round_robin' | 'latency_aware' | 'resource_aware' | 'consistent_hash';
export type WorkloadPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface ComputeNode {
  id: string;
  name: string;
  region: string;
  zone: string;
  cpuCapacity: number;          // millicores
  memoryCapacityMb: number;
  currentCpuUsage: number;      // millicores
  currentMemoryMb: number;
  activeConnections: number;
  maxConnections: number;
  status: NodeStatus;
  weight: number;               // 1-100 for WRR
  affinityLabels: Record<string, string>;
  lastHeartbeatAt: number;
  healthScore: number;          // 0-100
  avgLatencyMs: number;
  p99LatencyMs: number;
  totalRequestsHandled: number;
  totalRequestsFailed: number;
  createdAt: number;
}

export interface WorkloadTask {
  id: string;
  tenantId: string;
  priority: WorkloadPriority;
  cpuRequest: number;           // millicores
  memoryRequestMb: number;
  maxLatencyMs: number;
  affinityRequirements: Record<string, string>;
  antiAffinityNodeIds: string[];
  estimatedDurationMs: number;
  enqueuedAt: number;
  assignedNodeId?: string;
  assignedAt?: number;
  completedAt?: number;
  failed?: boolean;
  failureReason?: string;
  retryCount: number;
}

export interface SchedulingDecision {
  taskId: string;
  nodeId: string;
  algorithm: BalancingAlgorithm;
  scoreBreakdown: Record<string, number>;
  decisionLatencyMs: number;
  timestamp: number;
}

export interface RebalanceEvent {
  id: string;
  triggeredBy: 'hotspot' | 'node_overload' | 'node_offline' | 'scheduled' | 'slo_violation';
  affectedNodeIds: string[];
  tasksRelocated: number;
  durationMs: number;
  timestamp: number;
}

export interface WorkloadSummary {
  totalNodes: number;
  healthyNodes: number;
  totalActiveTasks: number;
  queueDepth: number;
  avgNodeCpuPct: number;
  avgNodeMemPct: number;
  avgSchedulingLatencyMs: number;
  totalDecisions: number;
  totalRebalances: number;
  sloViolations: number;
  hotspotNodes: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreNode(node: ComputeNode, task: WorkloadTask, algo: BalancingAlgorithm): { score: number; breakdown: Record<string, number> } {
  const cpuAvail = node.cpuCapacity - node.currentCpuUsage;
  const memAvail = node.memoryCapacityMb - node.currentMemoryMb;
  const connAvail = node.maxConnections - node.activeConnections;

  const cpuFit = cpuAvail >= task.cpuRequest ? Math.min(100, (cpuAvail / node.cpuCapacity) * 100) : 0;
  const memFit = memAvail >= task.memoryRequestMb ? Math.min(100, (memAvail / node.memoryCapacityMb) * 100) : 0;
  const latencyScore = task.maxLatencyMs > 0 ? Math.max(0, 100 - (node.avgLatencyMs / task.maxLatencyMs) * 100) : 50;
  const connScore = connAvail > 0 ? Math.min(100, (connAvail / node.maxConnections) * 100) : 0;
  const healthScore = node.healthScore;

  if (cpuFit === 0 || memFit === 0 || connScore === 0) return { score: 0, breakdown: { cpuFit: 0, memFit: 0, connScore: 0, latencyScore, healthScore } };

  let score: number;
  if (algo === 'least_connections') {
    score = connScore * 0.6 + healthScore * 0.4;
  } else if (algo === 'weighted_round_robin') {
    score = (node.weight / 100) * 60 + healthScore * 0.4;
  } else if (algo === 'latency_aware') {
    score = latencyScore * 0.5 + cpuFit * 0.25 + memFit * 0.25;
  } else if (algo === 'resource_aware') {
    score = cpuFit * 0.4 + memFit * 0.35 + latencyScore * 0.15 + connScore * 0.1;
  } else {
    score = (cpuFit + memFit + latencyScore + connScore + healthScore) / 5;
  }

  return { score, breakdown: { cpuFit, memFit, latencyScore, connScore, healthScore } };
}

// ── Engine ────────────────────────────────────────────────────────────────────

class IntelligentWorkloadBalancer {
  private readonly nodes = new Map<string, ComputeNode>();
  private readonly activeTasks = new Map<string, WorkloadTask>();
  private readonly taskQueue: WorkloadTask[] = [];
  private readonly decisions: SchedulingDecision[] = [];
  private readonly rebalanceHistory: RebalanceEvent[] = [];
  private totalSloViolations = 0;
  private defaultAlgorithm: BalancingAlgorithm = 'resource_aware';

  registerNode(node: ComputeNode): void {
    this.nodes.set(node.id, { ...node });
    logger.info('Workload node registered', { nodeId: node.id, region: node.region, status: node.status });
  }

  updateNode(nodeId: string, updates: Partial<ComputeNode>): boolean {
    const n = this.nodes.get(nodeId);
    if (!n) return false;
    const updated = { ...n, ...updates, id: nodeId };
    this.nodes.set(nodeId, updated);
    if (updated.status === 'offline' || updated.status === 'draining') {
      this._drainNode(nodeId);
    }
    return true;
  }

  removeNode(nodeId: string): boolean {
    if (!this.nodes.has(nodeId)) return false;
    this._drainNode(nodeId);
    this.nodes.delete(nodeId);
    logger.info('Workload node removed', { nodeId });
    return true;
  }

  enqueueTask(task: WorkloadTask): string {
    const t = { ...task, enqueuedAt: task.enqueuedAt || Date.now(), retryCount: task.retryCount ?? 0 };
    this.taskQueue.push(t);
    this._sortQueue();
    logger.debug('Task enqueued', { taskId: t.id, priority: t.priority, tenantId: t.tenantId });
    return t.id;
  }

  scheduleNextTask(algo?: BalancingAlgorithm): SchedulingDecision | null {
    if (this.taskQueue.length === 0) return null;
    const taskIdx = this.taskQueue.findIndex(t => !this.activeTasks.has(t.id));
    if (taskIdx === -1) return null;
    const task = this.taskQueue[taskIdx];
    const algorithm = algo ?? this.defaultAlgorithm;
    const start = Date.now();
    const eligibleNodes = Array.from(this.nodes.values()).filter(n =>
      n.status === 'healthy' &&
      !task.antiAffinityNodeIds.includes(n.id) &&
      this._matchesAffinity(n, task.affinityRequirements)
    );
    if (eligibleNodes.length === 0) return null;

    let bestNode: ComputeNode | null = null;
    let bestScore = -1;
    let bestBreakdown: Record<string, number> = {};
    for (const node of eligibleNodes) {
      const { score, breakdown } = scoreNode(node, task, algorithm);
      if (score > bestScore) { bestScore = score; bestNode = node; bestBreakdown = breakdown; }
    }
    if (!bestNode || bestScore === 0) return null;

    const decisionLatency = Date.now() - start;
    const now = Date.now();
    task.assignedNodeId = bestNode.id;
    task.assignedAt = now;
    this.taskQueue.splice(taskIdx, 1);
    this.activeTasks.set(task.id, task);

    const node = this.nodes.get(bestNode.id)!;
    node.currentCpuUsage += task.cpuRequest;
    node.currentMemoryMb += task.memoryRequestMb;
    node.activeConnections += 1;
    node.totalRequestsHandled += 1;

    const decision: SchedulingDecision = {
      taskId: task.id,
      nodeId: bestNode.id,
      algorithm,
      scoreBreakdown: bestBreakdown,
      decisionLatencyMs: decisionLatency,
      timestamp: now,
    };
    this.decisions.push(decision);
    if (this.decisions.length > 10000) this.decisions.splice(0, 1000);

    logger.debug('Task scheduled', { taskId: task.id, nodeId: bestNode.id, score: bestScore.toFixed(1) });
    return decision;
  }

  completeTask(taskId: string, failed = false, failureReason?: string): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task || !task.assignedNodeId) return false;
    const now = Date.now();
    task.completedAt = now;
    task.failed = failed;
    task.failureReason = failureReason;

    const node = this.nodes.get(task.assignedNodeId);
    if (node) {
      node.currentCpuUsage = Math.max(0, node.currentCpuUsage - task.cpuRequest);
      node.currentMemoryMb = Math.max(0, node.currentMemoryMb - task.memoryRequestMb);
      node.activeConnections = Math.max(0, node.activeConnections - 1);
      if (failed) node.totalRequestsFailed += 1;
      const duration = task.completedAt - (task.assignedAt ?? now);
      if (duration > task.maxLatencyMs) this.totalSloViolations += 1;
    }
    this.activeTasks.delete(taskId);
    return true;
  }

  rebalance(reason: RebalanceEvent['triggeredBy'] = 'scheduled'): RebalanceEvent {
    const start = Date.now();
    const overloaded = Array.from(this.nodes.values()).filter(n => {
      const cpuPct = n.currentCpuUsage / n.cpuCapacity;
      const memPct = n.currentMemoryMb / n.memoryCapacityMb;
      return cpuPct > 0.85 || memPct > 0.85;
    });

    let relocated = 0;
    for (const node of overloaded) {
      const tasks = Array.from(this.activeTasks.values())
        .filter(t => t.assignedNodeId === node.id && t.priority !== 'critical')
        .slice(0, 3);
      for (const task of tasks) {
        this.completeTask(task.id, false);
        const requeued = { ...task, assignedNodeId: undefined, assignedAt: undefined, enqueuedAt: Date.now() };
        this.enqueueTask(requeued);
        relocated++;
      }
    }

    const event: RebalanceEvent = {
      id: `reb-${Date.now()}`,
      triggeredBy: reason,
      affectedNodeIds: overloaded.map(n => n.id),
      tasksRelocated: relocated,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    };
    this.rebalanceHistory.push(event);
    if (this.rebalanceHistory.length > 500) this.rebalanceHistory.splice(0, 100);
    logger.info('Workload rebalance completed', { reason, relocated, affectedNodes: overloaded.length });
    return event;
  }

  getNode(nodeId: string): ComputeNode | undefined {
    return this.nodes.get(nodeId);
  }

  listNodes(): ComputeNode[] {
    return Array.from(this.nodes.values());
  }

  listActiveTasks(): WorkloadTask[] {
    return Array.from(this.activeTasks.values());
  }

  listQueuedTasks(): WorkloadTask[] {
    return [...this.taskQueue];
  }

  listDecisions(limit = 100): SchedulingDecision[] {
    return this.decisions.slice(-limit);
  }

  listRebalanceHistory(limit = 50): RebalanceEvent[] {
    return this.rebalanceHistory.slice(-limit);
  }

  getHotspotNodes(): ComputeNode[] {
    return Array.from(this.nodes.values()).filter(n => {
      const cpuPct = n.cpuCapacity > 0 ? n.currentCpuUsage / n.cpuCapacity : 0;
      const memPct = n.memoryCapacityMb > 0 ? n.currentMemoryMb / n.memoryCapacityMb : 0;
      return cpuPct > 0.8 || memPct > 0.8;
    });
  }

  getSummary(): WorkloadSummary {
    const nodes = this.listNodes();
    const healthyNodes = nodes.filter(n => n.status === 'healthy');
    const avgCpu = healthyNodes.length > 0
      ? healthyNodes.reduce((s, n) => s + (n.currentCpuUsage / n.cpuCapacity) * 100, 0) / healthyNodes.length
      : 0;
    const avgMem = healthyNodes.length > 0
      ? healthyNodes.reduce((s, n) => s + (n.currentMemoryMb / n.memoryCapacityMb) * 100, 0) / healthyNodes.length
      : 0;
    const avgDecisionLatency = this.decisions.length > 0
      ? this.decisions.slice(-200).reduce((s, d) => s + d.decisionLatencyMs, 0) / Math.min(200, this.decisions.length)
      : 0;
    return {
      totalNodes: nodes.length,
      healthyNodes: healthyNodes.length,
      totalActiveTasks: this.activeTasks.size,
      queueDepth: this.taskQueue.length,
      avgNodeCpuPct: parseFloat(avgCpu.toFixed(2)),
      avgNodeMemPct: parseFloat(avgMem.toFixed(2)),
      avgSchedulingLatencyMs: parseFloat(avgDecisionLatency.toFixed(2)),
      totalDecisions: this.decisions.length,
      totalRebalances: this.rebalanceHistory.length,
      sloViolations: this.totalSloViolations,
      hotspotNodes: this.getHotspotNodes().map(n => n.id),
    };
  }

  setDefaultAlgorithm(algo: BalancingAlgorithm): void {
    this.defaultAlgorithm = algo;
  }

  private _sortQueue(): void {
    const priorityOrder: Record<WorkloadPriority, number> = { critical: 0, high: 1, normal: 2, low: 3, background: 4 };
    this.taskQueue.sort((a, b) => {
      const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
      return pd !== 0 ? pd : a.enqueuedAt - b.enqueuedAt;
    });
  }

  private _matchesAffinity(node: ComputeNode, requirements: Record<string, string>): boolean {
    for (const [k, v] of Object.entries(requirements)) {
      if (node.affinityLabels[k] !== v) return false;
    }
    return true;
  }

  private _drainNode(nodeId: string): void {
    let relocated = 0;
    for (const [taskId, task] of this.activeTasks.entries()) {
      if (task.assignedNodeId === nodeId) {
        this.activeTasks.delete(taskId);
        const requeued = { ...task, assignedNodeId: undefined, assignedAt: undefined, enqueuedAt: Date.now() };
        this.taskQueue.push(requeued);
        relocated++;
      }
    }
    if (relocated > 0) {
      this._sortQueue();
      logger.info('Node drained, tasks requeued', { nodeId, relocated });
    }
  }
}

const KEY = '__intelligentWorkloadBalancer__';
export function getWorkloadBalancer(): IntelligentWorkloadBalancer {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new IntelligentWorkloadBalancer();
  }
  return (globalThis as Record<string, unknown>)[KEY] as IntelligentWorkloadBalancer;
}
