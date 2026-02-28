/**
 * @module cognitiveSearchOptimizer
 * @description AI-powered search ranking and optimization engine with query intent
 * classification, semantic query expansion, learning-to-rank re-ranking, personalized
 * boosting, query reformulation, session analytics, zero-result detection, spelling
 * correction, facet optimization, and click-through feedback loop.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueryIntent =
  | 'navigational'
  | 'informational'
  | 'transactional'
  | 'commercial'
  | 'local'
  | 'unknown';

export interface SearchQuery {
  id: string;
  sessionId: string;
  userId: string;
  tenantId: string;
  rawQuery: string;
  normalizedQuery: string;
  intent: QueryIntent;
  expandedTerms: string[];
  filters: Record<string, unknown>;
  timestamp: number;
}

export interface SearchResult {
  id: string;
  queryId: string;
  documentId: string;
  title: string;
  snippet: string;
  originalScore: number;
  rerankedScore: number;
  personalizedScore: number;
  finalScore: number;
  rank: number;
  features: Record<string, number>;
}

export interface RankingModel {
  id: string;
  name: string;
  featureWeights: Record<string, number>;
  version: number;
  trainedAt: number;
  clickThroughRate: number;
  meanReciprocalRank: number;
}

export interface QueryExpansion {
  originalQuery: string;
  expandedTerms: string[];
  synonyms: string[];
  relatedConcepts: string[];
  confidence: number;
}

export interface SearchSession {
  id: string;
  userId: string;
  tenantId: string;
  queries: string[]; // queryIds
  clicks: number;
  zeroResultQueries: number;
  reformulations: number;
  startedAt: number;
  lastActivityAt: number;
  satisfactionScore?: number;
}

export interface ClickRecord {
  queryId: string;
  documentId: string;
  userId: string;
  rank: number;
  timestamp: number;
}

export interface SearchOptimizerSummary {
  totalQueries: number;
  totalSessions: number;
  zeroResultRate: number;
  avgResultCount: number;
  clickThroughRate: number;
  intentDistribution: Record<QueryIntent, number>;
  topReformulations: number;
  activeRankingModel: string;
  avgPersonalizationBoost: number;
}

// ── Synonym/spelling dictionaries ─────────────────────────────────────────────

const SYNONYM_MAP: Record<string, string[]> = {
  buy: ['purchase', 'order', 'get', 'acquire'],
  cheap: ['affordable', 'budget', 'low-cost', 'inexpensive'],
  fast: ['quick', 'rapid', 'speedy', 'instant'],
  help: ['support', 'assist', 'guide', 'documentation'],
  news: ['articles', 'posts', 'updates', 'feed'],
};

const SPELLING_CORRECTIONS: Record<string, string> = {
  recieve: 'receive', occured: 'occurred', seperate: 'separate',
  definately: 'definitely', accomodate: 'accommodate', neccessary: 'necessary',
  recomend: 'recommend', adress: 'address', beleive: 'believe',
};

// ── Engine class ──────────────────────────────────────────────────────────────

export class CognitiveSearchOptimizer {
  private queries: Map<string, SearchQuery> = new Map();
  private sessions: Map<string, SearchSession> = new Map();
  private rankingModels: Map<string, RankingModel> = new Map();
  private clicks: ClickRecord[] = [];
  private resultCache: Map<string, SearchResult[]> = new Map(); // queryId -> results
  private zeroResultQueries: Set<string> = new Set();
  private activeModelId = 'default';
  private userProfiles: Map<string, Record<string, number>> = new Map(); // userId -> feature boosts

  constructor() {
    logger.info('[CognitiveSearchOptimizer] Initialized cognitive search optimizer');
    this.initDefaultRankingModel();
  }

  /**
   * Classify the intent of a raw search query.
   */
  classifyIntent(query: string): QueryIntent {
    const q = query.toLowerCase().trim();
    const transactionalKeywords = ['buy', 'purchase', 'order', 'price', 'discount', 'checkout'];
    const navigationalKeywords = ['login', 'account', 'dashboard', 'settings', 'profile'];
    const commercialKeywords = ['best', 'top', 'review', 'compare', 'vs', 'alternative'];
    const localKeywords = ['near me', 'nearby', 'location', 'local', 'map'];

    if (localKeywords.some(k => q.includes(k))) return 'local';
    if (transactionalKeywords.some(k => q.includes(k))) return 'transactional';
    if (navigationalKeywords.some(k => q.includes(k))) return 'navigational';
    if (commercialKeywords.some(k => q.includes(k))) return 'commercial';
    if (q.split(' ').length >= 4) return 'informational'; // long-tail = informational
    return 'unknown';
  }

  /**
   * Expand a query with synonyms and related concepts.
   */
  expandQuery(rawQuery: string): QueryExpansion {
    const corrected = this.correctSpelling(rawQuery);
    const terms = corrected.toLowerCase().split(/\s+/).filter(Boolean);
    const synonyms: string[] = [];
    const related: string[] = [];

    for (const term of terms) {
      const syns = SYNONYM_MAP[term] ?? [];
      synonyms.push(...syns);
      // Derive related concepts via simple suffix analysis
      if (term.endsWith('ing')) related.push(term.slice(0, -3));
      if (term.endsWith('tion')) related.push(term.slice(0, -4) + 'te');
    }

    const expandedTerms = [...new Set([...terms, ...synonyms.slice(0, 5)])];
    const confidence = synonyms.length > 0 ? Math.min(1, 0.5 + synonyms.length * 0.1) : 0.3;

    const expansion: QueryExpansion = {
      originalQuery: rawQuery,
      expandedTerms,
      synonyms: [...new Set(synonyms)].slice(0, 8),
      relatedConcepts: [...new Set(related)].slice(0, 5),
      confidence: parseFloat(confidence.toFixed(3)),
    };

    logger.debug(`[CognitiveSearchOptimizer] Query expanded: ${rawQuery} -> ${expandedTerms.length} terms`);
    return expansion;
  }

  /**
   * Re-rank search results using learning-to-rank feature weights.
   */
  rankResults(queryId: string, candidates: Array<{ documentId: string; title: string; snippet: string; features: Record<string, number> }>): SearchResult[] {
    const model = this.rankingModels.get(this.activeModelId);
    if (!model) throw new Error('No active ranking model');

    const results: SearchResult[] = candidates.map(c => {
      const originalScore = c.features['bm25'] ?? Math.random();
      const rerankedScore = Object.entries(model.featureWeights).reduce((score, [feat, weight]) => {
        return score + (c.features[feat] ?? 0) * weight;
      }, 0);

      return {
        id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        queryId,
        documentId: c.documentId,
        title: c.title,
        snippet: c.snippet,
        originalScore,
        rerankedScore,
        personalizedScore: rerankedScore,
        finalScore: rerankedScore,
        rank: 0,
        features: c.features,
      };
    });

    results.sort((a, b) => b.rerankedScore - a.rerankedScore);
    results.forEach((r, i) => { r.rank = i + 1; });
    this.resultCache.set(queryId, results);

    if (results.length === 0) this.zeroResultQueries.add(queryId);

    logger.debug(`[CognitiveSearchOptimizer] Ranked ${results.length} results for query ${queryId}`);
    return results;
  }

  /**
   * Apply personalized boosting to ranked results based on user click history.
   */
  personalizeBoost(userId: string, results: SearchResult[]): SearchResult[] {
    const userBoosts = this.userProfiles.get(userId) ?? {};
    let totalBoost = 0;

    const boosted = results.map(r => {
      const docBoost = userBoosts[r.documentId] ?? 0;
      const categoryBoost = Object.entries(userBoosts)
        .filter(([key]) => r.features[key] !== undefined)
        .reduce((sum, [, val]) => sum + val * 0.1, 0);
      const boost = docBoost + categoryBoost;
      totalBoost += boost;
      return {
        ...r,
        personalizedScore: r.rerankedScore * (1 + boost),
        finalScore: r.rerankedScore * (1 + boost),
      };
    });

    boosted.sort((a, b) => b.finalScore - a.finalScore);
    boosted.forEach((r, i) => { r.rank = i + 1; });

    const avgBoost = results.length > 0 ? totalBoost / results.length : 0;
    logger.debug(`[CognitiveSearchOptimizer] Personalized ${results.length} results for ${userId}, avgBoost=${avgBoost.toFixed(3)}`);
    return boosted;
  }

  /**
   * Generate query reformulation suggestions based on session history.
   */
  reformulateQuery(queryId: string): string[] {
    const query = this.queries.get(queryId);
    if (!query) return [];

    const session = this.sessions.get(query.sessionId);
    const suggestions: string[] = [];

    // Suggest removing stop words
    const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'is', 'are', 'was', 'were']);
    const filtered = query.normalizedQuery.split(' ').filter(w => !stopWords.has(w)).join(' ');
    if (filtered !== query.normalizedQuery) suggestions.push(filtered);

    // Suggest synonyms
    const expansion = this.expandQuery(query.normalizedQuery);
    if (expansion.synonyms.length > 0) {
      suggestions.push(`${query.normalizedQuery} ${expansion.synonyms[0]}`);
    }

    // Suggest broader query if zero results
    if (this.zeroResultQueries.has(queryId) && query.normalizedQuery.split(' ').length > 2) {
      const broader = query.normalizedQuery.split(' ').slice(0, 2).join(' ');
      suggestions.push(broader);
    }

    if (session) session.reformulations++;
    logger.debug(`[CognitiveSearchOptimizer] Reformulations for ${queryId}: ${suggestions.length}`);
    return suggestions;
  }

  /**
   * Record a click event and update user profile for personalization.
   */
  recordClick(queryId: string, documentId: string, userId: string, rank: number): void {
    this.clicks.push({ queryId, documentId, userId, rank, timestamp: Date.now() });

    // Update user profile with click signal
    const profile = this.userProfiles.get(userId) ?? {};
    profile[documentId] = Math.min(5, (profile[documentId] ?? 0) + 1 / rank);
    this.userProfiles.set(userId, profile);

    // Update model CTR
    const model = this.rankingModels.get(this.activeModelId);
    if (model) {
      const totalClicks = this.clicks.length;
      const totalQueries = this.queries.size;
      model.clickThroughRate = totalQueries > 0 ? parseFloat((totalClicks / totalQueries).toFixed(4)) : 0;
    }

    logger.debug(`[CognitiveSearchOptimizer] Click recorded: doc=${documentId} rank=${rank} user=${userId}`);
  }

  /**
   * Detect zero-result queries and log them for optimization.
   */
  detectZeroResults(queryId: string, resultCount: number): boolean {
    if (resultCount === 0) {
      this.zeroResultQueries.add(queryId);
      const q = this.queries.get(queryId);
      if (q) {
        const session = this.sessions.get(q.sessionId);
        if (session) session.zeroResultQueries++;
      }
      logger.warn(`[CognitiveSearchOptimizer] Zero results for query ${queryId}`);
      return true;
    }
    return false;
  }

  /**
   * Correct spelling errors in a query string.
   */
  correctSpelling(query: string): string {
    const words = query.split(/\s+/);
    const corrected = words.map(w => SPELLING_CORRECTIONS[w.toLowerCase()] ?? w);
    const result = corrected.join(' ');
    if (result !== query) {
      logger.debug(`[CognitiveSearchOptimizer] Spelling corrected: '${query}' -> '${result}'`);
    }
    return result;
  }

  /**
   * Register a query and attach it to a session.
   */
  registerQuery(query: Omit<SearchQuery, 'intent' | 'expandedTerms' | 'normalizedQuery'>): SearchQuery {
    const corrected = this.correctSpelling(query.rawQuery);
    const expansion = this.expandQuery(corrected);
    const intent = this.classifyIntent(corrected);
    const full: SearchQuery = {
      ...query,
      normalizedQuery: corrected.toLowerCase().trim(),
      intent,
      expandedTerms: expansion.expandedTerms,
      timestamp: query.timestamp || Date.now(),
    };
    this.queries.set(full.id, full);

    // Update session
    const session = this.sessions.get(full.sessionId);
    if (session) {
      session.queries.push(full.id);
      session.lastActivityAt = full.timestamp;
    }

    return full;
  }

  /**
   * Start or retrieve a search session.
   */
  getOrCreateSession(sessionId: string, userId: string, tenantId: string): SearchSession {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId, userId, tenantId,
        queries: [], clicks: 0, zeroResultQueries: 0, reformulations: 0,
        startedAt: Date.now(), lastActivityAt: Date.now(),
      });
    }
    return this.sessions.get(sessionId)!;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private initDefaultRankingModel(): void {
    this.rankingModels.set('default', {
      id: 'default',
      name: 'BM25 + LTR baseline',
      featureWeights: {
        bm25: 0.4, title_match: 0.25, recency: 0.15,
        click_history: 0.1, content_quality: 0.1,
      },
      version: 1,
      trainedAt: Date.now(),
      clickThroughRate: 0,
      meanReciprocalRank: 0,
    });
  }

  /**
   * Return a high-level summary of the search optimizer state.
   */
  getSummary(): SearchOptimizerSummary {
    const totalQueries = this.queries.size;
    const zeroRate = totalQueries > 0 ? this.zeroResultQueries.size / totalQueries : 0;
    const ctr = totalQueries > 0 ? this.clicks.length / totalQueries : 0;

    const intentDist: Record<QueryIntent, number> = {
      navigational: 0, informational: 0, transactional: 0,
      commercial: 0, local: 0, unknown: 0,
    };
    for (const q of this.queries.values()) intentDist[q.intent]++;

    const model = this.rankingModels.get(this.activeModelId);

    const allResults = Array.from(this.resultCache.values()).flat();
    const avgBoost = allResults.length > 0
      ? allResults.reduce((s, r) => s + (r.personalizedScore - r.rerankedScore), 0) / allResults.length
      : 0;

    const reformulations = Array.from(this.sessions.values())
      .reduce((s, sess) => s + sess.reformulations, 0);

    return {
      totalQueries,
      totalSessions: this.sessions.size,
      zeroResultRate: parseFloat(zeroRate.toFixed(4)),
      avgResultCount: this.resultCache.size > 0
        ? parseFloat((allResults.length / this.resultCache.size).toFixed(1)) : 0,
      clickThroughRate: parseFloat(ctr.toFixed(4)),
      intentDistribution: intentDist,
      topReformulations: reformulations,
      activeRankingModel: model?.name ?? 'none',
      avgPersonalizationBoost: parseFloat(avgBoost.toFixed(4)),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__cognitiveSearchOptimizer__';
export function getCognitiveSearchOptimizer(): CognitiveSearchOptimizer {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new CognitiveSearchOptimizer();
  }
  return (globalThis as Record<string, unknown>)[KEY] as CognitiveSearchOptimizer;
}
