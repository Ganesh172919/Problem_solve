/**
 * @module predictiveChurnPreventor
 * @description Churn prediction and prevention engine with behavioral signal ingestion,
 * weighted risk scoring, cohort classification, intervention campaign management,
 * effectiveness tracking, retention offer catalog, automated triggers, historical
 * churn analysis, win-back campaigns, and per-tenant churn reporting.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChurnCohort = 'low' | 'medium' | 'high' | 'critical';

export interface BehaviorSignal {
  userId: string;
  tenantId: string;
  signalType: 'login' | 'feature_use' | 'support_ticket' | 'page_view' | 'api_call' | 'export' | 'inactivity';
  value: number; // normalized 0-1
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface UserChurnProfile {
  userId: string;
  tenantId: string;
  riskScore: number;
  cohort: ChurnCohort;
  lastLoginAt?: number;
  signalCount: number;
  avgSessionValue: number;
  featureAdoptionRate: number;
  supportTicketCount: number;
  inactivityDays: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChurnRiskScore {
  userId: string;
  tenantId: string;
  score: number;
  breakdown: Record<string, number>;
  cohort: ChurnCohort;
  computedAt: number;
}

export interface RetentionOffer {
  id: string;
  name: string;
  type: 'discount' | 'feature_unlock' | 'support_upgrade' | 'extension' | 'credit';
  discountPercent?: number;
  durationDays: number;
  targetCohort: ChurnCohort;
  costToCompany: number;
  successRate: number;
}

export interface InterventionCampaign {
  id: string;
  name: string;
  targetCohort: ChurnCohort;
  offerId?: string;
  channel: 'email' | 'in_app' | 'sms' | 'phone';
  triggerRule: string;
  active: boolean;
  startedAt: number;
  endedAt?: number;
  totalTriggered: number;
  totalConverted: number;
  conversionRate: number;
}

export interface ChurnOutcomeRecord {
  userId: string;
  tenantId: string;
  campaignId: string;
  offerId?: string;
  outcome: 'retained' | 'churned' | 'pending';
  riskScoreAtTrigger: number;
  recordedAt: number;
}

export interface ChurnHistoryEntry {
  tenantId: string;
  monthYear: string;
  totalUsers: number;
  churnedUsers: number;
  churnRate: number;
  recoveredUsers: number;
  netChurnRate: number;
}

export interface ChurnPreventorSummary {
  totalProfiles: number;
  criticalRiskCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  activeCampaigns: number;
  avgChurnRisk: number;
  avgConversionRate: number;
  totalInterventions: number;
  churnRateByTenant: Record<string, number>;
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class PredictiveChurnPreventor {
  private profiles: Map<string, UserChurnProfile> = new Map();
  private campaigns: Map<string, InterventionCampaign> = new Map();
  private offers: Map<string, RetentionOffer> = new Map();
  private outcomes: ChurnOutcomeRecord[] = [];
  private history: ChurnHistoryEntry[] = [];
  private signals: Map<string, BehaviorSignal[]> = new Map(); // userId -> signals

  // Feature weights for churn risk model
  private readonly WEIGHTS: Record<string, number> = {
    inactivity: 0.30,
    support_tickets: 0.20,
    feature_adoption: -0.25, // negative = protective
    login_frequency: -0.20,
    api_call_drop: 0.25,
    export_activity: -0.10,
  };

  constructor() {
    logger.info('[PredictiveChurnPreventor] Initialized churn prevention engine');
  }

  /**
   * Ingest a behavioral signal and update the user's churn profile.
   */
  ingestBehaviorSignal(signal: BehaviorSignal): void {
    const key = signal.userId;
    const existing = this.signals.get(key) ?? [];
    existing.push({ ...signal, timestamp: signal.timestamp || Date.now() });
    // Keep last 200 signals per user
    if (existing.length > 200) existing.splice(0, existing.length - 200);
    this.signals.set(key, existing);

    // Update profile incrementally
    const profile = this.profiles.get(key);
    if (profile) {
      profile.signalCount++;
      if (signal.signalType === 'login') {
        profile.lastLoginAt = signal.timestamp;
        const daysSinceFirst = Math.max(1, (Date.now() - profile.createdAt) / 86400000);
        profile.inactivityDays = (Date.now() - signal.timestamp) / 86400000;
        const logins = existing.filter(s => s.signalType === 'login').length;
        profile.avgSessionValue = logins / daysSinceFirst;
      }
      if (signal.signalType === 'support_ticket') profile.supportTicketCount++;
      if (signal.signalType === 'feature_use') {
        const uses = existing.filter(s => s.signalType === 'feature_use').length;
        profile.featureAdoptionRate = Math.min(1, uses / 50);
      }
      profile.updatedAt = Date.now();
    }

    logger.debug(`[PredictiveChurnPreventor] Signal ingested for user ${signal.userId}: ${signal.signalType}`);
  }

  /**
   * Compute weighted churn risk score for a user using the feature model.
   */
  computeRiskScore(userId: string, tenantId: string): ChurnRiskScore {
    const userSignals = this.signals.get(userId) ?? [];
    const profile = this.profiles.get(userId);

    const now = Date.now();
    const recentWindow = now - 30 * 86400000;
    const recentSignals = userSignals.filter(s => s.timestamp > recentWindow);

    const logins = recentSignals.filter(s => s.signalType === 'login').length;
    const apiCalls = recentSignals.filter(s => s.signalType === 'api_call').length;
    const featureUses = recentSignals.filter(s => s.signalType === 'feature_use').length;
    const supportTickets = recentSignals.filter(s => s.signalType === 'support_ticket').length;
    const exports = recentSignals.filter(s => s.signalType === 'export').length;
    const lastLogin = profile?.lastLoginAt ?? (recentSignals.find(s => s.signalType === 'login')?.timestamp ?? 0);
    const inactivityDays = lastLogin > 0 ? (now - lastLogin) / 86400000 : 30;

    const breakdown: Record<string, number> = {
      inactivity: Math.min(1, inactivityDays / 30) * this.WEIGHTS.inactivity,
      support_tickets: Math.min(1, supportTickets / 5) * this.WEIGHTS.support_tickets,
      feature_adoption: Math.min(1, featureUses / 20) * this.WEIGHTS.feature_adoption,
      login_frequency: Math.min(1, logins / 20) * this.WEIGHTS.login_frequency,
      api_call_drop: Math.max(0, 1 - apiCalls / 50) * this.WEIGHTS.api_call_drop,
      export_activity: Math.min(1, exports / 5) * this.WEIGHTS.export_activity,
    };

    const rawScore = Object.values(breakdown).reduce((s, v) => s + v, 0);
    const normalizedScore = Math.max(0, Math.min(1, 0.5 + rawScore));
    const cohort = this.classifyCohort(normalizedScore);

    const result: ChurnRiskScore = {
      userId,
      tenantId,
      score: parseFloat(normalizedScore.toFixed(4)),
      breakdown: Object.fromEntries(
        Object.entries(breakdown).map(([k, v]) => [k, parseFloat(v.toFixed(4))]),
      ),
      cohort,
      computedAt: Date.now(),
    };

    // Upsert profile
    const existing = this.profiles.get(userId);
    const updatedProfile: UserChurnProfile = {
      userId,
      tenantId,
      riskScore: result.score,
      cohort,
      lastLoginAt: lastLogin > 0 ? lastLogin : existing?.lastLoginAt,
      signalCount: userSignals.length,
      avgSessionValue: existing?.avgSessionValue ?? logins / 30,
      featureAdoptionRate: existing?.featureAdoptionRate ?? featureUses / 20,
      supportTicketCount: existing?.supportTicketCount ?? supportTickets,
      inactivityDays: parseFloat(inactivityDays.toFixed(1)),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.profiles.set(userId, updatedProfile);

    logger.debug(`[PredictiveChurnPreventor] Risk score for ${userId}: ${result.score} (${cohort})`);
    return result;
  }

  /**
   * Classify user into a churn risk cohort based on their score.
   */
  classifyCohort(score: number): ChurnCohort {
    if (score >= 0.80) return 'critical';
    if (score >= 0.60) return 'high';
    if (score >= 0.35) return 'medium';
    return 'low';
  }

  /**
   * Trigger an intervention campaign for a user if applicable rules are met.
   */
  triggerIntervention(userId: string, campaignId: string): boolean {
    const campaign = this.campaigns.get(campaignId);
    const profile = this.profiles.get(userId);
    if (!campaign || !profile) return false;
    if (!campaign.active) return false;
    if (profile.cohort !== campaign.targetCohort &&
        !(profile.cohort === 'critical' && campaign.targetCohort === 'high')) {
      return false;
    }

    campaign.totalTriggered++;
    campaign.conversionRate = campaign.totalTriggered > 0
      ? campaign.totalConverted / campaign.totalTriggered
      : 0;

    this.outcomes.push({
      userId,
      tenantId: profile.tenantId,
      campaignId,
      offerId: campaign.offerId,
      outcome: 'pending',
      riskScoreAtTrigger: profile.riskScore,
      recordedAt: Date.now(),
    });

    logger.info(`[PredictiveChurnPreventor] Intervention triggered for ${userId} via campaign ${campaignId}`);
    return true;
  }

  /**
   * Record the outcome of an intervention and update campaign metrics.
   */
  recordInterventionOutcome(
    userId: string,
    campaignId: string,
    outcome: 'retained' | 'churned',
  ): void {
    const entry = this.outcomes.find(
      o => o.userId === userId && o.campaignId === campaignId && o.outcome === 'pending',
    );
    if (entry) {
      entry.outcome = outcome;
      entry.recordedAt = Date.now();
    }

    const campaign = this.campaigns.get(campaignId);
    if (campaign && outcome === 'retained') {
      campaign.totalConverted++;
      campaign.conversionRate = campaign.totalConverted / Math.max(1, campaign.totalTriggered);
    }

    logger.info(`[PredictiveChurnPreventor] Outcome for ${userId} in campaign ${campaignId}: ${outcome}`);
  }

  /**
   * Suggest the best retention offer for a user based on cohort and offer success rates.
   */
  suggestRetentionOffer(userId: string): RetentionOffer | null {
    const profile = this.profiles.get(userId);
    if (!profile) return null;

    const eligible = Array.from(this.offers.values())
      .filter(o => o.targetCohort === profile.cohort)
      .sort((a, b) => b.successRate - a.successRate);

    const offer = eligible[0] ?? null;
    if (offer) {
      logger.info(`[PredictiveChurnPreventor] Suggested offer '${offer.name}' for user ${userId}`);
    }
    return offer;
  }

  /**
   * Register an intervention campaign.
   */
  registerCampaign(campaign: InterventionCampaign): void {
    this.campaigns.set(campaign.id, campaign);
    logger.info(`[PredictiveChurnPreventor] Campaign '${campaign.name}' registered`);
  }

  /**
   * Register a retention offer in the catalog.
   */
  registerOffer(offer: RetentionOffer): void {
    this.offers.set(offer.id, offer);
    logger.info(`[PredictiveChurnPreventor] Offer '${offer.name}' registered (${offer.type})`);
  }

  /**
   * Analyze historical churn for a tenant and store the result.
   */
  analyzeChurnHistory(tenantId: string, monthYear: string, totalUsers: number): ChurnHistoryEntry {
    const tenantOutcomes = this.outcomes.filter(o => o.tenantId === tenantId);
    const churnedUsers = tenantOutcomes.filter(o => o.outcome === 'churned').length;
    const recoveredUsers = tenantOutcomes.filter(o => o.outcome === 'retained').length;
    const churnRate = totalUsers > 0 ? churnedUsers / totalUsers : 0;
    const netChurnRate = totalUsers > 0 ? (churnedUsers - recoveredUsers) / totalUsers : 0;

    const entry: ChurnHistoryEntry = {
      tenantId,
      monthYear,
      totalUsers,
      churnedUsers,
      churnRate: parseFloat(churnRate.toFixed(4)),
      recoveredUsers,
      netChurnRate: parseFloat(Math.max(0, netChurnRate).toFixed(4)),
    };

    this.history.push(entry);
    logger.info(`[PredictiveChurnPreventor] Churn history for ${tenantId} ${monthYear}: rate=${churnRate.toFixed(3)}`);
    return entry;
  }

  /**
   * Return a high-level summary of churn prevention state.
   */
  getSummary(): ChurnPreventorSummary {
    const profiles = Array.from(this.profiles.values());
    const cohortCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const p of profiles) cohortCounts[p.cohort]++;

    const avgRisk = profiles.length > 0
      ? profiles.reduce((s, p) => s + p.riskScore, 0) / profiles.length : 0;

    const activeCampaigns = Array.from(this.campaigns.values()).filter(c => c.active);
    const avgConversion = activeCampaigns.length > 0
      ? activeCampaigns.reduce((s, c) => s + c.conversionRate, 0) / activeCampaigns.length : 0;

    const churnRateByTenant: Record<string, number> = {};
    for (const entry of this.history) {
      churnRateByTenant[entry.tenantId] = entry.churnRate;
    }

    return {
      totalProfiles: profiles.length,
      criticalRiskCount: cohortCounts.critical,
      highRiskCount: cohortCounts.high,
      mediumRiskCount: cohortCounts.medium,
      lowRiskCount: cohortCounts.low,
      activeCampaigns: activeCampaigns.length,
      avgChurnRisk: parseFloat(avgRisk.toFixed(4)),
      avgConversionRate: parseFloat(avgConversion.toFixed(4)),
      totalInterventions: this.outcomes.length,
      churnRateByTenant,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__predictiveChurnPreventor__';
export function getPredictiveChurnPreventor(): PredictiveChurnPreventor {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new PredictiveChurnPreventor();
  }
  return (globalThis as Record<string, unknown>)[KEY] as PredictiveChurnPreventor;
}
