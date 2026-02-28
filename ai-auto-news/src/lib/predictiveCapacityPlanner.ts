/**
 * @module predictiveCapacityPlanner
 * @description Predictive capacity planning engine implementing demand forecasting
 * via exponential smoothing, resource utilization trend analysis, auto-scaling
 * recommendations, cost-aware provisioning, headroom management, spike prediction,
 * runway estimation, multi-resource optimization, and proactive alert generation
 * for cloud-native infrastructure platforms.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResourceType = 'cpu' | 'memory' | 'disk' | 'network' | 'gpu' | 'connection' | 'token' | 'custom';
export type ScalingDirection = 'scale_up' | 'scale_down' | 'no_action';
export type ScalingStrategy = 'predictive' | 'reactive' | 'scheduled' | 'ml_driven';
export type RunwayStatus = 'critical' | 'warning' | 'adequate' | 'excess';

export interface ResourcePool {
  id: string;
  name: string;
  tenantId: string;
  serviceId: string;
  resourceType: ResourceType;
  currentCapacity: number;
  usedCapacity: number;
  unit: string;
  costPerUnitHour: number;
  minCapacity: number;
  maxCapacity: number;
  scalingStep: number;
  targetUtilizationPct: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

export interface UtilizationSample {
  poolId: string;
  used: number;
  capacity: number;
  utilizationPct: number;
  timestamp: number;
}

export interface ForecastPoint {
  timestamp: number;
  predictedUsed: number;
  predictedPct: number;
  confidenceLow: number;
  confidenceHigh: number;
}

export interface CapacityForecast {
  poolId: string;
  tenantId: string;
  serviceId: string;
  resourceType: ResourceType;
  forecastHorizonMs: number;
  points: ForecastPoint[];
  peakPredictedPct: number;
  runwayMs: number;
  runwayStatus: RunwayStatus;
  generatedAt: number;
}

export interface ScalingRecommendation {
  id: string;
  poolId: string;
  tenantId: string;
  serviceId: string;
  resourceType: ResourceType;
  direction: ScalingDirection;
  strategy: ScalingStrategy;
  currentCapacity: number;
  recommendedCapacity: number;
  deltaCapacity: number;
  deltaCapacityPct: number;
  estimatedCostDeltaPerHour: number;
  urgency: 'immediate' | 'scheduled' | 'informational';
  reason: string;
  validUntil: number;
  createdAt: number;
  applied: boolean;
  appliedAt?: number;
}

export interface CapacityAlert {
  id: string;
  poolId: string;
  tenantId: string;
  serviceId: string;
  type: 'runway_critical' | 'over_provisioned' | 'spike_predicted' | 'cost_overrun';
  message: string;
  currentPct: number;
  thresholdPct: number;
  predictedAt?: number;
  firedAt: number;
  resolvedAt?: number;
}

export interface CostOptimizationOpportunity {
  poolId: string;
  tenantId: string;
  serviceId: string;
  resourceType: ResourceType;
  currentCapacity: number;
  recommendedCapacity: number;
  monthlySavings: number;
  utilizationPct: number;
  riskLevel: 'low' | 'medium' | 'high';
  description: string;
}

export interface PlannerSummary {
  totalPools: number;
  utilizationByType: Record<ResourceType, number>;
  criticalRunways: number;
  pendingRecommendations: number;
  totalMonthlySavingsOpportunity: number;
  activeAlerts: number;
  avgUtilizationPct: number;
}

// ── Exponential Smoothing ─────────────────────────────────────────────────────

function exponentialSmoothing(data: number[], alpha = 0.3): number[] {
  if (data.length === 0) return [];
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class PredictiveCapacityPlanner {
  private readonly pools = new Map<string, ResourcePool>();
  private readonly samples = new Map<string, UtilizationSample[]>();
  private readonly forecasts = new Map<string, CapacityForecast>();
  private readonly recommendations = new Map<string, ScalingRecommendation>();
  private readonly alerts: CapacityAlert[] = [];
  private globalCounter = 0;
  private readonly MAX_SAMPLES = 1440; // ~24h at 1-min resolution

  // Pool management ────────────────────────────────────────────────────────────

  registerPool(params: Omit<ResourcePool, 'createdAt' | 'updatedAt'>): ResourcePool {
    const pool: ResourcePool = { ...params, createdAt: Date.now(), updatedAt: Date.now() };
    this.pools.set(pool.id, pool);
    this.samples.set(pool.id, []);
    logger.info('Resource pool registered', { id: pool.id, resourceType: pool.resourceType });
    return pool;
  }

  updatePool(id: string, updates: Partial<Omit<ResourcePool, 'id' | 'createdAt'>>): ResourcePool {
    const pool = this.pools.get(id);
    if (!pool) throw new Error(`Pool ${id} not found`);
    const updated: ResourcePool = { ...pool, ...updates, updatedAt: Date.now() };
    this.pools.set(id, updated);
    return updated;
  }

  getPool(id: string): ResourcePool | undefined {
    return this.pools.get(id);
  }

  listPools(tenantId?: string, resourceType?: ResourceType): ResourcePool[] {
    let all = Array.from(this.pools.values());
    if (tenantId) all = all.filter(p => p.tenantId === tenantId);
    if (resourceType) all = all.filter(p => p.resourceType === resourceType);
    return all;
  }

  // Utilization recording ──────────────────────────────────────────────────────

  recordUtilization(poolId: string, used: number): UtilizationSample {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error(`Pool ${poolId} not found`);
    pool.usedCapacity = used;
    pool.updatedAt = Date.now();

    const sample: UtilizationSample = {
      poolId,
      used,
      capacity: pool.currentCapacity,
      utilizationPct: pool.currentCapacity > 0 ? (used / pool.currentCapacity) * 100 : 0,
      timestamp: Date.now(),
    };
    const list = this.samples.get(poolId)!;
    list.push(sample);
    if (list.length > this.MAX_SAMPLES) list.shift();

    this.checkThresholds(pool, sample);
    return sample;
  }

  getSamples(poolId: string, limit = 100): UtilizationSample[] {
    const list = this.samples.get(poolId) ?? [];
    return list.slice(-limit);
  }

  // Forecasting ────────────────────────────────────────────────────────────────

  generateForecast(poolId: string, horizonMs = 3 * 60 * 60 * 1000): CapacityForecast {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error(`Pool ${poolId} not found`);
    const list = this.samples.get(poolId) ?? [];
    if (list.length < 5) throw new Error(`Insufficient samples to forecast (need ≥5)`);

    const usedValues = list.map(s => s.used);
    const smoothed = exponentialSmoothing(usedValues);
    const last = smoothed[smoothed.length - 1];
    const trend = smoothed.length >= 2
      ? (smoothed[smoothed.length - 1] - smoothed[smoothed.length - 2]) / list[list.length - 1].timestamp * 1000
      : 0;

    const steps = 12; // 12 points over horizon
    const stepMs = horizonMs / steps;
    const points: ForecastPoint[] = [];
    const now = Date.now();

    for (let i = 1; i <= steps; i++) {
      const tMs = now + i * stepMs;
      const predicted = Math.max(0, last + trend * (i * stepMs / 1000));
      const uncertainty = predicted * 0.1 * Math.sqrt(i);
      const pct = pool.currentCapacity > 0 ? (predicted / pool.currentCapacity) * 100 : 0;
      points.push({
        timestamp: tMs,
        predictedUsed: predicted,
        predictedPct: Math.min(100, pct),
        confidenceLow: Math.max(0, pct - uncertainty),
        confidenceHigh: Math.min(110, pct + uncertainty),
      });
    }

    const peakPct = Math.max(...points.map(p => p.predictedPct));
    const runwayMs = this.estimateRunway(pool, smoothed, trend, horizonMs);
    const runwayStatus: RunwayStatus = runwayMs < 3_600_000 ? 'critical' :
      runwayMs < 86_400_000 ? 'warning' :
      runwayMs > 30 * 86_400_000 ? 'excess' : 'adequate';

    const forecast: CapacityForecast = {
      poolId,
      tenantId: pool.tenantId,
      serviceId: pool.serviceId,
      resourceType: pool.resourceType,
      forecastHorizonMs: horizonMs,
      points,
      peakPredictedPct: peakPct,
      runwayMs,
      runwayStatus,
      generatedAt: now,
    };
    this.forecasts.set(poolId, forecast);

    if (runwayStatus === 'critical') this.fireAlert(pool, 'runway_critical', `Pool will exhaust capacity in ${Math.round(runwayMs / 60_000)} minutes`, peakPct, 90);
    if (peakPct > 90) this.fireAlert(pool, 'spike_predicted', `Spike predicted reaching ${peakPct.toFixed(1)}%`, peakPct, 90, Date.now() + runwayMs);

    return forecast;
  }

  private estimateRunway(pool: ResourcePool, smoothed: number[], trend: number, maxMs: number): number {
    const last = smoothed[smoothed.length - 1];
    if (trend <= 0) return maxMs; // not growing
    const remaining = pool.currentCapacity - last;
    if (remaining <= 0) return 0;
    const secondsToFull = remaining / (trend * 1000);
    return Math.min(maxMs, secondsToFull * 1000);
  }

  getForecast(poolId: string): CapacityForecast | undefined {
    return this.forecasts.get(poolId);
  }

  // Recommendations ────────────────────────────────────────────────────────────

  generateRecommendations(tenantId?: string): ScalingRecommendation[] {
    const newRecs: ScalingRecommendation[] = [];
    const pools = tenantId ? this.listPools(tenantId) : Array.from(this.pools.values());

    for (const pool of pools) {
      const forecast = this.forecasts.get(pool.id);
      const currentPct = pool.currentCapacity > 0 ? (pool.usedCapacity / pool.currentCapacity) * 100 : 0;
      const direction = this.determineDirection(pool, currentPct, forecast);
      if (direction === 'no_action') continue;

      const recommended = direction === 'scale_up'
        ? Math.min(pool.maxCapacity, pool.currentCapacity + pool.scalingStep)
        : Math.max(pool.minCapacity, pool.currentCapacity - pool.scalingStep);

      if (recommended === pool.currentCapacity) continue;

      const delta = recommended - pool.currentCapacity;
      const costDelta = delta * pool.costPerUnitHour;
      const urgency = currentPct > 90 || (forecast?.runwayStatus === 'critical') ? 'immediate' :
        currentPct > 75 ? 'scheduled' : 'informational';

      const rec: ScalingRecommendation = {
        id: `rec_${Date.now()}_${++this.globalCounter}`,
        poolId: pool.id,
        tenantId: pool.tenantId,
        serviceId: pool.serviceId,
        resourceType: pool.resourceType,
        direction,
        strategy: forecast ? 'predictive' : 'reactive',
        currentCapacity: pool.currentCapacity,
        recommendedCapacity: recommended,
        deltaCapacity: delta,
        deltaCapacityPct: (delta / pool.currentCapacity) * 100,
        estimatedCostDeltaPerHour: costDelta,
        urgency,
        reason: this.buildReason(pool, currentPct, forecast, direction),
        validUntil: Date.now() + 3_600_000,
        createdAt: Date.now(),
        applied: false,
      };
      this.recommendations.set(rec.id, rec);
      newRecs.push(rec);
    }
    return newRecs;
  }

  private determineDirection(pool: ResourcePool, currentPct: number, forecast?: CapacityForecast): ScalingDirection {
    const target = pool.targetUtilizationPct;
    if (currentPct > target + 15 || (forecast?.peakPredictedPct ?? 0) > 85) return 'scale_up';
    if (currentPct < target - 30) return 'scale_down';
    return 'no_action';
  }

  private buildReason(pool: ResourcePool, currentPct: number, forecast: CapacityForecast | undefined, direction: ScalingDirection): string {
    const action = direction === 'scale_up' ? 'Scale up' : 'Scale down';
    if (forecast?.runwayStatus === 'critical') return `${action}: capacity runway < 1h (${currentPct.toFixed(1)}% used)`;
    if (forecast?.peakPredictedPct && forecast.peakPredictedPct > 85) return `${action}: predicted peak ${forecast.peakPredictedPct.toFixed(1)}%`;
    if (currentPct < pool.targetUtilizationPct - 30) return `${action}: over-provisioned (${currentPct.toFixed(1)}% used vs ${pool.targetUtilizationPct}% target)`;
    return `${action}: utilization ${currentPct.toFixed(1)}% vs target ${pool.targetUtilizationPct}%`;
  }

  applyRecommendation(id: string): ScalingRecommendation {
    const rec = this.recommendations.get(id);
    if (!rec) throw new Error(`Recommendation ${id} not found`);
    const pool = this.pools.get(rec.poolId);
    if (!pool) throw new Error(`Pool ${rec.poolId} not found`);
    pool.currentCapacity = rec.recommendedCapacity;
    pool.updatedAt = Date.now();
    rec.applied = true;
    rec.appliedAt = Date.now();
    logger.info('Scaling recommendation applied', { id, poolId: rec.poolId, newCapacity: rec.recommendedCapacity });
    return rec;
  }

  listRecommendations(tenantId?: string, applied = false): ScalingRecommendation[] {
    let all = Array.from(this.recommendations.values());
    if (tenantId) all = all.filter(r => r.tenantId === tenantId);
    if (!applied) all = all.filter(r => !r.applied && r.validUntil >= Date.now());
    return all;
  }

  // Cost optimization ──────────────────────────────────────────────────────────

  findCostOpportunities(tenantId?: string): CostOptimizationOpportunity[] {
    const pools = tenantId ? this.listPools(tenantId) : Array.from(this.pools.values());
    const opportunities: CostOptimizationOpportunity[] = [];
    for (const pool of pools) {
      const currentPct = pool.currentCapacity > 0 ? (pool.usedCapacity / pool.currentCapacity) * 100 : 0;
      if (currentPct < pool.targetUtilizationPct - 30) {
        const safeCapacity = Math.max(pool.minCapacity, pool.usedCapacity * 1.3);
        const delta = pool.currentCapacity - safeCapacity;
        if (delta <= 0) continue;
        const monthlySavings = delta * pool.costPerUnitHour * 730;
        opportunities.push({
          poolId: pool.id,
          tenantId: pool.tenantId,
          serviceId: pool.serviceId,
          resourceType: pool.resourceType,
          currentCapacity: pool.currentCapacity,
          recommendedCapacity: Math.ceil(safeCapacity),
          monthlySavings,
          utilizationPct: currentPct,
          riskLevel: currentPct < 20 ? 'low' : 'medium',
          description: `${pool.resourceType} at ${currentPct.toFixed(1)}% – reduce from ${pool.currentCapacity} to ${Math.ceil(safeCapacity)} ${pool.unit}`,
        });
      }
    }
    return opportunities.sort((a, b) => b.monthlySavings - a.monthlySavings);
  }

  // Alerts ─────────────────────────────────────────────────────────────────────

  private checkThresholds(pool: ResourcePool, sample: UtilizationSample): void {
    if (sample.utilizationPct > 90) {
      this.fireAlert(pool, 'runway_critical', `Utilization critical: ${sample.utilizationPct.toFixed(1)}%`, sample.utilizationPct, 90);
    }
    if (sample.utilizationPct < 20 && pool.currentCapacity > pool.minCapacity * 2) {
      this.fireAlert(pool, 'over_provisioned', `Resource significantly under-used: ${sample.utilizationPct.toFixed(1)}%`, sample.utilizationPct, 20);
    }
  }

  private fireAlert(pool: ResourcePool, type: CapacityAlert['type'], message: string, current: number, threshold: number, predictedAt?: number): void {
    const existing = this.alerts.find(a => a.poolId === pool.id && a.type === type && !a.resolvedAt);
    if (existing) return;
    const alert: CapacityAlert = {
      id: `cal_${Date.now()}_${++this.globalCounter}`,
      poolId: pool.id,
      tenantId: pool.tenantId,
      serviceId: pool.serviceId,
      type,
      message,
      currentPct: current,
      thresholdPct: threshold,
      predictedAt,
      firedAt: Date.now(),
    };
    this.alerts.push(alert);
    logger.warn('Capacity alert fired', { type, poolId: pool.id, message });
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) alert.resolvedAt = Date.now();
  }

  listAlerts(tenantId?: string, activeOnly = false): CapacityAlert[] {
    let all = this.alerts;
    if (tenantId) all = all.filter(a => a.tenantId === tenantId);
    if (activeOnly) all = all.filter(a => !a.resolvedAt);
    return all;
  }

  // Summary ────────────────────────────────────────────────────────────────────

  getSummary(): PlannerSummary {
    const pools = Array.from(this.pools.values());
    const utilizationByType: Partial<Record<ResourceType, number>> = {};
    for (const pool of pools) {
      const pct = pool.currentCapacity > 0 ? (pool.usedCapacity / pool.currentCapacity) * 100 : 0;
      const cur = utilizationByType[pool.resourceType];
      utilizationByType[pool.resourceType] = cur === undefined ? pct : (cur + pct) / 2;
    }
    const criticalRunways = Array.from(this.forecasts.values()).filter(f => f.runwayStatus === 'critical').length;
    const pending = Array.from(this.recommendations.values()).filter(r => !r.applied && r.validUntil >= Date.now()).length;
    const opportunities = this.findCostOpportunities();
    const totalSavings = opportunities.reduce((s, o) => s + o.monthlySavings, 0);
    const activeAlerts = this.alerts.filter(a => !a.resolvedAt).length;
    const avgUtil = pools.length > 0
      ? pools.reduce((s, p) => s + (p.currentCapacity > 0 ? (p.usedCapacity / p.currentCapacity) * 100 : 0), 0) / pools.length
      : 0;

    return {
      totalPools: pools.length,
      utilizationByType: utilizationByType as Record<ResourceType, number>,
      criticalRunways,
      pendingRecommendations: pending,
      totalMonthlySavingsOpportunity: totalSavings,
      activeAlerts,
      avgUtilizationPct: avgUtil,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__predictiveCapacityPlanner__';
export function getCapacityPlanner(): PredictiveCapacityPlanner {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new PredictiveCapacityPlanner();
  }
  return (globalThis as Record<string, unknown>)[KEY] as PredictiveCapacityPlanner;
}
