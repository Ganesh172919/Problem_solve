/**
 * Capacity Planning Engine
 *
 * Predictive capacity planning with resource forecasting,
 * bottleneck analysis, cost modeling, and scaling recommendations.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface ResourceMetric {
  id: string;
  resourceType: ResourceType;
  name: string;
  current: number;
  capacity: number;
  unit: string;
  timestamp: number;
}

export type ResourceType = 'cpu' | 'memory' | 'storage' | 'network' | 'database_connections' | 'api_rate' | 'queue_depth' | 'cache_memory';

export interface CapacityForecast {
  resourceType: ResourceType;
  name: string;
  currentUtilization: number;
  projectedUtilization: number[];
  exhaustionDate: number | null;
  daysUntilExhaustion: number | null;
  growthRate: number;
  confidence: number;
  recommendations: ScalingRecommendation[];
}

export interface ScalingRecommendation {
  type: 'scale_up' | 'scale_out' | 'optimize' | 'cache' | 'archive' | 'no_action';
  description: string;
  urgency: 'immediate' | 'soon' | 'planned' | 'optional';
  estimatedCost: number;
  estimatedImpact: number;
  implementationEffort: 'low' | 'medium' | 'high';
}

export interface BottleneckAnalysis {
  resource: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  utilization: number;
  impactedServices: string[];
  rootCause: string;
  resolution: string;
  estimatedResolutionTime: string;
}

export interface CostModel {
  resourceType: ResourceType;
  currentCost: number;
  projectedCost: number;
  optimizedCost: number;
  savingsPercent: number;
  optimizations: CostOptimization[];
}

export interface CostOptimization {
  description: string;
  currentCost: number;
  optimizedCost: number;
  savings: number;
  risk: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
}

export interface CapacityPlan {
  id: string;
  name: string;
  period: string;
  forecasts: CapacityForecast[];
  bottlenecks: BottleneckAnalysis[];
  costModels: CostModel[];
  totalCurrentCost: number;
  totalProjectedCost: number;
  totalOptimizedCost: number;
  healthScore: number;
  createdAt: number;
}

export interface GrowthScenario {
  name: string;
  userGrowthRate: number;
  dataGrowthRate: number;
  trafficGrowthRate: number;
  durationMonths: number;
}

export class CapacityPlanningEngine {
  private metrics: Map<string, ResourceMetric[]> = new Map();
  private plans: Map<string, CapacityPlan> = new Map();
  private thresholds: Map<ResourceType, { warning: number; critical: number }> = new Map();

  constructor() {
    this.thresholds.set('cpu', { warning: 0.7, critical: 0.9 });
    this.thresholds.set('memory', { warning: 0.75, critical: 0.9 });
    this.thresholds.set('storage', { warning: 0.8, critical: 0.95 });
    this.thresholds.set('network', { warning: 0.6, critical: 0.85 });
    this.thresholds.set('database_connections', { warning: 0.7, critical: 0.9 });
    this.thresholds.set('api_rate', { warning: 0.75, critical: 0.9 });
    this.thresholds.set('queue_depth', { warning: 0.6, critical: 0.8 });
    this.thresholds.set('cache_memory', { warning: 0.8, critical: 0.95 });
  }

  recordMetric(metric: ResourceMetric): void {
    const key = `${metric.resourceType}:${metric.name}`;
    const existing = this.metrics.get(key) || [];
    existing.push(metric);

    if (existing.length > 10000) {
      this.metrics.set(key, existing.slice(-5000));
    } else {
      this.metrics.set(key, existing);
    }
  }

  forecast(resourceType: ResourceType, name: string, daysAhead: number = 30): CapacityForecast {
    const key = `${resourceType}:${name}`;
    const history = this.metrics.get(key) || [];

    if (history.length < 2) {
      return this.emptyForecast(resourceType, name);
    }

    const utilizations = history.map((m) => m.current / Math.max(m.capacity, 1));
    const currentUtilization = utilizations[utilizations.length - 1];
    const growthRate = this.calculateGrowthRate(utilizations);

    const projectedUtilization: number[] = [];
    for (let d = 1; d <= daysAhead; d++) {
      const projected = currentUtilization * Math.pow(1 + growthRate, d);
      projectedUtilization.push(parseFloat(Math.min(1.5, projected).toFixed(4)));
    }

    const exhaustionIndex = projectedUtilization.findIndex((u) => u >= 1.0);
    const exhaustionDate = exhaustionIndex >= 0
      ? Date.now() + (exhaustionIndex + 1) * 24 * 60 * 60 * 1000
      : null;
    const daysUntilExhaustion = exhaustionIndex >= 0 ? exhaustionIndex + 1 : null;

    const confidence = Math.min(0.95, 0.5 + history.length / 200);
    const recommendations = this.generateScalingRecommendations(
      resourceType,
      currentUtilization,
      growthRate,
      daysUntilExhaustion,
    );

    return {
      resourceType,
      name,
      currentUtilization: parseFloat(currentUtilization.toFixed(4)),
      projectedUtilization,
      exhaustionDate,
      daysUntilExhaustion,
      growthRate: parseFloat(growthRate.toFixed(6)),
      confidence: parseFloat(confidence.toFixed(4)),
      recommendations,
    };
  }

  analyzeBottlenecks(): BottleneckAnalysis[] {
    const bottlenecks: BottleneckAnalysis[] = [];

    for (const [key, history] of this.metrics) {
      if (history.length === 0) continue;

      const latest = history[history.length - 1];
      const utilization = latest.current / Math.max(latest.capacity, 1);
      const thresholds = this.thresholds.get(latest.resourceType);

      if (!thresholds) continue;

      if (utilization >= thresholds.critical) {
        bottlenecks.push({
          resource: key,
          severity: 'critical',
          utilization: parseFloat(utilization.toFixed(4)),
          impactedServices: this.findImpactedServices(latest.resourceType),
          rootCause: `${latest.resourceType} at ${(utilization * 100).toFixed(1)}% capacity`,
          resolution: this.getResolution(latest.resourceType, 'critical'),
          estimatedResolutionTime: '1-2 hours',
        });
      } else if (utilization >= thresholds.warning) {
        bottlenecks.push({
          resource: key,
          severity: 'high',
          utilization: parseFloat(utilization.toFixed(4)),
          impactedServices: this.findImpactedServices(latest.resourceType),
          rootCause: `${latest.resourceType} approaching capacity at ${(utilization * 100).toFixed(1)}%`,
          resolution: this.getResolution(latest.resourceType, 'warning'),
          estimatedResolutionTime: '1-3 days',
        });
      }
    }

    return bottlenecks.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  generateCostModel(resourceType: ResourceType): CostModel {
    const baseCosts: Record<ResourceType, number> = {
      cpu: 50,
      memory: 30,
      storage: 10,
      network: 25,
      database_connections: 40,
      api_rate: 20,
      queue_depth: 15,
      cache_memory: 20,
    };

    const currentCost = baseCosts[resourceType] || 20;
    const forecast = this.forecastAll().find((f) => f.resourceType === resourceType);
    const growthFactor = forecast ? Math.max(1, 1 + forecast.growthRate * 30) : 1.1;
    const projectedCost = parseFloat((currentCost * growthFactor).toFixed(2));

    const optimizations: CostOptimization[] = [];

    if (resourceType === 'storage') {
      optimizations.push({
        description: 'Archive cold data to lower-cost storage',
        currentCost,
        optimizedCost: currentCost * 0.7,
        savings: parseFloat((currentCost * 0.3).toFixed(2)),
        risk: 'low',
        effort: 'medium',
      });
    }

    if (resourceType === 'cpu' || resourceType === 'memory') {
      optimizations.push({
        description: 'Enable auto-scaling with spot/preemptible instances',
        currentCost,
        optimizedCost: currentCost * 0.65,
        savings: parseFloat((currentCost * 0.35).toFixed(2)),
        risk: 'medium',
        effort: 'medium',
      });
    }

    if (resourceType === 'cache_memory') {
      optimizations.push({
        description: 'Implement tiered caching with TTL optimization',
        currentCost,
        optimizedCost: currentCost * 0.8,
        savings: parseFloat((currentCost * 0.2).toFixed(2)),
        risk: 'low',
        effort: 'low',
      });
    }

    const totalSavings = optimizations.reduce((sum, o) => sum + o.savings, 0);
    const optimizedCost = parseFloat((currentCost - totalSavings).toFixed(2));
    const savingsPercent = currentCost > 0 ? parseFloat(((totalSavings / currentCost) * 100).toFixed(2)) : 0;

    return {
      resourceType,
      currentCost,
      projectedCost,
      optimizedCost: Math.max(0, optimizedCost),
      savingsPercent,
      optimizations,
    };
  }

  generatePlan(name: string, period: string = '30 days'): CapacityPlan {
    const forecasts = this.forecastAll();
    const bottlenecks = this.analyzeBottlenecks();
    const resourceTypes: ResourceType[] = ['cpu', 'memory', 'storage', 'network', 'database_connections', 'api_rate', 'queue_depth', 'cache_memory'];
    const costModels = resourceTypes.map((rt) => this.generateCostModel(rt));

    const totalCurrentCost = costModels.reduce((sum, c) => sum + c.currentCost, 0);
    const totalProjectedCost = costModels.reduce((sum, c) => sum + c.projectedCost, 0);
    const totalOptimizedCost = costModels.reduce((sum, c) => sum + c.optimizedCost, 0);

    const criticalCount = bottlenecks.filter((b) => b.severity === 'critical').length;
    const highCount = bottlenecks.filter((b) => b.severity === 'high').length;
    const healthScore = Math.max(0, 1 - criticalCount * 0.25 - highCount * 0.1);

    const plan: CapacityPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name,
      period,
      forecasts,
      bottlenecks,
      costModels,
      totalCurrentCost: parseFloat(totalCurrentCost.toFixed(2)),
      totalProjectedCost: parseFloat(totalProjectedCost.toFixed(2)),
      totalOptimizedCost: parseFloat(totalOptimizedCost.toFixed(2)),
      healthScore: parseFloat(healthScore.toFixed(4)),
      createdAt: Date.now(),
    };

    this.plans.set(plan.id, plan);
    logger.info('Capacity plan generated', { planId: plan.id, healthScore: plan.healthScore });
    return plan;
  }

  modelGrowthScenario(scenario: GrowthScenario): CapacityPlan {
    const name = `Scenario: ${scenario.name}`;
    const plan = this.generatePlan(name, `${scenario.durationMonths} months`);

    for (const forecast of plan.forecasts) {
      const multiplier =
        forecast.resourceType === 'storage'
          ? scenario.dataGrowthRate
          : forecast.resourceType === 'network' || forecast.resourceType === 'api_rate'
            ? scenario.trafficGrowthRate
            : scenario.userGrowthRate;

      forecast.projectedUtilization = forecast.projectedUtilization.map((u) =>
        parseFloat((u * (1 + multiplier)).toFixed(4)),
      );
    }

    return plan;
  }

  getPlans(): CapacityPlan[] {
    return Array.from(this.plans.values());
  }

  getMetricHistory(resourceType: ResourceType, name: string): ResourceMetric[] {
    const key = `${resourceType}:${name}`;
    return this.metrics.get(key) || [];
  }

  private forecastAll(daysAhead: number = 30): CapacityForecast[] {
    const forecasts: CapacityForecast[] = [];
    const seen = new Set<string>();

    for (const [key] of this.metrics) {
      const [resourceType, name] = key.split(':');
      const forecastKey = `${resourceType}:${name}`;
      if (seen.has(forecastKey)) continue;
      seen.add(forecastKey);

      forecasts.push(this.forecast(resourceType as ResourceType, name, daysAhead));
    }

    return forecasts;
  }

  private calculateGrowthRate(utilizations: number[]): number {
    if (utilizations.length < 2) return 0;

    const n = Math.min(30, utilizations.length);
    const recent = utilizations.slice(-n);

    let totalGrowth = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1] > 0) {
        totalGrowth += (recent[i] - recent[i - 1]) / recent[i - 1];
      }
    }

    return recent.length > 1 ? totalGrowth / (recent.length - 1) : 0;
  }

  private generateScalingRecommendations(
    resourceType: ResourceType,
    currentUtil: number,
    growthRate: number,
    daysUntilExhaustion: number | null,
  ): ScalingRecommendation[] {
    const recommendations: ScalingRecommendation[] = [];

    if (daysUntilExhaustion !== null && daysUntilExhaustion <= 7) {
      recommendations.push({
        type: 'scale_up',
        description: `Immediate ${resourceType} capacity increase needed - exhaustion in ${daysUntilExhaustion} days`,
        urgency: 'immediate',
        estimatedCost: 100,
        estimatedImpact: 0.9,
        implementationEffort: 'low',
      });
    } else if (daysUntilExhaustion !== null && daysUntilExhaustion <= 30) {
      recommendations.push({
        type: 'scale_out',
        description: `Plan ${resourceType} scaling - exhaustion projected in ${daysUntilExhaustion} days`,
        urgency: 'soon',
        estimatedCost: 75,
        estimatedImpact: 0.8,
        implementationEffort: 'medium',
      });
    }

    if (currentUtil > 0.7 && growthRate > 0.02) {
      recommendations.push({
        type: 'optimize',
        description: `Optimize ${resourceType} usage - high utilization with growing demand`,
        urgency: 'planned',
        estimatedCost: 20,
        estimatedImpact: 0.5,
        implementationEffort: 'medium',
      });
    }

    if (currentUtil < 0.3 && growthRate < 0.01) {
      recommendations.push({
        type: 'no_action',
        description: `${resourceType} is well within capacity - no scaling needed`,
        urgency: 'optional',
        estimatedCost: 0,
        estimatedImpact: 0,
        implementationEffort: 'low',
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        type: 'no_action',
        description: `${resourceType} capacity is adequate for projected growth`,
        urgency: 'optional',
        estimatedCost: 0,
        estimatedImpact: 0,
        implementationEffort: 'low',
      });
    }

    return recommendations;
  }

  private findImpactedServices(resourceType: ResourceType): string[] {
    const serviceMap: Record<ResourceType, string[]> = {
      cpu: ['api', 'worker', 'scheduler'],
      memory: ['api', 'cache', 'worker'],
      storage: ['database', 'file_storage', 'logs'],
      network: ['api', 'cdn', 'replication'],
      database_connections: ['api', 'worker', 'analytics'],
      api_rate: ['api', 'gateway'],
      queue_depth: ['worker', 'scheduler', 'webhooks'],
      cache_memory: ['api', 'search', 'recommendations'],
    };
    return serviceMap[resourceType] || [];
  }

  private getResolution(resourceType: ResourceType, level: string): string {
    if (level === 'critical') {
      return `Immediately increase ${resourceType} capacity or enable auto-scaling`;
    }
    return `Plan ${resourceType} capacity increase within the next sprint`;
  }

  private emptyForecast(resourceType: ResourceType, name: string): CapacityForecast {
    return {
      resourceType,
      name,
      currentUtilization: 0,
      projectedUtilization: [],
      exhaustionDate: null,
      daysUntilExhaustion: null,
      growthRate: 0,
      confidence: 0,
      recommendations: [{
        type: 'no_action',
        description: 'Insufficient data for forecasting',
        urgency: 'optional',
        estimatedCost: 0,
        estimatedImpact: 0,
        implementationEffort: 'low',
      }],
    };
  }
}

let planningInstance: CapacityPlanningEngine | null = null;

export function getCapacityPlanningEngine(): CapacityPlanningEngine {
  if (!planningInstance) {
    planningInstance = new CapacityPlanningEngine();
  }
  return planningInstance;
}
