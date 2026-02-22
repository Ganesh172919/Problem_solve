/**
 * Customer Success Engine
 *
 * Comprehensive customer health scoring and lifecycle management:
 * - Multi-dimensional health score (usage, engagement, support, NPS)
 * - Churn risk scoring with ML-style weighted features
 * - Expansion opportunity detection
 * - Automated playbook execution
 * - Success milestones tracking
 * - QBR (Quarterly Business Review) report preparation
 * - At-risk customer alerts
 * - Customer lifecycle stage management
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import { SubscriptionTier } from '../types/saas';
import crypto from 'crypto';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

export type LifecycleStage =
  | 'trial'
  | 'onboarding'
  | 'adoption'
  | 'growth'
  | 'mature'
  | 'at-risk'
  | 'churned';

export type HealthCategory = 'product-usage' | 'engagement' | 'support' | 'nps' | 'billing';

export interface HealthScore {
  userId: string;
  overall: number;                        // 0–100
  components: Record<HealthCategory, number>;
  trend: 'improving' | 'stable' | 'declining';
  riskLevel: 'healthy' | 'neutral' | 'at-risk' | 'critical';
  lastUpdated: Date;
  history: { date: Date; score: number }[];
}

export interface UsageMetrics {
  userId: string;
  dailyActiveRatio: number;              // active days / 30
  featureAdoptionRate: number;           // features used / total features
  apiCallsLast30Days: number;
  avgSessionDurationMinutes: number;
  lastActiveDate: Date;
  activeDaysLast30: number;
  coreFeatureUsage: Record<string, number>;
}

export interface EngagementMetrics {
  userId: string;
  emailOpenRate: number;
  inAppNotificationClickRate: number;
  webinarAttendance: number;
  documentationPageViews: number;
  communityPosts: number;
  feedbackSubmissions: number;
  lastEngagementDate: Date;
}

export interface SupportMetrics {
  userId: string;
  openTickets: number;
  resolvedTickets30Days: number;
  avgResolutionHours: number;
  criticalTickets: number;
  satisfactionScore: number;             // CSAT 1–5
  escalationCount: number;
}

export interface NPSResponse {
  userId: string;
  score: number;                         // 0–10
  category: 'promoter' | 'passive' | 'detractor';
  comment?: string;
  respondedAt: Date;
}

export interface ChurnRisk {
  userId: string;
  riskScore: number;                     // 0–100, higher = more likely to churn
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  topFactors: ChurnFactor[];
  predictedChurnDate?: Date;
  confidence: number;
  recommendedAction: string;
}

export interface ChurnFactor {
  name: string;
  weight: number;
  value: number;
  impact: number;
  direction: 'positive' | 'negative';
}

export interface ExpansionOpportunity {
  userId: string;
  type: 'upgrade' | 'add-on' | 'seat-expansion' | 'higher-usage-plan';
  currentTier: SubscriptionTier;
  targetTier?: SubscriptionTier;
  confidence: number;
  estimatedMrr: number;
  signals: string[];
  suggestedAction: string;
  detectedAt: Date;
}

export interface Playbook {
  id: string;
  name: string;
  trigger: PlaybookTrigger;
  steps: PlaybookStep[];
  active: boolean;
  executionCount: number;
  successRate: number;
}

export interface PlaybookTrigger {
  type: 'health-drop' | 'churn-risk-increase' | 'milestone-reached' | 'expansion-signal' | 'nps-score';
  threshold: number;
  cooldownDays: number;
}

export interface PlaybookStep {
  order: number;
  action: 'send-email' | 'schedule-call' | 'assign-csm' | 'offer-discount' | 'send-in-app' | 'create-task';
  delayDays: number;
  template?: string;
  params?: Record<string, unknown>;
}

export interface PlaybookExecution {
  id: string;
  playbookId: string;
  userId: string;
  startedAt: Date;
  completedAt?: Date;
  currentStep: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  outcome?: 'converted' | 'churned' | 'no-change';
}

export interface Milestone {
  id: string;
  name: string;
  description: string;
  criteria: MilestoneCriteria;
  reward?: string;
}

export interface MilestoneCriteria {
  type: 'api-calls' | 'days-active' | 'features-used' | 'posts-created' | 'team-members';
  threshold: number;
}

export interface CustomerMilestone {
  userId: string;
  milestoneId: string;
  achievedAt: Date;
  notified: boolean;
}

export interface QBRReport {
  userId: string;
  period: { start: Date; end: Date };
  generatedAt: Date;
  healthScore: number;
  keyMetrics: {
    apiCallsTotal: number;
    avgDailyUsage: number;
    topFeatures: string[];
    supportTicketsClosed: number;
    npsScore: number | null;
    mrr: number;
  };
  achievements: CustomerMilestone[];
  risks: ChurnFactor[];
  recommendations: string[];
  expansionOpportunities: ExpansionOpportunity[];
}

export interface CustomerProfile {
  userId: string;
  tier: SubscriptionTier;
  lifecycleStage: LifecycleStage;
  mrr: number;
  healthScore: HealthScore | null;
  churnRisk: ChurnRisk | null;
  csmAssigned?: string;
  tags: string[];
  joinedAt: Date;
}

// ── CustomerSuccessEngine ──────────────────────────────────────────────────────

class CustomerSuccessEngine {
  private customers: Map<string, CustomerProfile> = new Map();
  private healthScores: Map<string, HealthScore> = new Map();
  private churnRisks: Map<string, ChurnRisk> = new Map();
  private expansionOpportunities: Map<string, ExpansionOpportunity[]> = new Map();
  private playbooks: Map<string, Playbook> = new Map();
  private playbookExecutions: Map<string, PlaybookExecution> = new Map();
  private milestones: Map<string, Milestone> = new Map();
  private customerMilestones: Map<string, CustomerMilestone[]> = new Map();
  private npsResponses: Map<string, NPSResponse[]> = new Map();

  constructor() {
    this.initDefaultPlaybooks();
    this.initDefaultMilestones();
  }

  // ── Customer Registration ──────────────────────────────────────────────────

  registerCustomer(profile: CustomerProfile): void {
    this.customers.set(profile.userId, profile);
    logger.info('Customer registered in CS engine', { userId: profile.userId, tier: profile.tier });
  }

  updateCustomerStage(userId: string, stage: LifecycleStage): void {
    const customer = this.customers.get(userId);
    if (customer) {
      customer.lifecycleStage = stage;
      logger.info('Customer lifecycle stage updated', { userId, stage });
    }
  }

  // ── Health Scoring ─────────────────────────────────────────────────────────

  calculateHealthScore(
    userId: string,
    usage: UsageMetrics,
    engagement: EngagementMetrics,
    support: SupportMetrics,
    npsHistory?: NPSResponse[],
  ): HealthScore {
    const productUsage = this.scoreProductUsage(usage);
    const engagementScore = this.scoreEngagement(engagement);
    const supportScore = this.scoreSupportHealth(support);
    const npsScore = this.scoreNps(npsHistory ?? []);
    const billingScore = 100; // Default; can be updated from billing events

    const components: Record<HealthCategory, number> = {
      'product-usage': productUsage,
      'engagement': engagementScore,
      'support': supportScore,
      'nps': npsScore,
      'billing': billingScore,
    };

    // Weighted average
    const weights: Record<HealthCategory, number> = {
      'product-usage': 0.35,
      'engagement': 0.25,
      'support': 0.20,
      'nps': 0.15,
      'billing': 0.05,
    };

    const overall = Math.round(
      Object.entries(components).reduce((sum, [cat, val]) => sum + val * weights[cat as HealthCategory], 0),
    );

    const prev = this.healthScores.get(userId);
    const trend: HealthScore['trend'] =
      !prev ? 'stable'
      : overall > prev.overall + 3 ? 'improving'
      : overall < prev.overall - 3 ? 'declining'
      : 'stable';

    const riskLevel: HealthScore['riskLevel'] =
      overall >= 75 ? 'healthy'
      : overall >= 55 ? 'neutral'
      : overall >= 35 ? 'at-risk'
      : 'critical';

    const history = prev ? [...prev.history.slice(-11), { date: new Date(), score: overall }] : [{ date: new Date(), score: overall }];

    const score: HealthScore = {
      userId, overall, components, trend, riskLevel,
      lastUpdated: new Date(), history,
    };

    this.healthScores.set(userId, score);
    cache.set(`cs:health:${userId}`, score, 3600);

    // Trigger at-risk alert
    if (riskLevel === 'at-risk' || riskLevel === 'critical') {
      this.triggerAtRiskAlert(userId, score);
    }

    return score;
  }

  private scoreProductUsage(u: UsageMetrics): number {
    let score = 0;
    score += Math.min(40, u.dailyActiveRatio * 40);
    score += Math.min(30, u.featureAdoptionRate * 30);
    // Recency
    const daysSinceActive = (Date.now() - u.lastActiveDate.getTime()) / 86_400_000;
    score += Math.max(0, 20 - daysSinceActive * 2);
    score += Math.min(10, Math.log10(u.apiCallsLast30Days + 1) * 5);
    return Math.min(100, Math.round(score));
  }

  private scoreEngagement(e: EngagementMetrics): number {
    let score = 0;
    score += Math.min(25, e.emailOpenRate * 100 * 0.25);
    score += Math.min(20, e.inAppNotificationClickRate * 100 * 0.20);
    score += Math.min(20, Math.min(e.documentationPageViews, 20) * 1);
    score += Math.min(20, e.communityPosts * 4);
    score += Math.min(15, e.feedbackSubmissions * 5);
    return Math.min(100, Math.round(score));
  }

  private scoreSupportHealth(s: SupportMetrics): number {
    let score = 100;
    // Penalise open tickets
    score -= Math.min(30, s.openTickets * 10);
    // Penalise critical tickets heavily
    score -= Math.min(30, s.criticalTickets * 15);
    // CSAT bonus
    score += (s.satisfactionScore - 3) * 5;
    // Escalation penalty
    score -= s.escalationCount * 8;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private scoreNps(responses: NPSResponse[]): number {
    if (responses.length === 0) return 60; // neutral default
    const recent = responses.sort((a, b) => b.respondedAt.getTime() - a.respondedAt.getTime())[0];
    return Math.round((recent.score / 10) * 100);
  }

  // ── Churn Risk ─────────────────────────────────────────────────────────────

  calculateChurnRisk(
    userId: string,
    usage: UsageMetrics,
    engagement: EngagementMetrics,
    support: SupportMetrics,
    daysInProduct: number,
    tier: SubscriptionTier,
  ): ChurnRisk {
    const factors: ChurnFactor[] = [];
    let riskScore = 0;

    // Login frequency
    const loginScore = usage.dailyActiveRatio < 0.15 ? (1 - usage.dailyActiveRatio / 0.15) * 25 : 0;
    factors.push({ name: 'Low login frequency', weight: 0.25, value: usage.dailyActiveRatio, impact: loginScore, direction: loginScore > 0 ? 'negative' : 'positive' });
    riskScore += loginScore;

    // Feature adoption
    const featureScore = usage.featureAdoptionRate < 0.3 ? (1 - usage.featureAdoptionRate / 0.3) * 20 : 0;
    factors.push({ name: 'Low feature adoption', weight: 0.20, value: usage.featureAdoptionRate, impact: featureScore, direction: featureScore > 0 ? 'negative' : 'positive' });
    riskScore += featureScore;

    // Recent activity
    const daysSinceActive = (Date.now() - usage.lastActiveDate.getTime()) / 86_400_000;
    const activityScore = Math.min(20, daysSinceActive * 1.5);
    factors.push({ name: 'Days since last active', weight: 0.20, value: daysSinceActive, impact: activityScore, direction: activityScore > 0 ? 'negative' : 'positive' });
    riskScore += activityScore;

    // Support issues
    const supportScore = Math.min(20, support.openTickets * 5 + support.criticalTickets * 10);
    factors.push({ name: 'Open support tickets', weight: 0.15, value: support.openTickets, impact: supportScore, direction: supportScore > 0 ? 'negative' : 'positive' });
    riskScore += supportScore;

    // NPS sentiment
    const npsHistory = this.npsResponses.get(userId) ?? [];
    const latestNps = npsHistory.sort((a, b) => b.respondedAt.getTime() - a.respondedAt.getTime())[0];
    const npsScore = latestNps && latestNps.category === 'detractor' ? 15 : 0;
    factors.push({ name: 'NPS detractor', weight: 0.10, value: latestNps?.score ?? 7, impact: npsScore, direction: npsScore > 0 ? 'negative' : 'positive' });
    riskScore += npsScore;

    // Engagement drop
    const engagementScore = engagement.emailOpenRate < 0.1 ? 10 : 0;
    factors.push({ name: 'Low engagement', weight: 0.10, value: engagement.emailOpenRate, impact: engagementScore, direction: engagementScore > 0 ? 'negative' : 'positive' });
    riskScore += engagementScore;

    riskScore = Math.min(100, Math.round(riskScore));
    const riskLevel: ChurnRisk['riskLevel'] =
      riskScore >= 70 ? 'critical'
      : riskScore >= 50 ? 'high'
      : riskScore >= 25 ? 'medium'
      : 'low';

    const predictedChurnDate = riskLevel === 'critical'
      ? new Date(Date.now() + 30 * 86_400_000)
      : riskLevel === 'high'
      ? new Date(Date.now() + 60 * 86_400_000)
      : undefined;

    const recommendedAction =
      riskLevel === 'critical' ? 'Immediate CSM call + discount offer'
      : riskLevel === 'high' ? 'Schedule health check call'
      : riskLevel === 'medium' ? 'Send re-engagement email sequence'
      : 'Continue standard nurture';

    const risk: ChurnRisk = {
      userId, riskScore, riskLevel, topFactors: factors.slice(0, 5),
      predictedChurnDate, confidence: 0.75, recommendedAction,
    };

    this.churnRisks.set(userId, risk);
    cache.set(`cs:churn:${userId}`, risk, 3600);

    if (riskLevel === 'high' || riskLevel === 'critical') {
      this.triggerPlaybookForChurnRisk(userId, riskScore);
    }

    return risk;
  }

  // ── Expansion Opportunities ────────────────────────────────────────────────

  detectExpansionOpportunities(
    userId: string,
    usage: UsageMetrics,
    currentTier: SubscriptionTier,
    mrr: number,
  ): ExpansionOpportunity[] {
    const opportunities: ExpansionOpportunity[] = [];

    // Usage limit proximity
    if (usage.apiCallsLast30Days > 8000 && currentTier === 'free') {
      opportunities.push({
        userId,
        type: 'upgrade',
        currentTier,
        targetTier: 'pro',
        confidence: 0.85,
        estimatedMrr: 49,
        signals: ['Approaching API limit', 'High daily usage ratio'],
        suggestedAction: 'Offer pro plan with 20% first-month discount',
        detectedAt: new Date(),
      });
    }

    if (usage.apiCallsLast30Days > 40000 && currentTier === 'pro') {
      opportunities.push({
        userId,
        type: 'upgrade',
        currentTier,
        targetTier: 'enterprise',
        confidence: 0.75,
        estimatedMrr: 299,
        signals: ['High API volume', 'Feature saturation at pro tier'],
        suggestedAction: 'Schedule enterprise demo call',
        detectedAt: new Date(),
      });
    }

    // High feature adoption signals add-on readiness
    if (usage.featureAdoptionRate > 0.8) {
      opportunities.push({
        userId,
        type: 'add-on',
        currentTier,
        confidence: 0.60,
        estimatedMrr: mrr * 0.2,
        signals: ['High feature adoption', 'Power user behaviour'],
        suggestedAction: 'Introduce advanced add-on modules',
        detectedAt: new Date(),
      });
    }

    this.expansionOpportunities.set(userId, opportunities);
    return opportunities;
  }

  // ── Playbooks ──────────────────────────────────────────────────────────────

  private initDefaultPlaybooks(): void {
    const playbooks: Playbook[] = [
      {
        id: 'at-risk-rescue',
        name: 'At-Risk Customer Rescue',
        trigger: { type: 'health-drop', threshold: 40, cooldownDays: 14 },
        steps: [
          { order: 1, action: 'send-email', delayDays: 0, template: 'health-check-email' },
          { order: 2, action: 'send-in-app', delayDays: 2, template: 'feature-tips' },
          { order: 3, action: 'schedule-call', delayDays: 5, params: { duration: 30 } },
          { order: 4, action: 'offer-discount', delayDays: 10, params: { percent: 20, durationMonths: 3 } },
        ],
        active: true,
        executionCount: 0,
        successRate: 0,
      },
      {
        id: 'expansion-nurture',
        name: 'Expansion Revenue Nurture',
        trigger: { type: 'expansion-signal', threshold: 0.7, cooldownDays: 30 },
        steps: [
          { order: 1, action: 'send-email', delayDays: 0, template: 'upgrade-benefits' },
          { order: 2, action: 'send-in-app', delayDays: 3, template: 'upgrade-modal' },
          { order: 3, action: 'schedule-call', delayDays: 7, params: { type: 'upgrade-demo' } },
        ],
        active: true,
        executionCount: 0,
        successRate: 0,
      },
      {
        id: 'nps-detractor-recovery',
        name: 'NPS Detractor Recovery',
        trigger: { type: 'nps-score', threshold: 6, cooldownDays: 90 },
        steps: [
          { order: 1, action: 'assign-csm', delayDays: 0, params: { priority: 'high' } },
          { order: 2, action: 'schedule-call', delayDays: 1, params: { duration: 45 } },
          { order: 3, action: 'create-task', delayDays: 0, template: 'root-cause-analysis' },
        ],
        active: true,
        executionCount: 0,
        successRate: 0,
      },
    ];
    for (const pb of playbooks) this.playbooks.set(pb.id, pb);
  }

  executePlaybook(playbookId: string, userId: string): PlaybookExecution {
    const playbook = this.playbooks.get(playbookId);
    if (!playbook) throw new Error(`Playbook ${playbookId} not found`);

    const execution: PlaybookExecution = {
      id: crypto.randomUUID(),
      playbookId,
      userId,
      startedAt: new Date(),
      currentStep: 1,
      status: 'running',
    };
    this.playbookExecutions.set(execution.id, execution);
    playbook.executionCount++;
    logger.info('Playbook execution started', { playbookId, userId, executionId: execution.id });
    return execution;
  }

  private triggerPlaybookForChurnRisk(userId: string, riskScore: number): void {
    if (riskScore >= 50) {
      const existing = Array.from(this.playbookExecutions.values())
        .find((e) => e.userId === userId && e.playbookId === 'at-risk-rescue' && e.status === 'running');
      if (!existing) {
        this.executePlaybook('at-risk-rescue', userId);
      }
    }
  }

  // ── At-Risk Alerts ─────────────────────────────────────────────────────────

  private triggerAtRiskAlert(userId: string, health: HealthScore): void {
    logger.warn('Customer at-risk alert', {
      userId,
      healthScore: health.overall,
      riskLevel: health.riskLevel,
      trend: health.trend,
    });
  }

  getAtRiskCustomers(): Array<{ userId: string; healthScore: number; riskLevel: string; mrr: number }> {
    const results: Array<{ userId: string; healthScore: number; riskLevel: string; mrr: number }> = [];
    for (const [userId, health] of this.healthScores) {
      if (health.riskLevel === 'at-risk' || health.riskLevel === 'critical') {
        const customer = this.customers.get(userId);
        results.push({ userId, healthScore: health.overall, riskLevel: health.riskLevel, mrr: customer?.mrr ?? 0 });
      }
    }
    return results.sort((a, b) => b.mrr - a.mrr);
  }

  // ── Milestones ─────────────────────────────────────────────────────────────

  private initDefaultMilestones(): void {
    const milestones: Milestone[] = [
      { id: 'first-api-call', name: 'First API Call', description: 'Made first API call', criteria: { type: 'api-calls', threshold: 1 } },
      { id: '100-api-calls', name: 'Getting Started', description: '100 API calls', criteria: { type: 'api-calls', threshold: 100 } },
      { id: '1000-api-calls', name: 'Power User', description: '1,000 API calls', criteria: { type: 'api-calls', threshold: 1000 } },
      { id: '30-days-active', name: 'Loyal Customer', description: 'Active for 30 days', criteria: { type: 'days-active', threshold: 30 } },
      { id: '90-days-active', name: 'Long-term Partner', description: 'Active for 90 days', criteria: { type: 'days-active', threshold: 90 } },
    ];
    for (const m of milestones) this.milestones.set(m.id, m);
  }

  checkMilestones(userId: string, apiCalls: number, daysActive: number): CustomerMilestone[] {
    const achieved: CustomerMilestone[] = [];
    const existing = new Set((this.customerMilestones.get(userId) ?? []).map((m) => m.milestoneId));

    for (const [id, milestone] of this.milestones) {
      if (existing.has(id)) continue;
      let met = false;
      if (milestone.criteria.type === 'api-calls' && apiCalls >= milestone.criteria.threshold) met = true;
      if (milestone.criteria.type === 'days-active' && daysActive >= milestone.criteria.threshold) met = true;
      if (met) {
        const cm: CustomerMilestone = { userId, milestoneId: id, achievedAt: new Date(), notified: false };
        const all = this.customerMilestones.get(userId) ?? [];
        all.push(cm);
        this.customerMilestones.set(userId, all);
        achieved.push(cm);
        logger.info('Milestone achieved', { userId, milestoneId: id });
      }
    }
    return achieved;
  }

  // ── NPS ────────────────────────────────────────────────────────────────────

  recordNPS(response: NPSResponse): void {
    const all = this.npsResponses.get(response.userId) ?? [];
    all.push(response);
    this.npsResponses.set(response.userId, all);
    if (response.category === 'detractor') {
      this.executePlaybook('nps-detractor-recovery', response.userId);
    }
  }

  getAggregateNPS(): { score: number; promoters: number; passives: number; detractors: number; totalResponses: number } {
    let promoters = 0, passives = 0, detractors = 0, total = 0;
    for (const responses of this.npsResponses.values()) {
      for (const r of responses) {
        total++;
        if (r.category === 'promoter') promoters++;
        else if (r.category === 'passive') passives++;
        else detractors++;
      }
    }
    const score = total === 0 ? 0 : Math.round(((promoters - detractors) / total) * 100);
    return { score, promoters, passives, detractors, totalResponses: total };
  }

  // ── QBR Report ─────────────────────────────────────────────────────────────

  prepareQBR(userId: string, periodStart: Date, periodEnd: Date): QBRReport {
    const health = this.healthScores.get(userId);
    const churn = this.churnRisks.get(userId);
    const opportunities = this.expansionOpportunities.get(userId) ?? [];
    const milestones = (this.customerMilestones.get(userId) ?? [])
      .filter((m) => m.achievedAt >= periodStart && m.achievedAt <= periodEnd);
    const customer = this.customers.get(userId);
    const npsHistory = this.npsResponses.get(userId) ?? [];
    const latestNps = npsHistory.sort((a, b) => b.respondedAt.getTime() - a.respondedAt.getTime())[0];

    const recommendations: string[] = [];
    if (health && health.riskLevel !== 'healthy') {
      recommendations.push('Schedule regular check-in cadence to improve engagement');
    }
    if (opportunities.length > 0) {
      recommendations.push(`Explore ${opportunities[0].type} opportunity worth $${Math.round(opportunities[0].estimatedMrr)}/mo`);
    }
    if (churn && churn.riskLevel !== 'low') {
      recommendations.push(`Address: ${churn.recommendedAction}`);
    }

    return {
      userId,
      period: { start: periodStart, end: periodEnd },
      generatedAt: new Date(),
      healthScore: health?.overall ?? 50,
      keyMetrics: {
        apiCallsTotal: 0,
        avgDailyUsage: 0,
        topFeatures: [],
        supportTicketsClosed: 0,
        npsScore: latestNps?.score ?? null,
        mrr: customer?.mrr ?? 0,
      },
      achievements: milestones,
      risks: churn?.topFactors ?? [],
      recommendations,
      expansionOpportunities: opportunities,
    };
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getEngineStats(): {
    totalCustomers: number;
    healthyCount: number;
    atRiskCount: number;
    criticalCount: number;
    avgHealthScore: number;
    totalMrrAtRisk: number;
    activePlaybooks: number;
  } {
    let healthy = 0, atRisk = 0, critical = 0, totalScore = 0, mrrAtRisk = 0;
    for (const [uid, h] of this.healthScores) {
      totalScore += h.overall;
      if (h.riskLevel === 'healthy') healthy++;
      else if (h.riskLevel === 'at-risk') { atRisk++; mrrAtRisk += this.customers.get(uid)?.mrr ?? 0; }
      else if (h.riskLevel === 'critical') { critical++; mrrAtRisk += this.customers.get(uid)?.mrr ?? 0; }
    }
    const count = this.healthScores.size;
    return {
      totalCustomers: this.customers.size,
      healthyCount: healthy,
      atRiskCount: atRisk,
      criticalCount: critical,
      avgHealthScore: count > 0 ? Math.round(totalScore / count) : 0,
      totalMrrAtRisk: Math.round(mrrAtRisk),
      activePlaybooks: Array.from(this.playbookExecutions.values()).filter((e) => e.status === 'running').length,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__customerSuccessEngine__';

export function getCustomerSuccessEngine(): CustomerSuccessEngine {
  const g = globalThis as unknown as Record<string, CustomerSuccessEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CustomerSuccessEngine();
  }
  return g[GLOBAL_KEY];
}

export { CustomerSuccessEngine };
export default getCustomerSuccessEngine;
