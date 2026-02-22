/**
 * Intelligent Cost Optimizer
 *
 * AI-driven infrastructure cost optimization with:
 * - Resource utilization analysis and rightsizing recommendations
 * - Reserved vs spot vs on-demand instance strategy
 * - Cost anomaly detection with statistical methods
 * - Wastage identification (idle/underutilized resources)
 * - Multi-cloud cost comparison
 * - Automated cost alerts with configurable thresholds
 * - Savings projections and ROI tracking
 * - Budget forecasting and burn rate analysis
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import crypto from 'crypto';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

export type CloudProvider = 'aws' | 'gcp' | 'azure' | 'digitalocean' | 'hetzner';
export type ResourceType = 'compute' | 'storage' | 'database' | 'networking' | 'ai-api' | 'cdn' | 'monitoring' | 'other';
export type PurchaseType = 'on-demand' | 'reserved-1yr' | 'reserved-3yr' | 'spot' | 'committed-use';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface ResourceRecord {
  id: string;
  name: string;
  provider: CloudProvider;
  type: ResourceType;
  region: string;
  purchaseType: PurchaseType;
  hourlyCost: number;
  monthlyCost: number;
  utilizationPercent: number;      // 0–100
  cpuAvgPercent?: number;
  memoryAvgPercent?: number;
  currentSpec: ResourceSpec;
  recommendedSpec?: ResourceSpec;
  tags: Record<string, string>;
  lastUpdated: Date;
  isIdle: boolean;
}

export interface ResourceSpec {
  vcpus?: number;
  memoryGb?: number;
  storageGb?: number;
  instanceType?: string;
}

export interface CostRecord {
  date: Date;
  provider: CloudProvider;
  resourceType: ResourceType;
  amount: number;
  currency: string;
  description: string;
  resourceId?: string;
  tags?: Record<string, string>;
}

export interface CostAnomaly {
  id: string;
  detectedAt: Date;
  resourceId?: string;
  resourceType: ResourceType;
  provider: CloudProvider;
  expectedCost: number;
  actualCost: number;
  deviationPercent: number;
  severity: AlertSeverity;
  description: string;
  resolved: boolean;
}

export interface OptimizationRecommendation {
  id: string;
  type: 'rightsizing' | 'reserved-instance' | 'idle-termination' | 'spot-migration' | 'storage-tiering' | 'commitment-discount' | 'multi-cloud-switch';
  resourceId: string;
  resourceName: string;
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  monthlySavings: number;
  annualSavings: number;
  effort: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  implementation: string;
  status: 'pending' | 'in_progress' | 'applied' | 'dismissed';
  createdAt: Date;
  appliedAt?: Date;
}

export interface CostAlert {
  id: string;
  name: string;
  metric: 'daily-spend' | 'monthly-spend' | 'budget-percent' | 'anomaly-score';
  threshold: number;
  severity: AlertSeverity;
  provider?: CloudProvider;
  resourceType?: ResourceType;
  active: boolean;
  triggered: boolean;
  triggeredAt?: Date;
  lastCheckedAt: Date;
  notificationChannels: string[];
}

export interface BudgetPlan {
  id: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'annual';
  totalBudget: number;
  currency: string;
  breakdown: Record<ResourceType, number>;
  startDate: Date;
  endDate: Date;
}

export interface BudgetStatus {
  budgetId: string;
  totalBudget: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  burnRate: number;          // per day
  projectedEndSpend: number;
  onTrack: boolean;
  daysRemaining: number;
}

export interface MultiCloudComparison {
  resourceSpec: ResourceSpec;
  resourceType: ResourceType;
  comparisons: CloudCostOption[];
  cheapestOption: CloudCostOption;
  currentOption?: CloudCostOption;
  potentialSavings: number;
}

export interface CloudCostOption {
  provider: CloudProvider;
  instanceType: string;
  region: string;
  hourlyPrice: number;
  monthlyPrice: number;
  purchaseType: PurchaseType;
  specs: ResourceSpec;
  score: number;              // value score (cost + reliability)
}

export interface ROITracking {
  recommendationId: string;
  implementedAt: Date;
  projectedAnnualSavings: number;
  actualSavingsToDate: number;
  implementationCost: number;
  roi: number;                // (savings - cost) / cost
  paybackMonths: number;
}

export interface CostOptimizationReport {
  generatedAt: Date;
  totalMonthlyCost: number;
  totalOptimizableCost: number;
  potentialMonthlySavings: number;
  potentialAnnualSavings: number;
  recommendations: OptimizationRecommendation[];
  anomalies: CostAnomaly[];
  costByProvider: Record<CloudProvider, number>;
  costByType: Record<ResourceType, number>;
  utilizationSummary: { avgUtilization: number; idleResources: number; underutilizedResources: number };
}

// ── Cloud Price Catalogue (simplified) ────────────────────────────────────────

const CLOUD_PRICES: Partial<Record<CloudProvider, Record<string, { monthly: number; specs: ResourceSpec }>>> = {
  aws: {
    't3.micro':   { monthly: 7.59,   specs: { vcpus: 2, memoryGb: 1 } },
    't3.small':   { monthly: 15.18,  specs: { vcpus: 2, memoryGb: 2 } },
    't3.medium':  { monthly: 30.37,  specs: { vcpus: 2, memoryGb: 4 } },
    't3.large':   { monthly: 60.74,  specs: { vcpus: 2, memoryGb: 8 } },
    'm5.large':   { monthly: 69.12,  specs: { vcpus: 2, memoryGb: 8 } },
    'm5.xlarge':  { monthly: 138.24, specs: { vcpus: 4, memoryGb: 16 } },
  },
  gcp: {
    'n1-standard-1': { monthly: 24.27, specs: { vcpus: 1, memoryGb: 3.75 } },
    'n1-standard-2': { monthly: 48.55, specs: { vcpus: 2, memoryGb: 7.5 } },
    'n1-standard-4': { monthly: 97.09, specs: { vcpus: 4, memoryGb: 15 } },
    'e2-medium':     { monthly: 24.46, specs: { vcpus: 2, memoryGb: 4 } },
  },
  azure: {
    'B1s':  { monthly: 7.59,   specs: { vcpus: 1, memoryGb: 1 } },
    'B2s':  { monthly: 30.37,  specs: { vcpus: 2, memoryGb: 4 } },
    'D2s_v3': { monthly: 70.08, specs: { vcpus: 2, memoryGb: 8 } },
    'D4s_v3': { monthly: 140.16, specs: { vcpus: 4, memoryGb: 16 } },
  },
};

// ── IntelligentCostOptimizer class ────────────────────────────────────────────

class IntelligentCostOptimizer {
  private resources: Map<string, ResourceRecord> = new Map();
  private costHistory: CostRecord[] = [];
  private anomalies: Map<string, CostAnomaly> = new Map();
  private recommendations: Map<string, OptimizationRecommendation> = new Map();
  private alerts: Map<string, CostAlert> = new Map();
  private budgets: Map<string, BudgetPlan> = new Map();
  private roiTracking: Map<string, ROITracking> = new Map();

  constructor() {
    this.initDefaultAlerts();
    setInterval(() => this.runAnomalyDetection(), 3_600_000);
    setInterval(() => this.checkAlerts(), 900_000);   // every 15 min
  }

  // ── Resource Management ────────────────────────────────────────────────────

  registerResource(resource: ResourceRecord): void {
    this.resources.set(resource.id, resource);
    logger.debug('Resource registered', { resourceId: resource.id, type: resource.type, provider: resource.provider });
  }

  updateResourceUtilization(resourceId: string, cpuPercent: number, memPercent: number): void {
    const resource = this.resources.get(resourceId);
    if (!resource) return;
    resource.cpuAvgPercent = cpuPercent;
    resource.memoryAvgPercent = memPercent;
    resource.utilizationPercent = Math.max(cpuPercent, memPercent);
    resource.isIdle = resource.utilizationPercent < 5;
    resource.lastUpdated = new Date();
  }

  // ── Cost Recording ─────────────────────────────────────────────────────────

  recordCost(record: CostRecord): void {
    this.costHistory.push(record);
    // Keep 13 months
    const cutoff = new Date(Date.now() - 13 * 30 * 86_400_000);
    while (this.costHistory.length > 0 && this.costHistory[0].date < cutoff) {
      this.costHistory.shift();
    }
  }

  recordCostBatch(records: CostRecord[]): void {
    for (const r of records) this.recordCost(r);
  }

  // ── Cost Analysis ──────────────────────────────────────────────────────────

  getTotalCostByPeriod(start: Date, end: Date): number {
    return this.costHistory.filter((r) => r.date >= start && r.date <= end).reduce((s, r) => s + r.amount, 0);
  }

  getCostByType(start: Date, end: Date): Record<ResourceType, number> {
    const types: ResourceType[] = ['compute', 'storage', 'database', 'networking', 'ai-api', 'cdn', 'monitoring', 'other'];
    const result: Record<string, number> = {};
    for (const t of types) result[t] = 0;
    for (const r of this.costHistory) {
      if (r.date >= start && r.date <= end) result[r.resourceType] += r.amount;
    }
    return result as Record<ResourceType, number>;
  }

  getCostByProvider(start: Date, end: Date): Record<CloudProvider, number> {
    const providers: CloudProvider[] = ['aws', 'gcp', 'azure', 'digitalocean', 'hetzner'];
    const result: Record<string, number> = {};
    for (const p of providers) result[p] = 0;
    for (const r of this.costHistory) {
      if (r.date >= start && r.date <= end) result[r.provider] += r.amount;
    }
    return result as Record<CloudProvider, number>;
  }

  getDailyBurnRate(days = 30): number {
    const start = new Date(Date.now() - days * 86_400_000);
    const total = this.getTotalCostByPeriod(start, new Date());
    return total / days;
  }

  // ── Anomaly Detection ──────────────────────────────────────────────────────

  private runAnomalyDetection(): void {
    // Group costs by day
    const dailyCosts: number[] = [];
    const now = new Date();
    for (let i = 30; i >= 1; i--) {
      const start = new Date(now.getTime() - i * 86_400_000);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86_400_000);
      dailyCosts.push(this.getTotalCostByPeriod(start, end));
    }

    if (dailyCosts.length < 7) return;

    // Stats on last 28 days
    const window = dailyCosts.slice(0, -2);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((s, x) => s + (x - mean) ** 2, 0) / window.length;
    const stdDev = Math.sqrt(variance);

    // Check last 2 days
    for (let i = dailyCosts.length - 2; i < dailyCosts.length; i++) {
      const actual = dailyCosts[i];
      const deviationZ = stdDev > 0 ? (actual - mean) / stdDev : 0;
      if (Math.abs(deviationZ) > 2.5) {
        const deviation = ((actual - mean) / mean) * 100;
        const severity: AlertSeverity = Math.abs(deviationZ) > 3.5 ? 'critical' : 'warning';
        const anomaly: CostAnomaly = {
          id: crypto.randomUUID(),
          detectedAt: new Date(),
          resourceType: 'other',
          provider: 'aws',
          expectedCost: mean,
          actualCost: actual,
          deviationPercent: deviation,
          severity,
          description: `Daily cost ${deviation > 0 ? 'spike' : 'drop'} of ${Math.abs(deviation).toFixed(1)}% vs 28-day average`,
          resolved: false,
        };
        this.anomalies.set(anomaly.id, anomaly);
        logger.warn('Cost anomaly detected', { deviation: anomaly.deviationPercent, severity });
      }
    }
  }

  detectAnomaliesNow(): CostAnomaly[] {
    this.runAnomalyDetection();
    return Array.from(this.anomalies.values()).filter((a) => !a.resolved);
  }

  resolveAnomaly(anomalyId: string): void {
    const a = this.anomalies.get(anomalyId);
    if (a) a.resolved = true;
  }

  // ── Rightsizing Recommendations ────────────────────────────────────────────

  generateRecommendations(): OptimizationRecommendation[] {
    const newRecs: OptimizationRecommendation[] = [];

    for (const resource of this.resources.values()) {
      // Idle termination
      if (resource.isIdle && resource.monthlyCost > 10) {
        const rec = this.makeRecommendation('idle-termination', resource, 0, 'high', 'low',
          `${resource.name} is idle (${resource.utilizationPercent}% utilization). Consider terminating.`,
          'Terminate or stop the resource. Ensure no critical dependencies before proceeding.');
        newRecs.push(rec);
      }

      // Rightsizing: underutilized compute
      if (resource.type === 'compute' && resource.cpuAvgPercent !== undefined && resource.cpuAvgPercent < 15 && !resource.isIdle) {
        const savingsFraction = 0.4;
        const rec = this.makeRecommendation('rightsizing', resource, savingsFraction, 'medium', 'medium',
          `${resource.name} CPU at ${resource.cpuAvgPercent?.toFixed(1)}% average. Downsize to smaller instance type.`,
          'Select instance type with ~50% current vCPU/memory specs and test performance under load.');
        newRecs.push(rec);
      }

      // Reserved instance recommendation for stable workloads
      if (resource.purchaseType === 'on-demand' && resource.utilizationPercent > 70 && resource.monthlyCost > 50) {
        const savingsFraction = 0.35;
        const rec = this.makeRecommendation('reserved-instance', resource, savingsFraction, 'low', 'low',
          `${resource.name} has high, stable utilization. Switch to 1-year reserved pricing.`,
          'Purchase 1-year reserved instance for this resource to save ~35%.');
        newRecs.push(rec);
      }

      // Spot migration for fault-tolerant workloads
      if (resource.purchaseType === 'on-demand' && (resource.tags['spot-eligible'] === 'true')) {
        const savingsFraction = 0.70;
        const rec = this.makeRecommendation('spot-migration', resource, savingsFraction, 'high', 'medium',
          `${resource.name} is spot-eligible. Migrating to spot instances saves ~70%.`,
          'Implement spot instance request with on-demand fallback and graceful interruption handling.');
        newRecs.push(rec);
      }
    }

    for (const rec of newRecs) {
      this.recommendations.set(rec.id, rec);
    }

    logger.info('Recommendations generated', { count: newRecs.length });
    return newRecs;
  }

  private makeRecommendation(
    type: OptimizationRecommendation['type'],
    resource: ResourceRecord,
    savingsFraction: number,
    priority: OptimizationRecommendation['priority'],
    risk: OptimizationRecommendation['risk'],
    description: string,
    implementation: string,
  ): OptimizationRecommendation {
    const monthly = resource.monthlyCost * savingsFraction;
    return {
      id: crypto.randomUUID(),
      type,
      resourceId: resource.id,
      resourceName: resource.name,
      currentMonthlyCost: resource.monthlyCost,
      projectedMonthlyCost: resource.monthlyCost - monthly,
      monthlySavings: monthly,
      annualSavings: monthly * 12,
      effort: type === 'reserved-instance' ? 'low' : 'medium',
      risk,
      priority,
      description,
      implementation,
      status: 'pending',
      createdAt: new Date(),
    };
  }

  applyRecommendation(recommendationId: string): void {
    const rec = this.recommendations.get(recommendationId);
    if (!rec) throw new Error(`Recommendation ${recommendationId} not found`);
    rec.status = 'applied';
    rec.appliedAt = new Date();

    // Start ROI tracking
    this.roiTracking.set(recommendationId, {
      recommendationId,
      implementedAt: new Date(),
      projectedAnnualSavings: rec.annualSavings,
      actualSavingsToDate: 0,
      implementationCost: 0,
      roi: 0,
      paybackMonths: rec.annualSavings > 0 ? 0 : Infinity,
    });
    logger.info('Recommendation applied', { recommendationId, type: rec.type, monthlySavings: rec.monthlySavings });
  }

  // ── Multi-Cloud Comparison ─────────────────────────────────────────────────

  compareMultiCloud(spec: ResourceSpec, resourceType: ResourceType, currentResourceId?: string): MultiCloudComparison {
    const options: CloudCostOption[] = [];

    for (const [provider, catalogue] of Object.entries(CLOUD_PRICES) as [CloudProvider, Record<string, { monthly: number; specs: ResourceSpec }>][]) {
      for (const [instanceType, details] of Object.entries(catalogue)) {
        // Filter by spec compatibility
        if (spec.vcpus && details.specs.vcpus && details.specs.vcpus < spec.vcpus) continue;
        if (spec.memoryGb && details.specs.memoryGb && details.specs.memoryGb < spec.memoryGb) continue;

        const valueScore = 100 - (details.monthly / 200) * 50; // lower cost = higher score
        options.push({
          provider,
          instanceType,
          region: 'us-east-1',
          hourlyPrice: details.monthly / 730,
          monthlyPrice: details.monthly,
          purchaseType: 'on-demand',
          specs: details.specs,
          score: valueScore,
        });
      }
    }

    options.sort((a, b) => a.monthlyPrice - b.monthlyPrice);
    const cheapest = options[0] ?? { provider: 'aws', instanceType: 't3.micro', region: 'us-east-1', hourlyPrice: 0, monthlyPrice: 0, purchaseType: 'on-demand', specs: {}, score: 0 };

    const current = currentResourceId ? this.resources.get(currentResourceId) : undefined;
    const currentOption = current ? options.find((o) => o.provider === current.provider) : undefined;
    const potentialSavings = currentOption ? currentOption.monthlyPrice - cheapest.monthlyPrice : 0;

    return {
      resourceSpec: spec,
      resourceType,
      comparisons: options.slice(0, 10),
      cheapestOption: cheapest,
      currentOption,
      potentialSavings: Math.max(0, potentialSavings),
    };
  }

  // ── Alerts ─────────────────────────────────────────────────────────────────

  private initDefaultAlerts(): void {
    const alerts: CostAlert[] = [
      { id: 'daily-1000', name: 'Daily spend > $1,000', metric: 'daily-spend', threshold: 1000, severity: 'warning', active: true, triggered: false, lastCheckedAt: new Date(), notificationChannels: ['email'] },
      { id: 'daily-5000', name: 'Daily spend > $5,000', metric: 'daily-spend', threshold: 5000, severity: 'critical', active: true, triggered: false, lastCheckedAt: new Date(), notificationChannels: ['email', 'slack'] },
      { id: 'monthly-80pct', name: 'Monthly budget 80% used', metric: 'budget-percent', threshold: 80, severity: 'warning', active: true, triggered: false, lastCheckedAt: new Date(), notificationChannels: ['email'] },
    ];
    for (const a of alerts) this.alerts.set(a.id, a);
  }

  addAlert(alert: CostAlert): void {
    this.alerts.set(alert.id, alert);
  }

  private checkAlerts(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailySpend = this.getTotalCostByPeriod(today, new Date());

    for (const alert of this.alerts.values()) {
      if (!alert.active) continue;
      let triggered = false;

      if (alert.metric === 'daily-spend') {
        triggered = dailySpend >= alert.threshold;
      } else if (alert.metric === 'anomaly-score') {
        triggered = Array.from(this.anomalies.values()).some((a) => !a.resolved && a.severity === 'critical');
      }

      if (triggered && !alert.triggered) {
        alert.triggered = true;
        alert.triggeredAt = new Date();
        logger.warn('Cost alert triggered', { alertId: alert.id, name: alert.name, severity: alert.severity });
      } else if (!triggered && alert.triggered) {
        alert.triggered = false;
      }
      alert.lastCheckedAt = new Date();
    }
  }

  // ── Budget ─────────────────────────────────────────────────────────────────

  createBudget(budget: BudgetPlan): void {
    this.budgets.set(budget.id, budget);
  }

  getBudgetStatus(budgetId: string): BudgetStatus | null {
    const budget = this.budgets.get(budgetId);
    if (!budget) return null;

    const spent = this.getTotalCostByPeriod(budget.startDate, new Date());
    const now = Date.now();
    const totalDays = (budget.endDate.getTime() - budget.startDate.getTime()) / 86_400_000;
    const elapsedDays = Math.max(1, (now - budget.startDate.getTime()) / 86_400_000);
    const daysRemaining = Math.max(0, (budget.endDate.getTime() - now) / 86_400_000);
    const burnRate = spent / elapsedDays;
    const projectedEnd = spent + burnRate * daysRemaining;

    return {
      budgetId,
      totalBudget: budget.totalBudget,
      spent,
      remaining: budget.totalBudget - spent,
      percentUsed: (spent / budget.totalBudget) * 100,
      burnRate,
      projectedEndSpend: projectedEnd,
      onTrack: projectedEnd <= budget.totalBudget * 1.05,
      daysRemaining,
    };
  }

  // ── ROI Tracking ───────────────────────────────────────────────────────────

  updateROI(recommendationId: string, actualSavings: number): void {
    const roi = this.roiTracking.get(recommendationId);
    if (!roi) return;
    roi.actualSavingsToDate += actualSavings;
    const net = roi.actualSavingsToDate - roi.implementationCost;
    roi.roi = roi.implementationCost > 0 ? net / roi.implementationCost : 0;
    roi.paybackMonths = roi.projectedAnnualSavings > 0
      ? (roi.implementationCost / (roi.projectedAnnualSavings / 12))
      : 0;
  }

  // ── Full Report ────────────────────────────────────────────────────────────

  generateReport(): CostOptimizationReport {
    const cacheKey = 'cost:report:latest';
    const cached = cache.get<CostOptimizationReport>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    this.generateRecommendations();

    const totalMonthlyCost = this.getTotalCostByPeriod(monthStart, now);
    const recs = Array.from(this.recommendations.values()).filter((r) => r.status === 'pending');
    const potentialMonthly = recs.reduce((s, r) => s + r.monthlySavings, 0);

    const idleResources = Array.from(this.resources.values()).filter((r) => r.isIdle).length;
    const underutilized = Array.from(this.resources.values()).filter((r) => r.utilizationPercent < 30 && !r.isIdle).length;
    const avgUtilization = this.resources.size > 0
      ? Array.from(this.resources.values()).reduce((s, r) => s + r.utilizationPercent, 0) / this.resources.size
      : 0;

    const report: CostOptimizationReport = {
      generatedAt: now,
      totalMonthlyCost,
      totalOptimizableCost: potentialMonthly,
      potentialMonthlySavings: potentialMonthly,
      potentialAnnualSavings: potentialMonthly * 12,
      recommendations: recs.sort((a, b) => b.monthlySavings - a.monthlySavings),
      anomalies: Array.from(this.anomalies.values()).filter((a) => !a.resolved),
      costByProvider: this.getCostByProvider(monthStart, now),
      costByType: this.getCostByType(monthStart, now),
      utilizationSummary: { avgUtilization: Math.round(avgUtilization), idleResources, underutilizedResources: underutilized },
    };

    cache.set(cacheKey, report, 1800);
    logger.info('Cost optimization report generated', {
      totalMonthlyCost,
      potentialSavings: potentialMonthly,
      recommendations: recs.length,
    });
    return report;
  }

  getAlerts(): CostAlert[] {
    return Array.from(this.alerts.values());
  }

  getTriggeredAlerts(): CostAlert[] {
    return Array.from(this.alerts.values()).filter((a) => a.triggered);
  }

  getROISummary(): { totalProjectedAnnual: number; totalActualSavings: number; avgROI: number; appliedRecommendations: number } {
    const all = Array.from(this.roiTracking.values());
    const totalProjected = all.reduce((s, r) => s + r.projectedAnnualSavings, 0);
    const totalActual = all.reduce((s, r) => s + r.actualSavingsToDate, 0);
    const avgROI = all.length > 0 ? all.reduce((s, r) => s + r.roi, 0) / all.length : 0;
    return { totalProjectedAnnual: totalProjected, totalActualSavings: totalActual, avgROI, appliedRecommendations: all.length };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__intelligentCostOptimizer__';

export function getIntelligentCostOptimizer(): IntelligentCostOptimizer {
  const g = globalThis as unknown as Record<string, IntelligentCostOptimizer>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new IntelligentCostOptimizer();
  }
  return g[GLOBAL_KEY];
}

export { IntelligentCostOptimizer };
export default getIntelligentCostOptimizer;
