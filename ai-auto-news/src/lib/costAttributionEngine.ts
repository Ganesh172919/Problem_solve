/**
 * Cost Attribution Engine
 *
 * Granular, real-time cost attribution across tenants, features,
 * infrastructure components, and user segments. Supports budget alerts,
 * cost anomaly detection, optimization recommendations, and chargeback reports.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface CostEntry {
  id: string;
  tenantId: string;
  category: CostCategory;
  resourceType: string;
  resourceId: string;
  feature?: string;
  userId?: string;
  amount: number;
  currency: string;
  unit: CostUnit;
  quantity: number;
  unitPrice: number;
  tags: Record<string, string>;
  timestamp: number;
  billingPeriod: string;
  environment: 'production' | 'staging' | 'development';
}

export type CostCategory =
  | 'compute'
  | 'storage'
  | 'network'
  | 'ai_inference'
  | 'database'
  | 'cache'
  | 'cdn'
  | 'monitoring'
  | 'third_party_api'
  | 'licensing'
  | 'support'
  | 'infrastructure';

export type CostUnit =
  | 'cpu_hour'
  | 'memory_gb_hour'
  | 'storage_gb_month'
  | 'network_gb'
  | 'api_call'
  | 'token'
  | 'request'
  | 'connection_hour'
  | 'unit';

export interface Budget {
  id: string;
  tenantId: string;
  name: string;
  amount: number;
  currency: string;
  period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  categories?: CostCategory[];
  alertThresholds: number[];
  currentSpend: number;
  forecastedSpend: number;
  status: BudgetStatus;
  createdAt: number;
  periodStart: number;
  periodEnd: number;
}

export type BudgetStatus = 'on_track' | 'at_risk' | 'exceeded' | 'alert_sent';

export interface CostBreakdown {
  tenantId: string;
  period: string;
  totalCost: number;
  byCategory: Record<CostCategory, number>;
  byFeature: Record<string, number>;
  byEnvironment: Record<string, number>;
  byUser: Record<string, number>;
  byResource: Record<string, number>;
  topCostDrivers: CostDriver[];
  costPerUser: number;
  costPerRequest: number;
  wastedSpend: number;
  optimizationPotential: number;
}

export interface CostDriver {
  resourceId: string;
  resourceType: string;
  category: CostCategory;
  amount: number;
  percentOfTotal: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  trendPercent: number;
}

export interface CostAnomaly {
  id: string;
  tenantId: string;
  category: CostCategory;
  resourceId: string;
  expectedCost: number;
  actualCost: number;
  deviationPercent: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectedAt: number;
  possibleCauses: string[];
  recommendations: string[];
  resolved: boolean;
}

export interface OptimizationRecommendation {
  id: string;
  tenantId: string;
  category: CostCategory;
  resourceId: string;
  type: OptimizationType;
  description: string;
  currentMonthlyCost: number;
  projectedSavings: number;
  savingsPercent: number;
  effort: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  priority: number;
  implementationSteps: string[];
}

export type OptimizationType =
  | 'rightsizing'
  | 'reserved_instances'
  | 'spot_instances'
  | 'idle_resource_cleanup'
  | 'storage_tiering'
  | 'caching'
  | 'batching'
  | 'compression'
  | 'deduplication'
  | 'rate_limit_optimization';

export interface ChargebackReport {
  reportId: string;
  generatedAt: number;
  period: string;
  tenants: TenantChargeback[];
  totalCost: number;
  currency: string;
  summary: ChargbackSummary;
}

export interface TenantChargeback {
  tenantId: string;
  tenantName?: string;
  allocatedCost: number;
  sharedCost: number;
  directCost: number;
  totalCost: number;
  breakdown: Partial<Record<CostCategory, number>>;
  costPercentOfTotal: number;
}

export interface ChargbackSummary {
  largestTenant: string;
  fastestGrowing: string;
  totalDirectCosts: number;
  totalSharedCosts: number;
  avgCostPerTenant: number;
}

export interface CostForecast {
  tenantId: string;
  forecastPeriod: string;
  dailyForecasts: Array<{ date: string; amount: number; confidence: number }>;
  monthlyForecast: number;
  annualForecast: number;
  budgetExceedanceRisk: number;
  confidenceInterval: { low: number; high: number };
  forecastMethod: 'linear' | 'exponential' | 'seasonal';
}

export class CostAttributionEngine {
  private costs = new Map<string, CostEntry[]>();
  private budgets = new Map<string, Budget[]>();
  private anomalies = new Map<string, CostAnomaly[]>();
  private historicalAverages = new Map<string, Map<string, number>>();
  private unitPrices: Record<CostCategory, number> = {
    compute: 0.048,
    storage: 0.023,
    network: 0.09,
    ai_inference: 0.002,
    database: 0.115,
    cache: 0.017,
    cdn: 0.085,
    monitoring: 0.01,
    third_party_api: 0.001,
    licensing: 0,
    support: 0,
    infrastructure: 0.05,
  };

  addCostEntry(entry: Omit<CostEntry, 'id'>): CostEntry {
    const full: CostEntry = {
      ...entry,
      id: `cost-${entry.tenantId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };

    const entries = this.costs.get(entry.tenantId) ?? [];
    entries.push(full);
    this.costs.set(entry.tenantId, entries);

    this.updateHistoricalAverage(entry.tenantId, entry.category, entry.amount);
    this.checkBudgets(entry.tenantId, entry.amount);
    this.detectAnomaly(full);

    return full;
  }

  recordUsage(
    tenantId: string,
    category: CostCategory,
    resourceId: string,
    quantity: number,
    tags: Record<string, string> = {}
  ): CostEntry {
    const unitPrice = this.unitPrices[category];
    return this.addCostEntry({
      tenantId,
      category,
      resourceType: category,
      resourceId,
      amount: quantity * unitPrice,
      currency: 'USD',
      unit: 'unit',
      quantity,
      unitPrice,
      tags,
      timestamp: Date.now(),
      billingPeriod: this.getCurrentBillingPeriod(),
      environment: 'production',
    });
  }

  getBreakdown(tenantId: string, since?: number): CostBreakdown {
    const cutoff = since ?? Date.now() - 30 * 86400_000;
    const entries = (this.costs.get(tenantId) ?? []).filter(e => e.timestamp >= cutoff);

    const totalCost = entries.reduce((s, e) => s + e.amount, 0);
    const byCategory = {} as Record<CostCategory, number>;
    const byFeature: Record<string, number> = {};
    const byEnvironment: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    const byResource: Record<string, number> = {};

    entries.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
      if (e.feature) byFeature[e.feature] = (byFeature[e.feature] ?? 0) + e.amount;
      byEnvironment[e.environment] = (byEnvironment[e.environment] ?? 0) + e.amount;
      if (e.userId) byUser[e.userId] = (byUser[e.userId] ?? 0) + e.amount;
      byResource[e.resourceId] = (byResource[e.resourceId] ?? 0) + e.amount;
    });

    const topCostDrivers: CostDriver[] = Object.entries(byResource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([resourceId, amount]) => {
        const entry = entries.find(e => e.resourceId === resourceId);
        return {
          resourceId,
          resourceType: entry?.resourceType ?? resourceId,
          category: entry?.category ?? 'compute',
          amount,
          percentOfTotal: totalCost > 0 ? (amount / totalCost) * 100 : 0,
          trend: 'stable',
          trendPercent: 0,
        };
      });

    const uniqueUsers = new Set(entries.map(e => e.userId).filter(Boolean)).size;
    const totalRequests = entries.filter(e => e.unit === 'request').reduce((s, e) => s + e.quantity, 0);
    const wastedSpend = this.estimateWastedSpend(entries);

    return {
      tenantId,
      period: new Date(cutoff).toISOString().slice(0, 10),
      totalCost,
      byCategory,
      byFeature,
      byEnvironment,
      byUser,
      byResource,
      topCostDrivers,
      costPerUser: uniqueUsers > 0 ? totalCost / uniqueUsers : 0,
      costPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
      wastedSpend,
      optimizationPotential: wastedSpend * 0.8,
    };
  }

  setBudget(budget: Omit<Budget, 'id' | 'currentSpend' | 'forecastedSpend' | 'status' | 'periodStart' | 'periodEnd'>): Budget {
    const now = Date.now();
    const [periodStart, periodEnd] = this.getPeriodRange(budget.period, now);
    const full: Budget = {
      ...budget,
      id: `budget-${budget.tenantId}-${Date.now()}`,
      currentSpend: this.getTenantSpendForPeriod(budget.tenantId, periodStart),
      forecastedSpend: 0,
      status: 'on_track',
      periodStart,
      periodEnd,
    };

    full.forecastedSpend = this.forecastSpend(budget.tenantId, full);
    full.status = this.computeBudgetStatus(full);

    const budgets = this.budgets.get(budget.tenantId) ?? [];
    budgets.push(full);
    this.budgets.set(budget.tenantId, budgets);

    logger.info('Budget set', { tenantId: budget.tenantId, amount: budget.amount, period: budget.period });
    return full;
  }

  getBudgets(tenantId: string): Budget[] {
    return (this.budgets.get(tenantId) ?? []).map(b => ({
      ...b,
      currentSpend: this.getTenantSpendForPeriod(tenantId, b.periodStart),
      status: this.computeBudgetStatus(b),
    }));
  }

  getAnomalies(tenantId: string, resolved = false): CostAnomaly[] {
    return (this.anomalies.get(tenantId) ?? []).filter(a => a.resolved === resolved);
  }

  resolveAnomaly(tenantId: string, anomalyId: string): void {
    const anomalies = this.anomalies.get(tenantId) ?? [];
    const anomaly = anomalies.find(a => a.id === anomalyId);
    if (anomaly) anomaly.resolved = true;
  }

  generateOptimizations(tenantId: string): OptimizationRecommendation[] {
    const breakdown = this.getBreakdown(tenantId);
    const recommendations: OptimizationRecommendation[] = [];

    Object.entries(breakdown.byCategory).forEach(([cat, amount]) => {
      const category = cat as CostCategory;
      if (amount > 100 && category === 'compute') {
        recommendations.push({
          id: `opt-${tenantId}-${category}-${Date.now()}`,
          tenantId,
          category,
          resourceId: category,
          type: 'rightsizing',
          description: 'Right-size compute instances based on actual utilization',
          currentMonthlyCost: amount,
          projectedSavings: amount * 0.3,
          savingsPercent: 30,
          effort: 'medium',
          risk: 'low',
          priority: 1,
          implementationSteps: [
            'Analyze CPU and memory utilization over 30 days',
            'Identify over-provisioned instances',
            'Schedule downsize during maintenance window',
            'Monitor performance after change',
          ],
        });
      }

      if (amount > 50 && category === 'storage') {
        recommendations.push({
          id: `opt-${tenantId}-${category}-${Date.now()}`,
          tenantId,
          category,
          resourceId: category,
          type: 'storage_tiering',
          description: 'Move infrequently accessed data to cold storage tier',
          currentMonthlyCost: amount,
          projectedSavings: amount * 0.5,
          savingsPercent: 50,
          effort: 'low',
          risk: 'low',
          priority: 2,
          implementationSteps: [
            'Identify data accessed < once per month',
            'Configure lifecycle policies',
            'Move eligible objects to cold storage',
          ],
        });
      }

      if (amount > 200 && category === 'ai_inference') {
        recommendations.push({
          id: `opt-${tenantId}-${category}-${Date.now()}`,
          tenantId,
          category,
          resourceId: category,
          type: 'caching',
          description: 'Cache AI inference results for repeated similar queries',
          currentMonthlyCost: amount,
          projectedSavings: amount * 0.4,
          savingsPercent: 40,
          effort: 'medium',
          risk: 'low',
          priority: 1,
          implementationSteps: [
            'Implement semantic similarity caching layer',
            'Set TTL based on freshness requirements',
            'Monitor cache hit rates',
          ],
        });
      }
    });

    return recommendations.sort((a, b) => b.projectedSavings - a.projectedSavings);
  }

  generateChargebackReport(period?: string): ChargebackReport {
    const reportPeriod = period ?? this.getCurrentBillingPeriod();
    const allTenants = Array.from(this.costs.keys());

    const tenantChargebacks: TenantChargeback[] = allTenants.map(tenantId => {
      const breakdown = this.getBreakdown(tenantId);
      return {
        tenantId,
        allocatedCost: breakdown.totalCost * 0.7,
        sharedCost: breakdown.totalCost * 0.3,
        directCost: breakdown.totalCost,
        totalCost: breakdown.totalCost,
        breakdown: breakdown.byCategory,
        costPercentOfTotal: 0,
      };
    });

    const totalCost = tenantChargebacks.reduce((s, t) => s + t.totalCost, 0);
    tenantChargebacks.forEach(t => {
      t.costPercentOfTotal = totalCost > 0 ? (t.totalCost / totalCost) * 100 : 0;
    });

    const sorted = [...tenantChargebacks].sort((a, b) => b.totalCost - a.totalCost);
    const fastestGrowing = tenantChargebacks[0]?.tenantId ?? '';

    return {
      reportId: `chargeback-${Date.now()}`,
      generatedAt: Date.now(),
      period: reportPeriod,
      tenants: tenantChargebacks,
      totalCost,
      currency: 'USD',
      summary: {
        largestTenant: sorted[0]?.tenantId ?? '',
        fastestGrowing,
        totalDirectCosts: tenantChargebacks.reduce((s, t) => s + t.directCost, 0),
        totalSharedCosts: tenantChargebacks.reduce((s, t) => s + t.sharedCost, 0),
        avgCostPerTenant: allTenants.length > 0 ? totalCost / allTenants.length : 0,
      },
    };
  }

  forecastCosts(tenantId: string, days = 30): CostForecast {
    const now = Date.now();
    const entries = (this.costs.get(tenantId) ?? []).filter(
      e => e.timestamp >= now - 60 * 86400_000
    );

    const dailyTotals: Record<string, number> = {};
    entries.forEach(e => {
      const day = new Date(e.timestamp).toISOString().slice(0, 10);
      dailyTotals[day] = (dailyTotals[day] ?? 0) + e.amount;
    });

    const values = Object.values(dailyTotals);
    const avgDaily = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const trend = values.length > 1
      ? (values[values.length - 1] - values[0]) / Math.max(values.length - 1, 1)
      : 0;

    const dailyForecasts = Array.from({ length: days }, (_, i) => {
      const date = new Date(now + i * 86400_000).toISOString().slice(0, 10);
      const amount = Math.max(0, avgDaily + trend * i);
      return { date, amount, confidence: Math.max(0.5, 0.95 - i * 0.01) };
    });

    const monthlyForecast = dailyForecasts.reduce((s, d) => s + d.amount, 0);
    const budgets = this.getBudgets(tenantId);
    const monthlyBudget = budgets.find(b => b.period === 'monthly')?.amount;
    const budgetExceedanceRisk = monthlyBudget
      ? Math.min(1, monthlyForecast / monthlyBudget)
      : 0;

    return {
      tenantId,
      forecastPeriod: `${days}d`,
      dailyForecasts,
      monthlyForecast,
      annualForecast: monthlyForecast * 12,
      budgetExceedanceRisk,
      confidenceInterval: {
        low: monthlyForecast * 0.85,
        high: monthlyForecast * 1.15,
      },
      forecastMethod: 'linear',
    };
  }

  private updateHistoricalAverage(tenantId: string, category: CostCategory, amount: number): void {
    if (!this.historicalAverages.has(tenantId)) {
      this.historicalAverages.set(tenantId, new Map());
    }
    const avgMap = this.historicalAverages.get(tenantId)!;
    const key = `${category}:daily`;
    const existing = avgMap.get(key) ?? amount;
    avgMap.set(key, existing * 0.9 + amount * 0.1);
  }

  private detectAnomaly(entry: CostEntry): void {
    const avgMap = this.historicalAverages.get(entry.tenantId);
    if (!avgMap) return;

    const avgKey = `${entry.category}:daily`;
    const avg = avgMap.get(avgKey) ?? 0;
    if (avg === 0) return;

    const deviationPercent = ((entry.amount - avg) / avg) * 100;
    if (Math.abs(deviationPercent) < 50) return;

    const severity: CostAnomaly['severity'] =
      Math.abs(deviationPercent) > 200 ? 'critical' :
      Math.abs(deviationPercent) > 100 ? 'high' :
      Math.abs(deviationPercent) > 75 ? 'medium' : 'low';

    const anomaly: CostAnomaly = {
      id: `anomaly-${entry.tenantId}-${Date.now()}`,
      tenantId: entry.tenantId,
      category: entry.category,
      resourceId: entry.resourceId,
      expectedCost: avg,
      actualCost: entry.amount,
      deviationPercent,
      severity,
      detectedAt: Date.now(),
      possibleCauses: this.getCauses(entry.category, deviationPercent),
      recommendations: this.getAnomalyRecommendations(entry.category),
      resolved: false,
    };

    const anomalies = this.anomalies.get(entry.tenantId) ?? [];
    anomalies.push(anomaly);
    this.anomalies.set(entry.tenantId, anomalies);

    if (severity === 'critical' || severity === 'high') {
      logger.warn('Cost anomaly detected', {
        tenantId: entry.tenantId,
        category: entry.category,
        deviationPercent: deviationPercent.toFixed(1),
        severity,
      });
    }
  }

  private checkBudgets(tenantId: string, newAmount: number): void {
    const budgets = this.budgets.get(tenantId) ?? [];
    budgets.forEach(budget => {
      budget.currentSpend += newAmount;
      const pct = budget.currentSpend / budget.amount;
      budget.alertThresholds.forEach(threshold => {
        if (pct >= threshold / 100 && budget.status !== 'alert_sent') {
          logger.warn('Budget threshold reached', {
            tenantId,
            budgetId: budget.id,
            threshold,
            currentSpend: budget.currentSpend,
            budgetAmount: budget.amount,
          });
        }
      });
      budget.status = this.computeBudgetStatus(budget);
    });
  }

  private computeBudgetStatus(budget: Budget): BudgetStatus {
    const pct = budget.currentSpend / budget.amount;
    if (pct >= 1) return 'exceeded';
    if (budget.forecastedSpend >= budget.amount) return 'at_risk';
    return 'on_track';
  }

  private getTenantSpendForPeriod(tenantId: string, since: number): number {
    return (this.costs.get(tenantId) ?? [])
      .filter(e => e.timestamp >= since)
      .reduce((s, e) => s + e.amount, 0);
  }

  private forecastSpend(tenantId: string, budget: Budget): number {
    const entries = this.costs.get(tenantId) ?? [];
    const recentEntries = entries.filter(e => e.timestamp >= budget.periodStart);
    const elapsed = (Date.now() - budget.periodStart) / (budget.periodEnd - budget.periodStart);
    if (elapsed <= 0) return 0;
    const currentSpend = recentEntries.reduce((s, e) => s + e.amount, 0);
    return currentSpend / elapsed;
  }

  private estimateWastedSpend(entries: CostEntry[]): number {
    const idleCompute = entries
      .filter(e => e.category === 'compute' && e.tags['utilization'] && Number(e.tags['utilization']) < 0.2)
      .reduce((s, e) => s + e.amount, 0);
    const idleStorage = entries
      .filter(e => e.category === 'storage' && e.tags['accessed'] === 'false')
      .reduce((s, e) => s + e.amount, 0);
    return idleCompute + idleStorage;
  }

  private getPeriodRange(period: Budget['period'], now: number): [number, number] {
    const date = new Date(now);
    switch (period) {
      case 'daily': {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        return [start, start + 86400_000];
      }
      case 'weekly': {
        const day = date.getDay();
        const start = now - day * 86400_000;
        return [start, start + 7 * 86400_000];
      }
      case 'monthly': {
        const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
        return [start, end];
      }
      case 'quarterly': {
        const quarter = Math.floor(date.getMonth() / 3);
        const start = new Date(date.getFullYear(), quarter * 3, 1).getTime();
        const end = new Date(date.getFullYear(), quarter * 3 + 3, 1).getTime();
        return [start, end];
      }
      case 'annual': {
        const start = new Date(date.getFullYear(), 0, 1).getTime();
        const end = new Date(date.getFullYear() + 1, 0, 1).getTime();
        return [start, end];
      }
    }
  }

  private getCurrentBillingPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private getCauses(category: CostCategory, deviationPercent: number): string[] {
    const causes: Record<CostCategory, string[]> = {
      compute: ['Auto-scaling triggered', 'Traffic spike', 'Runaway process', 'Batch job'],
      storage: ['Data backup completed', 'Log rotation disabled', 'Cache growth'],
      network: ['DDoS attack', 'Large data transfer', 'CDN misconfiguration'],
      ai_inference: ['Increased API calls', 'Token limit removed', 'New feature rollout'],
      database: ['N+1 query issue', 'Missing index', 'Connection pool exhaustion'],
      cache: ['Cache miss storm', 'Eviction policy change'],
      cdn: ['Traffic redistribution', 'New regions enabled'],
      monitoring: ['Log volume spike', 'New metrics added'],
      third_party_api: ['Rate limit exceeded', 'New integration'],
      licensing: ['New user seats added'],
      support: ['Enterprise support upgrade'],
      infrastructure: ['Compliance scan', 'Disaster recovery test'],
    };
    return deviationPercent > 0 ? causes[category] ?? [] : ['Optimization applied', 'Traffic decrease'];
  }

  private getAnomalyRecommendations(category: CostCategory): string[] {
    const recs: Record<CostCategory, string[]> = {
      compute: ['Review auto-scaling policies', 'Check for runaway processes'],
      storage: ['Enable lifecycle policies', 'Review retention settings'],
      network: ['Check for data exfiltration', 'Review CDN configuration'],
      ai_inference: ['Implement response caching', 'Review token usage'],
      database: ['Analyze slow query log', 'Review indexing strategy'],
      cache: ['Review eviction policies', 'Check cache capacity'],
      cdn: ['Review origin pull settings', 'Check edge location costs'],
      monitoring: ['Review log verbosity', 'Check metric cardinality'],
      third_party_api: ['Review API call patterns', 'Implement request batching'],
      licensing: ['Audit active user seats'],
      support: ['Review support tier'],
      infrastructure: ['Review resource provisioning'],
    };
    return recs[category] ?? [];
  }
}

let _engine: CostAttributionEngine | null = null;

export function getCostAttributionEngine(): CostAttributionEngine {
  if (!_engine) {
    _engine = new CostAttributionEngine();
  }
  return _engine;
}
