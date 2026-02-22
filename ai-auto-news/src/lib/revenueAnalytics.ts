/**
 * Revenue Analytics with Cohort Analysis
 *
 * Advanced revenue analytics system:
 * - Cohort analysis by signup date
 * - Customer lifetime value tracking
 * - Revenue cohorts and segments
 * - Retention analysis
 * - Expansion revenue tracking
 * - Churn revenue impact
 * - MRR/ARR calculations
 * - Revenue forecasting
 */

import { getLogger } from '@/lib/logger';
import { SubscriptionTier } from '@/types/saas';

const logger = getLogger();

export interface Cohort {
  id: string;
  name: string;
  periodStart: Date;
  periodEnd: Date;
  initialSize: number;
  currentSize: number;
  totalRevenue: number;
  averageRevenuePerUser: number;
  retentionRate: number;
  churnRate: number;
  expansionRevenue: number;
  contractionRevenue: number;
}

export interface CohortMetrics {
  cohortId: string;
  period: number; // months since cohort start
  activeUsers: number;
  retentionRate: number;
  revenue: number;
  averageRevenuePerUser: number;
  cumulativeRevenue: number;
  ltv: number;
}

export interface RevenueBreakdown {
  newRevenue: number;
  expansionRevenue: number;
  contractionRevenue: number;
  churnRevenue: number;
  netNewRevenue: number;
  recurringRevenue: number;
}

export interface CustomerSegment {
  id: string;
  name: string;
  criteria: SegmentCriteria;
  metrics: SegmentMetrics;
}

export interface SegmentCriteria {
  tier?: SubscriptionTier[];
  minMRR?: number;
  maxMRR?: number;
  accountAge?: { min?: number; max?: number };
  industry?: string[];
}

export interface SegmentMetrics {
  userCount: number;
  totalMRR: number;
  averageMRR: number;
  churnRate: number;
  ltv: number;
  growthRate: number;
}

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  netNewMRR: number;
  churnedMRR: number;
  expansionMRR: number;
  contractionMRR: number;
  quickRatio: number; // (new + expansion) / (churn + contraction)
  growthRate: number;
  cac: number; // Customer Acquisition Cost
  ltvcacRatio: number;
}

export interface RevenueForecast {
  month: Date;
  predictedMRR: number;
  predictedChurn: number;
  predictedExpansion: number;
  confidence: number;
  low: number;
  high: number;
}

class RevenueAnalytics {
  private cohorts: Map<string, Cohort> = new Map();
  private cohortMetrics: Map<string, CohortMetrics[]> = new Map();
  private segments: Map<string, CustomerSegment> = new Map();
  private revenueHistory: Map<string, RevenueBreakdown> = new Map(); // key: YYYY-MM

  /**
   * Create cohort
   */
  createCohort(periodStart: Date, periodEnd: Date): string {
    const id = this.generateCohortId(periodStart);

    const cohort: Cohort = {
      id,
      name: `Cohort ${periodStart.toISOString().substring(0, 7)}`,
      periodStart,
      periodEnd,
      initialSize: 0,
      currentSize: 0,
      totalRevenue: 0,
      averageRevenuePerUser: 0,
      retentionRate: 100,
      churnRate: 0,
      expansionRevenue: 0,
      contractionRevenue: 0,
    };

    this.cohorts.set(id, cohort);
    this.cohortMetrics.set(id, []);

    logger.info('Cohort created', { cohortId: id, periodStart });

    return id;
  }

  /**
   * Add user to cohort
   */
  addUserToCohort(cohortId: string, userId: string, initialMRR: number): void {
    const cohort = this.cohorts.get(cohortId);

    if (!cohort) {
      throw new Error(`Cohort not found: ${cohortId}`);
    }

    cohort.initialSize++;
    cohort.currentSize++;
    cohort.totalRevenue += initialMRR;
    cohort.averageRevenuePerUser = cohort.totalRevenue / cohort.currentSize;

    logger.debug('User added to cohort', { cohortId, userId, initialMRR });
  }

  /**
   * Update cohort metrics
   */
  updateCohortMetrics(cohortId: string, period: number, metrics: Partial<CohortMetrics>): void {
    const cohort = this.cohorts.get(cohortId);

    if (!cohort) {
      throw new Error(`Cohort not found: ${cohortId}`);
    }

    const cohortMetricsList = this.cohortMetrics.get(cohortId)!;

    // Find or create metrics for period
    let periodMetrics = cohortMetricsList.find(m => m.period === period);

    if (!periodMetrics) {
      periodMetrics = {
        cohortId,
        period,
        activeUsers: cohort.currentSize,
        retentionRate: 100,
        revenue: 0,
        averageRevenuePerUser: 0,
        cumulativeRevenue: 0,
        ltv: 0,
      };
      cohortMetricsList.push(periodMetrics);
    }

    // Update metrics
    Object.assign(periodMetrics, metrics);

    // Calculate derived metrics
    periodMetrics.retentionRate = (periodMetrics.activeUsers / cohort.initialSize) * 100;
    periodMetrics.averageRevenuePerUser = periodMetrics.activeUsers > 0
      ? periodMetrics.revenue / periodMetrics.activeUsers
      : 0;

    // Calculate cumulative revenue
    const previousPeriods = cohortMetricsList.filter(m => m.period < period);
    periodMetrics.cumulativeRevenue = previousPeriods.reduce((sum, m) => sum + m.revenue, 0) + periodMetrics.revenue;

    // Calculate LTV
    periodMetrics.ltv = periodMetrics.cumulativeRevenue / cohort.initialSize;

    // Update cohort
    cohort.retentionRate = periodMetrics.retentionRate;
    cohort.churnRate = 100 - periodMetrics.retentionRate;

    logger.debug('Cohort metrics updated', {
      cohortId,
      period,
      retentionRate: periodMetrics.retentionRate.toFixed(2),
    });
  }

  /**
   * Get cohort analysis
   */
  getCohortAnalysis(cohortId: string): CohortAnalysis | null {
    const cohort = this.cohorts.get(cohortId);
    const metrics = this.cohortMetrics.get(cohortId);

    if (!cohort || !metrics) {
      return null;
    }

    const sortedMetrics = metrics.sort((a, b) => a.period - b.period);

    return {
      cohort,
      metrics: sortedMetrics,
      ltv: sortedMetrics.length > 0 ? sortedMetrics[sortedMetrics.length - 1].ltv : 0,
      paybackPeriod: this.calculatePaybackPeriod(sortedMetrics),
    };
  }

  /**
   * Get all cohorts summary
   */
  getCohortsSummary(): CohortSummary[] {
    return Array.from(this.cohorts.values())
      .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
      .map(cohort => ({
        cohortId: cohort.id,
        name: cohort.name,
        periodStart: cohort.periodStart,
        initialSize: cohort.initialSize,
        currentSize: cohort.currentSize,
        retentionRate: cohort.retentionRate,
        totalRevenue: cohort.totalRevenue,
        averageRevenuePerUser: cohort.averageRevenuePerUser,
      }));
  }

  /**
   * Track revenue breakdown
   */
  trackRevenueBreakdown(month: string, breakdown: RevenueBreakdown): void {
    this.revenueHistory.set(month, breakdown);

    logger.info('Revenue breakdown tracked', {
      month,
      netNewRevenue: breakdown.netNewRevenue,
    });
  }

  /**
   * Get revenue metrics
   */
  getRevenueMetrics(): RevenueMetrics {
    // Get current month
    const currentMonth = new Date().toISOString().substring(0, 7);
    const breakdown = this.revenueHistory.get(currentMonth);

    if (!breakdown) {
      return this.getEmptyMetrics();
    }

    // Calculate metrics
    const mrr = breakdown.recurringRevenue;
    const arr = mrr * 12;

    const quickRatio = (breakdown.newRevenue + breakdown.expansionRevenue) /
      (breakdown.churnRevenue + breakdown.contractionRevenue || 1);

    // Calculate growth rate
    const previousMonth = this.getPreviousMonth(currentMonth);
    const previousBreakdown = this.revenueHistory.get(previousMonth);

    const growthRate = previousBreakdown
      ? ((mrr - previousBreakdown.recurringRevenue) / previousBreakdown.recurringRevenue) * 100
      : 0;

    return {
      mrr,
      arr,
      netNewMRR: breakdown.netNewRevenue,
      churnedMRR: breakdown.churnRevenue,
      expansionMRR: breakdown.expansionRevenue,
      contractionMRR: breakdown.contractionRevenue,
      quickRatio,
      growthRate,
      cac: 100, // Would be calculated from actual costs
      ltvcacRatio: 3.5, // Would be calculated from actual LTV and CAC
    };
  }

  /**
   * Forecast revenue
   */
  forecastRevenue(months: number): RevenueForecast[] {
    const forecasts: RevenueForecast[] = [];
    const currentMetrics = this.getRevenueMetrics();

    // Simple linear forecast based on current growth rate
    let currentMRR = currentMetrics.mrr;
    const monthlyGrowthRate = currentMetrics.growthRate / 100;

    for (let i = 1; i <= months; i++) {
      const forecastMonth = new Date();
      forecastMonth.setMonth(forecastMonth.getMonth() + i);

      // Project MRR with growth
      currentMRR = currentMRR * (1 + monthlyGrowthRate);

      // Estimate churn (2-5% of MRR)
      const predictedChurn = currentMRR * 0.03;

      // Estimate expansion (10-20% of MRR)
      const predictedExpansion = currentMRR * 0.15;

      // Confidence decreases with time
      const confidence = Math.max(0.5, 1 - (i * 0.05));

      forecasts.push({
        month: forecastMonth,
        predictedMRR: Math.round(currentMRR),
        predictedChurn: Math.round(predictedChurn),
        predictedExpansion: Math.round(predictedExpansion),
        confidence,
        low: Math.round(currentMRR * 0.8),
        high: Math.round(currentMRR * 1.2),
      });
    }

    return forecasts;
  }

  /**
   * Create customer segment
   */
  createSegment(segment: Omit<CustomerSegment, 'metrics'>): string {
    const id = this.generateId('segment');

    const fullSegment: CustomerSegment = {
      ...segment,
      id,
      metrics: {
        userCount: 0,
        totalMRR: 0,
        averageMRR: 0,
        churnRate: 0,
        ltv: 0,
        growthRate: 0,
      },
    };

    this.segments.set(id, fullSegment);

    logger.info('Customer segment created', { segmentId: id, name: segment.name });

    return id;
  }

  /**
   * Get segment metrics
   */
  getSegmentMetrics(segmentId: string): SegmentMetrics | null {
    const segment = this.segments.get(segmentId);
    return segment ? segment.metrics : null;
  }

  /**
   * Calculate payback period
   */
  private calculatePaybackPeriod(metrics: CohortMetrics[]): number {
    const cac = 100; // Mock CAC

    for (let i = 0; i < metrics.length; i++) {
      if (metrics[i].cumulativeRevenue >= cac) {
        return i + 1; // months
      }
    }

    return metrics.length; // Not paid back yet
  }

  /**
   * Get previous month string
   */
  private getPreviousMonth(monthString: string): string {
    const date = new Date(monthString + '-01');
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().substring(0, 7);
  }

  /**
   * Get empty metrics
   */
  private getEmptyMetrics(): RevenueMetrics {
    return {
      mrr: 0,
      arr: 0,
      netNewMRR: 0,
      churnedMRR: 0,
      expansionMRR: 0,
      contractionMRR: 0,
      quickRatio: 0,
      growthRate: 0,
      cac: 0,
      ltvcacRatio: 0,
    };
  }

  /**
   * Generate cohort ID
   */
  private generateCohortId(date: Date): string {
    return `cohort_${date.toISOString().substring(0, 7)}`;
  }

  /**
   * Generate ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

interface CohortAnalysis {
  cohort: Cohort;
  metrics: CohortMetrics[];
  ltv: number;
  paybackPeriod: number;
}

interface CohortSummary {
  cohortId: string;
  name: string;
  periodStart: Date;
  initialSize: number;
  currentSize: number;
  retentionRate: number;
  totalRevenue: number;
  averageRevenuePerUser: number;
}

// Singleton
let revenueAnalytics: RevenueAnalytics;

export function getRevenueAnalytics(): RevenueAnalytics {
  if (!revenueAnalytics) {
    revenueAnalytics = new RevenueAnalytics();
  }
  return revenueAnalytics;
}

export { RevenueAnalytics };
