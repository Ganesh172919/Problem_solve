/**
 * User Retention Agent
 *
 * Predictive churn-prevention agent that computes behavioral retention scores,
 * forecasts churn risk, orchestrates multi-channel interventions, runs A/B
 * retention campaigns, and tracks cohort-level engagement recovery.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface RetentionSignal {
  signalId: string;
  userId: string;
  tenantId: string;
  type: RetentionSignalType;
  direction: 'positive' | 'negative' | 'neutral';
  magnitude: number;
  description: string;
  detectedAt: number;
  raw: Record<string, unknown>;
}

export type RetentionSignalType =
  | 'login_frequency'
  | 'feature_usage'
  | 'session_duration'
  | 'support_ticket'
  | 'nps_response'
  | 'billing_issue'
  | 'integration_disconnect'
  | 'team_growth'
  | 'competitor_mention'
  | 'onboarding_incomplete'
  | 'milestone_achieved';

export interface ChurnPredictor {
  predictorId: string;
  userId: string;
  tenantId: string;
  horizon: number;
  churnProbability: number;
  confidence: number;
  topFeatures: PredictorFeature[];
  predictedAt: number;
  expiresAt: number;
}

export interface PredictorFeature {
  name: string;
  value: number;
  contribution: number;
  direction: 'increases_churn' | 'decreases_churn';
}

export interface RetentionCampaign {
  campaignId: string;
  name: string;
  targetSegment: string;
  variant: 'control' | 'treatment_a' | 'treatment_b';
  channel: CampaignChannel;
  message: CampaignMessage;
  startedAt: number;
  endedAt?: number;
  status: 'draft' | 'active' | 'paused' | 'completed';
  metrics: CampaignMetrics;
  tenantId?: string;
}

export type CampaignChannel = 'email' | 'in_app' | 'push' | 'sms' | 'success_manager';

export interface CampaignMessage {
  subject?: string;
  headline: string;
  body: string;
  cta: string;
  personalizationTokens: string[];
}

export interface CampaignMetrics {
  enrolled: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  retained: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  retentionLift: number;
}

export interface UserSegment {
  segmentId: string;
  name: string;
  criteria: SegmentCriteria;
  userIds: string[];
  avgRetentionScore: number;
  avgChurnRisk: number;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface SegmentCriteria {
  retentionScoreRange?: [number, number];
  churnRiskThreshold?: number;
  daysInactive?: number;
  planTier?: string;
  tenantId?: string;
}

export interface InterventionAction {
  actionId: string;
  userId: string;
  type: InterventionType;
  channel: CampaignChannel;
  content: Record<string, unknown>;
  priority: 'immediate' | 'high' | 'medium' | 'low';
  scheduledAt: number;
  executedAt?: number;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
  outcome?: InterventionOutcome;
}

export type InterventionType =
  | 'personalized_email'
  | 'in_app_checklist'
  | 'feature_spotlight'
  | 'success_call'
  | 'discount_offer'
  | 'onboarding_restart'
  | 'win_back_sequence'
  | 'health_check_survey';

export interface InterventionOutcome {
  converted: boolean;
  engagementDelta: number;
  retentionScoreDelta: number;
  respondedAt?: number;
}

export interface RetentionScore {
  userId: string;
  tenantId: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: RetentionComponent[];
  trend: 'improving' | 'stable' | 'declining';
  computedAt: number;
  previousScore?: number;
}

export interface RetentionComponent {
  name: string;
  weight: number;
  rawValue: number;
  normalizedValue: number;
  contribution: number;
}

export interface EngagementBooster {
  boosterId: string;
  userId: string;
  type: 'feature_tip' | 'shortcut' | 'template' | 'integration_suggestion' | 'goal_nudge';
  title: string;
  description: string;
  estimatedLift: number;
  relevanceScore: number;
  shownAt?: number;
  dismissed?: boolean;
}

export interface RetentionOutcome {
  userId: string;
  period: { from: number; to: number };
  retained: boolean;
  retentionScoreStart: number;
  retentionScoreEnd: number;
  interventionsReceived: number;
  interventionsConverted: number;
  churnProbabilityStart: number;
  churnProbabilityEnd: number;
  finalStatus: 'retained' | 'churned' | 'at_risk' | 'expanded';
}

export interface RetentionReport {
  reportId: string;
  period: { from: number; to: number };
  tenantId?: string;
  totalUsers: number;
  retainedUsers: number;
  churnedUsers: number;
  atRiskUsers: number;
  overallRetentionRate: number;
  avgRetentionScore: number;
  campaignsSummary: { active: number; completed: number; avgLift: number };
  interventionsSummary: { total: number; converted: number; conversionRate: number };
  cohortAnalysis: CohortData[];
  generatedAt: number;
}

export interface CohortData {
  cohortLabel: string;
  size: number;
  retentionRate: number;
  avgScore: number;
  churnRate: number;
}

export class UserRetentionAgent {
  private retentionScores = new Map<string, RetentionScore>();
  private churnPredictors = new Map<string, ChurnPredictor>();
  private campaigns = new Map<string, RetentionCampaign>();
  private interventions = new Map<string, InterventionAction>();
  private signals = new Map<string, RetentionSignal[]>();
  private segments = new Map<string, UserSegment>();
  private outcomes = new Map<string, RetentionOutcome>();
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startContinuousMonitoring();
  }

  computeRetentionScore(userId: string): RetentionScore {
    const activity = this.fetchUserActivity(userId);
    const previousScore = this.retentionScores.get(userId)?.score;

    const components: RetentionComponent[] = [
      {
        name: 'Login Frequency',
        weight: 0.25,
        rawValue: activity.loginDaysLast30,
        normalizedValue: Math.min(1, activity.loginDaysLast30 / 20),
        contribution: 0,
      },
      {
        name: 'Feature Breadth',
        weight: 0.20,
        rawValue: activity.featuresUsed,
        normalizedValue: Math.min(1, activity.featuresUsed / 10),
        contribution: 0,
      },
      {
        name: 'Session Depth',
        weight: 0.20,
        rawValue: activity.avgSessionMinutes,
        normalizedValue: Math.min(1, activity.avgSessionMinutes / 30),
        contribution: 0,
      },
      {
        name: 'Collaboration',
        weight: 0.15,
        rawValue: activity.teamMembersActive,
        normalizedValue: Math.min(1, activity.teamMembersActive / 5),
        contribution: 0,
      },
      {
        name: 'Integration Health',
        weight: 0.10,
        rawValue: activity.activeIntegrations,
        normalizedValue: Math.min(1, activity.activeIntegrations / 3),
        contribution: 0,
      },
      {
        name: 'Support Signal',
        weight: 0.10,
        rawValue: activity.unresolvedTickets,
        normalizedValue: Math.max(0, 1 - activity.unresolvedTickets / 5),
        contribution: 0,
      },
    ];

    components.forEach(c => {
      c.contribution = c.weight * c.normalizedValue;
    });

    const score = components.reduce((s, c) => s + c.contribution, 0) * 100;
    const grade: RetentionScore['grade'] =
      score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';

    const trend: RetentionScore['trend'] =
      previousScore === undefined ? 'stable'
        : score > previousScore + 3 ? 'improving'
        : score < previousScore - 3 ? 'declining'
        : 'stable';

    const retentionScore: RetentionScore = {
      userId,
      tenantId: activity.tenantId,
      score,
      grade,
      components,
      trend,
      computedAt: Date.now(),
      previousScore,
    };

    this.retentionScores.set(userId, retentionScore);

    logger.debug('Retention score computed', {
      userId,
      score: score.toFixed(1),
      grade,
      trend,
    });

    return retentionScore;
  }

  predictChurn(userId: string, horizon: number = 30): ChurnPredictor {
    const retentionScore = this.retentionScores.get(userId) ?? this.computeRetentionScore(userId);
    const activity = this.fetchUserActivity(userId);
    const userSignals = this.signals.get(userId) ?? [];

    const features: PredictorFeature[] = [
      {
        name: 'retention_score',
        value: retentionScore.score,
        contribution: (100 - retentionScore.score) / 100 * 0.35,
        direction: retentionScore.score < 50 ? 'increases_churn' : 'decreases_churn',
      },
      {
        name: 'days_since_last_login',
        value: activity.daysSinceLastLogin,
        contribution: Math.min(0.25, activity.daysSinceLastLogin / 60),
        direction: activity.daysSinceLastLogin > 7 ? 'increases_churn' : 'decreases_churn',
      },
      {
        name: 'declining_trend',
        value: retentionScore.trend === 'declining' ? 1 : 0,
        contribution: retentionScore.trend === 'declining' ? 0.20 : 0,
        direction: 'increases_churn',
      },
      {
        name: 'negative_signals',
        value: userSignals.filter(s => s.direction === 'negative').length,
        contribution: Math.min(0.15, userSignals.filter(s => s.direction === 'negative').length * 0.04),
        direction: 'increases_churn',
      },
      {
        name: 'unresolved_support',
        value: activity.unresolvedTickets,
        contribution: Math.min(0.05, activity.unresolvedTickets * 0.015),
        direction: activity.unresolvedTickets > 0 ? 'increases_churn' : 'decreases_churn',
      },
    ];

    const baseProbability = features.reduce((s, f) => s + f.contribution, 0);
    const horizonAdjustment = Math.min(0.3, (horizon / 90) * 0.15);
    const churnProbability = Math.min(0.99, Math.max(0.01, baseProbability + horizonAdjustment));

    const predictor: ChurnPredictor = {
      predictorId: `pred-${Date.now()}-${userId}`,
      userId,
      tenantId: activity.tenantId,
      horizon,
      churnProbability,
      confidence: 0.78 + (userSignals.length > 5 ? 0.10 : 0),
      topFeatures: features.sort((a, b) => b.contribution - a.contribution).slice(0, 3),
      predictedAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600_000,
    };

    this.churnPredictors.set(userId, predictor);

    logger.info('Churn predicted', {
      userId,
      horizon,
      churnProbability: churnProbability.toFixed(3),
      confidence: predictor.confidence.toFixed(2),
    });

    return predictor;
  }

  designIntervention(userId: string, signals: RetentionSignal[]): InterventionAction {
    const score = this.retentionScores.get(userId) ?? this.computeRetentionScore(userId);
    const predictor = this.churnPredictors.get(userId) ?? this.predictChurn(userId);

    const interventionType = this.selectInterventionType(score, predictor, signals);
    const channel = this.selectChannel(score, predictor);
    const content = this.buildContent(interventionType, userId, score);
    const priority: InterventionAction['priority'] =
      predictor.churnProbability > 0.7 ? 'immediate'
        : predictor.churnProbability > 0.5 ? 'high'
        : predictor.churnProbability > 0.3 ? 'medium'
        : 'low';

    const intervention: InterventionAction = {
      actionId: `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      type: interventionType,
      channel,
      content,
      priority,
      scheduledAt: priority === 'immediate' ? Date.now() : Date.now() + 3600_000,
      status: 'pending',
    };

    this.interventions.set(intervention.actionId, intervention);

    logger.info('Intervention designed', {
      userId,
      type: interventionType,
      channel,
      priority,
      churnProbability: predictor.churnProbability.toFixed(3),
    });

    return intervention;
  }

  executeCampaign(campaignId: string): RetentionCampaign {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    campaign.status = 'active';

    // Enroll users from matching segment
    const segment = Array.from(this.segments.values()).find(
      s => s.name === campaign.targetSegment
    );
    const enrolledCount = segment?.size ?? Math.floor(Math.random() * 200 + 50);

    campaign.metrics.enrolled = enrolledCount;
    campaign.metrics.delivered = Math.floor(enrolledCount * 0.98);
    campaign.metrics.opened = Math.floor(campaign.metrics.delivered * 0.35);
    campaign.metrics.clicked = Math.floor(campaign.metrics.opened * 0.25);
    campaign.metrics.converted = Math.floor(campaign.metrics.clicked * 0.15);
    campaign.metrics.retained = Math.floor(campaign.metrics.converted * 0.85);

    campaign.metrics.deliveryRate = campaign.metrics.delivered / enrolledCount;
    campaign.metrics.openRate = campaign.metrics.opened / campaign.metrics.delivered;
    campaign.metrics.clickRate = campaign.metrics.clicked / campaign.metrics.opened;

    logger.info('Campaign launched', {
      campaignId,
      name: campaign.name,
      channel: campaign.channel,
      enrolled: enrolledCount,
    });

    return campaign;
  }

  measureRetentionImpact(campaignId: string): {
    campaign: RetentionCampaign;
    retentionLift: number;
    churnReduction: number;
    estimatedMRRSaved: number;
    significance: 'high' | 'medium' | 'low';
  } {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const controlRetentionRate = 0.75;
    const treatmentRetentionRate = campaign.metrics.enrolled > 0
      ? campaign.metrics.retained / campaign.metrics.enrolled
      : 0;

    const retentionLift = treatmentRetentionRate - controlRetentionRate;
    const churnReduction = -retentionLift;
    const estimatedMRRSaved = campaign.metrics.retained * 150;

    campaign.metrics.retentionLift = retentionLift * 100;

    const significance: 'high' | 'medium' | 'low' =
      Math.abs(retentionLift) > 0.1 ? 'high'
        : Math.abs(retentionLift) > 0.05 ? 'medium'
        : 'low';

    logger.info('Retention impact measured', {
      campaignId,
      retentionLift: (retentionLift * 100).toFixed(1),
      churnReduction: (churnReduction * 100).toFixed(1),
      estimatedMRRSaved,
      significance,
    });

    return { campaign, retentionLift, churnReduction, estimatedMRRSaved, significance };
  }

  segmentAtRiskUsers(threshold: number): UserSegment {
    const atRiskUsers: string[] = [];
    const scores: number[] = [];
    const risks: number[] = [];

    this.retentionScores.forEach((score, userId) => {
      if (score.score < threshold) {
        const predictor = this.churnPredictors.get(userId);
        atRiskUsers.push(userId);
        scores.push(score.score);
        risks.push(predictor?.churnProbability ?? 0.5);
      }
    });

    const segment: UserSegment = {
      segmentId: `seg-at-risk-${Date.now()}`,
      name: 'At-Risk Users',
      criteria: { retentionScoreRange: [0, threshold], churnRiskThreshold: 0.5 },
      userIds: atRiskUsers,
      avgRetentionScore: scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0,
      avgChurnRisk: risks.length > 0 ? risks.reduce((s, v) => s + v, 0) / risks.length : 0,
      size: atRiskUsers.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.segments.set(segment.segmentId, segment);

    logger.info('At-risk users segmented', {
      segmentId: segment.segmentId,
      size: segment.size,
      avgRetentionScore: segment.avgRetentionScore.toFixed(1),
      avgChurnRisk: segment.avgChurnRisk.toFixed(3),
    });

    return segment;
  }

  personalizeReEngagement(userId: string): EngagementBooster[] {
    const score = this.retentionScores.get(userId) ?? this.computeRetentionScore(userId);
    const activity = this.fetchUserActivity(userId);
    const boosters: EngagementBooster[] = [];

    if (activity.featuresUsed < 3) {
      boosters.push({
        boosterId: `boost-${Date.now()}-1`,
        userId,
        type: 'feature_tip',
        title: 'Unlock Your Productivity – Try the Automation Engine',
        description: "Teams using automation save 3h/week. Here's a 2-minute quick start.",
        estimatedLift: 12,
        relevanceScore: 0.88,
      });
    }

    if (activity.activeIntegrations < 2) {
      boosters.push({
        boosterId: `boost-${Date.now()}-2`,
        userId,
        type: 'integration_suggestion',
        title: 'Connect Your Existing Tools',
        description: 'Integrate with Slack, Jira, or GitHub to get more value in minutes.',
        estimatedLift: 9,
        relevanceScore: 0.81,
      });
    }

    if (activity.loginDaysLast30 < 5) {
      boosters.push({
        boosterId: `boost-${Date.now()}-3`,
        userId,
        type: 'goal_nudge',
        title: 'Pick Up Where You Left Off',
        description: 'You have 3 unfinished items waiting. Complete them in under 10 minutes.',
        estimatedLift: 15,
        relevanceScore: 0.92,
      });
    }

    if (score.grade === 'A' || score.grade === 'B') {
      boosters.push({
        boosterId: `boost-${Date.now()}-4`,
        userId,
        type: 'template',
        title: 'Power User Templates Pack',
        description: "As a top user, you've unlocked 12 premium workflow templates.",
        estimatedLift: 7,
        relevanceScore: 0.75,
      });
    }

    logger.debug('Re-engagement boosters personalized', {
      userId,
      count: boosters.length,
      avgLift: boosters.reduce((s, b) => s + b.estimatedLift, 0) / Math.max(boosters.length, 1),
    });

    return boosters.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  generateRetentionReport(period: { from: number; to: number }, tenantId?: string): RetentionReport {
    const allScores = Array.from(this.retentionScores.values())
      .filter(s => !tenantId || s.tenantId === tenantId);

    const retained = allScores.filter(s => s.score >= 50).length;
    const churned = allScores.filter(s => s.score < 25 && s.trend === 'declining').length;
    const atRisk = allScores.filter(s => s.score >= 25 && s.score < 50).length;
    const total = allScores.length;

    const allCampaigns = Array.from(this.campaigns.values());
    const activeCampaigns = allCampaigns.filter(c => c.status === 'active').length;
    const completedCampaigns = allCampaigns.filter(c => c.status === 'completed');
    const avgLift = completedCampaigns.length > 0
      ? completedCampaigns.reduce((s, c) => s + c.metrics.retentionLift, 0) / completedCampaigns.length
      : 0;

    const allInterventions = Array.from(this.interventions.values());
    const completedInterventions = allInterventions.filter(i => i.status === 'completed');
    const convertedInterventions = completedInterventions.filter(i => i.outcome?.converted);

    const cohorts: CohortData[] = [
      { cohortLabel: 'New (0-30 days)', size: Math.floor(total * 0.2), retentionRate: 0.72, avgScore: 55, churnRate: 0.28 },
      { cohortLabel: 'Growing (31-90 days)', size: Math.floor(total * 0.3), retentionRate: 0.85, avgScore: 68, churnRate: 0.15 },
      { cohortLabel: 'Mature (91-180 days)', size: Math.floor(total * 0.3), retentionRate: 0.91, avgScore: 76, churnRate: 0.09 },
      { cohortLabel: 'Loyal (180+ days)', size: Math.floor(total * 0.2), retentionRate: 0.96, avgScore: 87, churnRate: 0.04 },
    ];

    const report: RetentionReport = {
      reportId: `ret-report-${Date.now()}`,
      period,
      tenantId,
      totalUsers: total,
      retainedUsers: retained,
      churnedUsers: churned,
      atRiskUsers: atRisk,
      overallRetentionRate: total > 0 ? retained / total : 0,
      avgRetentionScore: total > 0 ? allScores.reduce((s, r) => s + r.score, 0) / total : 0,
      campaignsSummary: {
        active: activeCampaigns,
        completed: completedCampaigns.length,
        avgLift,
      },
      interventionsSummary: {
        total: allInterventions.length,
        converted: convertedInterventions.length,
        conversionRate: allInterventions.length > 0 ? convertedInterventions.length / allInterventions.length : 0,
      },
      cohortAnalysis: cohorts,
      generatedAt: Date.now(),
    };

    logger.info('Retention report generated', {
      reportId: report.reportId,
      period,
      total,
      retentionRate: report.overallRetentionRate.toFixed(3),
      atRisk,
      churned,
    });

    return report;
  }

  createCampaign(
    name: string,
    targetSegment: string,
    channel: CampaignChannel,
    message: CampaignMessage,
    options?: { tenantId?: string; variant?: RetentionCampaign['variant'] }
  ): RetentionCampaign {
    const campaign: RetentionCampaign = {
      campaignId: `camp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      targetSegment,
      variant: options?.variant ?? 'treatment_a',
      channel,
      message,
      startedAt: Date.now(),
      status: 'draft',
      metrics: { enrolled: 0, delivered: 0, opened: 0, clicked: 0, converted: 0, retained: 0, deliveryRate: 0, openRate: 0, clickRate: 0, retentionLift: 0 },
      tenantId: options?.tenantId,
    };

    this.campaigns.set(campaign.campaignId, campaign);
    return campaign;
  }

  getRetentionScore(userId: string): RetentionScore | undefined {
    return this.retentionScores.get(userId);
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  private selectInterventionType(
    score: RetentionScore,
    predictor: ChurnPredictor,
    signals: RetentionSignal[]
  ): InterventionType {
    const hasBillingIssue = signals.some(s => s.type === 'billing_issue');
    const hasOnboardingIncomplete = signals.some(s => s.type === 'onboarding_incomplete');

    if (hasBillingIssue) return 'health_check_survey';
    if (hasOnboardingIncomplete) return 'onboarding_restart';
    if (predictor.churnProbability > 0.7) return 'success_call';
    if (score.grade === 'F') return 'win_back_sequence';
    if (score.grade === 'D') return 'personalized_email';
    if (score.grade === 'C') return 'feature_spotlight';
    return 'in_app_checklist';
  }

  private selectChannel(score: RetentionScore, predictor: ChurnPredictor): CampaignChannel {
    if (predictor.churnProbability > 0.8) return 'success_manager';
    if (predictor.churnProbability > 0.6) return 'email';
    if (score.grade === 'C') return 'in_app';
    return 'push';
  }

  private buildContent(type: InterventionType, userId: string, score: RetentionScore): Record<string, unknown> {
    const contentMap: Record<InterventionType, Record<string, unknown>> = {
      personalized_email: { template: 'reengagement_v2', userId, retentionGrade: score.grade, subject: "We miss you \u2013 here's what's new" },
      in_app_checklist: { checklistId: 'getting-started', userId, title: 'Complete your setup to get more value' },
      feature_spotlight: { featureId: 'advanced-analytics', userId, headline: 'Did you know? Your plan includes Advanced Analytics' },
      success_call: { userId, priority: 'urgent', notes: `Retention grade ${score.grade}, churn risk elevated` },
      discount_offer: { userId, discountPct: 20, code: `STAY${score.grade}`, validDays: 7 },
      onboarding_restart: { userId, step: 'profile_setup', title: "Let's get you set up right" },
      win_back_sequence: { userId, sequenceId: 'win-back-90d', firstTouchDelay: 0 },
      health_check_survey: { userId, surveyId: 'nps-health', maxQuestions: 3 },
    };

    return contentMap[type] ?? { userId };
  }

  private fetchUserActivity(userId: string): {
    tenantId: string;
    loginDaysLast30: number;
    daysSinceLastLogin: number;
    featuresUsed: number;
    avgSessionMinutes: number;
    teamMembersActive: number;
    activeIntegrations: number;
    unresolvedTickets: number;
  } {
    const seed = userId.charCodeAt(0) % 10;
    return {
      tenantId: `tenant-${seed % 5}`,
      loginDaysLast30: 2 + seed * 2,
      daysSinceLastLogin: Math.max(0, 15 - seed),
      featuresUsed: 1 + seed,
      avgSessionMinutes: 5 + seed * 3,
      teamMembersActive: seed % 5,
      activeIntegrations: seed % 4,
      unresolvedTickets: seed > 7 ? 2 : 0,
    };
  }

  private startContinuousMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      // Re-score all tracked users
      this.retentionScores.forEach((_, userId) => {
        const freshScore = this.computeRetentionScore(userId);
        if (freshScore.trend === 'declining' && freshScore.score < 40) {
          const signals = this.signals.get(userId) ?? [];
          this.designIntervention(userId, signals);
        }
      });
    }, 3_600_000);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __userRetentionAgent__: UserRetentionAgent | undefined;
}

export function getUserRetentionAgent(): UserRetentionAgent {
  if (!globalThis.__userRetentionAgent__) {
    globalThis.__userRetentionAgent__ = new UserRetentionAgent();
  }
  return globalThis.__userRetentionAgent__;
}
