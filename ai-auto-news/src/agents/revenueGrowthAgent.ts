/**
 * Revenue Growth Agent
 *
 * Autonomous agent that drives MRR expansion by identifying upsell opportunities,
 * detecting expansion signals, preventing churn, running pricing experiments,
 * and generating actionable growth plans for each tenant.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface RevenueOpportunity {
  opportunityId: string;
  tenantId: string;
  type: OpportunityType;
  title: string;
  description: string;
  estimatedMRR: number;
  probability: number;
  effort: 'low' | 'medium' | 'high';
  priority: number;
  signals: string[];
  expiresAt?: number;
  createdAt: number;
}

export type OpportunityType =
  | 'upsell'
  | 'cross_sell'
  | 'tier_upgrade'
  | 'seat_expansion'
  | 'add_on'
  | 'renewal_risk'
  | 'win_back'
  | 'referral';

export interface GrowthExperiment {
  experimentId: string;
  name: string;
  hypothesis: string;
  variant: 'control' | 'treatment';
  metric: string;
  targetSegment: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'completed' | 'stopped';
  controlMetric: number;
  treatmentMetric: number;
  pValue?: number;
  winner?: 'control' | 'treatment' | 'inconclusive';
  estimatedLiftPct?: number;
}

export interface PricingRecommendation {
  recommendationId: string;
  segment: string;
  currentPrice: number;
  recommendedPrice: number;
  changePct: number;
  rationale: string;
  expectedRevenueDelta: number;
  churnRiskDelta: number;
  confidence: number;
  validUntil: number;
  generatedAt: number;
}

export interface ExpansionSignal {
  signalId: string;
  userId: string;
  tenantId: string;
  type: SignalType;
  strength: number;
  description: string;
  detectedAt: number;
  actionable: boolean;
  recommendedAction?: string;
  expiresAt?: number;
}

export type SignalType =
  | 'usage_spike'
  | 'feature_limit_hit'
  | 'api_quota_exhausted'
  | 'seat_limit_reached'
  | 'power_user_activity'
  | 'integration_breadth'
  | 'nps_high'
  | 'support_champion';

export interface ChurnRisk {
  tenantId: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: ChurnFactor[];
  mrr: number;
  daysToRenewal: number;
  recommendedActions: string[];
  assessedAt: number;
}

export interface ChurnFactor {
  name: string;
  impact: number;
  description: string;
  mitigable: boolean;
}

export interface GrowthPlan {
  planId: string;
  tenantId: string;
  horizon: 'month' | 'quarter' | 'year';
  currentMRR: number;
  targetMRR: number;
  growthTargetPct: number;
  initiatives: GrowthInitiative[];
  experiments: string[];
  risks: string[];
  generatedAt: number;
}

export interface GrowthInitiative {
  initiativeId: string;
  name: string;
  type: OpportunityType | 'retention' | 'product_led';
  estimatedMRRImpact: number;
  effort: 'low' | 'medium' | 'high';
  timeline: string;
  owner: string;
  kpis: string[];
}

export interface RevenueAction {
  actionId: string;
  tenantId: string;
  userId?: string;
  type: ActionType;
  title: string;
  payload: Record<string, unknown>;
  channel: 'email' | 'in_app' | 'sales_call' | 'webhook' | 'push';
  scheduledAt?: number;
  executedAt?: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: ActionResult;
}

export type ActionType =
  | 'send_upsell_email'
  | 'trigger_in_app_nudge'
  | 'schedule_sales_call'
  | 'apply_discount'
  | 'unlock_trial_feature'
  | 'send_renewal_reminder'
  | 'activate_win_back_campaign';

export interface ActionResult {
  success: boolean;
  conversionValue?: number;
  responseTime?: number;
  error?: string;
}

export interface GrowthMetrics {
  mrr: number;
  mrrGrowthPct: number;
  arr: number;
  newMRR: number;
  expansionMRR: number;
  contractionMRR: number;
  churnedMRR: number;
  netRevenueRetention: number;
  grossRevenueRetention: number;
  avgRevenuePerAccount: number;
  activeOpportunities: number;
  conversionRate: number;
  measuredAt: number;
}

export class RevenueGrowthAgent {
  private opportunities = new Map<string, RevenueOpportunity>();
  private experiments = new Map<string, GrowthExperiment>();
  private plans = new Map<string, GrowthPlan>();
  private actions = new Map<string, RevenueAction>();
  private signals = new Map<string, ExpansionSignal[]>();
  private churnRisks = new Map<string, ChurnRisk>();
  private metricsHistory: GrowthMetrics[] = [];
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startGrowthMonitoring();
  }

  identifyOpportunities(tenantId: string): RevenueOpportunity[] {
    const existing = Array.from(this.opportunities.values()).filter(o => o.tenantId === tenantId);
    if (existing.length > 0) return existing;

    const usageData = this.fetchUsageData(tenantId);
    const opportunities: RevenueOpportunity[] = [];

    if (usageData.seatUtilizationPct > 85) {
      opportunities.push({
        opportunityId: `opp-${Date.now()}-1`,
        tenantId,
        type: 'seat_expansion',
        title: 'Seat Capacity Approaching Limit',
        description: `Current seat utilization at ${usageData.seatUtilizationPct.toFixed(0)}%. Recommend expanding seat count to avoid productivity blockers.`,
        estimatedMRR: usageData.currentMRR * 0.2,
        probability: 0.72,
        effort: 'low',
        priority: 1,
        signals: ['seat_limit_reached', 'power_user_activity'],
        expiresAt: Date.now() + 30 * 24 * 3600_000,
        createdAt: Date.now(),
      });
    }

    if (usageData.apiUsagePct > 80) {
      opportunities.push({
        opportunityId: `opp-${Date.now()}-2`,
        tenantId,
        type: 'tier_upgrade',
        title: 'API Quota Near Exhaustion',
        description: 'API usage at 80%+ of plan limit. Upgrading to next tier prevents service disruption.',
        estimatedMRR: usageData.currentMRR * 0.35,
        probability: 0.68,
        effort: 'low',
        priority: 2,
        signals: ['api_quota_exhausted'],
        expiresAt: Date.now() + 14 * 24 * 3600_000,
        createdAt: Date.now(),
      });
    }

    if (usageData.featureAdoptionPct < 40 && usageData.daysActive > 60) {
      opportunities.push({
        opportunityId: `opp-${Date.now()}-3`,
        tenantId,
        type: 'add_on',
        title: 'Feature Adoption Gap – Cross-sell Add-ons',
        description: 'Customer is not using advanced features. Targeted onboarding can unlock upsell potential.',
        estimatedMRR: usageData.currentMRR * 0.15,
        probability: 0.45,
        effort: 'medium',
        priority: 3,
        signals: ['integration_breadth'],
        createdAt: Date.now(),
      });
    }

    opportunities.forEach(o => this.opportunities.set(o.opportunityId, o));

    logger.info('Revenue opportunities identified', {
      tenantId,
      count: opportunities.length,
      totalEstimatedMRR: opportunities.reduce((s, o) => s + o.estimatedMRR, 0),
    });

    return opportunities;
  }

  generateGrowthPlan(tenantId: string): GrowthPlan {
    const opportunities = this.identifyOpportunities(tenantId);
    const usageData = this.fetchUsageData(tenantId);
    const churnRisk = this.assessChurnRisk(tenantId);

    const initiatives: GrowthInitiative[] = opportunities.map((opp, i) => ({
      initiativeId: `init-${i}`,
      name: opp.title,
      type: opp.type,
      estimatedMRRImpact: opp.estimatedMRR,
      effort: opp.effort,
      timeline: opp.effort === 'low' ? '1-2 weeks' : opp.effort === 'medium' ? '1 month' : '2-3 months',
      owner: 'growth-team',
      kpis: ['MRR', 'Conversion Rate', 'NPS'],
    }));

    if (churnRisk.riskLevel === 'high' || churnRisk.riskLevel === 'critical') {
      initiatives.unshift({
        initiativeId: 'init-churn',
        name: 'Churn Prevention Intervention',
        type: 'retention',
        estimatedMRRImpact: churnRisk.mrr,
        effort: 'high',
        timeline: 'Immediate',
        owner: 'cs-team',
        kpis: ['Churn Rate', 'NRR', 'CSAT'],
      });
    }

    const targetGrowthPct = churnRisk.riskLevel === 'low' ? 0.25 : 0.10;

    const plan: GrowthPlan = {
      planId: `plan-${Date.now()}-${tenantId}`,
      tenantId,
      horizon: 'quarter',
      currentMRR: usageData.currentMRR,
      targetMRR: usageData.currentMRR * (1 + targetGrowthPct),
      growthTargetPct: targetGrowthPct * 100,
      initiatives,
      experiments: [],
      risks: churnRisk.factors.map(f => f.description),
      generatedAt: Date.now(),
    };

    this.plans.set(plan.planId, plan);

    logger.info('Growth plan generated', {
      planId: plan.planId,
      tenantId,
      currentMRR: plan.currentMRR,
      targetMRR: plan.targetMRR,
      initiatives: initiatives.length,
    });

    return plan;
  }

  recommendPricing(segment: string): PricingRecommendation {
    const segmentData = this.fetchSegmentData(segment);
    const priceElasticity = this.computeElasticity(segment);
    const recommendedChange = priceElasticity > -1 ? 0.12 : priceElasticity > -2 ? 0.05 : -0.05;

    const recommendation: PricingRecommendation = {
      recommendationId: `price-${Date.now()}-${segment}`,
      segment,
      currentPrice: segmentData.avgPrice,
      recommendedPrice: segmentData.avgPrice * (1 + recommendedChange),
      changePct: recommendedChange * 100,
      rationale: recommendedChange > 0
        ? `Segment shows inelastic demand (elasticity: ${priceElasticity.toFixed(2)}). Price increase unlikely to increase churn.`
        : `Elastic segment. Price reduction expected to increase conversion by ${Math.abs(recommendedChange * 100).toFixed(0)}%.`,
      expectedRevenueDelta: segmentData.totalMRR * recommendedChange * 0.7,
      churnRiskDelta: recommendedChange > 0 ? 0.02 : -0.01,
      confidence: 0.74,
      validUntil: Date.now() + 90 * 24 * 3600_000,
      generatedAt: Date.now(),
    };

    logger.info('Pricing recommendation generated', {
      segment,
      currentPrice: recommendation.currentPrice,
      recommendedPrice: recommendation.recommendedPrice,
      changePct: recommendation.changePct,
    });

    return recommendation;
  }

  detectExpansionSignals(userId: string): ExpansionSignal[] {
    const usagePattern = this.fetchUserActivity(userId);
    const detectedSignals: ExpansionSignal[] = [];

    if (usagePattern.dailyActiveMinutes > 120) {
      detectedSignals.push({
        signalId: `sig-${Date.now()}-1`,
        userId,
        tenantId: usagePattern.tenantId,
        type: 'power_user_activity',
        strength: Math.min(1, usagePattern.dailyActiveMinutes / 240),
        description: `High daily engagement: ${usagePattern.dailyActiveMinutes} min/day`,
        detectedAt: Date.now(),
        actionable: true,
        recommendedAction: 'Offer advanced tier trial or champion recognition program',
        expiresAt: Date.now() + 7 * 24 * 3600_000,
      });
    }

    if (usagePattern.featureLimitHits > 3) {
      detectedSignals.push({
        signalId: `sig-${Date.now()}-2`,
        userId,
        tenantId: usagePattern.tenantId,
        type: 'feature_limit_hit',
        strength: Math.min(1, usagePattern.featureLimitHits / 10),
        description: `User hit feature limits ${usagePattern.featureLimitHits} times this week`,
        detectedAt: Date.now(),
        actionable: true,
        recommendedAction: 'Present upgrade dialog with feature benefit comparison',
        expiresAt: Date.now() + 3 * 24 * 3600_000,
      });
    }

    if (usagePattern.integrationsConnected > 5) {
      detectedSignals.push({
        signalId: `sig-${Date.now()}-3`,
        userId,
        tenantId: usagePattern.tenantId,
        type: 'integration_breadth',
        strength: Math.min(1, usagePattern.integrationsConnected / 10),
        description: `User deeply embedded with ${usagePattern.integrationsConnected} integrations`,
        detectedAt: Date.now(),
        actionable: false,
        recommendedAction: 'Flag as expansion candidate for enterprise tier discussion',
      });
    }

    const existing = this.signals.get(userId) ?? [];
    existing.push(...detectedSignals);
    this.signals.set(userId, existing);

    return detectedSignals;
  }

  monitorGrowthMetrics(): GrowthMetrics {
    const allTenants = this.getActiveTenants();
    const mrr = allTenants.reduce((s, t) => s + this.fetchUsageData(t).currentMRR, 0);
    const prevMRR = this.metricsHistory.slice(-1)[0]?.mrr ?? mrr;

    const metrics: GrowthMetrics = {
      mrr,
      mrrGrowthPct: prevMRR > 0 ? ((mrr - prevMRR) / prevMRR) * 100 : 0,
      arr: mrr * 12,
      newMRR: mrr * 0.08,
      expansionMRR: mrr * 0.05,
      contractionMRR: mrr * 0.01,
      churnedMRR: mrr * 0.015,
      netRevenueRetention: 1.10,
      grossRevenueRetention: 0.93,
      avgRevenuePerAccount: allTenants.length > 0 ? mrr / allTenants.length : 0,
      activeOpportunities: this.opportunities.size,
      conversionRate: this.computeConversionRate(),
      measuredAt: Date.now(),
    };

    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > 365) this.metricsHistory.shift();

    logger.info('Growth metrics captured', {
      mrr: metrics.mrr,
      mrrGrowthPct: metrics.mrrGrowthPct,
      nrr: metrics.netRevenueRetention,
    });

    return metrics;
  }

  executeGrowthAction(action: Omit<RevenueAction, 'actionId' | 'status' | 'executedAt' | 'result'>): RevenueAction {
    const revenueAction: RevenueAction = {
      ...action,
      actionId: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'executing',
      executedAt: Date.now(),
    };

    this.actions.set(revenueAction.actionId, revenueAction);

    try {
      const result = this.dispatchAction(revenueAction);
      revenueAction.status = 'completed';
      revenueAction.result = result;

      logger.info('Growth action executed', {
        actionId: revenueAction.actionId,
        type: revenueAction.type,
        channel: revenueAction.channel,
        tenantId: revenueAction.tenantId,
        success: result.success,
      });
    } catch (err) {
      revenueAction.status = 'failed';
      revenueAction.result = { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      logger.error('Growth action failed', undefined, {
        actionId: revenueAction.actionId,
        error: revenueAction.result.error,
      });
    }

    return revenueAction;
  }

  evaluateExperiment(experimentId: string): GrowthExperiment {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    if (experiment.status !== 'running') return experiment;

    // Compute statistical significance with Welch's t-test approximation
    const lift = experiment.controlMetric > 0
      ? (experiment.treatmentMetric - experiment.controlMetric) / experiment.controlMetric
      : 0;
    const n = 500; // assumed sample size per variant
    const se = Math.sqrt((experiment.controlMetric * (1 - experiment.controlMetric) / n) * 2);
    const zScore = se > 0 ? Math.abs(experiment.treatmentMetric - experiment.controlMetric) / se : 0;
    const pValue = zScore > 2.576 ? 0.01 : zScore > 1.96 ? 0.05 : zScore > 1.645 ? 0.10 : 0.50;

    experiment.pValue = pValue;
    experiment.estimatedLiftPct = lift * 100;

    if (pValue <= 0.05) {
      experiment.winner = lift > 0 ? 'treatment' : 'control';
      experiment.status = 'completed';
      experiment.endedAt = Date.now();
    } else {
      experiment.winner = 'inconclusive';
    }

    logger.info('Experiment evaluated', {
      experimentId,
      pValue,
      liftPct: experiment.estimatedLiftPct,
      winner: experiment.winner,
    });

    return experiment;
  }

  forecastRevenue(horizon: 'month' | 'quarter' | 'year'): {
    horizon: string;
    forecastMRR: number;
    forecastARR: number;
    confidenceInterval: { low: number; high: number };
    assumptions: string[];
  } {
    const currentMetrics = this.metricsHistory.slice(-1)[0] ?? this.monitorGrowthMetrics();
    const months = horizon === 'month' ? 1 : horizon === 'quarter' ? 3 : 12;

    const avgGrowthRate = this.metricsHistory.length > 1
      ? this.metricsHistory.slice(-6).reduce((s, m) => s + m.mrrGrowthPct, 0) / Math.min(6, this.metricsHistory.length)
      : 5;

    const compoundGrowth = Math.pow(1 + avgGrowthRate / 100, months);
    const forecastMRR = currentMetrics.mrr * compoundGrowth;
    const uncertainty = 0.15 * Math.sqrt(months);

    logger.info('Revenue forecast generated', {
      horizon,
      currentMRR: currentMetrics.mrr,
      forecastMRR,
      avgGrowthRate,
    });

    return {
      horizon,
      forecastMRR,
      forecastARR: forecastMRR * 12,
      confidenceInterval: {
        low: forecastMRR * (1 - uncertainty),
        high: forecastMRR * (1 + uncertainty),
      },
      assumptions: [
        `Average monthly growth rate of ${avgGrowthRate.toFixed(1)}% maintained`,
        `NRR held at ${(currentMetrics.netRevenueRetention * 100).toFixed(0)}%`,
        `No major market disruptions in ${horizon} horizon`,
        `Expansion pipeline conversion at current rates`,
      ],
    };
  }

  assessChurnRisk(tenantId: string): ChurnRisk {
    const cached = this.churnRisks.get(tenantId);
    if (cached && Date.now() - cached.assessedAt < 3600_000) return cached;

    const usageData = this.fetchUsageData(tenantId);
    const factors: ChurnFactor[] = [];

    if (usageData.loginFrequencyDrop > 0.3) {
      factors.push({ name: 'login_frequency_drop', impact: 0.35, description: 'Login frequency dropped >30% MoM', mitigable: true });
    }
    if (usageData.supportTickets > 5) {
      factors.push({ name: 'high_support_volume', impact: 0.20, description: 'High unresolved support ticket count', mitigable: true });
    }
    if (usageData.featureAdoptionPct < 25) {
      factors.push({ name: 'low_feature_adoption', impact: 0.25, description: 'Less than 25% of features adopted', mitigable: true });
    }
    if (usageData.daysToRenewal < 30) {
      factors.push({ name: 'renewal_proximity', impact: 0.20, description: 'Renewal within 30 days with no expansion signals', mitigable: false });
    }

    const riskScore = factors.reduce((s, f) => s + f.impact, 0);
    const riskLevel: ChurnRisk['riskLevel'] =
      riskScore >= 0.75 ? 'critical' : riskScore >= 0.5 ? 'high' : riskScore >= 0.25 ? 'medium' : 'low';

    const risk: ChurnRisk = {
      tenantId,
      riskScore,
      riskLevel,
      factors,
      mrr: usageData.currentMRR,
      daysToRenewal: usageData.daysToRenewal,
      recommendedActions: this.buildChurnPreventionActions(riskLevel, factors),
      assessedAt: Date.now(),
    };

    this.churnRisks.set(tenantId, risk);
    return risk;
  }

  private buildChurnPreventionActions(level: ChurnRisk['riskLevel'], factors: ChurnFactor[]): string[] {
    const actions: string[] = [];
    if (level === 'critical') actions.push('Escalate to account executive for executive business review');
    if (factors.some(f => f.name === 'login_frequency_drop')) actions.push('Trigger re-engagement email sequence');
    if (factors.some(f => f.name === 'high_support_volume')) actions.push('Assign dedicated CSM for white-glove support');
    if (factors.some(f => f.name === 'low_feature_adoption')) actions.push('Schedule personalized onboarding session');
    if (factors.some(f => f.name === 'renewal_proximity')) actions.push('Prepare renewal proposal with incentive');
    return actions;
  }

  private dispatchAction(action: RevenueAction): ActionResult {
    // Simulate dispatch; real impl would call email/in-app/webhook service
    const mockSuccessRate = 0.92;
    const success = Math.random() < mockSuccessRate;
    return {
      success,
      conversionValue: success ? Math.random() * 500 : undefined,
      responseTime: Math.floor(Math.random() * 2000),
      error: success ? undefined : 'Delivery provider returned 5xx',
    };
  }

  private fetchUsageData(tenantId: string): {
    currentMRR: number;
    seatUtilizationPct: number;
    apiUsagePct: number;
    featureAdoptionPct: number;
    daysActive: number;
    loginFrequencyDrop: number;
    supportTickets: number;
    daysToRenewal: number;
  } {
    const seed = tenantId.charCodeAt(0) % 10;
    return {
      currentMRR: 500 + seed * 250,
      seatUtilizationPct: 50 + seed * 5,
      apiUsagePct: 40 + seed * 6,
      featureAdoptionPct: 20 + seed * 8,
      daysActive: 30 + seed * 10,
      loginFrequencyDrop: seed > 7 ? 0.35 : 0.05,
      supportTickets: seed > 6 ? 6 : 1,
      daysToRenewal: 10 + seed * 15,
    };
  }

  private fetchSegmentData(segment: string): { avgPrice: number; totalMRR: number } {
    const seed = segment.length % 5;
    return { avgPrice: 49 + seed * 50, totalMRR: 10000 + seed * 5000 };
  }

  private fetchUserActivity(userId: string): {
    tenantId: string;
    dailyActiveMinutes: number;
    featureLimitHits: number;
    integrationsConnected: number;
  } {
    const seed = userId.charCodeAt(0) % 10;
    return {
      tenantId: `tenant-${seed}`,
      dailyActiveMinutes: 30 + seed * 15,
      featureLimitHits: seed > 6 ? seed - 3 : 0,
      integrationsConnected: seed,
    };
  }

  private computeElasticity(segment: string): number {
    const seed = segment.length % 5;
    return -(0.5 + seed * 0.3);
  }

  private computeConversionRate(): number {
    const completed = Array.from(this.actions.values()).filter(a => a.status === 'completed' && a.result?.conversionValue);
    const total = Array.from(this.actions.values()).filter(a => a.status === 'completed' || a.status === 'failed');
    return total.length > 0 ? completed.length / total.length : 0;
  }

  private getActiveTenants(): string[] {
    const tenantSet = new Set<string>();
    this.opportunities.forEach(o => tenantSet.add(o.tenantId));
    this.churnRisks.forEach((_, tid) => tenantSet.add(tid));
    return Array.from(tenantSet);
  }

  private startGrowthMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.monitorGrowthMetrics();

      // Auto-expire stale opportunities
      const now = Date.now();
      this.opportunities.forEach((opp, id) => {
        if (opp.expiresAt && opp.expiresAt < now) {
          this.opportunities.delete(id);
        }
      });

      // Re-evaluate running experiments
      this.experiments.forEach(exp => {
        if (exp.status === 'running') this.evaluateExperiment(exp.experimentId);
      });
    }, 3_600_000);
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __revenueGrowthAgent__: RevenueGrowthAgent | undefined;
}

export function getRevenueGrowthAgent(): RevenueGrowthAgent {
  if (!globalThis.__revenueGrowthAgent__) {
    globalThis.__revenueGrowthAgent__ = new RevenueGrowthAgent();
  }
  return globalThis.__revenueGrowthAgent__;
}
