/**
 * Auto-Scaling Orchestrator
 *
 * Intelligent auto-scaling with:
 * - Real-time load monitoring
 * - Predictive scaling based on patterns
 * - Cost-aware scaling decisions
 * - Multi-dimensional scaling (CPU, memory, requests)
 * - Custom scaling policies
 * - Scale-up and scale-down orchestration
 * - Health-aware scaling
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger();

export interface ScalingMetrics {
  timestamp: Date;
  cpuUtilization: number; // 0-100
  memoryUtilization: number; // 0-100
  requestsPerSecond: number;
  activeConnections: number;
  averageResponseTime: number; // milliseconds
  errorRate: number; // 0-1
  queueDepth: number;
}

export interface ScalingPolicy {
  id: string;
  name: string;
  enabled: boolean;
  metric: 'cpu' | 'memory' | 'requests' | 'custom';
  thresholdUp: number;
  thresholdDown: number;
  scaleUpBy: number;
  scaleDownBy: number;
  cooldownPeriod: number; // seconds
  minInstances: number;
  maxInstances: number;
  evaluationPeriod: number; // seconds
  priority: number;
}

export interface ScalingDecision {
  timestamp: Date;
  action: 'scale-up' | 'scale-down' | 'no-action';
  currentInstances: number;
  targetInstances: number;
  reason: string;
  triggeredBy: string; // policy ID
  metrics: ScalingMetrics;
  costImpact: number; // estimated cost change
}

export interface PredictiveScaling {
  enabled: boolean;
  lookAheadMinutes: number;
  patterns: ScalingPattern[];
  confidence: number; // 0-1
}

export interface ScalingPattern {
  type: 'daily' | 'weekly' | 'monthly' | 'event-based';
  timeRange: { start: string; end: string };
  expectedLoad: number; // multiplier
  preScaleMinutes: number;
}

export interface ResourcePool {
  id: string;
  name: string;
  currentInstances: number;
  minInstances: number;
  maxInstances: number;
  instanceType: string;
  costPerHour: number;
  healthyInstances: number;
  status: 'healthy' | 'degraded' | 'critical';
}

class AutoScalingOrchestrator {
  private policies: Map<string, ScalingPolicy> = new Map();
  private metricsHistory: ScalingMetrics[] = [];
  private decisionsHistory: ScalingDecision[] = [];
  private resourcePools: Map<string, ResourcePool> = new Map();
  private predictiveScaling: PredictiveScaling;
  private lastScalingAction: Date = new Date(0);
  private monitoringInterval?: NodeJS.Timeout;

  constructor() {
    this.predictiveScaling = {
      enabled: true,
      lookAheadMinutes: 15,
      patterns: [],
      confidence: 0.8,
    };

    this.initializeDefaultPolicies();
    this.initializeResourcePools();
    this.startMonitoring();
  }

  /**
   * Evaluate scaling decision
   */
  async evaluateScaling(poolId: string, metrics: ScalingMetrics): Promise<ScalingDecision> {
    logger.debug('Evaluating scaling decision', { poolId });

    const pool = this.resourcePools.get(poolId);

    if (!pool) {
      throw new Error(`Resource pool not found: ${poolId}`);
    }

    // Store metrics
    this.metricsHistory.push(metrics);
    this.trimMetricsHistory();

    // Get active policies
    const activePolicies = Array.from(this.policies.values())
      .filter(p => p.enabled)
      .sort((a, b) => b.priority - a.priority);

    // Evaluate each policy
    for (const policy of activePolicies) {
      const decision = await this.evaluatePolicy(policy, pool, metrics);

      if (decision.action !== 'no-action') {
        // Check cooldown
        if (this.isInCooldown(policy)) {
          logger.info('Scaling action skipped - in cooldown period', {
            policy: policy.id,
          });
          continue;
        }

        // Apply scaling decision
        await this.applyScalingDecision(poolId, decision);

        this.decisionsHistory.push(decision);
        this.lastScalingAction = new Date();

        return decision;
      }
    }

    // Check predictive scaling
    if (this.predictiveScaling.enabled) {
      const predictiveDecision = await this.evaluatePredictiveScaling(pool, metrics);

      if (predictiveDecision.action !== 'no-action') {
        await this.applyScalingDecision(poolId, predictiveDecision);
        this.decisionsHistory.push(predictiveDecision);
        return predictiveDecision;
      }
    }

    // No scaling needed
    const noActionDecision: ScalingDecision = {
      timestamp: new Date(),
      action: 'no-action',
      currentInstances: pool.currentInstances,
      targetInstances: pool.currentInstances,
      reason: 'Metrics within acceptable range',
      triggeredBy: 'none',
      metrics,
      costImpact: 0,
    };

    return noActionDecision;
  }

  /**
   * Add scaling policy
   */
  addPolicy(policy: ScalingPolicy): void {
    this.policies.set(policy.id, policy);
    logger.info('Scaling policy added', { policyId: policy.id, name: policy.name });
  }

  /**
   * Remove scaling policy
   */
  removePolicy(policyId: string): boolean {
    const removed = this.policies.delete(policyId);
    if (removed) {
      logger.info('Scaling policy removed', { policyId });
    }
    return removed;
  }

  /**
   * Add scaling pattern for predictive scaling
   */
  addScalingPattern(pattern: ScalingPattern): void {
    this.predictiveScaling.patterns.push(pattern);
    logger.info('Scaling pattern added', { type: pattern.type });
  }

  /**
   * Get scaling statistics
   */
  getStatistics(): ScalingStatistics {
    const recentDecisions = this.decisionsHistory.slice(-100);

    const scaleUpCount = recentDecisions.filter(d => d.action === 'scale-up').length;
    const scaleDownCount = recentDecisions.filter(d => d.action === 'scale-down').length;

    const totalCostImpact = recentDecisions.reduce((sum, d) => sum + d.costImpact, 0);

    const pools = Array.from(this.resourcePools.values());
    const totalInstances = pools.reduce((sum, p) => sum + p.currentInstances, 0);
    const totalCost = pools.reduce(
      (sum, p) => sum + p.currentInstances * p.costPerHour,
      0
    );

    return {
      totalPolicies: this.policies.size,
      activePolicies: Array.from(this.policies.values()).filter(p => p.enabled).length,
      totalDecisions: this.decisionsHistory.length,
      recentScaleUps: scaleUpCount,
      recentScaleDowns: scaleDownCount,
      totalInstances,
      estimatedHourlyCost: totalCost,
      costImpact: totalCostImpact,
      predictiveScalingEnabled: this.predictiveScaling.enabled,
    };
  }

  /**
   * Get resource pool status
   */
  getPoolStatus(poolId: string): ResourcePool | null {
    return this.resourcePools.get(poolId) || null;
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit: number = 10): ScalingDecision[] {
    return this.decisionsHistory.slice(-limit);
  }

  /**
   * Evaluate policy
   */
  private async evaluatePolicy(
    policy: ScalingPolicy,
    pool: ResourcePool,
    metrics: ScalingMetrics
  ): Promise<ScalingDecision> {
    // Get metric value
    const metricValue = this.getMetricValue(metrics, policy.metric);

    // Get historical average for evaluation period
    const historicalAvg = this.getHistoricalAverage(policy.metric, policy.evaluationPeriod);

    let action: ScalingDecision['action'] = 'no-action';
    let targetInstances = pool.currentInstances;
    let reason = '';

    // Check scale-up condition
    if (metricValue > policy.thresholdUp && historicalAvg > policy.thresholdUp) {
      if (pool.currentInstances < policy.maxInstances) {
        action = 'scale-up';
        targetInstances = Math.min(
          pool.currentInstances + policy.scaleUpBy,
          policy.maxInstances
        );
        reason = `${policy.metric} exceeded threshold: ${metricValue.toFixed(2)} > ${policy.thresholdUp}`;
      }
    }

    // Check scale-down condition
    else if (metricValue < policy.thresholdDown && historicalAvg < policy.thresholdDown) {
      if (pool.currentInstances > policy.minInstances) {
        action = 'scale-down';
        targetInstances = Math.max(
          pool.currentInstances - policy.scaleDownBy,
          policy.minInstances
        );
        reason = `${policy.metric} below threshold: ${metricValue.toFixed(2)} < ${policy.thresholdDown}`;
      }
    }

    // Calculate cost impact
    const costImpact = (targetInstances - pool.currentInstances) * pool.costPerHour;

    return {
      timestamp: new Date(),
      action,
      currentInstances: pool.currentInstances,
      targetInstances,
      reason,
      triggeredBy: policy.id,
      metrics,
      costImpact,
    };
  }

  /**
   * Evaluate predictive scaling
   */
  private async evaluatePredictiveScaling(
    pool: ResourcePool,
    currentMetrics: ScalingMetrics
  ): Promise<ScalingDecision> {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    // Find matching pattern
    let expectedLoad = 1.0;
    let matchingPattern: ScalingPattern | null = null;

    for (const pattern of this.predictiveScaling.patterns) {
      if (this.patternMatches(pattern, currentHour, currentDay)) {
        expectedLoad = pattern.expectedLoad;
        matchingPattern = pattern;
        break;
      }
    }

    // Calculate target instances based on expected load
    const baselineInstances = pool.currentInstances;
    const targetInstances = Math.round(baselineInstances * expectedLoad);

    // Ensure within bounds
    const boundedTarget = Math.max(
      pool.minInstances,
      Math.min(pool.maxInstances, targetInstances)
    );

    if (boundedTarget === pool.currentInstances) {
      return {
        timestamp: new Date(),
        action: 'no-action',
        currentInstances: pool.currentInstances,
        targetInstances: pool.currentInstances,
        reason: 'Predictive scaling - no change needed',
        triggeredBy: 'predictive',
        metrics: currentMetrics,
        costImpact: 0,
      };
    }

    const action = boundedTarget > pool.currentInstances ? 'scale-up' : 'scale-down';
    const costImpact = (boundedTarget - pool.currentInstances) * pool.costPerHour;

    return {
      timestamp: new Date(),
      action,
      currentInstances: pool.currentInstances,
      targetInstances: boundedTarget,
      reason: `Predictive scaling based on ${matchingPattern?.type} pattern`,
      triggeredBy: 'predictive',
      metrics: currentMetrics,
      costImpact,
    };
  }

  /**
   * Apply scaling decision
   */
  private async applyScalingDecision(poolId: string, decision: ScalingDecision): Promise<void> {
    const pool = this.resourcePools.get(poolId);

    if (!pool) {
      throw new Error(`Resource pool not found: ${poolId}`);
    }

    logger.info('Applying scaling decision', {
      poolId,
      action: decision.action,
      from: decision.currentInstances,
      to: decision.targetInstances,
    });

    // In production, this would actually scale infrastructure
    // For now, update the pool state

    if (decision.action === 'scale-up') {
      pool.currentInstances = decision.targetInstances;
      pool.healthyInstances = decision.targetInstances;
    } else if (decision.action === 'scale-down') {
      pool.currentInstances = decision.targetInstances;
      pool.healthyInstances = decision.targetInstances;
    }

    // Update pool status
    pool.status = this.determinePoolStatus(pool);

    logger.info('Scaling decision applied', {
      poolId,
      newInstances: pool.currentInstances,
      status: pool.status,
    });
  }

  /**
   * Check if in cooldown period
   */
  private isInCooldown(policy: ScalingPolicy): boolean {
    const timeSinceLastAction = (Date.now() - this.lastScalingAction.getTime()) / 1000;
    return timeSinceLastAction < policy.cooldownPeriod;
  }

  /**
   * Get metric value
   */
  private getMetricValue(metrics: ScalingMetrics, metricType: string): number {
    switch (metricType) {
      case 'cpu':
        return metrics.cpuUtilization;
      case 'memory':
        return metrics.memoryUtilization;
      case 'requests':
        return metrics.requestsPerSecond;
      default:
        return 0;
    }
  }

  /**
   * Get historical average
   */
  private getHistoricalAverage(metricType: string, periodSeconds: number): number {
    const cutoff = Date.now() - periodSeconds * 1000;
    const relevantMetrics = this.metricsHistory.filter(
      m => m.timestamp.getTime() > cutoff
    );

    if (relevantMetrics.length === 0) return 0;

    const sum = relevantMetrics.reduce(
      (total, m) => total + this.getMetricValue(m, metricType),
      0
    );

    return sum / relevantMetrics.length;
  }

  /**
   * Check if pattern matches current time
   */
  private patternMatches(pattern: ScalingPattern, hour: number, day: number): boolean {
    // Simplified pattern matching
    const [startHour] = pattern.timeRange.start.split(':').map(Number);
    const [endHour] = pattern.timeRange.end.split(':').map(Number);

    return hour >= startHour && hour <= endHour;
  }

  /**
   * Determine pool status
   */
  private determinePoolStatus(pool: ResourcePool): ResourcePool['status'] {
    const healthRatio = pool.healthyInstances / pool.currentInstances;

    if (healthRatio >= 0.9) return 'healthy';
    if (healthRatio >= 0.7) return 'degraded';
    return 'critical';
  }

  /**
   * Trim metrics history
   */
  private trimMetricsHistory(): void {
    const maxHistory = 1000;
    if (this.metricsHistory.length > maxHistory) {
      this.metricsHistory = this.metricsHistory.slice(-maxHistory);
    }
  }

  /**
   * Initialize default policies
   */
  private initializeDefaultPolicies(): void {
    const policies: ScalingPolicy[] = [
      {
        id: 'cpu-scaling',
        name: 'CPU-based Scaling',
        enabled: true,
        metric: 'cpu',
        thresholdUp: 70,
        thresholdDown: 30,
        scaleUpBy: 2,
        scaleDownBy: 1,
        cooldownPeriod: 300,
        minInstances: 2,
        maxInstances: 20,
        evaluationPeriod: 60,
        priority: 10,
      },
      {
        id: 'memory-scaling',
        name: 'Memory-based Scaling',
        enabled: true,
        metric: 'memory',
        thresholdUp: 80,
        thresholdDown: 40,
        scaleUpBy: 2,
        scaleDownBy: 1,
        cooldownPeriod: 300,
        minInstances: 2,
        maxInstances: 20,
        evaluationPeriod: 60,
        priority: 9,
      },
    ];

    for (const policy of policies) {
      this.policies.set(policy.id, policy);
    }
  }

  /**
   * Initialize resource pools
   */
  private initializeResourcePools(): void {
    const pools: ResourcePool[] = [
      {
        id: 'api-servers',
        name: 'API Server Pool',
        currentInstances: 3,
        minInstances: 2,
        maxInstances: 20,
        instanceType: 't3.medium',
        costPerHour: 0.0416,
        healthyInstances: 3,
        status: 'healthy',
      },
      {
        id: 'worker-pool',
        name: 'Background Worker Pool',
        currentInstances: 2,
        minInstances: 1,
        maxInstances: 10,
        instanceType: 't3.small',
        costPerHour: 0.0208,
        healthyInstances: 2,
        status: 'healthy',
      },
    ];

    for (const pool of pools) {
      this.resourcePools.set(pool.id, pool);
    }
  }

  /**
   * Start monitoring
   */
  private startMonitoring(): void {
    // In production, this would continuously monitor and evaluate scaling
    logger.info('Auto-scaling orchestrator monitoring started');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }
}

interface ScalingStatistics {
  totalPolicies: number;
  activePolicies: number;
  totalDecisions: number;
  recentScaleUps: number;
  recentScaleDowns: number;
  totalInstances: number;
  estimatedHourlyCost: number;
  costImpact: number;
  predictiveScalingEnabled: boolean;
}

// Singleton
let scalingOrchestrator: AutoScalingOrchestrator;

export function getAutoScalingOrchestrator(): AutoScalingOrchestrator {
  if (!scalingOrchestrator) {
    scalingOrchestrator = new AutoScalingOrchestrator();
  }
  return scalingOrchestrator;
}

export { AutoScalingOrchestrator };
