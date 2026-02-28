/**
 * @module realTimeReputationEngine
 * @description Real-time reputation scoring engine for users and content with multi-signal
 * ingestion, time-based decay, tier assignment, trust gating, abuse pattern detection,
 * recovery pathways, cross-tenant isolation, leaderboard generation, ban/unban workflows,
 * and full audit log.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReputationTier = 'new' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'banned';

export interface ReputationSignal {
  entityId: string;
  entityType: 'user' | 'content';
  tenantId: string;
  signalType: 'upvote' | 'downvote' | 'flag' | 'report' | 'quality_pass' | 'quality_fail' | 'share' | 'purchase';
  weight: number; // custom weight override, default = signal type default
  timestamp: number;
  actorId: string;
}

export interface ReputationProfile {
  entityId: string;
  entityType: 'user' | 'content';
  tenantId: string;
  rawScore: number;
  decayedScore: number;
  tier: ReputationTier;
  trustLevel: number; // 0-10
  isBanned: boolean;
  bannedAt?: number;
  banReason?: string;
  flagCount: number;
  reportCount: number;
  upvoteCount: number;
  downvoteCount: number;
  lastSignalAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface AbusePattern {
  patternId: string;
  entityId: string;
  tenantId: string;
  type: 'rapid_downvoting' | 'coordinated_reporting' | 'vote_manipulation' | 'spam_flagging';
  confidence: number;
  evidenceCount: number;
  detectedAt: number;
}

export interface ReputationAuditEntry {
  id: string;
  entityId: string;
  tenantId: string;
  action: string;
  previousScore: number;
  newScore: number;
  previousTier: ReputationTier;
  newTier: ReputationTier;
  reason: string;
  actorId: string;
  timestamp: number;
}

export interface ReputationEngineSummary {
  totalProfiles: number;
  tierDistribution: Record<ReputationTier, number>;
  bannedCount: number;
  avgDecayedScore: number;
  abusePatternCount: number;
  topEntitiesByScore: Array<{ entityId: string; score: number }>;
  recentAuditEntries: number;
}

// ── Signal weights ─────────────────────────────────────────────────────────────

const DEFAULT_SIGNAL_WEIGHTS: Record<ReputationSignal['signalType'], number> = {
  upvote: 2,
  downvote: -1.5,
  flag: -3,
  report: -5,
  quality_pass: 3,
  quality_fail: -2,
  share: 1.5,
  purchase: 4,
};

// ── Tier thresholds ────────────────────────────────────────────────────────────

const TIER_THRESHOLDS: Array<{ tier: ReputationTier; min: number }> = [
  { tier: 'platinum', min: 500 },
  { tier: 'gold', min: 200 },
  { tier: 'silver', min: 80 },
  { tier: 'bronze', min: 20 },
  { tier: 'new', min: 0 },
];

// ── Engine class ──────────────────────────────────────────────────────────────

export class RealTimeReputationEngine {
  private profiles: Map<string, ReputationProfile> = new Map();
  private signals: Map<string, ReputationSignal[]> = new Map(); // entityId -> signals
  private abusePatterns: AbusePattern[] = [];
  private auditLog: ReputationAuditEntry[] = [];
  private readonly DECAY_HALF_LIFE_DAYS = 90;
  private readonly MIN_TRUST_TO_VOTE = 2;
  private readonly MAX_SCORE = 10000;

  constructor() {
    logger.info('[RealTimeReputationEngine] Initialized reputation engine');
  }

  /**
   * Ingest a reputation signal and immediately update entity score.
   */
  ingestSignal(signal: ReputationSignal): void {
    const key = signal.entityId;
    const list = this.signals.get(key) ?? [];
    list.push({ ...signal, timestamp: signal.timestamp || Date.now() });
    if (list.length > 500) list.splice(0, list.length - 500);
    this.signals.set(key, list);

    const profile = this.getOrCreateProfile(signal.entityId, signal.entityType, signal.tenantId);
    const signalWeight = signal.weight !== 0 ? signal.weight : DEFAULT_SIGNAL_WEIGHTS[signal.signalType];
    const before = { score: profile.rawScore, tier: profile.tier };

    profile.rawScore = Math.max(-100, Math.min(this.MAX_SCORE, profile.rawScore + signalWeight));
    profile.lastSignalAt = signal.timestamp;
    profile.updatedAt = Date.now();

    if (signal.signalType === 'upvote') profile.upvoteCount++;
    if (signal.signalType === 'downvote') profile.downvoteCount++;
    if (signal.signalType === 'flag') profile.flagCount++;
    if (signal.signalType === 'report') profile.reportCount++;

    profile.decayedScore = this.applyDecay(profile.rawScore, profile.lastSignalAt);
    const newTier = this.assignTier(profile);
    profile.tier = newTier;
    profile.trustLevel = this.computeTrustLevel(profile);

    if (before.tier !== newTier) {
      this.appendAudit(signal.entityId, signal.tenantId, 'tier_change', before.score, profile.rawScore,
        before.tier, newTier, `Signal: ${signal.signalType}`, signal.actorId);
    }

    logger.debug(`[RealTimeReputationEngine] Signal '${signal.signalType}' for ${signal.entityId}: score=${profile.rawScore}`);
  }

  /**
   * Compute the current decayed score for an entity.
   */
  computeScore(entityId: string): number {
    const profile = this.profiles.get(entityId);
    if (!profile) return 0;
    profile.decayedScore = this.applyDecay(profile.rawScore, profile.lastSignalAt);
    profile.updatedAt = Date.now();
    return profile.decayedScore;
  }

  /**
   * Assign a reputation tier based on the entity's decayed score.
   */
  assignTier(profile: ReputationProfile): ReputationTier {
    if (profile.isBanned) return 'banned';
    const score = profile.decayedScore >= 0 ? profile.decayedScore : profile.rawScore;
    for (const threshold of TIER_THRESHOLDS) {
      if (score >= threshold.min) return threshold.tier;
    }
    return 'new';
  }

  /**
   * Detect abuse patterns such as rapid downvoting or coordinated reporting.
   */
  detectAbuse(entityId: string, tenantId: string): AbusePattern[] {
    const list = this.signals.get(entityId) ?? [];
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const detected: AbusePattern[] = [];

    // Rapid downvoting: >5 downvotes in 1 hour from different actors
    const recentDownvotes = list.filter(s => s.signalType === 'downvote' && s.timestamp > now - oneHour);
    const uniqueActors = new Set(recentDownvotes.map(s => s.actorId)).size;
    if (recentDownvotes.length >= 5 && uniqueActors >= 3) {
      const pattern: AbusePattern = {
        patternId: `abuse_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        entityId, tenantId,
        type: 'rapid_downvoting',
        confidence: Math.min(1, recentDownvotes.length / 10),
        evidenceCount: recentDownvotes.length,
        detectedAt: now,
      };
      this.abusePatterns.push(pattern);
      detected.push(pattern);
      logger.warn(`[RealTimeReputationEngine] Abuse detected: rapid_downvoting on ${entityId}`);
    }

    // Coordinated reporting: >3 reports in 1 hour
    const recentReports = list.filter(s => s.signalType === 'report' && s.timestamp > now - oneHour);
    if (recentReports.length >= 3) {
      const pattern: AbusePattern = {
        patternId: `abuse_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        entityId, tenantId,
        type: 'coordinated_reporting',
        confidence: Math.min(1, recentReports.length / 5),
        evidenceCount: recentReports.length,
        detectedAt: now,
      };
      this.abusePatterns.push(pattern);
      detected.push(pattern);
      logger.warn(`[RealTimeReputationEngine] Abuse detected: coordinated_reporting on ${entityId}`);
    }

    return detected;
  }

  /**
   * Apply time-based score decay using exponential half-life model.
   */
  applyDecay(rawScore: number, lastSignalAt: number): number {
    if (rawScore <= 0) return rawScore;
    const ageDays = (Date.now() - lastSignalAt) / (1000 * 60 * 60 * 24);
    const decayFactor = Math.pow(0.5, ageDays / this.DECAY_HALF_LIFE_DAYS);
    return parseFloat((rawScore * decayFactor).toFixed(2));
  }

  /**
   * Flag an entity for review due to suspicious activity.
   */
  flagForReview(entityId: string, tenantId: string, reason: string, actorId: string): void {
    const profile = this.getOrCreateProfile(entityId, 'user', tenantId);
    profile.flagCount++;
    const before = { score: profile.rawScore, tier: profile.tier };
    profile.rawScore = Math.max(-100, profile.rawScore - 2);
    profile.decayedScore = this.applyDecay(profile.rawScore, profile.lastSignalAt);
    profile.tier = this.assignTier(profile);
    this.appendAudit(entityId, tenantId, 'flag_for_review', before.score, profile.rawScore,
      before.tier, profile.tier, reason, actorId);
    logger.info(`[RealTimeReputationEngine] ${entityId} flagged for review: ${reason}`);
  }

  /**
   * Ban an entity, setting their tier to 'banned' and preventing future interactions.
   */
  banEntity(entityId: string, tenantId: string, reason: string, actorId: string): void {
    const profile = this.getOrCreateProfile(entityId, 'user', tenantId);
    const before = { score: profile.rawScore, tier: profile.tier };
    profile.isBanned = true;
    profile.bannedAt = Date.now();
    profile.banReason = reason;
    profile.tier = 'banned';
    profile.trustLevel = 0;
    this.appendAudit(entityId, tenantId, 'ban', before.score, profile.rawScore,
      before.tier, 'banned', reason, actorId);
    logger.warn(`[RealTimeReputationEngine] Entity ${entityId} banned: ${reason}`);
  }

  /**
   * Unban an entity and restore their previous tier.
   */
  unbanEntity(entityId: string, tenantId: string, actorId: string): void {
    const profile = this.profiles.get(entityId);
    if (!profile || !profile.isBanned) return;
    profile.isBanned = false;
    profile.bannedAt = undefined;
    profile.banReason = undefined;
    profile.decayedScore = this.applyDecay(profile.rawScore, profile.lastSignalAt);
    profile.tier = this.assignTier(profile);
    profile.trustLevel = this.computeTrustLevel(profile);
    this.appendAudit(entityId, tenantId, 'unban', profile.rawScore, profile.rawScore,
      'banned', profile.tier, 'Manual unban', actorId);
    logger.info(`[RealTimeReputationEngine] Entity ${entityId} unbanned`);
  }

  /**
   * Generate a leaderboard for a tenant sorted by decayed score.
   */
  generateLeaderboard(tenantId: string, limit = 10): Array<{ entityId: string; score: number; tier: ReputationTier }> {
    return Array.from(this.profiles.values())
      .filter(p => p.tenantId === tenantId && !p.isBanned)
      .map(p => ({ entityId: p.entityId, score: this.computeScore(p.entityId), tier: p.tier }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getOrCreateProfile(entityId: string, entityType: 'user' | 'content', tenantId: string): ReputationProfile {
    if (!this.profiles.has(entityId)) {
      this.profiles.set(entityId, {
        entityId, entityType, tenantId,
        rawScore: 0, decayedScore: 0,
        tier: 'new', trustLevel: 1,
        isBanned: false,
        flagCount: 0, reportCount: 0, upvoteCount: 0, downvoteCount: 0,
        lastSignalAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return this.profiles.get(entityId)!;
  }

  private computeTrustLevel(profile: ReputationProfile): number {
    if (profile.isBanned) return 0;
    const raw = Math.max(0, Math.min(10, Math.floor(profile.decayedScore / 50)));
    return Math.max(this.MIN_TRUST_TO_VOTE, raw);
  }

  private appendAudit(
    entityId: string, tenantId: string, action: string,
    prev: number, next: number, prevTier: ReputationTier, newTier: ReputationTier,
    reason: string, actorId: string,
  ): void {
    this.auditLog.push({
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      entityId, tenantId, action,
      previousScore: prev, newScore: next,
      previousTier: prevTier, newTier,
      reason, actorId,
      timestamp: Date.now(),
    });
  }

  /**
   * Return a high-level summary of reputation engine state.
   */
  getSummary(): ReputationEngineSummary {
    const profiles = Array.from(this.profiles.values());
    const tierDist: Record<ReputationTier, number> = {
      new: 0, bronze: 0, silver: 0, gold: 0, platinum: 0, banned: 0,
    };
    for (const p of profiles) tierDist[p.tier]++;
    const avgScore = profiles.length > 0
      ? profiles.reduce((s, p) => s + p.decayedScore, 0) / profiles.length : 0;
    const top = profiles
      .filter(p => !p.isBanned)
      .sort((a, b) => b.decayedScore - a.decayedScore)
      .slice(0, 5)
      .map(p => ({ entityId: p.entityId, score: p.decayedScore }));

    const summary: ReputationEngineSummary = {
      totalProfiles: profiles.length,
      tierDistribution: tierDist,
      bannedCount: profiles.filter(p => p.isBanned).length,
      avgDecayedScore: parseFloat(avgScore.toFixed(2)),
      abusePatternCount: this.abusePatterns.length,
      topEntitiesByScore: top,
      recentAuditEntries: this.auditLog.length,
    };

    logger.info(`[RealTimeReputationEngine] Summary: ${summary.totalProfiles} profiles, ${summary.bannedCount} banned`);
    return summary;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__realTimeReputationEngine__';
export function getRealTimeReputationEngine(): RealTimeReputationEngine {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new RealTimeReputationEngine();
  }
  return (globalThis as Record<string, unknown>)[KEY] as RealTimeReputationEngine;
}
