/**
 * @module realtimePersonalizationEngine
 * @description Real-time user personalization engine with edge-optimized delivery.
 * Implements hybrid collaborative + content-based filtering, LRU profile cache
 * (max 10 000 entries), rule-priority evaluation with short-circuit, and
 * contextual-bandit exploration/exploitation balance for content ranking.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface UserPreferences {
  contentTypes: string[];
  topics: string[];
  updateFrequency: 'realtime' | 'hourly' | 'daily';
  notificationChannels: string[];
  language: string;
  timezone: string;
}

export interface UserProfile {
  userId: string;
  features: Record<string, number>;
  segments: string[];
  preferences: UserPreferences;
  activityScore: number;
  tier: 'free' | 'pro' | 'enterprise';
  lastSeen: number;
}

export interface DeviceContext {
  type: 'mobile' | 'tablet' | 'desktop';
  os: string;
  browser: string;
  screenWidth: number;
  connectionType: string;
}

export interface LocationContext {
  country: string;
  region: string;
  city: string;
  timezone: string;
  language: string;
}

export interface PersonalizationContext {
  userId: string;
  sessionId: string;
  device: DeviceContext;
  location: LocationContext;
  timestamp: number;
  pageContext: string;
}

export interface PersonalizationResult {
  userId: string;
  contentIds: string[];
  scores: Record<string, number>;
  explanation: string[];
  appliedRules: string[];
  servedAt: number;
  ttl: number;
}

export interface RuleCondition {
  type: 'segment' | 'feature' | 'time' | 'device' | 'location' | 'behavior';
  operator: string;
  value: unknown;
}

export interface RuleAction {
  type: 'boost' | 'bury' | 'filter' | 'inject';
  contentIds?: string[];
  factor?: number;
}

export interface PersonalizationRule {
  id: string;
  name: string;
  condition: RuleCondition;
  action: RuleAction;
  priority: number;
  enabled: boolean;
}

export interface PersonalizationMetrics {
  totalRequests: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  rulesApplied: number;
  conversionLift: number;
}

// ── LRU Cache ─────────────────────────────────────────────────────────────────

class LRUCache<V> {
  private readonly capacity: number;
  private map: Map<string, V> = new Map();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  size(): number {
    return this.map.size;
  }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface BanditArm {
  contentId: string;
  successes: number;
  trials: number;
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class RealtimePersonalizationEngine {
  private profileCache: LRUCache<UserProfile> = new LRUCache(10_000);
  private rules: PersonalizationRule[] = [];
  private banditArms: Map<string, BanditArm> = new Map();
  private interactionMatrix: Map<string, Map<string, number>> = new Map();
  private contentFeatures: Map<string, Record<string, number>> = new Map();
  private metrics: PersonalizationMetrics = {
    totalRequests: 0,
    cacheHitRate: 0,
    avgLatencyMs: 0,
    rulesApplied: 0,
    conversionLift: 0,
  };
  private cacheHits = 0;
  private latencyHistory: number[] = [];

  updateProfile(userId: string, signals: Partial<UserProfile>): UserProfile {
    const existing = this.getOrCreateProfile(userId);
    const updated: UserProfile = {
      ...existing,
      ...signals,
      userId,
      lastSeen: Date.now(),
      features: { ...existing.features, ...(signals.features ?? {}) },
    };
    // Decay activity score over time (half-life 7 days)
    const daysSinceLastSeen = (Date.now() - existing.lastSeen) / 86_400_000;
    updated.activityScore = existing.activityScore * Math.pow(0.5, daysSinceLastSeen / 7);
    if (signals.activityScore !== undefined) {
      updated.activityScore = Math.min(1, updated.activityScore + signals.activityScore * 0.1);
    }
    this.profileCache.set(userId, updated);
    logger.debug('Profile updated', { userId, activityScore: updated.activityScore });
    return updated;
  }

  getRecommendations(context: PersonalizationContext): PersonalizationResult {
    const start = Date.now();
    this.metrics.totalRequests++;

    const cached = this.profileCache.get(context.userId);
    if (cached) this.cacheHits++;
    this.metrics.cacheHitRate = this.metrics.totalRequests > 0
      ? this.cacheHits / this.metrics.totalRequests
      : 0;

    const profile = this.getOrCreateProfile(context.userId);
    const candidates = this.generateCandidates(profile, context);
    const result = this.applyRules(profile, context, candidates);

    const latencyMs = Date.now() - start;
    this.latencyHistory.push(latencyMs);
    if (this.latencyHistory.length > 1000) this.latencyHistory.shift();
    this.metrics.avgLatencyMs = this.latencyHistory.reduce((s, v) => s + v, 0) / this.latencyHistory.length;

    logger.debug('Recommendations generated', { userId: context.userId, count: result.contentIds.length, latencyMs });
    return result;
  }

  applyRules(
    profile: UserProfile,
    context: PersonalizationContext,
    candidates: string[],
  ): PersonalizationResult {
    const scores: Record<string, number> = {};
    const collab = this.applyCollaborativeFiltering(profile.userId, candidates);
    const content = this.applyContentFiltering(profile, candidates);
    candidates.forEach((id) => {
      scores[id] = 0.5 * (collab[id] ?? 0) + 0.5 * (content[id] ?? 0);
    });

    const appliedRules: string[] = [];
    const explanation: string[] = [];

    // Sort rules by priority desc, apply with short-circuit for filter
    const sorted = this.rules
      .filter((r) => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sorted) {
      if (!this.evaluateCondition(rule.condition, profile, context)) continue;
      appliedRules.push(rule.id);
      this.metrics.rulesApplied++;

      switch (rule.action.type) {
        case 'boost':
          (rule.action.contentIds ?? []).forEach((id) => {
            scores[id] = (scores[id] ?? 0) * (rule.action.factor ?? 2.0);
          });
          explanation.push(`Rule "${rule.name}" boosted ${rule.action.contentIds?.length ?? 0} items`);
          break;
        case 'bury':
          (rule.action.contentIds ?? []).forEach((id) => {
            scores[id] = (scores[id] ?? 0) * (rule.action.factor ?? 0.1);
          });
          explanation.push(`Rule "${rule.name}" buried ${rule.action.contentIds?.length ?? 0} items`);
          break;
        case 'filter':
          const allowed = new Set(rule.action.contentIds ?? []);
          Object.keys(scores).forEach((id) => { if (!allowed.has(id)) delete scores[id]; });
          explanation.push(`Rule "${rule.name}" filtered candidates to ${allowed.size} items`);
          break;
        case 'inject':
          (rule.action.contentIds ?? []).forEach((id) => { scores[id] = 1.0; });
          explanation.push(`Rule "${rule.name}" injected ${rule.action.contentIds?.length ?? 0} items`);
          break;
      }
    }

    const ranked = this.rankCandidates(profile, Object.keys(scores));
    ranked.forEach(({ id, score }) => { scores[id] = score; });

    const contentIds = ranked.map((r) => r.id);
    return {
      userId: profile.userId,
      contentIds,
      scores,
      explanation,
      appliedRules,
      servedAt: Date.now(),
      ttl: profile.preferences.updateFrequency === 'realtime' ? 60 : profile.preferences.updateFrequency === 'hourly' ? 3600 : 86400,
    };
  }

  computeRelevanceScore(profile: UserProfile, contentId: string): number {
    const feats = this.contentFeatures.get(contentId) ?? {};
    let score = 0;
    let totalWeight = 0;
    for (const [key, val] of Object.entries(feats)) {
      const profileVal = profile.features[key] ?? 0;
      score += profileVal * val;
      totalWeight += Math.abs(val);
    }
    const topicBoost = profile.preferences.topics.some((t) => contentId.toLowerCase().includes(t.toLowerCase())) ? 0.2 : 0;
    return totalWeight > 0 ? Math.min(1, score / totalWeight + topicBoost) : topicBoost;
  }

  getOrCreateProfile(userId: string): UserProfile {
    const cached = this.profileCache.get(userId);
    if (cached) return cached;
    const profile: UserProfile = {
      userId,
      features: {},
      segments: ['new_user'],
      preferences: {
        contentTypes: ['article', 'video'],
        topics: [],
        updateFrequency: 'hourly',
        notificationChannels: ['email'],
        language: 'en',
        timezone: 'UTC',
      },
      activityScore: 0.1,
      tier: 'free',
      lastSeen: Date.now(),
    };
    this.profileCache.set(userId, profile);
    return profile;
  }

  addRule(rule: PersonalizationRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
    logger.info('Personalization rule added', { ruleId: rule.id, priority: rule.priority });
  }

  removeRule(ruleId: string): void {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== ruleId);
    logger.info('Rule removed', { ruleId, removed: before - this.rules.length });
  }

  batchPersonalize(
    userIds: string[],
    context: Omit<PersonalizationContext, 'userId'>,
  ): Map<string, PersonalizationResult> {
    const results = new Map<string, PersonalizationResult>();
    for (const userId of userIds) {
      results.set(userId, this.getRecommendations({ ...context, userId }));
    }
    return results;
  }

  invalidateCache(userId: string): void {
    this.profileCache.delete(userId);
    logger.debug('Cache invalidated', { userId });
  }

  getMetrics(): PersonalizationMetrics {
    return { ...this.metrics };
  }

  private rankCandidates(
    profile: UserProfile,
    candidates: string[],
  ): Array<{ id: string; score: number }> {
    return candidates
      .map((id) => {
        const relevance = this.computeRelevanceScore(profile, id);
        // Thompson sampling for exploration/exploitation
        const arm = this.getOrCreateArm(id);
        const alpha = arm.successes + 1;
        const beta = arm.trials - arm.successes + 1;
        const exploration = this.betaSample(alpha, beta);
        const score = 0.7 * relevance + 0.3 * exploration;
        return { id, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  private applyCollaborativeFiltering(userId: string, candidates: string[]): Record<string, number> {
    const userInteractions = this.interactionMatrix.get(userId) ?? new Map<string, number>();
    const scores: Record<string, number> = {};
    for (const candidateId of candidates) {
      // Find similar users who interacted with this content
      let simSum = 0;
      let weightSum = 0;
      for (const [otherId, otherInteractions] of this.interactionMatrix.entries()) {
        if (otherId === userId) continue;
        const otherScore = otherInteractions.get(candidateId) ?? 0;
        if (otherScore === 0) continue;
        // Cosine similarity between user interaction vectors
        const sim = this.cosineSimilarity(userInteractions, otherInteractions);
        simSum += sim * otherScore;
        weightSum += Math.abs(sim);
      }
      scores[candidateId] = weightSum > 0 ? Math.min(1, simSum / weightSum) : 0;
    }
    return scores;
  }

  private applyContentFiltering(
    profile: UserProfile,
    candidates: string[],
  ): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const id of candidates) {
      scores[id] = this.computeRelevanceScore(profile, id);
    }
    return scores;
  }

  private evaluateCondition(
    condition: RuleCondition,
    profile: UserProfile,
    context: PersonalizationContext,
  ): boolean {
    switch (condition.type) {
      case 'segment':
        return profile.segments.includes(condition.value as string);
      case 'feature': {
        const [feat, threshold] = (condition.value as string).split(':');
        const val = profile.features[feat] ?? 0;
        return condition.operator === '>=' ? val >= parseFloat(threshold) : val <= parseFloat(threshold);
      }
      case 'device':
        return context.device.type === condition.value;
      case 'location':
        return context.location.country === condition.value;
      case 'time': {
        const hour = new Date(context.timestamp).getUTCHours();
        const [from, to] = (condition.value as string).split('-').map(Number);
        return hour >= from && hour < to;
      }
      case 'behavior':
        return profile.activityScore >= (condition.value as number);
      default:
        return false;
    }
  }

  private generateCandidates(profile: UserProfile, context: PersonalizationContext): string[] {
    const base = Array.from(this.contentFeatures.keys());
    if (base.length > 0) return base.slice(0, 100);
    // Generate topic-scoped synthetic candidates; use context page as an additional signal
    const contextBoost = context.pageContext ? [context.pageContext] : [];
    const topics = [...contextBoost, ...profile.preferences.topics];
    return topics.flatMap((t, i) =>
      Array.from({ length: 5 }, (_, j) => `content_${t}_${i}_${j}`),
    );
  }

  private cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const [key, val] of a.entries()) {
      dot += val * (b.get(key) ?? 0);
      normA += val * val;
    }
    for (const val of b.values()) normB += val * val;
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private getOrCreateArm(contentId: string): BanditArm {
    if (!this.banditArms.has(contentId)) {
      this.banditArms.set(contentId, { contentId, successes: 1, trials: 2 });
    }
    return this.banditArms.get(contentId)!;
  }

  // Approximation of Beta distribution sample via Johnk's method
  private betaSample(alpha: number, beta: number): number {
    const u = Math.random();
    const v = Math.random();
    const x = Math.pow(u, 1 / alpha);
    const y = Math.pow(v, 1 / beta);
    return x + y > 0 ? x / (x + y) : 0.5;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__realtimePersonalizationEngine__';

export function getRealtimePersonalizationEngine(): RealtimePersonalizationEngine {
  const g = globalThis as unknown as Record<string, RealtimePersonalizationEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new RealtimePersonalizationEngine();
    logger.info('RealtimePersonalizationEngine singleton initialised');
  }
  return g[GLOBAL_KEY];
}

export default getRealtimePersonalizationEngine;
