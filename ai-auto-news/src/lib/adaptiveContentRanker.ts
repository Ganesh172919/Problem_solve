/**
 * @module adaptiveContentRanker
 * @description Adaptive content ranking engine using multi-armed bandit algorithms,
 * collaborative filtering, recency decay, quality scoring, and personalized
 * ranking models per user segment for maximum engagement and retention.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type RankingAlgorithm = 'ucb1' | 'thompson_sampling' | 'epsilon_greedy' | 'hybrid' | 'collaborative';
export type ContentType = 'article' | 'video' | 'podcast' | 'newsletter' | 'report' | 'alert';

export interface ContentItem {
  id: string;
  type: ContentType;
  title: string;
  topics: string[];
  author: string;
  publishedAt: number;
  estimatedReadMinutes: number;
  qualityScore: number; // 0-1 editorial quality
  tenantId: string;
  metadata: Record<string, unknown>;
}

export interface UserProfile {
  userId: string;
  tenantId: string;
  segment: string;
  topicPreferences: Map<string, number>; // topic -> affinity score
  authorPreferences: Map<string, number>;
  typePreferences: Map<ContentType, number>;
  avgSessionMinutes: number;
  lastActiveAt: number;
  interactionHistory: string[]; // content ids, most recent last
}

export interface ContentEngagement {
  contentId: string;
  userId: string;
  impressions: number;
  clicks: number;
  completionRate: number; // 0-1
  shares: number;
  saves: number;
  reactions: number;
  dwellTimeMs: number;
  timestamp: number;
}

export interface BanditArm {
  contentId: string;
  pulls: number;          // times shown
  rewards: number;        // sum of engagement scores
  lastPulledAt: number;
  contextualFeatures: number[];
}

export interface RankedContent {
  contentId: string;
  rank: number;
  score: number;
  algorithm: RankingAlgorithm;
  factors: Record<string, number>;
  confidence: number;
  servedAt: number;
}

// ── Scoring Functions ─────────────────────────────────────────────────────────

function recencyDecay(publishedAt: number, halfLifeHours = 24): number {
  const ageHours = (Date.now() - publishedAt) / 3600_000;
  return Math.pow(0.5, ageHours / halfLifeHours);
}

function computeEngagementScore(engagement: ContentEngagement): number {
  const ctr = engagement.impressions > 0 ? engagement.clicks / engagement.impressions : 0;
  const completion = engagement.completionRate;
  const shareScore = Math.min(1, engagement.shares * 0.1);
  const saveScore = Math.min(1, engagement.saves * 0.15);
  return ctr * 0.3 + completion * 0.35 + shareScore * 0.15 + saveScore * 0.2;
}

function computePersonalizationScore(content: ContentItem, user: UserProfile): number {
  let score = 0;
  let weight = 0;

  // Topic affinity
  for (const topic of content.topics) {
    const affinity = user.topicPreferences.get(topic) ?? 0;
    score += affinity * 0.4;
    weight += 0.4;
  }

  // Author affinity
  const authorAffinity = user.authorPreferences.get(content.author) ?? 0;
  score += authorAffinity * 0.2;
  weight += 0.2;

  // Type preference
  const typeAffinity = user.typePreferences.get(content.type) ?? 0.5;
  score += typeAffinity * 0.2;
  weight += 0.2;

  // Read time compatibility
  const readTimeScore = user.avgSessionMinutes > 0
    ? Math.max(0, 1 - Math.abs(content.estimatedReadMinutes - user.avgSessionMinutes) / user.avgSessionMinutes)
    : 0.5;
  score += readTimeScore * 0.2;
  weight += 0.2;

  return weight > 0 ? score / weight : 0.5;
}

// ── Multi-Armed Bandit ────────────────────────────────────────────────────────

class UCB1Bandit {
  private arms = new Map<string, BanditArm>();
  private totalPulls = 0;

  addArm(contentId: string): void {
    if (!this.arms.has(contentId)) {
      this.arms.set(contentId, {
        contentId,
        pulls: 0,
        rewards: 0,
        lastPulledAt: 0,
        contextualFeatures: [],
      });
    }
  }

  score(contentId: string): number {
    const arm = this.arms.get(contentId);
    if (!arm || arm.pulls === 0) return Infinity; // Force exploration

    const avgReward = arm.rewards / arm.pulls;
    const exploration = Math.sqrt((2 * Math.log(this.totalPulls + 1)) / arm.pulls);
    return avgReward + exploration;
  }

  update(contentId: string, reward: number): void {
    const arm = this.arms.get(contentId);
    if (!arm) return;
    arm.pulls++;
    arm.rewards += reward;
    arm.lastPulledAt = Date.now();
    this.totalPulls++;
  }

  getArm(contentId: string): BanditArm | undefined {
    return this.arms.get(contentId);
  }
}

class ThompsonSamplingBandit {
  private alphas = new Map<string, number>();
  private betas = new Map<string, number>();

  addArm(contentId: string): void {
    if (!this.alphas.has(contentId)) {
      this.alphas.set(contentId, 1);
      this.betas.set(contentId, 1);
    }
  }

  score(contentId: string): number {
    const alpha = this.alphas.get(contentId) ?? 1;
    const beta = this.betas.get(contentId) ?? 1;
    // Sample from Beta distribution using approximation
    return this.betaSample(alpha, beta);
  }

  update(contentId: string, reward: number): void {
    const success = reward > 0.5 ? 1 : 0;
    this.alphas.set(contentId, (this.alphas.get(contentId) ?? 1) + success);
    this.betas.set(contentId, (this.betas.get(contentId) ?? 1) + (1 - success));
  }

  private betaSample(alpha: number, beta: number): number {
    // Approximation: use mean + noise for Beta(alpha, beta)
    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const noise = (Math.random() - 0.5) * Math.sqrt(variance) * 2;
    return Math.max(0, Math.min(1, mean + noise));
  }
}

// ── Core Ranker ───────────────────────────────────────────────────────────────

export class AdaptiveContentRanker {
  private contents = new Map<string, ContentItem>();
  private engagements = new Map<string, ContentEngagement>();
  private userBandits = new Map<string, UCB1Bandit>();
  private globalBandit = new UCB1Bandit();
  private thompsonBandit = new ThompsonSamplingBandit();
  private rankingHistory = new Map<string, RankedContent[]>(); // userId -> last rankings
  private totalRankings = 0;
  private algorithm: RankingAlgorithm = 'hybrid';

  setAlgorithm(algorithm: RankingAlgorithm): void {
    this.algorithm = algorithm;
    logger.info('Ranking algorithm updated', { algorithm });
  }

  indexContent(content: ContentItem): void {
    this.contents.set(content.id, content);
    this.globalBandit.addArm(content.id);
    this.thompsonBandit.addArm(content.id);
  }

  recordEngagement(engagement: ContentEngagement): void {
    this.engagements.set(`${engagement.userId}:${engagement.contentId}`, engagement);

    const reward = computeEngagementScore(engagement);
    this.globalBandit.update(engagement.contentId, reward);
    this.thompsonBandit.update(engagement.contentId, reward);

    const userBandit = this.userBandits.get(engagement.userId);
    if (userBandit) userBandit.update(engagement.contentId, reward);

    logger.debug('Engagement recorded', {
      userId: engagement.userId,
      contentId: engagement.contentId,
      reward: reward.toFixed(3),
    });
  }

  rank(
    candidateIds: string[],
    user: UserProfile,
    topK = 20
  ): RankedContent[] {
    this.totalRankings++;

    // Ensure user has a bandit
    if (!this.userBandits.has(user.userId)) {
      const bandit = new UCB1Bandit();
      for (const id of candidateIds) bandit.addArm(id);
      this.userBandits.set(user.userId, bandit);
    }
    const userBandit = this.userBandits.get(user.userId)!;
    for (const id of candidateIds) userBandit.addArm(id);
    this.globalBandit.addArm.bind(this.globalBandit);
    for (const id of candidateIds) {
      this.globalBandit.addArm(id);
      this.thompsonBandit.addArm(id);
    }

    const scored = candidateIds.map(id => {
      const content = this.contents.get(id);
      if (!content) return { id, score: 0, factors: {} as Record<string, number> };

      const factors: Record<string, number> = {};

      // Quality & recency
      factors.quality = content.qualityScore;
      factors.recency = recencyDecay(content.publishedAt);

      // Personalization
      factors.personalization = computePersonalizationScore(content, user);

      // Bandit scores
      factors.ucb1 = isFinite(this.globalBandit.score(id)) ? Math.min(1, this.globalBandit.score(id)) : 1;
      factors.thompson = this.thompsonBandit.score(id);
      factors.userBandit = isFinite(userBandit.score(id)) ? Math.min(1, userBandit.score(id)) : 1;

      // Diversity penalty (avoid too many same-topic items)
      const alreadyRanked = (this.rankingHistory.get(user.userId) ?? []).slice(-10);
      const topicOverlap = alreadyRanked.filter(r => {
        const prev = this.contents.get(r.contentId);
        return prev && content.topics.some(t => prev.topics.includes(t));
      }).length;
      factors.diversity = Math.max(0, 1 - topicOverlap * 0.15);

      // Novelty: not seen recently
      const recentlySeen = user.interactionHistory.slice(-50).includes(id);
      factors.novelty = recentlySeen ? 0.1 : 1.0;

      let score: number;
      switch (this.algorithm) {
        case 'ucb1':
          score = factors.ucb1 * 0.5 + factors.quality * 0.3 + factors.recency * 0.2;
          break;
        case 'thompson_sampling':
          score = factors.thompson * 0.5 + factors.quality * 0.3 + factors.recency * 0.2;
          break;
        case 'epsilon_greedy':
          score = Math.random() < 0.1
            ? Math.random()
            : factors.quality * 0.5 + factors.recency * 0.3 + factors.personalization * 0.2;
          break;
        case 'collaborative':
          score = factors.personalization * 0.5 + factors.ucb1 * 0.3 + factors.diversity * 0.2;
          break;
        case 'hybrid':
        default:
          score = factors.quality * 0.25 +
                  factors.recency * 0.15 +
                  factors.personalization * 0.25 +
                  factors.ucb1 * 0.1 +
                  factors.thompson * 0.1 +
                  factors.diversity * 0.1 +
                  factors.novelty * 0.05;
          break;
      }

      return { id, score, factors };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    const results: RankedContent[] = top.map((item, i) => ({
      contentId: item.id,
      rank: i + 1,
      score: Math.round(item.score * 10000) / 10000,
      algorithm: this.algorithm,
      factors: item.factors,
      confidence: Math.min(1, (this.globalBandit.getArm(item.id)?.pulls ?? 0) / 50),
      servedAt: Date.now(),
    }));

    // Update ranking history
    const history = this.rankingHistory.get(user.userId) ?? [];
    history.push(...results.slice(0, 5));
    if (history.length > 100) history.splice(0, history.length - 100);
    this.rankingHistory.set(user.userId, history);

    return results;
  }

  getContentStats(contentId: string): {
    content: ContentItem | undefined;
    totalEngagements: number;
    avgRewardScore: number;
    impressions: number;
  } {
    const content = this.contents.get(contentId);
    const arm = this.globalBandit.getArm(contentId);
    const engagementEntries = Array.from(this.engagements.entries())
      .filter(([k]) => k.endsWith(`:${contentId}`));

    const totalImpressions = engagementEntries.reduce((s, [, e]) => s + e.impressions, 0);

    return {
      content,
      totalEngagements: engagementEntries.length,
      avgRewardScore: arm && arm.pulls > 0 ? arm.rewards / arm.pulls : 0,
      impressions: totalImpressions,
    };
  }

  getStats(): {
    totalRankings: number;
    indexedContent: number;
    trackedUsers: number;
    algorithm: RankingAlgorithm;
  } {
    return {
      totalRankings: this.totalRankings,
      indexedContent: this.contents.size,
      trackedUsers: this.userBandits.size,
      algorithm: this.algorithm,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __adaptiveContentRanker__: AdaptiveContentRanker | undefined;
}

export function getContentRanker(): AdaptiveContentRanker {
  if (!globalThis.__adaptiveContentRanker__) {
    globalThis.__adaptiveContentRanker__ = new AdaptiveContentRanker();
  }
  return globalThis.__adaptiveContentRanker__;
}
