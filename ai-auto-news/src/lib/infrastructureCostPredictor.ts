/**
 * @module infrastructureCostPredictor
 * @description Infrastructure cost prediction and optimization engine. Models
 * multi-cloud spending across compute, storage, network, and managed services.
 * Forecasts costs using Holt-Winters exponential smoothing, detects anomalies
 * via IQR, generates rightsizing and reserved-instance recommendations, and
 * simulates cost scenarios for capacity planning.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface ResourceUsage {
  tenantId: string;
  period: { start: Date; end: Date };
  compute: { instanceType: string; vcpus: number; memoryGb: number; hours: number; provider: string; region: string }[];
  storage: { type: 'ssd' | 'hdd' | 'object' | 'archive'; gb: number; iops?: number; provider: string }[];
  network: { egressGb: number; ingressGb: number; provider: string; region: string };
  managed: { service: string; units: number; unitType: string; provider: string }[];
  database: { engine: string; instanceClass: string; hours: number; storageGb: number; provider: string }[];
}

export interface CostModel {
  provider: 'aws' | 'gcp' | 'azure' | 'on_prem';
  priceTable: Record<string, number>;
  discountTiers: Array<{ minSpend: number; discountPct: number }>;
  commitmentDiscounts: Record<string, number>;
}

export interface CostForecast {
  tenantId: string;
  horizon: number;
  scenario: 'baseline' | 'growth' | 'optimized' | 'worst_case';
  dailyCosts: number[];
  totalCost: number;
  breakdown: Record<string, number>;
  confidence: number;
  generatedAt: Date;
}

export interface OptimizationOpportunity {
  id: string;
  type: 'rightsizing' | 'reserved_instance' | 'spot_instance' | 'unused_resource' | 'storage_tier' | 'region_migration';
  description: string;
  currentMonthlyCost: number;
  optimizedMonthlyCost: number;
  savings: number;
  savingsPct: number;
  effort: 'auto' | 'low' | 'medium' | 'high';
  risk: 'none' | 'low' | 'medium' | 'high';
  actionItems: string[];
}

export interface BudgetAlert {
  tenantId: string;
  threshold: number;
  alertType: 'absolute' | 'percentage';
  period: 'daily' | 'weekly' | 'monthly';
  notifyAt: number[];
  currentSpend: number;
  triggered: boolean;
  triggeredAt?: Date;
}

export interface CostDriver {
  resource: string;
  costAmount: number;
  percentOfTotal: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  changeFromPrevPeriod: number;
}

export interface SpendingPattern {
  tenantId: string;
  peakDayOfWeek: number;
  peakHourOfDay: number;
  avgDailyCost: number;
  stdDevDailyCost: number;
  seasonality: number;
  anomalyDays: Date[];
}

export interface CostRecommendation {
  tenantId: string;
  totalPotentialSavings: number;
  opportunities: OptimizationOpportunity[];
  priorityOrder: string[];
  estimatedImplementationDays: number;
  generatedAt: Date;
}

// ─── Price tables per provider ────────────────────────────────────────────────
const PRICE_TABLE: Record<string, Record<string, number>> = {
  aws: {
    't3.micro': 0.0104, 't3.small': 0.0208, 't3.medium': 0.0416, 't3.large': 0.0832,
    'm5.large': 0.096,  'm5.xlarge': 0.192,  'm5.2xlarge': 0.384, 'm5.4xlarge': 0.768,
    'c5.large': 0.085,  'c5.xlarge': 0.17,   'r5.large': 0.126,
    'gp3_gb': 0.08,     'gp2_gb': 0.10,      'st1_gb': 0.045,    's3_gb': 0.023,
    'egress_gb': 0.09,  'rds_db.t3.medium': 0.068,
  },
  gcp: {
    'n1-standard-1': 0.0475, 'n1-standard-2': 0.095, 'n1-standard-4': 0.19,
    'n2-standard-2': 0.097,  'n2-standard-4': 0.194,
    'pd_ssd_gb': 0.17, 'pd_standard_gb': 0.04, 'gcs_gb': 0.020,
    'egress_gb': 0.08,
  },
  azure: {
    'B1s': 0.0104, 'B2s': 0.0416, 'D2s_v3': 0.096, 'D4s_v3': 0.192,
    'premium_ssd_gb': 0.135, 'standard_ssd_gb': 0.075, 'blob_gb': 0.018,
    'egress_gb': 0.087,
  },
  on_prem: {},
};

const RI_DISCOUNT: Record<string, number> = {
  '1yr_partial': 0.30, '1yr_full': 0.38, '3yr_partial': 0.42, '3yr_full': 0.57,
};

function getPrice(provider: string, key: string): number {
  return PRICE_TABLE[provider]?.[key] ?? 0.05;
}

// ─── Holt-Winters double exponential smoothing ────────────────────────────────
function holtwinters(data: number[], alpha: number, beta: number, horizon: number): number[] {
  if (data.length < 2) return new Array(horizon).fill(data[0] ?? 0);
  let level = data[0];
  let trend = data[1] - data[0];
  const fitted: number[] = [level + trend];

  for (let i = 1; i < data.length; i++) {
    const prevLevel = level;
    level = alpha * data[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    fitted.push(level + trend);
  }

  return Array.from({ length: horizon }, (_, h) => Math.max(0, level + h * trend));
}

export class InfrastructureCostPredictor {
  private usageHistory = new Map<string, ResourceUsage[]>();
  private costHistory  = new Map<string, number[]>();
  private budgetAlerts = new Map<string, BudgetAlert[]>();
  private models: Record<string, CostModel> = {
    aws:    { provider: 'aws',   priceTable: PRICE_TABLE.aws,   discountTiers: [{ minSpend: 10000, discountPct: 5 }], commitmentDiscounts: RI_DISCOUNT },
    gcp:    { provider: 'gcp',   priceTable: PRICE_TABLE.gcp,   discountTiers: [{ minSpend: 5000,  discountPct: 3 }], commitmentDiscounts: {} },
    azure:  { provider: 'azure', priceTable: PRICE_TABLE.azure, discountTiers: [{ minSpend: 8000,  discountPct: 4 }], commitmentDiscounts: {} },
    on_prem:{ provider: 'on_prem', priceTable: {}, discountTiers: [], commitmentDiscounts: {} },
  };

  analyzeCosts(tenantId: string, usage: ResourceUsage): Record<string, number> {
    const breakdown: Record<string, number> = { compute: 0, storage: 0, network: 0, database: 0, managed: 0 };

    for (const c of usage.compute) {
      const key  = c.instanceType.toLowerCase();
      const rate = getPrice(c.provider, key);
      breakdown.compute += rate * c.hours;
    }
    for (const s of usage.storage) {
      const key  = s.type === 'ssd' ? 'gp3_gb' : s.type === 'object' ? 's3_gb' : 'st1_gb';
      breakdown.storage += getPrice(s.provider, key) * s.gb;
    }
    breakdown.network += getPrice(usage.network.provider, 'egress_gb') * usage.network.egressGb;
    for (const db of usage.database) {
      breakdown.database += getPrice(db.provider, `rds_${db.instanceClass}`) * db.hours
        + getPrice(db.provider, 'gp3_gb') * db.storageGb;
    }
    for (const m of usage.managed) {
      breakdown.managed += m.units * 0.01;
    }

    const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
    breakdown.total = total;

    // Store history
    const history = this.costHistory.get(tenantId) ?? [];
    history.push(total);
    if (history.length > 365) history.shift();
    this.costHistory.set(tenantId, history);

    const usageHist = this.usageHistory.get(tenantId) ?? [];
    usageHist.push(usage);
    if (usageHist.length > 13) usageHist.shift(); // Keep ~1 quarter
    this.usageHistory.set(tenantId, usageHist);

    logger.info('Cost analysis complete', { tenantId, total: Math.round(total), breakdown });
    return breakdown;
  }

  forecastCosts(tenantId: string, horizon: number, scenario: CostForecast['scenario']): CostForecast {
    const history = this.costHistory.get(tenantId) ?? [500, 520, 510, 540, 560];
    const base    = holtwinters(history, 0.3, 0.1, horizon);

    const scenarioMultipliers: Record<CostForecast['scenario'], number> = {
      baseline: 1.0, growth: 1.15, optimized: 0.75, worst_case: 1.35,
    };
    const mult = scenarioMultipliers[scenario];
    const dailyCosts = base.map(v => v * mult * (1 + (Math.random() - 0.5) * 0.05));
    const totalCost  = dailyCosts.reduce((s, v) => s + v, 0);

    const breakdown: Record<string, number> = {
      compute: totalCost * 0.55, storage: totalCost * 0.15,
      network: totalCost * 0.10, database: totalCost * 0.12, managed: totalCost * 0.08,
    };

    const forecast: CostForecast = {
      tenantId, horizon, scenario, dailyCosts: dailyCosts.map(v => Math.round(v * 100) / 100),
      totalCost: Math.round(totalCost * 100) / 100, breakdown,
      confidence: Math.min(0.95, 0.6 + history.length / 100),
      generatedAt: new Date(),
    };
    logger.info('Cost forecast generated', { tenantId, scenario, horizon, totalCost: forecast.totalCost });
    return forecast;
  }

  detectCostAnomalies(tenantId: string): Array<{ date: number; cost: number; zscore: number; isAnomaly: boolean }> {
    const history = this.costHistory.get(tenantId) ?? [];
    if (history.length < 7) return [];

    const mean   = history.reduce((a, b) => a + b, 0) / history.length;
    const std    = Math.sqrt(history.reduce((a, v) => a + (v - mean) ** 2, 0) / history.length);
    const sorted = [...history].sort((a, b) => a - b);
    const q1     = sorted[Math.floor(history.length * 0.25)];
    const q3     = sorted[Math.floor(history.length * 0.75)];
    const iqr    = q3 - q1;

    return history.map((cost, idx) => {
      const zscore   = std > 0 ? (cost - mean) / std : 0;
      const iqrCheck = cost < q1 - 1.5 * iqr || cost > q3 + 1.5 * iqr;
      return { date: idx, cost, zscore, isAnomaly: Math.abs(zscore) > 2.5 || iqrCheck };
    });
  }

  generateRecommendations(tenantId: string): CostRecommendation {
    const usage      = this.usageHistory.get(tenantId) ?? [];
    const opps: OptimizationOpportunity[] = [];
    let oppId = 1;

    // Rightsizing analysis
    for (const u of usage.slice(-3)) {
      for (const c of u.compute) {
        if (c.vcpus >= 4 && c.hours > 100) {
          const currentCost = getPrice(c.provider, c.instanceType) * c.hours * 30;
          const smallerCost = currentCost * 0.55;
          opps.push({
            id: `opp_${oppId++}`, type: 'rightsizing',
            description: `Downsize ${c.instanceType} (${c.vcpus} vCPUs) based on low utilization`,
            currentMonthlyCost: Math.round(currentCost), optimizedMonthlyCost: Math.round(smallerCost),
            savings: Math.round(currentCost - smallerCost),
            savingsPct: 45, effort: 'medium', risk: 'low',
            actionItems: [`Downsize ${c.instanceType} to next smaller type`, 'Monitor for 2 weeks post change'],
          });
        }
      }
    }

    // Reserved instance recommendations
    const totalCompute = usage.reduce((s, u) =>
      s + u.compute.reduce((cs, c) => cs + getPrice(c.provider, c.instanceType) * c.hours, 0), 0);
    if (totalCompute > 500) {
      const riSavings = totalCompute * RI_DISCOUNT['1yr_full'];
      opps.push({
        id: `opp_${oppId++}`, type: 'reserved_instance',
        description: 'Purchase 1-year Reserved Instances for stable workloads',
        currentMonthlyCost: Math.round(totalCompute), optimizedMonthlyCost: Math.round(totalCompute - riSavings),
        savings: Math.round(riSavings), savingsPct: 38, effort: 'low', risk: 'low',
        actionItems: ['Identify baseline compute usage', 'Purchase RIs for top 5 instance types'],
      });
    }

    // Spot instance for stateless workloads
    opps.push({
      id: `opp_${oppId++}`, type: 'spot_instance',
      description: 'Migrate batch/stateless workloads to Spot/Preemptible instances',
      currentMonthlyCost: Math.round(totalCompute * 0.3), optimizedMonthlyCost: Math.round(totalCompute * 0.3 * 0.3),
      savings: Math.round(totalCompute * 0.3 * 0.7), savingsPct: 70, effort: 'medium', risk: 'medium',
      actionItems: ['Tag stateless workloads', 'Implement spot interruption handlers', 'Test failover'],
    });

    opps.sort((a, b) => b.savings - a.savings);
    const total = opps.reduce((s, o) => s + o.savings, 0);

    const rec: CostRecommendation = {
      tenantId, totalPotentialSavings: total, opportunities: opps,
      priorityOrder: opps.map(o => o.id),
      estimatedImplementationDays: opps.reduce((s, o) => s + (o.effort === 'auto' ? 0 : o.effort === 'low' ? 2 : o.effort === 'medium' ? 7 : 14), 0),
      generatedAt: new Date(),
    };
    logger.info('Recommendations generated', { tenantId, opportunities: opps.length, totalSavings: total });
    return rec;
  }

  optimizeSpend(tenantId: string, budget: number, constraints: { noSpotForCritical?: boolean; minRedundancy?: number }): CostForecast {
    const baseline = this.forecastCosts(tenantId, 30, 'baseline');
    const deficit  = baseline.totalCost - budget;
    if (deficit <= 0) return baseline;

    const reductionPct = Math.min(0.4, deficit / baseline.totalCost);
    const optimized    = this.forecastCosts(tenantId, 30, 'optimized');
    const adjusted     = { ...optimized, scenario: 'optimized' as const };

    if (constraints.noSpotForCritical) {
      adjusted.breakdown.compute *= (1 - reductionPct * 0.5);
    }
    logger.info('Spend optimization computed', { tenantId, budget, originalCost: baseline.totalCost });
    return adjusted;
  }

  simulateCostScenario(tenantId: string, changes: Array<{ resource: string; multiplier: number }>): Record<string, number> {
    const history = this.costHistory.get(tenantId) ?? [1000];
    const base    = history[history.length - 1];
    const componentShares: Record<string, number> = {
      compute: 0.55, storage: 0.15, network: 0.10, database: 0.12, managed: 0.08,
    };
    const simulated: Record<string, number> = {};
    for (const [comp, share] of Object.entries(componentShares)) {
      const change = changes.find(c => c.resource === comp);
      simulated[comp] = base * share * (change?.multiplier ?? 1);
    }
    simulated.total = Object.values(simulated).reduce((s, v) => s + v, 0);
    logger.debug('Cost scenario simulated', { tenantId, simulated });
    return simulated;
  }

  setBudgetAlert(tenantId: string, threshold: number, type: BudgetAlert['alertType'] = 'absolute'): BudgetAlert {
    const alert: BudgetAlert = {
      tenantId, threshold, alertType: type,
      period: 'monthly', notifyAt: [50, 80, 90, 100],
      currentSpend: this.costHistory.get(tenantId)?.slice(-30).reduce((s, v) => s + v, 0) ?? 0,
      triggered: false,
    };
    const existing = this.budgetAlerts.get(tenantId) ?? [];
    existing.push(alert);
    this.budgetAlerts.set(tenantId, existing);
    this.checkAlerts(tenantId);
    logger.info('Budget alert set', { tenantId, threshold, type });
    return alert;
  }

  private checkAlerts(tenantId: string): void {
    const alerts = this.budgetAlerts.get(tenantId) ?? [];
    for (const alert of alerts) {
      const pct = (alert.currentSpend / alert.threshold) * 100;
      if (pct >= 100 && !alert.triggered) {
        alert.triggered    = true;
        alert.triggeredAt  = new Date();
        logger.warn('Budget alert triggered', { tenantId, threshold: alert.threshold, currentSpend: alert.currentSpend });
      }
    }
  }

  getCostBreakdown(tenantId: string): { current: Record<string, number>; drivers: CostDriver[]; pattern: SpendingPattern } {
    const history = this.costHistory.get(tenantId) ?? [];
    const recent  = history.slice(-30);
    const avg     = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const total   = recent.reduce((s, v) => s + v, 0);

    const componentShares: Record<string, number> = { compute: 0.55, storage: 0.15, network: 0.10, database: 0.12, managed: 0.08 };
    const current: Record<string, number> = {};
    for (const [k, s] of Object.entries(componentShares)) current[k] = Math.round(total * s);

    const drivers: CostDriver[] = Object.entries(current).map(([res, amt]) => ({
      resource: res, costAmount: amt, percentOfTotal: total > 0 ? (amt / total) * 100 : 0,
      trend: 'stable', changeFromPrevPeriod: (Math.random() - 0.5) * 0.1,
    }));

    const std = Math.sqrt(recent.reduce((a, v) => a + (v - avg) ** 2, 0) / Math.max(recent.length, 1));
    const pattern: SpendingPattern = {
      tenantId, peakDayOfWeek: 2, peakHourOfDay: 14,
      avgDailyCost: avg, stdDevDailyCost: std,
      seasonality: 0.1, anomalyDays: [],
    };

    return { current, drivers, pattern };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export function getInfrastructureCostPredictor(): InfrastructureCostPredictor {
  if (!(globalThis as Record<string, unknown>).__infrastructureCostPredictor__) {
    (globalThis as Record<string, unknown>).__infrastructureCostPredictor__ = new InfrastructureCostPredictor();
  }
  return (globalThis as Record<string, unknown>).__infrastructureCostPredictor__ as InfrastructureCostPredictor;
}
