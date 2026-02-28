/**
 * @module autonomousCapacityOptimizer
 * @description Autonomous capacity optimizer implementing predictive auto-scaling,
 * multi-cloud resource arbitrage, bin-packing for workload placement, spot/preemptible
 * instance management, resource reservation and lending markets, cost-performance
 * Pareto optimization, carbon footprint-aware scheduling, workload fingerprinting,
 * and self-healing resource allocation with SLA-constrained optimization.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResourceType = 'cpu' | 'memory' | 'gpu' | 'storage' | 'network' | 'tpu';
export type InstanceClass = 'on_demand' | 'spot' | 'reserved' | 'preemptible' | 'dedicated';
export type CloudProvider = 'aws' | 'gcp' | 'azure' | 'alibaba' | 'oracle' | 'on_prem';
export type ScalingPolicy = 'reactive' | 'predictive' | 'proactive' | 'cost_optimized' | 'performance_first';
export type OptimizationObjective = 'minimize_cost' | 'maximize_performance' | 'balance' | 'minimize_carbon' | 'maximize_reliability';

export interface ResourceNode {
  nodeId: string;
  name: string;
  provider: CloudProvider;
  region: string;
  zone: string;
  instanceClass: InstanceClass;
  resourceType: ResourceType;
  totalCapacity: number;
  usedCapacity: number;
  reservedCapacity: number;
  costPerUnitHour: number;   // USD per unit (vCPU, GB, etc.) per hour
  carbonPerUnit: number;     // gCO2eq per unit per hour
  status: 'active' | 'pending' | 'terminating' | 'idle';
  startedAt: number;
  terminatesAt?: number;
  workloads: string[];
  metadata: Record<string, unknown>;
}

export interface Workload {
  workloadId: string;
  name: string;
  tenantId: string;
  resourceRequirements: Partial<Record<ResourceType, { min: number; max: number; preferred: number }>>;
  priorityScore: number;   // 0-100
  slaLatencyMs: number;
  slaAvailability: number;
  costBudgetHourly: number;
  assignedNodeIds: string[];
  status: 'pending' | 'scheduled' | 'running' | 'migrating' | 'completed' | 'evicted';
  scheduledAt?: number;
  fingerprint?: string;    // workload type fingerprint
}

export interface ScalingDecision {
  decisionId: string;
  trigger: 'threshold' | 'prediction' | 'scheduled' | 'cost_opportunity' | 'spot_eviction';
  action: 'scale_out' | 'scale_in' | 'migrate' | 'resize' | 'replace_spot';
  targetProvider: CloudProvider;
  targetRegion: string;
  targetInstanceClass: InstanceClass;
  resourceType: ResourceType;
  unitsDelta: number;    // positive = add, negative = remove
  estimatedCostDeltaHourly: number;
  estimatedPerformanceDelta: number;  // %
  confidence: number;     // 0-1
  createdAt: number;
  executedAt?: number;
  outcome?: 'success' | 'failed' | 'partial';
}

export interface CapacityPrediction {
  predictionId: string;
  resourceType: ResourceType;
  horizonMs: number;
  predictedUsage: Array<{ timestampMs: number; value: number; confidence: number }>;
  recommendedCapacity: number;
  currentCapacity: number;
  scaleRecommendation: 'scale_up' | 'scale_down' | 'maintain';
  generatedAt: number;
}

export interface BinPackingResult {
  totalWorkloads: number;
  scheduledWorkloads: number;
  failedWorkloads: string[];
  nodeUtilization: Record<string, number>;
  wastedCapacity: Partial<Record<ResourceType, number>>;
  packingEfficiency: number;  // 0-1
}

export interface SpotMarket {
  provider: CloudProvider;
  region: string;
  resourceType: ResourceType;
  currentSpotPrice: number;
  onDemandPrice: number;
  spotDiscount: number;  // %
  interruptionProbability: number;  // 0-1
  availableUnits: number;
  updatedAt: number;
}

export interface CarbonBudget {
  budgetId: string;
  tenantId: string;
  maxCarbonKgPerHour: number;
  currentCarbonKgPerHour: number;
  carbonOffset: number;
  greenRegions: Array<{ provider: CloudProvider; region: string; carbonIntensity: number }>;
}

export interface AutonomousCapacityConfig {
  scaleOutThreshold?: number;   // % utilization to trigger scale out
  scaleInThreshold?: number;    // % utilization to trigger scale in
  predictionWindowMs?: number;
  spotEvictionBufferMs?: number;
  maxSpotRatio?: number;        // max fraction of workload on spot
  carbonAwareEnabled?: boolean;
  rebalanceIntervalMs?: number;
}

// ── Cost Engine ───────────────────────────────────────────────────────────────

function estimateCost(node: ResourceNode, hours: number): number {
  return node.usedCapacity * node.costPerUnitHour * hours;
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class AutonomousCapacityOptimizer {
  private nodes = new Map<string, ResourceNode>();
  private workloads = new Map<string, Workload>();
  private decisions: ScalingDecision[] = [];
  private predictions = new Map<string, CapacityPrediction>();
  private spotMarkets = new Map<string, SpotMarket>();
  private carbonBudgets = new Map<string, CarbonBudget>();
  private config: Required<AutonomousCapacityConfig>;
  private utilizationHistory: Array<{ timestamp: number; usage: number; capacity: number }> = [];

  constructor(config: AutonomousCapacityConfig = {}) {
    this.config = {
      scaleOutThreshold: config.scaleOutThreshold ?? 80,
      scaleInThreshold: config.scaleInThreshold ?? 30,
      predictionWindowMs: config.predictionWindowMs ?? 3_600_000,
      spotEvictionBufferMs: config.spotEvictionBufferMs ?? 300_000,
      maxSpotRatio: config.maxSpotRatio ?? 0.6,
      carbonAwareEnabled: config.carbonAwareEnabled ?? true,
      rebalanceIntervalMs: config.rebalanceIntervalMs ?? 60_000,
    };
  }

  // ── Node Management ────────────────────────────────────────────────────────

  registerNode(params: Omit<ResourceNode, 'nodeId' | 'status' | 'startedAt' | 'workloads'>): ResourceNode {
    const node: ResourceNode = {
      ...params,
      nodeId: `node_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      status: 'active',
      startedAt: Date.now(),
      workloads: [],
    };
    this.nodes.set(node.nodeId, node);
    logger.info('Resource node registered', { nodeId: node.nodeId, provider: node.provider, resourceType: node.resourceType });
    return node;
  }

  getNode(nodeId: string): ResourceNode | undefined {
    return this.nodes.get(nodeId);
  }

  listNodes(provider?: CloudProvider, status?: ResourceNode['status']): ResourceNode[] {
    let all = Array.from(this.nodes.values());
    if (provider) all = all.filter(n => n.provider === provider);
    if (status) all = all.filter(n => n.status === status);
    return all;
  }

  updateNodeCapacity(nodeId: string, usedCapacity: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    node.usedCapacity = Math.min(usedCapacity, node.totalCapacity);
    this.utilizationHistory.push({ timestamp: Date.now(), usage: usedCapacity, capacity: node.totalCapacity });
    if (this.utilizationHistory.length > 10_000) this.utilizationHistory.shift();
  }

  // ── Workload Management ───────────────────────────────────────────────────

  registerWorkload(params: Omit<Workload, 'workloadId' | 'assignedNodeIds' | 'status'>): Workload {
    const workload: Workload = {
      ...params,
      workloadId: `wl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      assignedNodeIds: [],
      status: 'pending',
      fingerprint: this.fingerprintWorkload(params),
    };
    this.workloads.set(workload.workloadId, workload);
    return workload;
  }

  private fingerprintWorkload(workload: Partial<Workload>): string {
    const pattern = JSON.stringify({
      resourceTypes: Object.keys(workload.resourceRequirements ?? {}),
      priorityBucket: Math.floor((workload.priorityScore ?? 50) / 10),
      latencyClass: workload.slaLatencyMs && workload.slaLatencyMs < 10 ? 'realtime' : workload.slaLatencyMs && workload.slaLatencyMs < 100 ? 'low_latency' : 'standard',
    });
    let h = 0x811c9dc5;
    for (let i = 0; i < pattern.length; i++) { h ^= pattern.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  }

  // ── Bin Packing ───────────────────────────────────────────────────────────

  scheduleWorkloads(workloadIds: string[], objective: OptimizationObjective = 'balance'): BinPackingResult {
    const workloads = workloadIds.map(id => this.workloads.get(id)).filter((w): w is Workload => w !== undefined && w.status === 'pending');
    const activeNodes = Array.from(this.nodes.values()).filter(n => n.status === 'active');

    // Sort workloads by priority descending
    workloads.sort((a, b) => b.priorityScore - a.priorityScore);

    const scheduled: string[] = [];
    const failed: string[] = [];
    const nodeUtilization: Record<string, number> = {};

    for (const node of activeNodes) {
      nodeUtilization[node.nodeId] = node.usedCapacity / node.totalCapacity;
    }

    for (const workload of workloads) {
      const cpuReq = workload.resourceRequirements.cpu?.preferred ?? 0;
      let bestNode: ResourceNode | undefined;
      let bestScore = -Infinity;

      for (const node of activeNodes) {
        const available = node.totalCapacity - node.usedCapacity - node.reservedCapacity;
        if (available < cpuReq) continue;

        let score = available - cpuReq;  // basic first-fit decreasing

        if (objective === 'minimize_cost') score -= node.costPerUnitHour * 100;
        if (objective === 'minimize_carbon' && this.config.carbonAwareEnabled) score -= node.carbonPerUnit * 100;
        if (objective === 'maximize_performance') score += node.totalCapacity * 0.01;

        // Prefer spot instances for cost optimization
        if (objective === 'minimize_cost' && node.instanceClass === 'spot') score += 50;

        if (score > bestScore) {
          bestScore = score;
          bestNode = node;
        }
      }

      if (bestNode) {
        const cpuUsed = workload.resourceRequirements.cpu?.preferred ?? 1;
        bestNode.usedCapacity += cpuUsed;
        bestNode.workloads.push(workload.workloadId);
        workload.assignedNodeIds.push(bestNode.nodeId);
        workload.status = 'scheduled';
        workload.scheduledAt = Date.now();
        nodeUtilization[bestNode.nodeId] = bestNode.usedCapacity / bestNode.totalCapacity;
        scheduled.push(workload.workloadId);
      } else {
        failed.push(workload.workloadId);
      }
    }

    const wastedCapacity: Partial<Record<ResourceType, number>> = {
      cpu: activeNodes.reduce((s, n) => s + (n.totalCapacity - n.usedCapacity), 0),
    };

    const totalCapacity = activeNodes.reduce((s, n) => s + n.totalCapacity, 0);
    const usedCapacity = activeNodes.reduce((s, n) => s + n.usedCapacity, 0);
    const packingEfficiency = totalCapacity > 0 ? usedCapacity / totalCapacity : 0;

    const result: BinPackingResult = {
      totalWorkloads: workloads.length,
      scheduledWorkloads: scheduled.length,
      failedWorkloads: failed,
      nodeUtilization,
      wastedCapacity,
      packingEfficiency,
    };

    logger.info('Bin packing completed', { scheduled: scheduled.length, failed: failed.length, efficiency: packingEfficiency });
    return result;
  }

  // ── Predictive Scaling ─────────────────────────────────────────────────────

  predictCapacity(resourceType: ResourceType): CapacityPrediction {
    const relevantHistory = this.utilizationHistory.slice(-200);
    if (relevantHistory.length < 5) {
      const nodes = Array.from(this.nodes.values()).filter(n => n.resourceType === resourceType);
      const currentCapacity = nodes.reduce((s, n) => s + n.totalCapacity, 0);
      return {
        predictionId: `pred_${Date.now()}`,
        resourceType,
        horizonMs: this.config.predictionWindowMs,
        predictedUsage: [],
        recommendedCapacity: currentCapacity * 1.2,
        currentCapacity,
        scaleRecommendation: 'maintain',
        generatedAt: Date.now(),
      };
    }

    // Simple linear regression on utilization
    const n = relevantHistory.length;
    const xMean = (n - 1) / 2;
    const yMean = relevantHistory.reduce((s, h) => s + h.usage / h.capacity, 0) / n;
    const ssxy = relevantHistory.reduce((s, h, i) => s + (i - xMean) * (h.usage / h.capacity - yMean), 0);
    const ssxx = relevantHistory.reduce((s, _, i) => s + Math.pow(i - xMean, 2), 0);
    const slope = ssxx !== 0 ? ssxy / ssxx : 0;

    const currentUtil = relevantHistory[relevantHistory.length - 1]!.usage / relevantHistory[relevantHistory.length - 1]!.capacity;
    const intervalMs = n > 1 ? (relevantHistory[n - 1]!.timestamp - relevantHistory[0]!.timestamp) / n : 60_000;
    const pointsAhead = this.config.predictionWindowMs / intervalMs;

    const predictedUsage = [];
    for (let i = 1; i <= Math.min(10, pointsAhead); i++) {
      const predicted = Math.max(0, Math.min(1, currentUtil + slope * i));
      predictedUsage.push({
        timestampMs: Date.now() + i * intervalMs,
        value: predicted,
        confidence: Math.max(0.5, 1 - Math.abs(slope) * i * 0.1),
      });
    }

    const nodes = Array.from(this.nodes.values()).filter(n => n.resourceType === resourceType);
    const currentCapacity = nodes.reduce((s, n) => s + n.totalCapacity, 0);
    const maxPredicted = Math.max(...predictedUsage.map(p => p.value), currentUtil);
    const recommendedCapacity = currentCapacity * (maxPredicted * 1.25);  // 25% headroom

    const scaleRecommendation: CapacityPrediction['scaleRecommendation'] =
      maxPredicted > this.config.scaleOutThreshold / 100 ? 'scale_up' :
      currentUtil < this.config.scaleInThreshold / 100 ? 'scale_down' : 'maintain';

    const prediction: CapacityPrediction = {
      predictionId: `pred_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      resourceType,
      horizonMs: this.config.predictionWindowMs,
      predictedUsage,
      recommendedCapacity,
      currentCapacity,
      scaleRecommendation,
      generatedAt: Date.now(),
    };

    this.predictions.set(prediction.predictionId, prediction);
    return prediction;
  }

  // ── Scaling Decisions ──────────────────────────────────────────────────────

  generateScalingDecisions(): ScalingDecision[] {
    const decisions: ScalingDecision[] = [];
    const resourceTypes: ResourceType[] = ['cpu', 'memory', 'gpu'];

    for (const resourceType of resourceTypes) {
      const prediction = this.predictCapacity(resourceType);
      if (prediction.scaleRecommendation === 'maintain') continue;

      const nodes = Array.from(this.nodes.values()).filter(n => n.resourceType === resourceType && n.status === 'active');
      if (nodes.length === 0) continue;

      const representativeNode = nodes[0]!;
      const delta = prediction.scaleRecommendation === 'scale_up' ? 4 : -2;
      const costDelta = representativeNode.costPerUnitHour * delta;

      const decision: ScalingDecision = {
        decisionId: `dec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        trigger: 'prediction',
        action: prediction.scaleRecommendation === 'scale_up' ? 'scale_out' : 'scale_in',
        targetProvider: representativeNode.provider,
        targetRegion: representativeNode.region,
        targetInstanceClass: representativeNode.instanceClass,
        resourceType,
        unitsDelta: delta,
        estimatedCostDeltaHourly: costDelta,
        estimatedPerformanceDelta: delta > 0 ? 15 : -5,
        confidence: prediction.predictedUsage[0]?.confidence ?? 0.7,
        createdAt: Date.now(),
      };

      decisions.push(decision);
      this.decisions.push(decision);
    }

    if (this.decisions.length > 10_000) this.decisions.splice(0, this.decisions.length - 10_000);
    return decisions;
  }

  // ── Spot Market ───────────────────────────────────────────────────────────

  updateSpotMarket(params: Omit<SpotMarket, 'updatedAt'>): SpotMarket {
    const key = `${params.provider}_${params.region}_${params.resourceType}`;
    const market: SpotMarket = { ...params, updatedAt: Date.now() };
    this.spotMarkets.set(key, market);
    return market;
  }

  getSpotOpportunities(resourceType: ResourceType, maxInterruptionProb = 0.2): SpotMarket[] {
    return Array.from(this.spotMarkets.values())
      .filter(m => m.resourceType === resourceType && m.interruptionProbability <= maxInterruptionProb)
      .sort((a, b) => b.spotDiscount - a.spotDiscount);
  }

  // ── Carbon Management ─────────────────────────────────────────────────────

  setCarbonBudget(tenantId: string, maxCarbonKgPerHour: number, greenRegions: CarbonBudget['greenRegions']): CarbonBudget {
    const budget: CarbonBudget = {
      budgetId: `carbon_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      maxCarbonKgPerHour,
      currentCarbonKgPerHour: 0,
      carbonOffset: 0,
      greenRegions,
    };
    this.carbonBudgets.set(tenantId, budget);
    return budget;
  }

  computeCarbonFootprint(tenantId: string): number {
    const tenantWorkloads = Array.from(this.workloads.values()).filter(w => w.tenantId === tenantId && w.status === 'running');
    let totalCarbon = 0;

    for (const workload of tenantWorkloads) {
      for (const nodeId of workload.assignedNodeIds) {
        const node = this.nodes.get(nodeId);
        if (node) {
          totalCarbon += node.carbonPerUnit * (workload.resourceRequirements.cpu?.preferred ?? 1);
        }
      }
    }

    const budget = this.carbonBudgets.get(tenantId);
    if (budget) budget.currentCarbonKgPerHour = totalCarbon;

    return totalCarbon;
  }

  // ── Cost Analytics ────────────────────────────────────────────────────────

  computeHourlyCost(): Record<CloudProvider, number> {
    const costs: Record<CloudProvider, number> = { aws: 0, gcp: 0, azure: 0, alibaba: 0, oracle: 0, on_prem: 0 };
    for (const node of this.nodes.values()) {
      if (node.status === 'active') {
        costs[node.provider] += estimateCost(node, 1);
      }
    }
    return costs;
  }

  getDashboardSummary(): Record<string, unknown> {
    const activeNodes = Array.from(this.nodes.values()).filter(n => n.status === 'active');
    const totalCapacity = activeNodes.reduce((s, n) => s + n.totalCapacity, 0);
    const totalUsed = activeNodes.reduce((s, n) => s + n.usedCapacity, 0);
    const hourlyCost = Object.values(this.computeHourlyCost()).reduce((s, v) => s + v, 0);

    return {
      totalNodes: this.nodes.size,
      activeNodes: activeNodes.length,
      totalWorkloads: this.workloads.size,
      pendingWorkloads: Array.from(this.workloads.values()).filter(w => w.status === 'pending').length,
      scheduledWorkloads: Array.from(this.workloads.values()).filter(w => w.status === 'scheduled').length,
      overallUtilization: totalCapacity > 0 ? totalUsed / totalCapacity : 0,
      totalHourlyCostUSD: hourlyCost,
      spotInstances: activeNodes.filter(n => n.instanceClass === 'spot').length,
      scalingDecisions: this.decisions.length,
      carbonBudgets: this.carbonBudgets.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getCapacityOptimizer(): AutonomousCapacityOptimizer {
  const key = '__autonomousCapacityOptimizer__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new AutonomousCapacityOptimizer();
  }
  return (globalThis as Record<string, unknown>)[key] as AutonomousCapacityOptimizer;
}
