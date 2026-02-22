/**
 * Platform Growth Engine
 *
 * Orchestrates viral growth, network effects, and ecosystem expansion:
 * - Referral tracking and reward management
 * - Viral coefficient (K-factor) calculation
 * - Growth loop identification and monitoring
 * - Developer ecosystem metrics (API adoption, integrations)
 * - Community engagement scoring
 * - NPS automation and follow-up
 * - Growth experiments management
 * - Partner program tracking
 * - Network effects measurement
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import crypto from 'crypto';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReferralProgram {
  id: string;
  name: string;
  referrerReward: ReferralReward;
  refereeReward: ReferralReward;
  active: boolean;
  maxReferralsPerUser?: number;
  expiryDays?: number;
  totalReferrals: number;
  successfulConversions: number;
  totalRewardValue: number;
}

export interface ReferralReward {
  type: 'credit' | 'discount' | 'feature-unlock' | 'cash' | 'extended-trial';
  value: number;
  currency?: string;
  durationDays?: number;
  description: string;
}

export interface ReferralLink {
  id: string;
  referrerId: string;
  code: string;
  programId: string;
  createdAt: Date;
  expiresAt?: Date;
  clicks: number;
  signups: number;
  conversions: number;
  rewardClaimed: boolean;
  status: 'active' | 'expired' | 'exhausted';
}

export interface GrowthLoop {
  id: string;
  name: string;
  type: 'viral' | 'paid' | 'content' | 'product' | 'community' | 'developer';
  description: string;
  stages: GrowthLoopStage[];
  kFactor: number;           // viral coefficient
  cycleTimeHours: number;
  conversionRate: number;
  active: boolean;
  monthlyNewUsers: number;
}

export interface GrowthLoopStage {
  order: number;
  name: string;
  conversionRate: number;
  avgTimeHours: number;
}

export interface GrowthExperiment {
  id: string;
  name: string;
  hypothesis: string;
  metric: string;
  targetImprovement: number;   // % improvement goal
  status: 'draft' | 'running' | 'paused' | 'completed' | 'abandoned';
  startedAt?: Date;
  endedAt?: Date;
  controlGroup: ExperimentGroup;
  treatmentGroup: ExperimentGroup;
  result?: ExperimentResult;
}

export interface ExperimentGroup {
  name: string;
  trafficPercent: number;
  userIds: string[];
  conversions: number;
  totalUsers: number;
}

export interface ExperimentResult {
  winner: 'control' | 'treatment' | 'inconclusive';
  uplift: number;             // % change
  pValue: number;
  confidence: number;
  recommendation: string;
  completedAt: Date;
}

export interface DeveloperEcosystem {
  totalDevelopers: number;
  activeIntegrations: number;
  publishedApps: number;
  sdkDownloads: number;
  apiAdoptionRate: number;    // devs using API / total devs
  avgApiCallsPerDev: number;
  topIntegrations: string[];
  weeklyNewDevelopers: number;
  ecosystemHealthScore: number;  // 0–100
}

export interface CommunityEngagement {
  period: { start: Date; end: Date };
  totalMembers: number;
  activeMembers: number;          // posted/commented
  newMembers: number;
  postsCreated: number;
  commentsCreated: number;
  helpfulAnswers: number;
  eventAttendees: number;
  engagementScore: number;        // 0–100
  topContributors: string[];
}

export interface PartnerProgram {
  id: string;
  name: string;
  tier: 'silver' | 'gold' | 'platinum' | 'strategic';
  partnerId: string;
  partnerName: string;
  joinedAt: Date;
  revenueGenerated: number;
  referralsProvided: number;
  coMarketingActivities: number;
  status: 'active' | 'inactive' | 'suspended';
  commission: number;             // % of referred revenue
  nextReviewDate: Date;
}

export interface ViralMetrics {
  kFactor: number;                // viral coefficient
  avgInvitesSentPerUser: number;
  inviteConversionRate: number;
  viralCycleHours: number;
  netNewUsersFromViral: number;
  percentageViralSignups: number;
}

export interface GrowthSnapshot {
  date: Date;
  dau: number;
  mau: number;
  newSignups: number;
  activations: number;
  retentionD7: number;
  retentionD30: number;
  kFactor: number;
  nps: number;
  mrr: number;
}

export interface NetworkEffect {
  id: string;
  type: 'direct' | 'indirect' | 'data' | 'platform' | 'social';
  description: string;
  strength: number;           // 0–1
  usersRequired: number;      // threshold where effect kicks in
  currentUsers: number;
  active: boolean;
}

// ── PlatformGrowthEngine ──────────────────────────────────────────────────────

class PlatformGrowthEngine {
  private referralPrograms: Map<string, ReferralProgram> = new Map();
  private referralLinks: Map<string, ReferralLink> = new Map();   // code → link
  private referralsByUser: Map<string, string[]> = new Map();      // userId → linkIds
  private growthLoops: Map<string, GrowthLoop> = new Map();
  private experiments: Map<string, GrowthExperiment> = new Map();
  private partnerPrograms: Map<string, PartnerProgram> = new Map();
  private networkEffects: Map<string, NetworkEffect> = new Map();
  private growthHistory: GrowthSnapshot[] = [];
  private communityData: CommunityEngagement[] = [];
  private developerEcosystem: DeveloperEcosystem = {
    totalDevelopers: 0,
    activeIntegrations: 0,
    publishedApps: 0,
    sdkDownloads: 0,
    apiAdoptionRate: 0,
    avgApiCallsPerDev: 0,
    topIntegrations: [],
    weeklyNewDevelopers: 0,
    ecosystemHealthScore: 0,
  };

  constructor() {
    this.initDefaultGrowthLoops();
    this.initDefaultNetworkEffects();
  }

  // ── Referral Programs ──────────────────────────────────────────────────────

  createReferralProgram(program: Omit<ReferralProgram, 'totalReferrals' | 'successfulConversions' | 'totalRewardValue'>): void {
    const full: ReferralProgram = { ...program, totalReferrals: 0, successfulConversions: 0, totalRewardValue: 0 };
    this.referralPrograms.set(program.id, full);
    logger.info('Referral program created', { programId: program.id, name: program.name });
  }

  generateReferralLink(referrerId: string, programId: string): ReferralLink {
    const program = this.referralPrograms.get(programId);
    if (!program || !program.active) throw new Error(`Referral program ${programId} not found or inactive`);

    // Max referrals check
    const existing = this.referralsByUser.get(referrerId) ?? [];
    if (program.maxReferralsPerUser && existing.length >= program.maxReferralsPerUser) {
      throw new Error('Maximum referral links reached for this user');
    }

    const code = `${referrerId.slice(0, 6)}-${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
    const link: ReferralLink = {
      id: crypto.randomUUID(),
      referrerId,
      code,
      programId,
      createdAt: new Date(),
      expiresAt: program.expiryDays ? new Date(Date.now() + program.expiryDays * 86_400_000) : undefined,
      clicks: 0,
      signups: 0,
      conversions: 0,
      rewardClaimed: false,
      status: 'active',
    };

    this.referralLinks.set(code, link);
    const userLinks = this.referralsByUser.get(referrerId) ?? [];
    userLinks.push(link.id);
    this.referralsByUser.set(referrerId, userLinks);

    logger.info('Referral link generated', { referrerId, code, programId });
    return link;
  }

  trackReferralClick(code: string): boolean {
    const link = this.referralLinks.get(code);
    if (!link || link.status !== 'active') return false;
    if (link.expiresAt && link.expiresAt < new Date()) {
      link.status = 'expired';
      return false;
    }
    link.clicks++;
    return true;
  }

  recordReferralSignup(code: string): boolean {
    const link = this.referralLinks.get(code);
    if (!link || link.status !== 'active') return false;
    link.signups++;
    const program = this.referralPrograms.get(link.programId);
    if (program) program.totalReferrals++;
    return true;
  }

  recordReferralConversion(code: string): { referrerId: string; rewards: ReferralReward[] } | null {
    const link = this.referralLinks.get(code);
    if (!link) return null;
    link.conversions++;
    const program = this.referralPrograms.get(link.programId);
    if (!program) return null;
    program.successfulConversions++;
    program.totalRewardValue += program.referrerReward.value + program.refereeReward.value;
    logger.info('Referral conversion recorded', { code, referrerId: link.referrerId });
    return { referrerId: link.referrerId, rewards: [program.referrerReward, program.refereeReward] };
  }

  // ── Viral Coefficient ──────────────────────────────────────────────────────

  calculateKFactor(window?: { start: Date; end: Date }): ViralMetrics {
    const cacheKey = 'growth:kfactor';
    const cached = cache.get<ViralMetrics>(cacheKey);
    if (cached && !window) return cached;

    let totalSignups = 0;
    let totalConversions = 0;
    let totalClicks = 0;
    let totalLinks = 0;

    for (const link of this.referralLinks.values()) {
      if (window && (link.createdAt < window.start || link.createdAt > window.end)) continue;
      totalSignups += link.signups;
      totalConversions += link.conversions;
      totalClicks += link.clicks;
      totalLinks++;
    }

    const avgInvites = totalLinks > 0 ? totalClicks / totalLinks : 0;
    const conversionRate = totalClicks > 0 ? totalConversions / totalClicks : 0;
    const kFactor = avgInvites * conversionRate;

    // Viral cycle time: average days between link creation and first conversion
    let cycleHours = 48; // default estimate
    const loops = Array.from(this.growthLoops.values()).filter((l) => l.type === 'viral');
    if (loops.length > 0) {
      cycleHours = loops[0].cycleTimeHours;
    }

    const history = this.growthHistory;
    const totalNewUsers = history.reduce((s, h) => s + h.newSignups, 0);
    const viralUsers = totalConversions;
    const percentViral = totalNewUsers > 0 ? (viralUsers / totalNewUsers) * 100 : 0;

    const metrics: ViralMetrics = {
      kFactor,
      avgInvitesSentPerUser: avgInvites,
      inviteConversionRate: conversionRate,
      viralCycleHours: cycleHours,
      netNewUsersFromViral: viralUsers,
      percentageViralSignups: percentViral,
    };

    cache.set(cacheKey, metrics, 3600);
    return metrics;
  }

  // ── Growth Loops ───────────────────────────────────────────────────────────

  private initDefaultGrowthLoops(): void {
    const loops: GrowthLoop[] = [
      {
        id: 'referral-loop',
        name: 'User Referral Loop',
        type: 'viral',
        description: 'Users invite colleagues → colleagues sign up → they refer more users',
        stages: [
          { order: 1, name: 'User discovers referral program', conversionRate: 0.40, avgTimeHours: 24 },
          { order: 2, name: 'User sends invites', conversionRate: 0.30, avgTimeHours: 8 },
          { order: 3, name: 'Invitee clicks link', conversionRate: 0.25, avgTimeHours: 48 },
          { order: 4, name: 'Invitee converts to paid', conversionRate: 0.15, avgTimeHours: 72 },
        ],
        kFactor: 0.3,
        cycleTimeHours: 152,
        conversionRate: 0.15,
        active: true,
        monthlyNewUsers: 0,
      },
      {
        id: 'content-loop',
        name: 'Content Distribution Loop',
        type: 'content',
        description: 'Platform generates news → users share → shares drive signups → more content created',
        stages: [
          { order: 1, name: 'AI generates news content', conversionRate: 0.90, avgTimeHours: 1 },
          { order: 2, name: 'User publishes/shares content', conversionRate: 0.35, avgTimeHours: 4 },
          { order: 3, name: 'Content reader visits platform', conversionRate: 0.08, avgTimeHours: 72 },
          { order: 4, name: 'Visitor signs up', conversionRate: 0.12, avgTimeHours: 12 },
        ],
        kFactor: 0.25,
        cycleTimeHours: 89,
        conversionRate: 0.12,
        active: true,
        monthlyNewUsers: 0,
      },
      {
        id: 'developer-loop',
        name: 'Developer Ecosystem Loop',
        type: 'developer',
        description: 'Developers build integrations → integrations attract users → revenue funds API improvements',
        stages: [
          { order: 1, name: 'Developer discovers API', conversionRate: 0.60, avgTimeHours: 48 },
          { order: 2, name: 'Developer builds integration', conversionRate: 0.20, avgTimeHours: 240 },
          { order: 3, name: 'Integration published', conversionRate: 0.70, avgTimeHours: 72 },
          { order: 4, name: 'Users install integration', conversionRate: 0.30, avgTimeHours: 168 },
        ],
        kFactor: 0.18,
        cycleTimeHours: 528,
        conversionRate: 0.10,
        active: true,
        monthlyNewUsers: 0,
      },
    ];
    for (const loop of loops) this.growthLoops.set(loop.id, loop);
  }

  getGrowthLoop(loopId: string): GrowthLoop | null {
    return this.growthLoops.get(loopId) ?? null;
  }

  updateGrowthLoop(loopId: string, updates: Partial<GrowthLoop>): void {
    const loop = this.growthLoops.get(loopId);
    if (loop) Object.assign(loop, updates);
  }

  // ── Growth Experiments ─────────────────────────────────────────────────────

  createExperiment(experiment: Omit<GrowthExperiment, 'status'>): GrowthExperiment {
    const full: GrowthExperiment = { ...experiment, status: 'draft' };
    this.experiments.set(experiment.id, full);
    logger.info('Growth experiment created', { experimentId: experiment.id, name: experiment.name });
    return full;
  }

  startExperiment(experimentId: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);
    exp.status = 'running';
    exp.startedAt = new Date();
    logger.info('Growth experiment started', { experimentId });
  }

  recordExperimentConversion(experimentId: string, userId: string, group: 'control' | 'treatment'): void {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== 'running') return;
    if (group === 'control') {
      exp.controlGroup.conversions++;
      if (!exp.controlGroup.userIds.includes(userId)) exp.controlGroup.userIds.push(userId);
    } else {
      exp.treatmentGroup.conversions++;
      if (!exp.treatmentGroup.userIds.includes(userId)) exp.treatmentGroup.userIds.push(userId);
    }
  }

  concludeExperiment(experimentId: string): ExperimentResult {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const controlCvr = exp.controlGroup.totalUsers > 0
      ? exp.controlGroup.conversions / exp.controlGroup.totalUsers : 0;
    const treatmentCvr = exp.treatmentGroup.totalUsers > 0
      ? exp.treatmentGroup.conversions / exp.treatmentGroup.totalUsers : 0;

    const uplift = controlCvr > 0 ? ((treatmentCvr - controlCvr) / controlCvr) * 100 : 0;

    // Simplified p-value approximation (Z-test)
    const n1 = exp.controlGroup.totalUsers;
    const n2 = exp.treatmentGroup.totalUsers;
    const p1 = controlCvr;
    const p2 = treatmentCvr;
    const pooled = (exp.controlGroup.conversions + exp.treatmentGroup.conversions) / (n1 + n2);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, n1) + 1 / Math.max(1, n2)));
    const z = se > 0 ? Math.abs(p2 - p1) / se : 0;
    const pValue = Math.max(0.001, 2 * (1 - this.normalCDF(z)));
    const confidence = 1 - pValue;

    const winner: ExperimentResult['winner'] =
      pValue < 0.05 && uplift > 0 ? 'treatment'
      : pValue < 0.05 && uplift < 0 ? 'control'
      : 'inconclusive';

    const result: ExperimentResult = {
      winner,
      uplift,
      pValue,
      confidence,
      recommendation:
        winner === 'treatment' ? `Ship treatment: +${uplift.toFixed(1)}% improvement in ${exp.metric}`
        : winner === 'control' ? 'Keep control; treatment performed worse'
        : 'Insufficient signal; extend experiment or revisit hypothesis',
      completedAt: new Date(),
    };

    exp.result = result;
    exp.status = 'completed';
    exp.endedAt = new Date();
    logger.info('Growth experiment concluded', { experimentId, winner, uplift: uplift.toFixed(2) + '%' });
    return result;
  }

  private normalCDF(z: number): number {
    // Abramowitz and Stegun approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return z > 0 ? 1 - p : p;
  }

  // ── Developer Ecosystem ────────────────────────────────────────────────────

  updateDeveloperEcosystem(data: Partial<DeveloperEcosystem>): void {
    Object.assign(this.developerEcosystem, data);
    this.developerEcosystem.ecosystemHealthScore = this.computeEcosystemHealth();
  }

  private computeEcosystemHealth(): number {
    const d = this.developerEcosystem;
    let score = 0;
    score += Math.min(25, d.apiAdoptionRate * 100 * 0.25);
    score += Math.min(25, Math.log10(d.activeIntegrations + 1) * 10);
    score += Math.min(20, Math.log10(d.sdkDownloads + 1) * 5);
    score += Math.min(15, Math.log10(d.publishedApps + 1) * 10);
    score += Math.min(15, Math.log10(d.weeklyNewDevelopers + 1) * 10);
    return Math.min(100, Math.round(score));
  }

  getDeveloperEcosystem(): DeveloperEcosystem {
    return { ...this.developerEcosystem };
  }

  // ── Community ──────────────────────────────────────────────────────────────

  recordCommunityEngagement(data: CommunityEngagement): void {
    this.communityData.push(data);
    if (this.communityData.length > 24) this.communityData.shift(); // keep 24 months
  }

  getLatestCommunityEngagement(): CommunityEngagement | null {
    return this.communityData[this.communityData.length - 1] ?? null;
  }

  // ── Partner Programs ───────────────────────────────────────────────────────

  registerPartner(partner: PartnerProgram): void {
    this.partnerPrograms.set(partner.id, partner);
    logger.info('Partner registered', { partnerId: partner.id, tier: partner.tier });
  }

  recordPartnerReferral(partnerId: string, revenue: number): void {
    const partner = this.partnerPrograms.get(partnerId);
    if (!partner) return;
    partner.referralsProvided++;
    partner.revenueGenerated += revenue;
  }

  getTopPartners(limit = 10): PartnerProgram[] {
    return Array.from(this.partnerPrograms.values())
      .filter((p) => p.status === 'active')
      .sort((a, b) => b.revenueGenerated - a.revenueGenerated)
      .slice(0, limit);
  }

  // ── Network Effects ────────────────────────────────────────────────────────

  private initDefaultNetworkEffects(): void {
    const effects: NetworkEffect[] = [
      { id: 'content-quality', type: 'data', description: 'More users → more feedback → better AI content', strength: 0.6, usersRequired: 100, currentUsers: 0, active: false },
      { id: 'integrations', type: 'platform', description: 'More integrations → more utility → more users', strength: 0.7, usersRequired: 10, currentUsers: 0, active: false },
      { id: 'community-knowledge', type: 'social', description: 'More members → richer Q&A → more value', strength: 0.5, usersRequired: 500, currentUsers: 0, active: false },
    ];
    for (const e of effects) this.networkEffects.set(e.id, e);
  }

  updateNetworkEffectUsers(totalUsers: number): void {
    for (const effect of this.networkEffects.values()) {
      effect.currentUsers = totalUsers;
      effect.active = totalUsers >= effect.usersRequired;
    }
  }

  getActiveNetworkEffects(): NetworkEffect[] {
    return Array.from(this.networkEffects.values()).filter((e) => e.active);
  }

  // ── Growth History ─────────────────────────────────────────────────────────

  recordGrowthSnapshot(snapshot: GrowthSnapshot): void {
    this.growthHistory.push(snapshot);
    if (this.growthHistory.length > 365) this.growthHistory.shift();
    cache.set('growth:snapshot:latest', snapshot, 86400);
  }

  getGrowthHistory(days = 30): GrowthSnapshot[] {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    return this.growthHistory.filter((s) => s.date >= cutoff);
  }

  // ── Summary Stats ──────────────────────────────────────────────────────────

  getGrowthSummary(): {
    kFactor: number;
    totalReferrals: number;
    referralConversions: number;
    activeExperiments: number;
    partnerRevenue: number;
    communityEngagementScore: number;
    developerEcosystemHealth: number;
    activeNetworkEffects: number;
    growthLoopsActive: number;
  } {
    const kMetrics = this.calculateKFactor();
    const totalReferrals = Array.from(this.referralPrograms.values()).reduce((s, p) => s + p.totalReferrals, 0);
    const conversions = Array.from(this.referralPrograms.values()).reduce((s, p) => s + p.successfulConversions, 0);
    const partnerRevenue = Array.from(this.partnerPrograms.values()).reduce((s, p) => s + p.revenueGenerated, 0);
    const community = this.getLatestCommunityEngagement();

    return {
      kFactor: kMetrics.kFactor,
      totalReferrals,
      referralConversions: conversions,
      activeExperiments: Array.from(this.experiments.values()).filter((e) => e.status === 'running').length,
      partnerRevenue,
      communityEngagementScore: community?.engagementScore ?? 0,
      developerEcosystemHealth: this.developerEcosystem.ecosystemHealthScore,
      activeNetworkEffects: this.getActiveNetworkEffects().length,
      growthLoopsActive: Array.from(this.growthLoops.values()).filter((l) => l.active).length,
    };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__platformGrowthEngine__';

export function getPlatformGrowthEngine(): PlatformGrowthEngine {
  const g = globalThis as unknown as Record<string, PlatformGrowthEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new PlatformGrowthEngine();
  }
  return g[GLOBAL_KEY];
}

export { PlatformGrowthEngine };
export default getPlatformGrowthEngine;
