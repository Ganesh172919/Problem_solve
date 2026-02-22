/**
 * User Engagement Engine
 *
 * Provides:
 * - User engagement scoring (0-100) with time-decay
 * - Gamification: streaks, achievements, badges
 * - Engagement decay modeling (exponential decay)
 * - Re-engagement triggers (dormancy detection)
 * - Social proof mechanisms (trending badges, community stats)
 * - Viral coefficient tracking (k-factor = invites × conversion rate)
 * - Loyalty tiers (Bronze/Silver/Gold/Platinum), reward point system
 */

import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface EngagementScore {
  userId: string;
  score: number; // 0-100
  rawScore: number; // before normalization
  components: Array<{
    action: string;
    points: number;
    decayedPoints: number;
    occurredAt: Date;
    ageDays: number;
  }>;
  lastActivityAt: Date | null;
  daysSinceLastActivity: number;
  trend: 'rising' | 'stable' | 'declining' | 'dormant';
  calculatedAt: Date;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: 'onboarding' | 'engagement' | 'social' | 'loyalty' | 'milestone' | 'special';
  icon: string;
  condition: {
    type: 'count' | 'streak' | 'score' | 'cumulative' | 'custom';
    action?: string;
    threshold: number;
    windowDays?: number;
  };
  rewardPoints: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  active: boolean;
}

export interface Badge {
  id: string;
  userId: string;
  achievementId: string;
  achievementName: string;
  icon: string;
  rarity: Achievement['rarity'];
  awardedAt: Date;
  displayOnProfile: boolean;
}

export interface Streak {
  userId: string;
  actionType: string;
  currentStreak: number;
  longestStreak: number;
  lastActionDate: string; // YYYY-MM-DD
  streakStartDate: string;
  isActive: boolean;
  frozenUntil?: string; // streak freeze feature
  updatedAt: Date;
}

export type LoyaltyTierName = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface LoyaltyTier {
  name: LoyaltyTierName;
  minPoints: number;
  maxPoints: number | null;
  multiplier: number; // points earning multiplier
  benefits: string[];
  color: string;
}

export interface RewardPoints {
  userId: string;
  totalPoints: number;
  availablePoints: number;
  lifetimePoints: number;
  tier: LoyaltyTierName;
  transactions: Array<{
    id: string;
    type: 'earn' | 'redeem' | 'expire' | 'bonus';
    points: number;
    reason: string;
    referenceId?: string;
    occurredAt: Date;
  }>;
  nextTierName: LoyaltyTierName | null;
  pointsToNextTier: number | null;
  updatedAt: Date;
}

export interface ReEngagementTrigger {
  id: string;
  userId: string;
  type: 'dormancy' | 'streak-break' | 'tier-at-risk' | 'win-back' | 'milestone-nearby';
  severity: 'low' | 'medium' | 'high';
  message: string;
  suggestedAction: string;
  channel: 'email' | 'push' | 'in-app' | 'sms';
  scheduledFor: Date;
  fired: boolean;
  firedAt?: Date;
  createdAt: Date;
}

export interface ViralMetrics {
  userId: string;
  totalInvitesSent: number;
  successfulConversions: number;
  conversionRate: number; // 0-1
  kFactor: number; // invites × conversion rate per existing user
  viralCycleLengthDays: number;
  viralCoefficient: number; // kFactor adjusted for cycle length
  tier: 'non-viral' | 'sub-viral' | 'viral' | 'super-viral';
  updatedAt: Date;
}

// ─── Internal state types ─────────────────────────────────────────────────────

interface ActionEvent {
  userId: string;
  action: string;
  points: number;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

interface UserEngagementState {
  events: ActionEvent[];
  badges: Badge[];
  streaks: Map<string, Streak>;
  rewardPoints: RewardPoints;
  viralMetrics: ViralMetrics;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOYALTY_TIERS: LoyaltyTier[] = [
  { name: 'Bronze', minPoints: 0, maxPoints: 999, multiplier: 1.0, benefits: ['Basic access'], color: '#CD7F32' },
  { name: 'Silver', minPoints: 1000, maxPoints: 4999, multiplier: 1.25, benefits: ['Priority support', '5% discount'], color: '#C0C0C0' },
  { name: 'Gold', minPoints: 5000, maxPoints: 19999, multiplier: 1.5, benefits: ['Priority support', '10% discount', 'Early access'], color: '#FFD700' },
  { name: 'Platinum', minPoints: 20000, maxPoints: null, multiplier: 2.0, benefits: ['Dedicated support', '20% discount', 'Early access', 'Exclusive features'], color: '#E5E4E2' },
];

const ACTION_POINTS: Record<string, number> = {
  login: 5,
  article_read: 10,
  article_share: 20,
  comment: 15,
  like: 5,
  bookmark: 8,
  profile_complete: 50,
  referral_sent: 25,
  referral_converted: 100,
  purchase: 200,
  review_written: 30,
  streak_day: 10,
  achievement_unlocked: 50,
};

// Half-life of 30 days: score decays to 50% after 30 days of inactivity
const DECAY_HALF_LIFE_DAYS = 30;

// ─── Engine ───────────────────────────────────────────────────────────────────

class UserEngagementEngine {
  private userStates: Map<string, UserEngagementState> = new Map();
  private achievements: Map<string, Achievement> = new Map();
  private reEngagementTriggers: Map<string, ReEngagementTrigger[]> = new Map();

  constructor() {
    this.registerDefaultAchievements();
  }

  // ─── State Management ─────────────────────────────────────────────────────

  private getOrCreateState(userId: string): UserEngagementState {
    if (!this.userStates.has(userId)) {
      const state: UserEngagementState = {
        events: [],
        badges: [],
        streaks: new Map(),
        rewardPoints: {
          userId,
          totalPoints: 0,
          availablePoints: 0,
          lifetimePoints: 0,
          tier: 'Bronze',
          transactions: [],
          nextTierName: 'Silver',
          pointsToNextTier: 1000,
          updatedAt: new Date(),
        },
        viralMetrics: {
          userId,
          totalInvitesSent: 0,
          successfulConversions: 0,
          conversionRate: 0,
          kFactor: 0,
          viralCycleLengthDays: 7,
          viralCoefficient: 0,
          tier: 'non-viral',
          updatedAt: new Date(),
        },
      };
      this.userStates.set(userId, state);
    }
    return this.userStates.get(userId)!;
  }

  // ─── Engagement Scoring ───────────────────────────────────────────────────

  recordAction(userId: string, action: string, pointsOverride?: number, occurredAt?: Date): void {
    const state = this.getOrCreateState(userId);
    const points = pointsOverride ?? ACTION_POINTS[action] ?? 5;
    const event: ActionEvent = { userId, action, points, occurredAt: occurredAt ?? new Date() };
    state.events.push(event);

    // Evict events older than 365 days
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    state.events = state.events.filter((e) => e.occurredAt >= cutoff);

    // Update streak if applicable
    if (['login', 'article_read', 'comment'].includes(action)) {
      this.trackStreak(userId, action);
    }

    // Check achievements
    this.checkAllAchievements(userId);

    logger.info('Action recorded', { userId, action, points });
  }

  calculateEngagementScore(userId: string): EngagementScore {
    const cacheKey = `engagement_score:${userId}`;
    const cached = cache.get<EngagementScore>(cacheKey);
    if (cached) return cached;

    const state = this.getOrCreateState(userId);
    const now = new Date();

    const components = state.events.map((e) => {
      const ageDays = (now.getTime() - e.occurredAt.getTime()) / (1000 * 3600 * 24);
      // Exponential decay: points × e^(-λ × ageDays) where λ = ln(2) / half_life
      const lambda = Math.LN2 / DECAY_HALF_LIFE_DAYS;
      const decayedPoints = e.points * Math.exp(-lambda * ageDays);
      return { action: e.action, points: e.points, decayedPoints, occurredAt: e.occurredAt, ageDays };
    });

    const rawScore = components.reduce((acc, c) => acc + c.decayedPoints, 0);
    // Normalize to 0-100 using sigmoid-like scaling (cap at 500 raw points → 100)
    const score = Math.min(100, Math.round((rawScore / 500) * 100));

    const lastEvent = state.events.length > 0
      ? state.events.reduce((a, b) => (b.occurredAt > a.occurredAt ? b : a))
      : null;
    const lastActivityAt = lastEvent?.occurredAt ?? null;
    const daysSinceLastActivity = lastActivityAt
      ? Math.floor((now.getTime() - lastActivityAt.getTime()) / (1000 * 3600 * 24))
      : 9999;

    // Trend: compare score with score from 7 days ago
    const trend: EngagementScore['trend'] =
      daysSinceLastActivity > 30 ? 'dormant' :
      score >= 60 ? 'rising' :
      score >= 30 ? 'stable' : 'declining';

    const result: EngagementScore = {
      userId,
      score,
      rawScore: Math.round(rawScore * 100) / 100,
      components,
      lastActivityAt,
      daysSinceLastActivity,
      trend,
      calculatedAt: now,
    };

    cache.set(cacheKey, result, 300);
    return result;
  }

  // ─── Streaks ──────────────────────────────────────────────────────────────

  trackStreak(userId: string, actionType: string): Streak {
    const state = this.getOrCreateState(userId);
    const today = new Date().toISOString().slice(0, 10);
    const existing = state.streaks.get(actionType);

    if (!existing) {
      const streak: Streak = {
        userId,
        actionType,
        currentStreak: 1,
        longestStreak: 1,
        lastActionDate: today,
        streakStartDate: today,
        isActive: true,
        updatedAt: new Date(),
      };
      state.streaks.set(actionType, streak);
      return streak;
    }

    // Streak freeze check
    if (existing.frozenUntil && today <= existing.frozenUntil) {
      existing.lastActionDate = today;
      existing.updatedAt = new Date();
      return existing;
    }

    const lastDate = new Date(existing.lastActionDate);
    const todayDate = new Date(today);
    const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));

    if (diffDays === 0) {
      // Already acted today, no change
      return existing;
    } else if (diffDays === 1) {
      // Consecutive day — extend streak
      existing.currentStreak++;
      existing.longestStreak = Math.max(existing.longestStreak, existing.currentStreak);
      existing.lastActionDate = today;
      existing.isActive = true;
    } else {
      // Streak broken
      existing.currentStreak = 1;
      existing.streakStartDate = today;
      existing.lastActionDate = today;
      existing.isActive = true;
    }
    existing.updatedAt = new Date();

    // Award streak bonus points every 7 days
    if (existing.currentStreak % 7 === 0) {
      this.addRewardPoints(userId, ACTION_POINTS.streak_day * existing.currentStreak, `${existing.currentStreak}-day streak bonus`, 'earn');
      logger.info('Streak milestone bonus awarded', { userId, streak: existing.currentStreak });
    }

    return existing;
  }

  getStreak(userId: string, actionType: string): Streak | null {
    return this.getOrCreateState(userId).streaks.get(actionType) ?? null;
  }

  freezeStreak(userId: string, actionType: string, days: number): void {
    const state = this.getOrCreateState(userId);
    const streak = state.streaks.get(actionType);
    if (!streak) return;
    const until = new Date();
    until.setDate(until.getDate() + days);
    streak.frozenUntil = until.toISOString().slice(0, 10);
    logger.info('Streak frozen', { userId, actionType, frozenUntil: streak.frozenUntil });
  }

  // ─── Achievements ─────────────────────────────────────────────────────────

  registerAchievement(achievement: Achievement): void {
    this.achievements.set(achievement.id, achievement);
  }

  private registerDefaultAchievements(): void {
    const defaults: Achievement[] = [
      {
        id: 'first_login', name: 'Welcome Aboard', description: 'Log in for the first time', category: 'onboarding',
        icon: '👋', condition: { type: 'count', action: 'login', threshold: 1 }, rewardPoints: 50, rarity: 'common', active: true,
      },
      {
        id: 'read_10', name: 'Avid Reader', description: 'Read 10 articles', category: 'engagement',
        icon: '📚', condition: { type: 'count', action: 'article_read', threshold: 10 }, rewardPoints: 100, rarity: 'common', active: true,
      },
      {
        id: 'read_100', name: 'Bookworm', description: 'Read 100 articles', category: 'engagement',
        icon: '🎓', condition: { type: 'count', action: 'article_read', threshold: 100 }, rewardPoints: 500, rarity: 'rare', active: true,
      },
      {
        id: 'streak_7', name: 'Week Warrior', description: 'Maintain a 7-day login streak', category: 'engagement',
        icon: '🔥', condition: { type: 'streak', action: 'login', threshold: 7 }, rewardPoints: 200, rarity: 'uncommon', active: true,
      },
      {
        id: 'streak_30', name: 'Monthly Master', description: 'Maintain a 30-day login streak', category: 'engagement',
        icon: '⚡', condition: { type: 'streak', action: 'login', threshold: 30 }, rewardPoints: 1000, rarity: 'epic', active: true,
      },
      {
        id: 'referral_5', name: 'Community Builder', description: 'Refer 5 users who convert', category: 'social',
        icon: '🤝', condition: { type: 'count', action: 'referral_converted', threshold: 5 }, rewardPoints: 750, rarity: 'rare', active: true,
      },
      {
        id: 'score_80', name: 'Power User', description: 'Achieve an engagement score of 80+', category: 'milestone',
        icon: '⭐', condition: { type: 'score', threshold: 80 }, rewardPoints: 300, rarity: 'uncommon', active: true,
      },
      {
        id: 'platinum_tier', name: 'Platinum Elite', description: 'Reach Platinum loyalty tier', category: 'loyalty',
        icon: '💎', condition: { type: 'cumulative', threshold: 20000 }, rewardPoints: 2000, rarity: 'legendary', active: true,
      },
    ];
    defaults.forEach((a) => this.achievements.set(a.id, a));
  }

  private checkAllAchievements(userId: string): void {
    const state = this.getOrCreateState(userId);
    const alreadyAwarded = new Set(state.badges.map((b) => b.achievementId));

    for (const achievement of this.achievements.values()) {
      if (!achievement.active || alreadyAwarded.has(achievement.id)) continue;
      if (this.meetsAchievementCondition(userId, achievement)) {
        this.awardAchievement(userId, achievement.id);
      }
    }
  }

  private meetsAchievementCondition(userId: string, achievement: Achievement): boolean {
    const state = this.getOrCreateState(userId);
    const { condition } = achievement;

    switch (condition.type) {
      case 'count': {
        const actionEvents = state.events.filter((e) => e.action === condition.action);
        let filtered = actionEvents;
        if (condition.windowDays) {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - condition.windowDays);
          filtered = actionEvents.filter((e) => e.occurredAt >= cutoff);
        }
        return filtered.length >= condition.threshold;
      }
      case 'streak': {
        const streak = state.streaks.get(condition.action ?? 'login');
        return (streak?.currentStreak ?? 0) >= condition.threshold;
      }
      case 'score': {
        const score = this.calculateEngagementScore(userId);
        return score.score >= condition.threshold;
      }
      case 'cumulative': {
        return state.rewardPoints.lifetimePoints >= condition.threshold;
      }
      default: return false;
    }
  }

  awardAchievement(userId: string, achievementId: string): Badge | null {
    const achievement = this.achievements.get(achievementId);
    if (!achievement) return null;

    const state = this.getOrCreateState(userId);
    if (state.badges.some((b) => b.achievementId === achievementId)) return null;

    const badge: Badge = {
      id: `badge:${userId}:${achievementId}:${Date.now()}`,
      userId,
      achievementId,
      achievementName: achievement.name,
      icon: achievement.icon,
      rarity: achievement.rarity,
      awardedAt: new Date(),
      displayOnProfile: true,
    };
    state.badges.push(badge);
    this.addRewardPoints(userId, achievement.rewardPoints, `Achievement: ${achievement.name}`, 'bonus', achievementId);

    logger.info('Achievement awarded', { userId, achievementId, name: achievement.name, rarity: achievement.rarity });
    return badge;
  }

  getUserBadges(userId: string): Badge[] {
    return this.getOrCreateState(userId).badges;
  }

  // ─── Loyalty Tiers ────────────────────────────────────────────────────────

  checkLoyaltyTier(userId: string): LoyaltyTier {
    const state = this.getOrCreateState(userId);
    const points = state.rewardPoints.lifetimePoints;
    return this.getTierForPoints(points);
  }

  private getTierForPoints(points: number): LoyaltyTier {
    for (let i = LOYALTY_TIERS.length - 1; i >= 0; i--) {
      if (points >= LOYALTY_TIERS[i].minPoints) return LOYALTY_TIERS[i];
    }
    return LOYALTY_TIERS[0];
  }

  private getNextTier(currentTier: LoyaltyTierName): LoyaltyTier | null {
    const idx = LOYALTY_TIERS.findIndex((t) => t.name === currentTier);
    return LOYALTY_TIERS[idx + 1] ?? null;
  }

  // ─── Reward Points ────────────────────────────────────────────────────────

  addRewardPoints(userId: string, points: number, reason: string, type: RewardPoints['transactions'][0]['type'], referenceId?: string): RewardPoints {
    const state = this.getOrCreateState(userId);
    const rp = state.rewardPoints;
    const tier = this.checkLoyaltyTier(userId);
    const multiplier = type === 'earn' ? tier.multiplier : 1;
    const finalPoints = type === 'earn' ? Math.round(points * multiplier) : points;

    rp.transactions.push({
      id: `txn:${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      type,
      points: finalPoints,
      reason,
      referenceId,
      occurredAt: new Date(),
    });

    if (type === 'earn' || type === 'bonus') {
      rp.totalPoints += finalPoints;
      rp.availablePoints += finalPoints;
      rp.lifetimePoints += finalPoints;
    } else if (type === 'redeem') {
      rp.availablePoints = Math.max(0, rp.availablePoints - finalPoints);
      rp.totalPoints = Math.max(0, rp.totalPoints - finalPoints);
    } else if (type === 'expire') {
      rp.availablePoints = Math.max(0, rp.availablePoints - finalPoints);
      rp.totalPoints = Math.max(0, rp.totalPoints - finalPoints);
    }

    const newTier = this.getTierForPoints(rp.lifetimePoints);
    rp.tier = newTier.name;
    const nextTier = this.getNextTier(newTier.name);
    rp.nextTierName = nextTier?.name ?? null;
    rp.pointsToNextTier = nextTier ? nextTier.minPoints - rp.lifetimePoints : null;
    rp.updatedAt = new Date();

    // Evict old transactions (keep last 500)
    if (rp.transactions.length > 500) rp.transactions = rp.transactions.slice(-500);

    logger.info('Reward points updated', { userId, type, points: finalPoints, total: rp.totalPoints, tier: rp.tier });
    return rp;
  }

  redeemPoints(userId: string, points: number, reason: string): { success: boolean; rewardPoints: RewardPoints; message: string } {
    const state = this.getOrCreateState(userId);
    if (state.rewardPoints.availablePoints < points) {
      return { success: false, rewardPoints: state.rewardPoints, message: 'Insufficient available points' };
    }
    const updated = this.addRewardPoints(userId, points, reason, 'redeem');
    return { success: true, rewardPoints: updated, message: `${points} points redeemed successfully` };
  }

  getRewardPoints(userId: string): RewardPoints {
    return this.getOrCreateState(userId).rewardPoints;
  }

  // ─── Dormancy Detection ───────────────────────────────────────────────────

  detectDormancy(userId: string, dormancyThresholdDays = 14): boolean {
    const score = this.calculateEngagementScore(userId);
    return score.daysSinceLastActivity >= dormancyThresholdDays;
  }

  // ─── Re-engagement Triggers ───────────────────────────────────────────────

  triggerReEngagement(userId: string): ReEngagementTrigger[] {
    const triggers: ReEngagementTrigger[] = [];
    const score = this.calculateEngagementScore(userId);
    const state = this.getOrCreateState(userId);
    const now = new Date();
    const idBase = `trigger:${userId}:${Date.now()}`;

    // Dormancy trigger
    if (score.daysSinceLastActivity >= 14 && score.daysSinceLastActivity < 30) {
      triggers.push({
        id: `${idBase}:dormancy`,
        userId,
        type: 'dormancy',
        severity: 'medium',
        message: `We miss you! It's been ${score.daysSinceLastActivity} days since your last visit.`,
        suggestedAction: 'Read today's top article',
        channel: 'email',
        scheduledFor: now,
        fired: false,
        createdAt: now,
      });
    }
    if (score.daysSinceLastActivity >= 30) {
      triggers.push({
        id: `${idBase}:winback`,
        userId,
        type: 'win-back',
        severity: 'high',
        message: `It's been over a month! Come back and earn double points this week.`,
        suggestedAction: 'Claim your re-engagement bonus',
        channel: 'email',
        scheduledFor: now,
        fired: false,
        createdAt: now,
      });
    }

    // Streak break trigger
    for (const [actionType, streak] of state.streaks.entries()) {
      if (streak.currentStreak >= 5) {
        const lastDate = new Date(streak.lastActionDate);
        const daysSince = Math.round((now.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));
        if (daysSince === 1) {
          triggers.push({
            id: `${idBase}:streak:${actionType}`,
            userId,
            type: 'streak-break',
            severity: 'medium',
            message: `Don't break your ${streak.currentStreak}-day ${actionType} streak! Act today to keep it alive.`,
            suggestedAction: `Complete one ${actionType} action today`,
            channel: 'push',
            scheduledFor: now,
            fired: false,
            createdAt: now,
          });
        }
      }
    }

    // Tier at risk
    const rp = state.rewardPoints;
    if (rp.tier !== 'Bronze' && score.daysSinceLastActivity >= 30) {
      triggers.push({
        id: `${idBase}:tier`,
        userId,
        type: 'tier-at-risk',
        severity: 'high',
        message: `Your ${rp.tier} tier status may be at risk. Stay active to retain your benefits!`,
        suggestedAction: 'Check your loyalty benefits',
        channel: 'in-app',
        scheduledFor: now,
        fired: false,
        createdAt: now,
      });
    }

    // Milestone nearby
    if (rp.pointsToNextTier !== null && rp.pointsToNextTier <= 200) {
      triggers.push({
        id: `${idBase}:milestone`,
        userId,
        type: 'milestone-nearby',
        severity: 'low',
        message: `You're only ${rp.pointsToNextTier} points away from ${rp.nextTierName} tier!`,
        suggestedAction: 'Earn points to level up',
        channel: 'in-app',
        scheduledFor: now,
        fired: false,
        createdAt: now,
      });
    }

    if (!this.reEngagementTriggers.has(userId)) this.reEngagementTriggers.set(userId, []);
    this.reEngagementTriggers.get(userId)!.push(...triggers);

    if (triggers.length > 0) {
      logger.info('Re-engagement triggers created', { userId, count: triggers.length });
    }
    return triggers;
  }

  markTriggerFired(triggerId: string, userId: string): void {
    const triggers = this.reEngagementTriggers.get(userId) ?? [];
    const trigger = triggers.find((t) => t.id === triggerId);
    if (trigger) {
      trigger.fired = true;
      trigger.firedAt = new Date();
    }
  }

  // ─── Viral Coefficient Tracking ───────────────────────────────────────────

  calculateViralCoefficient(userId: string, invitesSent: number, conversions: number, cycleLengthDays = 7): ViralMetrics {
    const state = this.getOrCreateState(userId);
    const vm = state.viralMetrics;

    vm.totalInvitesSent = invitesSent;
    vm.successfulConversions = conversions;
    vm.conversionRate = invitesSent > 0 ? Math.round((conversions / invitesSent) * 10000) / 10000 : 0;
    vm.kFactor = Math.round(invitesSent * vm.conversionRate * 1000) / 1000;
    vm.viralCycleLengthDays = cycleLengthDays;
    // Effective viral coefficient adjusted for cycle length (monthly normalization)
    vm.viralCoefficient = Math.round(vm.kFactor * (30 / cycleLengthDays) * 1000) / 1000;
    vm.tier =
      vm.kFactor >= 1.5 ? 'super-viral' :
      vm.kFactor >= 1.0 ? 'viral' :
      vm.kFactor >= 0.5 ? 'sub-viral' : 'non-viral';
    vm.updatedAt = new Date();

    logger.info('Viral coefficient calculated', { userId, kFactor: vm.kFactor, viralCoefficient: vm.viralCoefficient, tier: vm.tier });
    return vm;
  }

  recordReferral(referrerId: string, inviteeConverted: boolean): void {
    const state = this.getOrCreateState(referrerId);
    state.viralMetrics.totalInvitesSent++;
    this.recordAction(referrerId, 'referral_sent');
    if (inviteeConverted) {
      state.viralMetrics.successfulConversions++;
      this.recordAction(referrerId, 'referral_converted');
    }
    this.calculateViralCoefficient(referrerId, state.viralMetrics.totalInvitesSent, state.viralMetrics.successfulConversions);
  }

  // ─── Social Proof ─────────────────────────────────────────────────────────

  getSocialProof(userId: string): {
    rank: number;
    percentile: number;
    trendingBadge: boolean;
    communityStats: { totalUsers: number; activeToday: number; avgEngagementScore: number };
    leaderboardPosition: number;
  } {
    const allUsers = Array.from(this.userStates.entries());
    const scores = allUsers.map(([uid]) => this.calculateEngagementScore(uid).score);
    const myScore = this.calculateEngagementScore(userId).score;

    const sorted = [...scores].sort((a, b) => b - a);
    const rank = sorted.indexOf(myScore) + 1;
    const percentile = allUsers.length > 1 ? Math.round(((allUsers.length - rank) / (allUsers.length - 1)) * 100) : 100;
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const now = new Date();
    const todayCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activeToday = allUsers.filter(([uid]) => {
      const s = this.calculateEngagementScore(uid);
      return s.lastActivityAt && s.lastActivityAt >= todayCutoff;
    }).length;

    return {
      rank,
      percentile,
      trendingBadge: percentile >= 90,
      communityStats: {
        totalUsers: allUsers.length,
        activeToday,
        avgEngagementScore: avgScore,
      },
      leaderboardPosition: rank,
    };
  }

  // ─── Bulk Operations ──────────────────────────────────────────────────────

  runDormancySweep(dormancyThresholdDays = 14): Array<{ userId: string; daysSinceLastActivity: number; triggers: ReEngagementTrigger[] }> {
    const results: Array<{ userId: string; daysSinceLastActivity: number; triggers: ReEngagementTrigger[] }> = [];
    for (const userId of this.userStates.keys()) {
      if (this.detectDormancy(userId, dormancyThresholdDays)) {
        const score = this.calculateEngagementScore(userId);
        const triggers = this.triggerReEngagement(userId);
        results.push({ userId, daysSinceLastActivity: score.daysSinceLastActivity, triggers });
      }
    }
    logger.info('Dormancy sweep complete', { dormantUsers: results.length });
    return results;
  }

  getUserEngagementSummary(userId: string): {
    score: EngagementScore;
    badges: Badge[];
    rewardPoints: RewardPoints;
    loyaltyTier: LoyaltyTier;
    streaks: Streak[];
    viralMetrics: ViralMetrics;
  } {
    const state = this.getOrCreateState(userId);
    return {
      score: this.calculateEngagementScore(userId),
      badges: state.badges,
      rewardPoints: state.rewardPoints,
      loyaltyTier: this.checkLoyaltyTier(userId),
      streaks: Array.from(state.streaks.values()),
      viralMetrics: state.viralMetrics,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getUserEngagementEngine(): UserEngagementEngine {
  if (!(globalThis as any).__userEngagementEngine__) {
    (globalThis as any).__userEngagementEngine__ = new UserEngagementEngine();
  }
  return (globalThis as any).__userEngagementEngine__;
}
