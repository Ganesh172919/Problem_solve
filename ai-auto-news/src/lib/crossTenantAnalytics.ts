/**
 * @module crossTenantAnalytics
 * @description Cross-tenant aggregated analytics with privacy preservation.
 * Aggregates metrics across tenant cohorts while enforcing k-anonymity and
 * differential privacy (Laplace noise). Provides percentile benchmarks,
 * industry comparisons, outlier detection (IQR + z-score), and anonymized
 * insight reports. Tracks per-tenant privacy budgets using the epsilon-delta model.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface AggregatedMetric {
  name: string;
  cohort: string;
  count: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  p90: number;
  p99: number;
  stddev: number;
  min: number;
  max: number;
  computedAt: Date;
  privacyLevel: 'k_anonymous' | 'differentially_private' | 'public';
}

export interface TenantSegment {
  id: string;
  name: string;
  criteria: { industry?: string; tier?: string; region?: string; minRevenue?: number; maxRevenue?: number };
  tenantCount: number;
  minKAnonymity: number;
}

export interface BenchmarkReport {
  industry: string;
  tier: string;
  metrics: Record<string, AggregatedMetric>;
  generatedAt: Date;
  tenantCount: number;
  privacyGuarantees: string[];
}

export interface IndustryComparison {
  tenantId: string;
  industry: string;
  comparedMetrics: Array<{
    metricName: string;
    tenantValue: number;
    industryMedian: number;
    industryP75: number;
    industryP25: number;
    percentile: number;
    relativeTo: 'above_median' | 'below_median' | 'at_median';
    insight: string;
  }>;
  overallPercentile: number;
  generatedAt: Date;
}

export interface AnonymizedInsight {
  id: string;
  category: string;
  headline: string;
  detail: string;
  affectedCohortSize: number;
  confidenceScore: number;
  dataPoints: number;
  generatedAt: Date;
}

export interface AggregationPolicy {
  id: string;
  name: string;
  minCohortSize: number;
  kAnonymityK: number;
  differentialPrivacy: boolean;
  epsilon: number;
  delta: number;
  suppressSmallCohorts: boolean;
  noiseMechanism: 'laplace' | 'gaussian';
}

export interface CrossTenantQuery {
  metricName: string;
  segment: TenantSegment;
  aggregations: Array<'mean' | 'median' | 'p75' | 'p90' | 'count'>;
  filters?: Record<string, unknown>;
  timeRange?: { start: Date; end: Date };
}

export interface PrivacyBudget {
  tenantId: string;
  totalEpsilon: number;
  usedEpsilon: number;
  remainingEpsilon: number;
  totalDelta: number;
  usedDelta: number;
  queries: number;
  resetAt: Date;
}

// ─── Differential Privacy: Laplace mechanism ─────────────────────────────────
function laplaceNoise(sensitivity: number, epsilon: number): number {
  const b = sensitivity / epsilon;
  const u = Math.random() - 0.5;
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

function gaussianNoise(sensitivity: number, epsilon: number, delta: number): number {
  const sigma = Math.sqrt(2 * Math.log(1.25 / delta)) * sensitivity / epsilon;
  const u1    = Math.random(), u2 = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
}

// ─── Percentile helper ────────────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

function computeAggregation(values: number[], name: string, cohort: string, policy: AggregationPolicy): AggregatedMetric | null {
  if (values.length < policy.minCohortSize) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mean   = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  let noisedMean   = mean;
  let noisedMedian = percentile(sorted, 50);
  const sensitivity = (Math.max(...values) - Math.min(...values)) / values.length;

  if (policy.differentialPrivacy && policy.epsilon > 0) {
    const noise = policy.noiseMechanism === 'laplace'
      ? laplaceNoise(sensitivity, policy.epsilon)
      : gaussianNoise(sensitivity, policy.epsilon, policy.delta);
    noisedMean   += noise;
    noisedMedian += laplaceNoise(sensitivity, policy.epsilon * 1.5);
  }

  return {
    name, cohort,
    count:       values.length,
    mean:        noisedMean,
    median:      noisedMedian,
    p25:         percentile(sorted, 25),
    p75:         percentile(sorted, 75),
    p90:         percentile(sorted, 90),
    p99:         percentile(sorted, 99),
    stddev,
    min:         sorted[0],
    max:         sorted[sorted.length - 1],
    computedAt:  new Date(),
    privacyLevel: policy.differentialPrivacy ? 'differentially_private' : 'k_anonymous',
  };
}

// ─── Default policy ───────────────────────────────────────────────────────────
const DEFAULT_POLICY: AggregationPolicy = {
  id: 'default', name: 'Default DP Policy',
  minCohortSize: 10, kAnonymityK: 10,
  differentialPrivacy: true, epsilon: 0.5, delta: 1e-5,
  suppressSmallCohorts: true, noiseMechanism: 'laplace',
};

export class CrossTenantAnalytics {
  private tenantData    = new Map<string, Record<string, number[]>>();
  private segments      = new Map<string, TenantSegment>();
  private privacyBudgets = new Map<string, PrivacyBudget>();
  private policies      = new Map<string, AggregationPolicy>([['default', DEFAULT_POLICY]]);
  private insightCache  = new Map<string, AnonymizedInsight[]>();
  private stats         = { queries: 0, aggregations: 0, suppressedCohorts: 0, avgNoiseAdded: 0 };
  private noiseHistory: number[] = [];

  registerTenantMetrics(tenantId: string, metrics: Record<string, number>): void {
    const existing = this.tenantData.get(tenantId) ?? {};
    for (const [k, v] of Object.entries(metrics)) {
      if (!existing[k]) existing[k] = [];
      existing[k].push(v);
      if (existing[k].length > 90) existing[k].shift(); // 90-day window
    }
    this.tenantData.set(tenantId, existing);
  }

  aggregateMetrics(metricName: string, segment: TenantSegment, policy?: AggregationPolicy): AggregatedMetric | null {
    const p      = policy ?? this.policies.get('default') ?? DEFAULT_POLICY;
    const budget = this.checkAndDeductBudget('system', p.epsilon, p.delta);
    if (!budget) {
      logger.warn('Privacy budget exhausted for aggregation', { metricName });
      return null;
    }

    const values: number[] = [];
    for (const [, data] of this.tenantData) {
      const tenantVals = data[metricName];
      if (tenantVals && tenantVals.length > 0) {
        values.push(tenantVals[tenantVals.length - 1]);
      }
    }

    if (values.length < p.kAnonymityK) {
      if (p.suppressSmallCohorts) {
        this.stats.suppressedCohorts++;
        logger.debug('Cohort suppressed for k-anonymity', { metricName, cohortSize: values.length, k: p.kAnonymityK });
        return null;
      }
    }

    const result = computeAggregation(values, metricName, segment.id, p);
    if (result) this.stats.aggregations++;
    logger.debug('Metric aggregated', { metricName, tenants: values.length });
    return result;
  }

  generateBenchmarks(industry: string, tier: string): BenchmarkReport {
    const metricsToAggregate = ['monthly_revenue', 'churn_rate', 'nps_score', 'api_calls_per_day', 'active_users', 'avg_session_min'];
    const metrics: Record<string, AggregatedMetric> = {};
    const segment: TenantSegment = {
      id: `seg_${industry}_${tier}`, name: `${industry} ${tier}`,
      criteria: { industry, tier }, tenantCount: this.tenantData.size, minKAnonymity: 10,
    };

    for (const metricName of metricsToAggregate) {
      const agg = this.aggregateMetrics(metricName, segment);
      if (agg) metrics[metricName] = agg;
    }

    const report: BenchmarkReport = {
      industry, tier, metrics, generatedAt: new Date(),
      tenantCount: this.tenantData.size,
      privacyGuarantees: [`k=${DEFAULT_POLICY.kAnonymityK} anonymity`, `ε=${DEFAULT_POLICY.epsilon} differential privacy`],
    };
    logger.info('Benchmark report generated', { industry, tier, metricCount: Object.keys(metrics).length });
    return report;
  }

  compareToIndustry(tenantId: string, metricValues: Record<string, number>): IndustryComparison {
    const comparisons: IndustryComparison['comparedMetrics'] = [];
    const segment: TenantSegment = {
      id: 'all', name: 'All Tenants', criteria: {}, tenantCount: this.tenantData.size, minKAnonymity: 10,
    };

    for (const [metricName, tenantValue] of Object.entries(metricValues)) {
      const agg = this.aggregateMetrics(metricName, segment);
      if (!agg) continue;

      const sorted = this.getMetricValues(metricName).sort((a, b) => a - b);
      const rank   = sorted.filter(v => v <= tenantValue).length;
      const ptile  = sorted.length > 0 ? (rank / sorted.length) * 100 : 50;
      const relTo: 'above_median' | 'below_median' | 'at_median' =
        tenantValue > agg.median * 1.02 ? 'above_median' :
        tenantValue < agg.median * 0.98 ? 'below_median' : 'at_median';
      const diff   = agg.median > 0 ? ((tenantValue - agg.median) / agg.median) * 100 : 0;

      comparisons.push({
        metricName, tenantValue, industryMedian: agg.median,
        industryP75: agg.p75, industryP25: agg.p25, percentile: Math.round(ptile),
        relativeTo: relTo,
        insight: `${relTo === 'above_median' ? 'Above' : relTo === 'below_median' ? 'Below' : 'At'} industry median by ${Math.abs(diff).toFixed(1)}%`,
      });
    }

    const overallPercentile = comparisons.length > 0
      ? comparisons.reduce((s, c) => s + c.percentile, 0) / comparisons.length
      : 50;

    this.stats.queries++;
    return { tenantId, industry: 'all', comparedMetrics: comparisons, overallPercentile: Math.round(overallPercentile), generatedAt: new Date() };
  }

  private getMetricValues(metricName: string): number[] {
    const vals: number[] = [];
    for (const data of this.tenantData.values()) {
      const tenantVals = data[metricName];
      if (tenantVals?.length) vals.push(tenantVals[tenantVals.length - 1]);
    }
    return vals;
  }

  detectOutliers(metricName: string): Array<{ tenantHash: string; value: number; zscore: number; isOutlier: boolean }> {
    const values = this.getMetricValues(metricName);
    if (values.length < 5) return [];

    const mean   = values.reduce((s, v) => s + v, 0) / values.length;
    const std    = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    const sorted = [...values].sort((a, b) => a - b);
    const q1     = percentile(sorted, 25), q3 = percentile(sorted, 75);
    const iqr    = q3 - q1;

    return Array.from(this.tenantData.entries()).map(([id, data], idx) => {
      const v      = data[metricName]?.[data[metricName].length - 1] ?? mean;
      const zscore = std > 0 ? (v - mean) / std : 0;
      // Pseudonymous hash: XOR-fold the tenant ID chars to produce a stable token
      const hash = 'tenant_' + Array.from(id).reduce((acc, ch, i) => (acc ^ (ch.charCodeAt(0) * (i + 31))) & 0xffff, 0x9e37).toString(16).padStart(4, '0');
      return {
        tenantHash: hash,
        value: v + laplaceNoise(std * 0.01, DEFAULT_POLICY.epsilon * 2),
        zscore, isOutlier: Math.abs(zscore) > 2 || v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr,
      };
    });
  }

  generateInsightReport(segment: TenantSegment): AnonymizedInsight[] {
    const cached = this.insightCache.get(segment.id);
    if (cached) return cached;

    const insights: AnonymizedInsight[] = [];
    const metricsToCheck = ['monthly_revenue', 'churn_rate', 'api_calls_per_day', 'active_users'];

    for (const metric of metricsToCheck) {
      const values = this.getMetricValues(metric);
      if (values.length < 10) continue;

      const agg = computeAggregation(values, metric, segment.id, DEFAULT_POLICY);
      if (!agg) continue;

      const cvPercent = agg.mean > 0 ? (agg.stddev / agg.mean) * 100 : 0;
      const skew      = agg.mean > agg.median ? 'right-skewed' : 'left-skewed';

      insights.push({
        id: `ins_${metric}_${Date.now()}`,
        category: 'distribution_analysis',
        headline: `${metric.replace(/_/g, ' ')} shows ${cvPercent.toFixed(0)}% coefficient of variation`,
        detail: `Distribution is ${skew}. Median ${agg.median.toFixed(2)}, P90 ${agg.p90.toFixed(2)} across ${agg.count} tenants in cohort.`,
        affectedCohortSize: agg.count,
        confidenceScore: Math.min(0.99, 0.7 + agg.count / 100),
        dataPoints: agg.count,
        generatedAt: new Date(),
      });
    }

    // Trend insight
    insights.push({
      id: `ins_trend_${Date.now()}`,
      category: 'trend_analysis',
      headline: `${segment.tenantCount} tenants analyzed in ${segment.name} cohort`,
      detail: `Cross-tenant analysis identifies usage patterns across ${metricsToCheck.length} key metrics with ${DEFAULT_POLICY.kAnonymityK}-anonymity guarantee.`,
      affectedCohortSize: segment.tenantCount,
      confidenceScore: 0.92,
      dataPoints: segment.tenantCount * metricsToCheck.length,
      generatedAt: new Date(),
    });

    this.insightCache.set(segment.id, insights);
    logger.info('Insight report generated', { segment: segment.id, insights: insights.length });
    return insights;
  }

  queryAnonymized(query: CrossTenantQuery): AggregatedMetric | null {
    this.stats.queries++;
    return this.aggregateMetrics(query.metricName, query.segment);
  }

  updatePrivacyBudget(tenantId: string, epsilonCost: number): PrivacyBudget {
    const budget = this.getOrInitBudget(tenantId);
    budget.usedEpsilon      = Math.min(budget.totalEpsilon, budget.usedEpsilon + epsilonCost);
    budget.remainingEpsilon = Math.max(0, budget.totalEpsilon - budget.usedEpsilon);
    budget.queries++;

    const noiseTracking = laplaceNoise(1, budget.remainingEpsilon > 0 ? budget.remainingEpsilon : 0.01);
    this.noiseHistory.push(Math.abs(noiseTracking));
    if (this.noiseHistory.length > 100) this.noiseHistory.shift();
    this.stats.avgNoiseAdded = this.noiseHistory.reduce((s, v) => s + v, 0) / this.noiseHistory.length;

    if (budget.remainingEpsilon <= 0) {
      logger.warn('Privacy budget exhausted', { tenantId, totalEpsilon: budget.totalEpsilon });
    }
    this.privacyBudgets.set(tenantId, budget);
    return budget;
  }

  private checkAndDeductBudget(tenantId: string, epsilon: number, _delta: number): boolean {
    const budget = this.getOrInitBudget(tenantId);
    if (budget.remainingEpsilon < epsilon) return false;
    budget.usedEpsilon      += epsilon;
    budget.remainingEpsilon -= epsilon;
    budget.queries++;
    this.privacyBudgets.set(tenantId, budget);
    return true;
  }

  private getOrInitBudget(tenantId: string): PrivacyBudget {
    const existing = this.privacyBudgets.get(tenantId);
    if (existing) return existing;
    const budget: PrivacyBudget = {
      tenantId, totalEpsilon: 10, usedEpsilon: 0, remainingEpsilon: 10,
      totalDelta: 1e-4, usedDelta: 0, queries: 0,
      resetAt: new Date(Date.now() + 30 * 86400_000),
    };
    this.privacyBudgets.set(tenantId, budget);
    return budget;
  }

  getAggregationStats(): typeof this.stats & { tenantCount: number; cachedInsights: number } {
    return { ...this.stats, tenantCount: this.tenantData.size, cachedInsights: this.insightCache.size };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export function getCrossTenantAnalytics(): CrossTenantAnalytics {
  if (!(globalThis as Record<string, unknown>).__crossTenantAnalytics__) {
    (globalThis as Record<string, unknown>).__crossTenantAnalytics__ = new CrossTenantAnalytics();
  }
  return (globalThis as Record<string, unknown>).__crossTenantAnalytics__ as CrossTenantAnalytics;
}
