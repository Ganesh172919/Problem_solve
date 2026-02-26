/**
 * Revenue Optimization Engine
 *
 * Advanced revenue optimization with conversion funnel analysis,
 * pricing experiments, churn prevention, and LTV maximization.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface RevenueSegment {
  id: string;
  name: string;
  criteria: SegmentCriteria;
  metrics: SegmentMetrics;
  strategy: OptimizationStrategy;
  lastUpdated: number;
}

export interface SegmentCriteria {
  tierFilter?: string[];
  minRevenue?: number;
  maxRevenue?: number;
  activityLevel?: 'high' | 'medium' | 'low' | 'inactive';
  ageGroupDays?: [number, number];
  featureUsage?: string[];
}

export interface SegmentMetrics {
  userCount: number;
  totalRevenue: number;
  avgRevenue: number;
  churnRate: number;
  conversionRate: number;
  expansionRate: number;
  avgLTV: number;
  medianLTV: number;
}

export interface OptimizationStrategy {
  type: 'retention' | 'expansion' | 'conversion' | 'reactivation' | 'upsell';
  actions: OptimizationAction[];
  expectedImpact: number;
  confidenceLevel: number;
  budget: number;
}

export interface OptimizationAction {
  id: string;
  type: 'discount' | 'feature_unlock' | 'email' | 'notification' | 'trial_extension' | 'personal_outreach';
  description: string;
  trigger: ActionTrigger;
  parameters: Record<string, unknown>;
  estimatedROI: number;
}

export interface ActionTrigger {
  type: 'time' | 'event' | 'threshold' | 'schedule';
  condition: string;
  delay?: number;
}

export interface ConversionFunnel {
  id: string;
  name: string;
  stages: FunnelStage[];
  overallConversion: number;
  bottleneck: string;
  recommendations: string[];
}

export interface FunnelStage {
  id: string;
  name: string;
  entryCount: number;
  exitCount: number;
  conversionRate: number;
  avgTimeInStageMs: number;
  dropoffReasons: { reason: string; count: number }[];
}

export interface PricingExperiment {
  id: string;
  name: string;
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  variants: PricingVariant[];
  startDate: number;
  endDate: number | null;
  winningVariant: string | null;
  statisticalSignificance: number;
  metrics: ExperimentMetrics;
}

export interface PricingVariant {
  id: string;
  name: string;
  prices: Record<string, number>;
  features: string[];
  sampleSize: number;
  conversionRate: number;
  avgRevenue: number;
}

export interface ExperimentMetrics {
  totalParticipants: number;
  byVariant: Record<string, { conversions: number; revenue: number; participants: number }>;
  confidenceInterval: [number, number];
  pValue: number;
}

export interface RevenueProjection {
  period: string;
  projectedMRR: number;
  projectedARR: number;
  confidence: number;
  assumptions: string[];
  riskFactors: RiskFactor[];
  scenarios: {
    optimistic: number;
    baseline: number;
    pessimistic: number;
  };
}

export interface RiskFactor {
  name: string;
  probability: number;
  impact: number;
  mitigation: string;
}

export interface CohortAnalysis {
  cohortMonth: string;
  initialSize: number;
  retentionByMonth: number[];
  revenueByMonth: number[];
  cumulativeLTV: number[];
  churnedCount: number;
  expandedCount: number;
}

export class RevenueOptimizationEngine {
  private segments: Map<string, RevenueSegment> = new Map();
  private funnels: Map<string, ConversionFunnel> = new Map();
  private experiments: Map<string, PricingExperiment> = new Map();
  private cohorts: Map<string, CohortAnalysis> = new Map();
  private userEvents: { userId: string; event: string; revenue: number; timestamp: number }[] = [];

  createSegment(params: {
    name: string;
    criteria: SegmentCriteria;
    strategy: OptimizationStrategy;
  }): RevenueSegment {
    const segment: RevenueSegment = {
      id: `seg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: params.name,
      criteria: params.criteria,
      metrics: {
        userCount: 0,
        totalRevenue: 0,
        avgRevenue: 0,
        churnRate: 0,
        conversionRate: 0,
        expansionRate: 0,
        avgLTV: 0,
        medianLTV: 0,
      },
      strategy: params.strategy,
      lastUpdated: Date.now(),
    };

    this.segments.set(segment.id, segment);
    logger.info('Revenue segment created', { segmentId: segment.id, name: segment.name });
    return segment;
  }

  updateSegmentMetrics(segmentId: string, metrics: Partial<SegmentMetrics>): boolean {
    const segment = this.segments.get(segmentId);
    if (!segment) return false;

    segment.metrics = { ...segment.metrics, ...metrics };
    segment.lastUpdated = Date.now();
    return true;
  }

  createFunnel(name: string, stages: Omit<FunnelStage, 'conversionRate'>[]): ConversionFunnel {
    const fullStages: FunnelStage[] = stages.map((stage, index) => {
      const nextStageEntry = index < stages.length - 1 ? stages[index + 1].entryCount : stage.exitCount;
      return {
        ...stage,
        conversionRate: stage.entryCount > 0 ? nextStageEntry / stage.entryCount : 0,
      };
    });

    const overallConversion =
      fullStages.length > 0 && fullStages[0].entryCount > 0
        ? fullStages[fullStages.length - 1].exitCount / fullStages[0].entryCount
        : 0;

    let bottleneck = '';
    let worstConversion = 1;
    for (const stage of fullStages) {
      if (stage.conversionRate < worstConversion) {
        worstConversion = stage.conversionRate;
        bottleneck = stage.name;
      }
    }

    const recommendations = this.generateFunnelRecommendations(fullStages, bottleneck);

    const funnel: ConversionFunnel = {
      id: `funnel_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name,
      stages: fullStages,
      overallConversion,
      bottleneck,
      recommendations,
    };

    this.funnels.set(funnel.id, funnel);
    return funnel;
  }

  startPricingExperiment(params: {
    name: string;
    variants: Omit<PricingVariant, 'sampleSize' | 'conversionRate' | 'avgRevenue'>[];
    durationDays: number;
  }): PricingExperiment {
    const experiment: PricingExperiment = {
      id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: params.name,
      status: 'running',
      variants: params.variants.map((v) => ({
        ...v,
        sampleSize: 0,
        conversionRate: 0,
        avgRevenue: 0,
      })),
      startDate: Date.now(),
      endDate: Date.now() + params.durationDays * 24 * 60 * 60 * 1000,
      winningVariant: null,
      statisticalSignificance: 0,
      metrics: {
        totalParticipants: 0,
        byVariant: {},
        confidenceInterval: [0, 0],
        pValue: 1,
      },
    };

    for (const variant of experiment.variants) {
      experiment.metrics.byVariant[variant.id] = { conversions: 0, revenue: 0, participants: 0 };
    }

    this.experiments.set(experiment.id, experiment);
    logger.info('Pricing experiment started', { experimentId: experiment.id, name: experiment.name });
    return experiment;
  }

  recordExperimentEvent(
    experimentId: string,
    variantId: string,
    converted: boolean,
    revenue: number,
  ): boolean {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || experiment.status !== 'running') return false;

    const variantMetrics = experiment.metrics.byVariant[variantId];
    if (!variantMetrics) return false;

    variantMetrics.participants++;
    if (converted) {
      variantMetrics.conversions++;
      variantMetrics.revenue += revenue;
    }

    experiment.metrics.totalParticipants++;

    const variant = experiment.variants.find((v) => v.id === variantId);
    if (variant) {
      variant.sampleSize = variantMetrics.participants;
      variant.conversionRate =
        variantMetrics.participants > 0 ? variantMetrics.conversions / variantMetrics.participants : 0;
      variant.avgRevenue =
        variantMetrics.conversions > 0 ? variantMetrics.revenue / variantMetrics.conversions : 0;
    }

    this.updateExperimentSignificance(experiment);
    return true;
  }

  concludeExperiment(experimentId: string): PricingExperiment | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return null;

    let bestVariant: PricingVariant | null = null;
    let bestRevenue = -1;

    for (const variant of experiment.variants) {
      const totalRevenue = variant.conversionRate * variant.avgRevenue * variant.sampleSize;
      if (totalRevenue > bestRevenue) {
        bestRevenue = totalRevenue;
        bestVariant = variant;
      }
    }

    experiment.status = 'completed';
    experiment.winningVariant = bestVariant?.id || null;
    experiment.endDate = Date.now();

    logger.info('Experiment concluded', {
      experimentId,
      winner: experiment.winningVariant,
      significance: experiment.statisticalSignificance,
    });

    return experiment;
  }

  trackUserEvent(userId: string, event: string, revenue: number = 0): void {
    this.userEvents.push({ userId, event, revenue, timestamp: Date.now() });

    if (this.userEvents.length > 100000) {
      this.userEvents = this.userEvents.slice(-50000);
    }
  }

  generateCohortAnalysis(cohortMonth: string, userIds: string[]): CohortAnalysis {
    const cohortStart = new Date(cohortMonth + '-01').getTime();
    const now = Date.now();
    const monthsPassed = Math.floor((now - cohortStart) / (30 * 24 * 60 * 60 * 1000));

    const retentionByMonth: number[] = [];
    const revenueByMonth: number[] = [];
    const cumulativeLTV: number[] = [];
    let cumulative = 0;

    for (let m = 0; m <= monthsPassed; m++) {
      const monthStart = cohortStart + m * 30 * 24 * 60 * 60 * 1000;
      const monthEnd = monthStart + 30 * 24 * 60 * 60 * 1000;

      const activeUsers = this.userEvents.filter(
        (e) =>
          userIds.includes(e.userId) &&
          e.timestamp >= monthStart &&
          e.timestamp < monthEnd,
      );

      const uniqueActive = new Set(activeUsers.map((e) => e.userId)).size;
      const retention = userIds.length > 0 ? uniqueActive / userIds.length : 0;
      const monthRevenue = activeUsers.reduce((sum, e) => sum + e.revenue, 0);

      retentionByMonth.push(parseFloat(retention.toFixed(4)));
      revenueByMonth.push(parseFloat(monthRevenue.toFixed(2)));
      cumulative += monthRevenue;
      cumulativeLTV.push(parseFloat(cumulative.toFixed(2)));
    }

    const analysis: CohortAnalysis = {
      cohortMonth,
      initialSize: userIds.length,
      retentionByMonth,
      revenueByMonth,
      cumulativeLTV,
      churnedCount: Math.round(userIds.length * (1 - (retentionByMonth[retentionByMonth.length - 1] || 0))),
      expandedCount: Math.round(
        userIds.length * 0.1,
      ),
    };

    this.cohorts.set(cohortMonth, analysis);
    return analysis;
  }

  projectRevenue(currentMRR: number, growthRate: number, months: number): RevenueProjection[] {
    const projections: RevenueProjection[] = [];

    for (let m = 1; m <= months; m++) {
      const date = new Date();
      date.setMonth(date.getMonth() + m);
      const period = date.toISOString().substring(0, 7);

      const baseline = currentMRR * Math.pow(1 + growthRate, m);
      const optimistic = currentMRR * Math.pow(1 + growthRate * 1.5, m);
      const pessimistic = currentMRR * Math.pow(1 + growthRate * 0.5, m);

      const confidence = Math.max(0.3, 1 - m * 0.05);

      projections.push({
        period,
        projectedMRR: parseFloat(baseline.toFixed(2)),
        projectedARR: parseFloat((baseline * 12).toFixed(2)),
        confidence: parseFloat(confidence.toFixed(2)),
        assumptions: [
          `${(growthRate * 100).toFixed(1)}% monthly growth rate`,
          'Stable churn rate',
          'Consistent conversion funnel',
        ],
        riskFactors: [
          {
            name: 'Market competition',
            probability: 0.3,
            impact: -0.15,
            mitigation: 'Feature differentiation and pricing optimization',
          },
          {
            name: 'Churn increase',
            probability: 0.2,
            impact: -0.1,
            mitigation: 'Proactive retention campaigns and feature engagement',
          },
        ],
        scenarios: {
          optimistic: parseFloat(optimistic.toFixed(2)),
          baseline: parseFloat(baseline.toFixed(2)),
          pessimistic: parseFloat(pessimistic.toFixed(2)),
        },
      });
    }

    return projections;
  }

  optimizeSegmentStrategies(): Map<string, OptimizationAction[]> {
    const recommendations = new Map<string, OptimizationAction[]>();

    for (const [segmentId, segment] of this.segments) {
      const actions: OptimizationAction[] = [];

      if (segment.metrics.churnRate > 0.1) {
        actions.push({
          id: `action_retention_${segmentId}`,
          type: 'discount',
          description: 'Offer 20% discount to at-risk users',
          trigger: { type: 'threshold', condition: 'churn_risk > 0.7' },
          parameters: { discountPercent: 20, durationMonths: 3 },
          estimatedROI: 2.5,
        });
      }

      if (segment.metrics.conversionRate < 0.05) {
        actions.push({
          id: `action_conversion_${segmentId}`,
          type: 'trial_extension',
          description: 'Extend trial by 7 days with premium features',
          trigger: { type: 'time', condition: 'trial_expiry < 2d' },
          parameters: { extensionDays: 7, features: ['premium_analytics', 'api_access'] },
          estimatedROI: 3.0,
        });
      }

      if (segment.metrics.expansionRate < 0.02) {
        actions.push({
          id: `action_upsell_${segmentId}`,
          type: 'feature_unlock',
          description: 'Temporarily unlock next-tier features',
          trigger: { type: 'event', condition: 'usage > 80%' },
          parameters: { features: ['advanced_analytics'], durationDays: 14 },
          estimatedROI: 4.0,
        });
      }

      recommendations.set(segmentId, actions);
    }

    return recommendations;
  }

  getSegments(): RevenueSegment[] {
    return Array.from(this.segments.values());
  }

  getFunnels(): ConversionFunnel[] {
    return Array.from(this.funnels.values());
  }

  getExperiments(status?: string): PricingExperiment[] {
    const experiments = Array.from(this.experiments.values());
    return status ? experiments.filter((e) => e.status === status) : experiments;
  }

  getRevenueMetrics(): {
    totalMRR: number;
    avgArpu: number;
    netRevenueRetention: number;
    expansionRevenue: number;
    churnedRevenue: number;
  } {
    let totalRevenue = 0;
    let totalUsers = 0;

    for (const segment of this.segments.values()) {
      totalRevenue += segment.metrics.totalRevenue;
      totalUsers += segment.metrics.userCount;
    }

    return {
      totalMRR: parseFloat(totalRevenue.toFixed(2)),
      avgArpu: totalUsers > 0 ? parseFloat((totalRevenue / totalUsers).toFixed(2)) : 0,
      netRevenueRetention: 1.05,
      expansionRevenue: parseFloat((totalRevenue * 0.15).toFixed(2)),
      churnedRevenue: parseFloat((totalRevenue * 0.05).toFixed(2)),
    };
  }

  private generateFunnelRecommendations(stages: FunnelStage[], bottleneck: string): string[] {
    const recommendations: string[] = [];

    for (const stage of stages) {
      if (stage.conversionRate < 0.3) {
        recommendations.push(
          `${stage.name}: Low conversion (${(stage.conversionRate * 100).toFixed(1)}%) - consider simplifying this step`,
        );
      }
      if (stage.avgTimeInStageMs > 86400000) {
        recommendations.push(
          `${stage.name}: Users spending too long in this stage - add nudge notifications`,
        );
      }
    }

    if (bottleneck) {
      recommendations.push(`Focus optimization efforts on "${bottleneck}" as the primary bottleneck`);
    }

    return recommendations;
  }

  private updateExperimentSignificance(experiment: PricingExperiment): void {
    if (experiment.variants.length < 2) return;

    const control = experiment.variants[0];
    const treatment = experiment.variants[1];

    if (control.sampleSize < 30 || treatment.sampleSize < 30) {
      experiment.statisticalSignificance = 0;
      return;
    }

    const p1 = control.conversionRate;
    const p2 = treatment.conversionRate;
    const n1 = control.sampleSize;
    const n2 = treatment.sampleSize;

    const pPooled = (p1 * n1 + p2 * n2) / (n1 + n2);
    const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));

    if (se === 0) {
      experiment.statisticalSignificance = 0;
      return;
    }

    const z = Math.abs(p2 - p1) / se;
    experiment.statisticalSignificance = Math.min(0.99, 1 - Math.exp(-0.5 * z * z));

    const margin = 1.96 * se;
    experiment.metrics.confidenceInterval = [
      parseFloat((p2 - p1 - margin).toFixed(4)),
      parseFloat((p2 - p1 + margin).toFixed(4)),
    ];
    experiment.metrics.pValue = parseFloat((1 - experiment.statisticalSignificance).toFixed(4));
  }
}

let revenueEngineInstance: RevenueOptimizationEngine | null = null;

export function getRevenueOptimizationEngine(): RevenueOptimizationEngine {
  if (!revenueEngineInstance) {
    revenueEngineInstance = new RevenueOptimizationEngine();
  }
  return revenueEngineInstance;
}
