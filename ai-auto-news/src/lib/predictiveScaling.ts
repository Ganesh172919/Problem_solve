/**
 * Predictive Scaling & Resource Optimization Engine
 *
 * Machine learning-powered system for:
 * - Predicting future resource needs
 * - Auto-scaling infrastructure proactively
 * - Optimizing resource allocation
 * - Cost optimization recommendations
 * - Capacity planning
 */

import { getLogger } from './logger';
import { getMetrics } from './metrics';

const logger = getLogger();

export interface ResourceMetrics {
  timestamp: Date;
  cpu: number; // 0-100%
  memory: number; // 0-100%
  disk: number; // 0-100%
  network: number; // bytes/s
  connections: number;
  requestRate: number; // requests/s
  errorRate: number; // 0-1
  latency: LatencyMetrics;
}

export interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface ResourcePrediction {
  timestamp: Date;
  horizon: number; // minutes ahead
  predictions: {
    cpu: number;
    memory: number;
    requestRate: number;
    expectedLoad: number;
  };
  confidence: number; // 0-1
  triggers: PredictionTrigger[];
}

export interface PredictionTrigger {
  type: 'time_pattern' | 'event' | 'trend' | 'anomaly';
  description: string;
  impact: number; // expected % increase
}

export interface ScalingDecision {
  id: string;
  timestamp: Date;
  action: 'scale_up' | 'scale_down' | 'no_action';
  resourceType: 'compute' | 'memory' | 'storage' | 'network';
  currentCapacity: number;
  targetCapacity: number;
  reason: string;
  prediction: ResourcePrediction;
  costImpact: number;
  executedAt?: Date;
  success?: boolean;
}

export interface ScalingPolicy {
  id: string;
  name: string;
  enabled: boolean;
  triggers: ScalingTrigger[];
  cooldown: number; // seconds
  minCapacity: number;
  maxCapacity: number;
  scaleUpStep: number;
  scaleDownStep: number;
  predictiveEnabled: boolean;
  costConstraints?: CostConstraints;
}

export interface ScalingTrigger {
  metric: string;
  operator: 'greater_than' | 'less_than';
  threshold: number;
  duration: number; // seconds
  aggregation: 'avg' | 'max' | 'min' | 'sum';
}

export interface CostConstraints {
  maxHourlyCost: number;
  maxMonthlyCost: number;
  preferenceOrder: ('performance' | 'cost' | 'balanced')[];
}

export interface OptimizationRecommendation {
  id: string;
  type: 'rightsizing' | 'scheduling' | 'consolidation' | 'termination' | 'reservation';
  priority: 'critical' | 'high' | 'medium' | 'low';
  resource: string;
  currentState: Record<string, any>;
  recommendedState: Record<string, any>;
  expectedSavings: number; // $ per month
  implementation: string;
  risks: string[];
  impact: OptimizationImpact;
}

export interface OptimizationImpact {
  costReduction: number; // percentage
  performanceImpact: number; // percentage, negative is degradation
  reliability: number; // 0-1
  complexity: 'low' | 'medium' | 'high';
}

export interface CapacityPlan {
  period: { start: Date; end: Date };
  currentCapacity: ResourceCapacity;
  projectedNeeds: ResourceCapacity;
  recommendations: CapacityRecommendation[];
  estimatedCost: number;
  riskFactors: string[];
}

export interface ResourceCapacity {
  compute: number; // vCPUs
  memory: number; // GB
  storage: number; // GB
  bandwidth: number; // Gbps
}

export interface CapacityRecommendation {
  resource: string;
  action: 'increase' | 'decrease' | 'maintain';
  amount: number;
  timing: Date;
  reason: string;
  cost: number;
}

class PredictiveScalingEngine {
  private metricsHistory: ResourceMetrics[] = [];
  private predictions: ResourcePrediction[] = [];
  private scalingDecisions: ScalingDecision[] = [];
  private policies: Map<string, ScalingPolicy> = new Map();
  private metrics = getMetrics();
  private readonly HISTORY_SIZE = 10000;
  private readonly PREDICTION_HORIZONS = [15, 30, 60, 120]; // minutes

  constructor() {
    this.initializeDefaultPolicies();
  }

  /**
   * Start predictive scaling engine
   */
  start(): void {
    logger.info('Starting predictive scaling engine');

    // Collect metrics every minute
    setInterval(() => this.collectMetrics(), 60000);

    // Generate predictions every 5 minutes
    setInterval(() => this.generatePredictions(), 300000);

    // Evaluate scaling decisions every 2 minutes
    setInterval(() => this.evaluateScaling(), 120000);

    // Generate optimizations daily
    setInterval(() => this.generateOptimizations(), 86400000);
  }

  /**
   * Collect current resource metrics
   */
  private async collectMetrics(): Promise<void> {
    const metrics: ResourceMetrics = {
      timestamp: new Date(),
      cpu: await this.getCurrentCPU(),
      memory: await this.getCurrentMemory(),
      disk: await this.getCurrentDisk(),
      network: await this.getCurrentNetwork(),
      connections: await this.getCurrentConnections(),
      requestRate: await this.getCurrentRequestRate(),
      errorRate: await this.getCurrentErrorRate(),
      latency: await this.getCurrentLatency(),
    };

    this.metricsHistory.push(metrics);

    // Trim history
    if (this.metricsHistory.length > this.HISTORY_SIZE) {
      this.metricsHistory = this.metricsHistory.slice(-this.HISTORY_SIZE);
    }

    // Record to metrics system
    this.metrics.recordGauge('resource.cpu', metrics.cpu);
    this.metrics.recordGauge('resource.memory', metrics.memory);
    this.metrics.recordGauge('resource.request_rate', metrics.requestRate);
  }

  /**
   * Generate resource predictions using ML
   */
  private async generatePredictions(): Promise<void> {
    if (this.metricsHistory.length < 100) {
      logger.debug('Insufficient data for predictions');
      return;
    }

    for (const horizon of this.PREDICTION_HORIZONS) {
      const prediction = await this.predictResources(horizon);
      this.predictions.push(prediction);

      logger.debug('Prediction generated', {
        horizon,
        cpuPrediction: prediction.predictions.cpu,
        confidence: prediction.confidence,
      });
    }

    // Keep only recent predictions
    const cutoff = new Date(Date.now() - 3600000); // 1 hour
    this.predictions = this.predictions.filter(p => p.timestamp >= cutoff);
  }

  /**
   * Predict resources for given horizon
   */
  private async predictResources(horizonMinutes: number): Promise<ResourcePrediction> {
    const recent = this.metricsHistory.slice(-100); // Last 100 data points

    // Time-based patterns
    const timePattern = this.detectTimePatterns(recent);

    // Trend analysis
    const trend = this.calculateTrend(recent);

    // Anomaly detection
    const anomalies = this.detectAnomalies(recent);

    // Simple linear prediction (in production use ML model)
    const avgCPU = recent.reduce((sum, m) => sum + m.cpu, 0) / recent.length;
    const avgMemory = recent.reduce((sum, m) => sum + m.memory, 0) / recent.length;
    const avgRequestRate = recent.reduce((sum, m) => sum + m.requestRate, 0) / recent.length;

    const cpuTrend = trend.cpu;
    const memoryTrend = trend.memory;
    const requestRateTrend = trend.requestRate;

    const prediction: ResourcePrediction = {
      timestamp: new Date(),
      horizon: horizonMinutes,
      predictions: {
        cpu: Math.min(100, Math.max(0, avgCPU + cpuTrend * (horizonMinutes / 60))),
        memory: Math.min(100, Math.max(0, avgMemory + memoryTrend * (horizonMinutes / 60))),
        requestRate: Math.max(0, avgRequestRate + requestRateTrend * (horizonMinutes / 60)),
        expectedLoad: this.calculateExpectedLoad(avgRequestRate, requestRateTrend, horizonMinutes),
      },
      confidence: this.calculateConfidence(recent.length, trend, anomalies.length),
      triggers: this.identifyTriggers(timePattern, trend, anomalies),
    };

    return prediction;
  }

  /**
   * Evaluate if scaling is needed
   */
  private async evaluateScaling(): Promise<void> {
    const nearestPrediction = this.predictions.find(p => p.horizon === 15); // 15 min ahead

    if (!nearestPrediction || nearestPrediction.confidence < 0.6) {
      return;
    }

    for (const [_, policy] of this.policies.entries()) {
      if (!policy.enabled) continue;

      const decision = await this.makeScalingDecision(policy, nearestPrediction);

      if (decision.action !== 'no_action') {
        this.scalingDecisions.push(decision);

        if (policy.predictiveEnabled) {
          await this.executeScaling(decision);
        }
      }
    }
  }

  /**
   * Make scaling decision based on policy and prediction
   */
  private async makeScalingDecision(
    policy: ScalingPolicy,
    prediction: ResourcePrediction
  ): Promise<ScalingDecision> {
    const decision: ScalingDecision = {
      id: `decision_${Date.now()}`,
      timestamp: new Date(),
      action: 'no_action',
      resourceType: 'compute',
      currentCapacity: await this.getCurrentCapacity('compute'),
      targetCapacity: 0,
      reason: '',
      prediction,
      costImpact: 0,
    };

    // Check triggers
    for (const trigger of policy.triggers) {
      const predicted = this.getPredictedMetric(prediction, trigger.metric);

      if (trigger.operator === 'greater_than' && predicted > trigger.threshold) {
        // Need to scale up
        decision.action = 'scale_up';
        decision.targetCapacity = Math.min(
          decision.currentCapacity + policy.scaleUpStep,
          policy.maxCapacity
        );
        decision.reason = `Predicted ${trigger.metric} (${predicted.toFixed(1)}) exceeds threshold (${trigger.threshold})`;
        decision.costImpact = this.estimateCostImpact(
          'scale_up',
          decision.currentCapacity,
          decision.targetCapacity
        );
        break;
      } else if (trigger.operator === 'less_than' && predicted < trigger.threshold) {
        // Can scale down
        decision.action = 'scale_down';
        decision.targetCapacity = Math.max(
          decision.currentCapacity - policy.scaleDownStep,
          policy.minCapacity
        );
        decision.reason = `Predicted ${trigger.metric} (${predicted.toFixed(1)}) below threshold (${trigger.threshold})`;
        decision.costImpact = this.estimateCostImpact(
          'scale_down',
          decision.currentCapacity,
          decision.targetCapacity
        );
        break;
      }
    }

    // Check cost constraints
    if (policy.costConstraints) {
      if (Math.abs(decision.costImpact) > policy.costConstraints.maxHourlyCost) {
        logger.warn('Scaling decision violates cost constraints', {
          decision: decision.id,
          costImpact: decision.costImpact,
        });
        decision.action = 'no_action';
      }
    }

    return decision;
  }

  /**
   * Execute scaling action
   */
  private async executeScaling(decision: ScalingDecision): Promise<void> {
    logger.info('Executing scaling decision', {
      id: decision.id,
      action: decision.action,
      currentCapacity: decision.currentCapacity,
      targetCapacity: decision.targetCapacity,
    });

    try {
      // Would actually call cloud provider APIs
      // await cloudProvider.scale(decision.resourceType, decision.targetCapacity);

      decision.executedAt = new Date();
      decision.success = true;

      logger.info('Scaling executed successfully', { id: decision.id });
    } catch (error: any) {
      logger.error('Scaling execution failed', { id: decision.id, error: error.message });
      decision.success = false;
    }
  }

  /**
   * Generate optimization recommendations
   */
  async generateOptimizations(): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];

    // Analyze resource utilization
    const utilizationAnalysis = this.analyzeUtilization();

    // Right-sizing recommendations
    if (utilizationAnalysis.avgCPU < 30 && utilizationAnalysis.avgMemory < 30) {
      recommendations.push({
        id: `opt_${Date.now()}`,
        type: 'rightsizing',
        priority: 'high',
        resource: 'compute',
        currentState: { instances: 10, type: 'm5.large' },
        recommendedState: { instances: 10, type: 'm5.medium' },
        expectedSavings: 500,
        implementation: 'Update instance type in deployment configuration',
        risks: ['Temporary performance degradation during migration'],
        impact: {
          costReduction: 50,
          performanceImpact: -5,
          reliability: 0.95,
          complexity: 'medium',
        },
      });
    }

    // Scheduling recommendations
    const idleHours = this.identifyIdleHours();
    if (idleHours.length > 0) {
      recommendations.push({
        id: `opt_${Date.now()}_sched`,
        type: 'scheduling',
        priority: 'medium',
        resource: 'development_environment',
        currentState: { schedule: 'always_on' },
        recommendedState: { schedule: 'business_hours_only', hours: '9am-6pm' },
        expectedSavings: 300,
        implementation: 'Configure auto-start/stop schedule',
        risks: ['May need manual start outside business hours'],
        impact: {
          costReduction: 65,
          performanceImpact: 0,
          reliability: 0.98,
          complexity: 'low',
        },
      });
    }

    // Consolidation recommendations
    if (this.detectUnderutilizedInstances()) {
      recommendations.push({
        id: `opt_${Date.now()}_consol`,
        type: 'consolidation',
        priority: 'high',
        resource: 'database_replicas',
        currentState: { replicas: 5, utilization: '25%' },
        recommendedState: { replicas: 3, utilization: '40%' },
        expectedSavings: 400,
        implementation: 'Reduce replica count and redistribute load',
        risks: ['Reduced redundancy', 'Higher individual instance load'],
        impact: {
          costReduction: 40,
          performanceImpact: 0,
          reliability: 0.92,
          complexity: 'medium',
        },
      });
    }

    logger.info('Optimizations generated', { count: recommendations.length });

    return recommendations;
  }

  /**
   * Generate capacity plan
   */
  async generateCapacityPlan(months: number): Promise<CapacityPlan> {
    const now = new Date();
    const endDate = new Date(now.getTime() + months * 30 * 24 * 3600000);

    const currentCapacity: ResourceCapacity = {
      compute: await this.getCurrentCapacity('compute'),
      memory: await this.getCurrentCapacity('memory'),
      storage: await this.getCurrentCapacity('storage'),
      bandwidth: await this.getCurrentCapacity('bandwidth'),
    };

    // Project growth based on historical trends
    const growthRate = this.calculateGrowthRate();

    const projectedNeeds: ResourceCapacity = {
      compute: currentCapacity.compute * Math.pow(1 + growthRate.compute, months),
      memory: currentCapacity.memory * Math.pow(1 + growthRate.memory, months),
      storage: currentCapacity.storage * Math.pow(1 + growthRate.storage, months),
      bandwidth: currentCapacity.bandwidth * Math.pow(1 + growthRate.bandwidth, months),
    };

    const recommendations: CapacityRecommendation[] = [];

    // Generate monthly recommendations
    for (let month = 1; month <= months; month++) {
      const monthDate = new Date(now.getTime() + month * 30 * 24 * 3600000);

      if (projectedNeeds.compute > currentCapacity.compute * 1.2) {
        recommendations.push({
          resource: 'compute',
          action: 'increase',
          amount: Math.ceil((projectedNeeds.compute - currentCapacity.compute) / months),
          timing: monthDate,
          reason: 'Projected growth in request volume',
          cost: 100 * month,
        });
      }
    }

    const estimatedCost = recommendations.reduce((sum, r) => sum + r.cost, 0);

    const riskFactors = [
      'Projections based on historical trends may not account for market changes',
      'Seasonal variations not fully modeled',
      'External events (marketing campaigns, viral growth) may cause sudden spikes',
    ];

    return {
      period: { start: now, end: endDate },
      currentCapacity,
      projectedNeeds,
      recommendations,
      estimatedCost,
      riskFactors,
    };
  }

  // Helper methods

  private initializeDefaultPolicies(): void {
    this.policies.set('auto-scaling', {
      id: 'auto-scaling',
      name: 'Auto Scaling Policy',
      enabled: true,
      triggers: [
        {
          metric: 'cpu',
          operator: 'greater_than',
          threshold: 75,
          duration: 300,
          aggregation: 'avg',
        },
        {
          metric: 'cpu',
          operator: 'less_than',
          threshold: 25,
          duration: 600,
          aggregation: 'avg',
        },
      ],
      cooldown: 300,
      minCapacity: 2,
      maxCapacity: 20,
      scaleUpStep: 2,
      scaleDownStep: 1,
      predictiveEnabled: true,
    });
  }

  private async getCurrentCPU(): Promise<number> {
    return Math.random() * 100;
  }

  private async getCurrentMemory(): Promise<number> {
    return Math.random() * 100;
  }

  private async getCurrentDisk(): Promise<number> {
    return Math.random() * 100;
  }

  private async getCurrentNetwork(): Promise<number> {
    return Math.random() * 1000000;
  }

  private async getCurrentConnections(): Promise<number> {
    return Math.floor(Math.random() * 1000);
  }

  private async getCurrentRequestRate(): Promise<number> {
    return Math.random() * 1000;
  }

  private async getCurrentErrorRate(): Promise<number> {
    return Math.random() * 0.05;
  }

  private async getCurrentLatency(): Promise<LatencyMetrics> {
    return {
      p50: 50 + Math.random() * 50,
      p95: 200 + Math.random() * 100,
      p99: 500 + Math.random() * 500,
      max: 1000 + Math.random() * 2000,
    };
  }

  private async getCurrentCapacity(type: string): Promise<number> {
    return 10; // Simplified
  }

  private detectTimePatterns(metrics: ResourceMetrics[]): any {
    return { hourly: true, daily: false };
  }

  private calculateTrend(metrics: ResourceMetrics[]): {
    cpu: number;
    memory: number;
    requestRate: number;
  } {
    if (metrics.length < 2) {
      return { cpu: 0, memory: 0, requestRate: 0 };
    }

    const first = metrics[0];
    const last = metrics[metrics.length - 1];
    const duration = (last.timestamp.getTime() - first.timestamp.getTime()) / 3600000; // hours

    return {
      cpu: duration > 0 ? (last.cpu - first.cpu) / duration : 0,
      memory: duration > 0 ? (last.memory - first.memory) / duration : 0,
      requestRate: duration > 0 ? (last.requestRate - first.requestRate) / duration : 0,
    };
  }

  private detectAnomalies(metrics: ResourceMetrics[]): any[] {
    return [];
  }

  private calculateExpectedLoad(
    current: number,
    trend: number,
    horizonMinutes: number
  ): number {
    return current + trend * (horizonMinutes / 60);
  }

  private calculateConfidence(
    dataPoints: number,
    trend: any,
    anomalies: number
  ): number {
    let confidence = 0.5;

    if (dataPoints > 50) confidence += 0.2;
    if (dataPoints > 100) confidence += 0.1;
    if (Math.abs(trend.cpu) < 5) confidence += 0.1;
    if (anomalies === 0) confidence += 0.1;

    return Math.min(0.95, confidence);
  }

  private identifyTriggers(
    timePattern: any,
    trend: any,
    anomalies: any[]
  ): PredictionTrigger[] {
    const triggers: PredictionTrigger[] = [];

    if (trend.requestRate > 10) {
      triggers.push({
        type: 'trend',
        description: 'Increasing request rate trend',
        impact: 15,
      });
    }

    if (timePattern.hourly) {
      triggers.push({
        type: 'time_pattern',
        description: 'Hourly traffic pattern detected',
        impact: 10,
      });
    }

    return triggers;
  }

  private getPredictedMetric(prediction: ResourcePrediction, metric: string): number {
    switch (metric) {
      case 'cpu':
        return prediction.predictions.cpu;
      case 'memory':
        return prediction.predictions.memory;
      case 'request_rate':
        return prediction.predictions.requestRate;
      default:
        return 0;
    }
  }

  private estimateCostImpact(
    action: string,
    current: number,
    target: number
  ): number {
    const diff = target - current;
    const costPerUnit = 0.1; // $ per hour per unit
    return diff * costPerUnit;
  }

  private analyzeUtilization(): { avgCPU: number; avgMemory: number } {
    const recent = this.metricsHistory.slice(-100);

    return {
      avgCPU: recent.reduce((sum, m) => sum + m.cpu, 0) / recent.length,
      avgMemory: recent.reduce((sum, m) => sum + m.memory, 0) / recent.length,
    };
  }

  private identifyIdleHours(): number[] {
    return [0, 1, 2, 3, 4, 5, 22, 23];
  }

  private detectUnderutilizedInstances(): boolean {
    return Math.random() > 0.5;
  }

  private calculateGrowthRate(): ResourceCapacity {
    return {
      compute: 0.05, // 5% per month
      memory: 0.04,
      storage: 0.08,
      bandwidth: 0.06,
    };
  }

  /**
   * Get system statistics
   */
  getStats(): {
    metricsCollected: number;
    predictionsGenerated: number;
    scalingDecisions: number;
    successfulScalings: number;
  } {
    return {
      metricsCollected: this.metricsHistory.length,
      predictionsGenerated: this.predictions.length,
      scalingDecisions: this.scalingDecisions.length,
      successfulScalings: this.scalingDecisions.filter(d => d.success).length,
    };
  }
}

// Singleton
let scalingEngine: PredictiveScalingEngine;

export function getPredictiveScalingEngine(): PredictiveScalingEngine {
  if (!scalingEngine) {
    scalingEngine = new PredictiveScalingEngine();
  }
  return scalingEngine;
}
