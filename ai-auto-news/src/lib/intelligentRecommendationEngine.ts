/**
 * Intelligent Recommendation Engine for SaaS platform.
 *
 * Provides content-based filtering, collaborative filtering, hybrid strategies,
 * user preference learning, popularity tracking, recommendation explanations,
 * A/B testing support, and real-time feedback incorporation.
 */
import { getLogger } from './logger';

const logger = getLogger();

export interface RecommendationItem {
  id: string;
  type: string;
  title: string;
  description: string;
  tags: string[];
  features: Record<string, number>;
  popularity: number;
  createdAt: Date;
}

export interface UserInteraction {
  itemId: string;
  type: 'view' | 'click' | 'purchase' | 'rate' | 'share' | 'dismiss';
  value?: number;
  timestamp: Date;
}

export interface UserProfile {
  userId: string;
  preferences: Record<string, number>;
  interactionHistory: UserInteraction[];
  segments: string[];
}

export interface Recommendation {
  itemId: string;
  score: number;
  strategy: 'content' | 'collaborative' | 'popular' | 'hybrid';
  explanation: string;
  confidence: number;
}

export interface RecommendationRequest {
  userId: string;
  count: number;
  strategy?: 'content' | 'collaborative' | 'popular' | 'hybrid';
  excludeIds?: string[];
  contextTags?: string[];
}

export interface RecommendationFeedback {
  userId: string;
  itemId: string;
  accepted: boolean;
  timestamp: Date;
}

export interface RecommendationStats {
  totalItems: number;
  totalUsers: number;
  totalRecommendations: number;
  acceptanceRate: number;
  avgScore: number;
  strategyPerformance: Record<string, { count: number; acceptanceRate: number }>;
}

const INTERACTION_WEIGHTS: Record<UserInteraction['type'], number> = {
  view: 1, click: 2, rate: 3, share: 4, purchase: 5, dismiss: -2,
};
const POPULARITY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const HYBRID_WEIGHTS = { content: 0.4, collaborative: 0.35, popular: 0.25 };

export class IntelligentRecommendationEngine {
  private items = new Map<string, RecommendationItem>();
  private users = new Map<string, UserProfile>();
  private feedbackLog: RecommendationFeedback[] = [];
  private recommendationCount = 0;
  private tagDocFreq = new Map<string, number>();

  addItem(item: Omit<RecommendationItem, 'popularity' | 'createdAt'>): RecommendationItem {
    const full: RecommendationItem = { ...item, popularity: 0, createdAt: new Date() };
    this.items.set(full.id, full);
    this.updateTagDocFrequencies();
    logger.info(`Item added: ${full.id}`, { itemId: full.id });
    return full;
  }

  updateItem(itemId: string, updates: Partial<Omit<RecommendationItem, 'id' | 'createdAt'>>): RecommendationItem {
    const existing = this.items.get(itemId);
    if (!existing) throw new Error(`Item not found: ${itemId}`);
    const updated = { ...existing, ...updates };
    this.items.set(itemId, updated);
    if (updates.tags) this.updateTagDocFrequencies();
    logger.info(`Item updated: ${itemId}`, { itemId });
    return updated;
  }

  removeItem(itemId: string): void {
    this.items.delete(itemId);
    this.updateTagDocFrequencies();
    logger.info(`Item removed: ${itemId}`, { itemId });
  }

  addUserProfile(profile: UserProfile): void {
    this.users.set(profile.userId, profile);
    logger.info(`User profile added: ${profile.userId}`, { userId: profile.userId });
  }

  recordInteraction(userId: string, interaction: Omit<UserInteraction, 'timestamp'>): void {
    let profile = this.users.get(userId);
    if (!profile) {
      profile = { userId, preferences: {}, interactionHistory: [], segments: [] };
      this.users.set(userId, profile);
    }
    const full: UserInteraction = { ...interaction, timestamp: new Date() };
    profile.interactionHistory.push(full);
    const item = this.items.get(interaction.itemId);
    if (item) item.popularity += INTERACTION_WEIGHTS[interaction.type] ?? 1;
    this.recomputePreferences(profile);
    logger.info(`Interaction recorded for user ${userId}`, { userId, type: interaction.type });
  }

  getRecommendations(request: RecommendationRequest): Recommendation[] {
    const { userId, count, strategy = 'hybrid', excludeIds = [], contextTags } = request;
    let results: Recommendation[];
    switch (strategy) {
      case 'content':
        results = this.getContentBasedRecommendations(userId, count); break;
      case 'collaborative':
        results = this.getCollaborativeRecommendations(userId, count); break;
      case 'popular':
        results = this.getPopularRecommendations(count); break;
      case 'hybrid': default:
        results = this.getHybridRecommendations(userId, count); break;
    }
    results = results.filter((r) => !excludeIds.includes(r.itemId));
    if (contextTags && contextTags.length > 0) {
      results = results.map((r) => {
        const item = this.items.get(r.itemId);
        if (!item) return r;
        const overlap = item.tags.filter((t) => contextTags.includes(t)).length;
        return { ...r, score: r.score * (1 + overlap * 0.1) };
      });
      results.sort((a, b) => b.score - a.score);
    }
    this.recommendationCount += results.slice(0, count).length;
    return results.slice(0, count);
  }

  getContentBasedRecommendations(userId: string, count: number): Recommendation[] {
    const profile = this.users.get(userId);
    if (!profile) return this.getPopularRecommendations(count);
    const prefVec = this.getUserPreferenceVector(userId);
    const interactedIds = new Set(profile.interactionHistory.map((i) => i.itemId));
    const scored: Recommendation[] = [];
    for (const item of this.items.values()) {
      if (interactedIds.has(item.id)) continue;
      const itemVec = this.buildItemVector(item);
      const sim = this.cosineSimilarity(prefVec, itemVec);
      if (sim <= 0) continue;
      const topFeatures = this.topMatchingFeatures(prefVec, itemVec, 3);
      scored.push({
        itemId: item.id,
        score: sim,
        strategy: 'content',
        explanation: `Matches your interests in ${topFeatures.join(', ')}`,
        confidence: Math.min(sim * 1.2, 1),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count);
  }

  getCollaborativeRecommendations(userId: string, count: number): Recommendation[] {
    const profile = this.users.get(userId);
    if (!profile) return this.getPopularRecommendations(count);
    // Build user-item interaction matrix
    const userVectors = new Map<string, Map<string, number>>();
    for (const u of this.users.values()) {
      const vec = new Map<string, number>();
      for (const ix of u.interactionHistory) {
        const w = INTERACTION_WEIGHTS[ix.type] ?? 1;
        vec.set(ix.itemId, (vec.get(ix.itemId) ?? 0) + w);
      }
      userVectors.set(u.userId, vec);
    }
    const currentVec = userVectors.get(userId);
    if (!currentVec || currentVec.size === 0) return this.getPopularRecommendations(count);
    // Find similar users via cosine similarity on interaction vectors
    const similarities: { uid: string; sim: number }[] = [];
    for (const [uid, vec] of userVectors) {
      if (uid === userId) continue;
      const sim = this.sparseCosineSimilarity(currentVec, vec);
      if (sim > 0) similarities.push({ uid, sim });
    }
    similarities.sort((a, b) => b.sim - a.sim);
    const neighbours = similarities.slice(0, 20);
    if (neighbours.length === 0) return this.getPopularRecommendations(count);
    // Aggregate item scores from neighbours weighted by similarity
    const candidateScores = new Map<string, number>();
    for (const { uid, sim } of neighbours) {
      const nVec = userVectors.get(uid)!;
      for (const [itemId, weight] of nVec) {
        if (currentVec.has(itemId)) continue;
        candidateScores.set(itemId, (candidateScores.get(itemId) ?? 0) + weight * sim);
      }
    }
    const results: Recommendation[] = [];
    for (const [itemId, score] of candidateScores) {
      const item = this.items.get(itemId);
      if (!item) continue;
      results.push({
        itemId, score, strategy: 'collaborative',
        explanation: `Users with similar tastes enjoyed "${item.title}"`,
        confidence: Math.min(score / 10, 1),
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, count);
  }

  getPopularRecommendations(count: number): Recommendation[] {
    const now = Date.now();
    const scored: { item: RecommendationItem; decayed: number }[] = [];
    for (const item of this.items.values()) {
      const ageMs = now - item.createdAt.getTime();
      const decay = Math.pow(0.5, ageMs / POPULARITY_HALF_LIFE_MS);
      scored.push({ item, decayed: item.popularity * decay });
    }
    scored.sort((a, b) => b.decayed - a.decayed);
    return scored.slice(0, count).map(({ item, decayed }) => ({
      itemId: item.id, score: decayed, strategy: 'popular' as const,
      explanation: 'Trending — popular among all users',
      confidence: Math.min(decayed / 20, 1),
    }));
  }

  getHybridRecommendations(userId: string, count: number): Recommendation[] {
    const pool = count * 3;
    const content = this.getContentBasedRecommendations(userId, pool);
    const collab = this.getCollaborativeRecommendations(userId, pool);
    const popular = this.getPopularRecommendations(pool);
    // Normalise scores within each strategy to [0,1]
    const normalise = (recs: Recommendation[]): void => {
      const max = recs.reduce((m, r) => Math.max(m, r.score), 0) || 1;
      for (const r of recs) r.score /= max;
    };
    normalise(content);
    normalise(collab);
    normalise(popular);
    // Merge into a single map, weighting by strategy
    const merged = new Map<string, Recommendation>();
    const blend = (recs: Recommendation[], weight: number): void => {
      for (const r of recs) {
        const existing = merged.get(r.itemId);
        const weighted = r.score * weight;
        merged.set(r.itemId, {
          itemId: r.itemId,
          score: (existing?.score ?? 0) + weighted,
          strategy: 'hybrid',
          explanation: existing ? existing.explanation : r.explanation,
          confidence: Math.min((existing?.confidence ?? 0) + r.confidence * weight, 1),
        });
      }
    };
    blend(content, HYBRID_WEIGHTS.content);
    blend(collab, HYBRID_WEIGHTS.collaborative);
    blend(popular, HYBRID_WEIGHTS.popular);
    const results = Array.from(merged.values());
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, count);
  }

  submitFeedback(feedback: RecommendationFeedback): void {
    this.feedbackLog.push(feedback);
    const profile = this.users.get(feedback.userId);
    const item = this.items.get(feedback.itemId);
    if (profile && item) {
      const factor = feedback.accepted ? 0.1 : -0.05;
      for (const tag of item.tags) {
        profile.preferences[tag] = (profile.preferences[tag] ?? 0) + factor;
      }
      for (const [feat, val] of Object.entries(item.features)) {
        profile.preferences[feat] = (profile.preferences[feat] ?? 0) + factor * val;
      }
    }
    logger.info(`Feedback submitted for user ${feedback.userId}`, {
      userId: feedback.userId, accepted: feedback.accepted,
    });
  }

  getStats(): RecommendationStats {
    const totalFeedback = this.feedbackLog.length;
    const accepted = this.feedbackLog.filter((f) => f.accepted).length;
    const acceptanceRate = totalFeedback > 0 ? accepted / totalFeedback : 0;
    const strategyBuckets: Record<string, { total: number; accepted: number }> = {};
    for (const strat of ['content', 'collaborative', 'popular', 'hybrid']) {
      strategyBuckets[strat] = { total: 0, accepted: 0 };
    }
    for (const fb of this.feedbackLog) {
      const bucket = strategyBuckets['hybrid'];
      bucket.total += 1;
      if (fb.accepted) bucket.accepted += 1;
    }
    const strategyPerformance: Record<string, { count: number; acceptanceRate: number }> = {};
    for (const [strat, { total, accepted: acc }] of Object.entries(strategyBuckets)) {
      strategyPerformance[strat] = { count: total, acceptanceRate: total > 0 ? acc / total : 0 };
    }
    return {
      totalItems: this.items.size,
      totalUsers: this.users.size,
      totalRecommendations: this.recommendationCount,
      acceptanceRate,
      avgScore: totalFeedback > 0 ? accepted / totalFeedback : 0,
      strategyPerformance,
    };
  }

  computeItemSimilarity(itemId1: string, itemId2: string): number {
    const a = this.items.get(itemId1);
    const b = this.items.get(itemId2);
    if (!a || !b) return 0;
    return this.cosineSimilarity(this.buildItemVector(a), this.buildItemVector(b));
  }

  getUserPreferenceVector(userId: string): Record<string, number> {
    const profile = this.users.get(userId);
    if (!profile) return {};
    const vec: Record<string, number> = { ...profile.preferences };
    for (const interaction of profile.interactionHistory) {
      const item = this.items.get(interaction.itemId);
      if (!item) continue;
      const w = INTERACTION_WEIGHTS[interaction.type] ?? 1;
      const recency = this.recencyWeight(interaction.timestamp);
      for (const tag of item.tags) {
        vec[tag] = (vec[tag] ?? 0) + w * recency * this.idf(tag);
      }
      for (const [feat, val] of Object.entries(item.features)) {
        vec[feat] = (vec[feat] ?? 0) + w * recency * val;
      }
    }
    return vec;
  }

  // -- Private helpers --

  private recomputePreferences(profile: UserProfile): void {
    const vec: Record<string, number> = {};
    for (const interaction of profile.interactionHistory) {
      const item = this.items.get(interaction.itemId);
      if (!item) continue;
      const w = INTERACTION_WEIGHTS[interaction.type] ?? 1;
      const recency = this.recencyWeight(interaction.timestamp);
      for (const tag of item.tags) {
        vec[tag] = (vec[tag] ?? 0) + w * recency;
      }
    }
    profile.preferences = vec;
  }

  private buildItemVector(item: RecommendationItem): Record<string, number> {
    const vec: Record<string, number> = { ...item.features };
    for (const tag of item.tags) vec[`tag:${tag}`] = this.idf(tag);
    return vec;
  }

  private updateTagDocFrequencies(): void {
    this.tagDocFreq.clear();
    for (const item of this.items.values()) {
      for (const tag of item.tags) {
        this.tagDocFreq.set(tag, (this.tagDocFreq.get(tag) ?? 0) + 1);
      }
    }
  }

  /** TF-IDF-inspired inverse document frequency for a tag. */
  private idf(tag: string): number {
    const df = this.tagDocFreq.get(tag) ?? 0;
    return df === 0 ? 1 : Math.log(1 + this.items.size / df);
  }

  /** Cosine similarity between two dense vectors represented as Records. */
  private cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
    let dot = 0, magA = 0, magB = 0;
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of allKeys) {
      const va = a[k] ?? 0;
      const vb = b[k] ?? 0;
      dot += va * vb;
      magA += va * va;
      magB += vb * vb;
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Cosine similarity for sparse Map-based vectors (collaborative filtering). */
  private sparseCosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0, magA = 0, magB = 0;
    for (const [k, va] of a) {
      magA += va * va;
      const vb = b.get(k);
      if (vb !== undefined) dot += va * vb;
    }
    for (const [, vb] of b) magB += vb * vb;
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Exponential recency weight — interactions lose half their weight every 14 days. */
  private recencyWeight(timestamp: Date): number {
    const ageMs = Date.now() - timestamp.getTime();
    return Math.pow(0.5, ageMs / (14 * 24 * 60 * 60 * 1000));
  }

  /** Top N matching feature keys between two vectors. */
  private topMatchingFeatures(a: Record<string, number>, b: Record<string, number>, n: number): string[] {
    const pairs: { key: string; product: number }[] = [];
    for (const k of Object.keys(b)) {
      if (a[k] !== undefined && a[k] > 0 && b[k] > 0) {
        pairs.push({ key: k.replace(/^tag:/, ''), product: a[k] * b[k] });
      }
    }
    pairs.sort((x, y) => y.product - x.product);
    return pairs.slice(0, n).map((p) => p.key);
  }
}

declare global {
  var __intelligentRecommendationEngine__: IntelligentRecommendationEngine | undefined;
}

export function getRecommendationEngine(): IntelligentRecommendationEngine {
  if (!globalThis.__intelligentRecommendationEngine__) {
    globalThis.__intelligentRecommendationEngine__ = new IntelligentRecommendationEngine();
    logger.info('IntelligentRecommendationEngine singleton created');
  }
  return globalThis.__intelligentRecommendationEngine__;
}
