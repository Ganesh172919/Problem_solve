/**
 * SEO Optimization Agent
 *
 * Autonomous SEO agent that:
 * - Analyzes content items from a queue and generates optimization recommendations
 * - Performs keyword research (extract + score keywords) and competition analysis
 * - On-page SEO optimization (title, description, schema, internal links)
 * - Generates optimization recommendations with priority scores (0-100)
 * - Monitors ranking changes (simulated), updates meta tags automatically
 */

import { getLogger } from '../lib/logger';
import { getCache } from '../lib/cache';
import getAIPoweredSEO from '../lib/aiPoweredSEO';

const logger = getLogger();
const cache = getCache();

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface AgentConfig {
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
  recommendationThreshold: number; // min priority score to emit
  rankingCheckIntervalMs: number;
  cacheKeywordsTtlSec: number;
  enableAutoApply: boolean;         // auto-apply low-risk optimizations
  maxQueueSize: number;
  retryAttempts: number;
}

export interface SEOTask {
  id: string;
  contentId: string;
  url: string;
  title: string;
  body: string;
  description: string;
  headings: string[];
  tags: string[];
  category: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  errorMessage?: string;
}

export interface KeywordScore {
  keyword: string;
  frequency: number;
  density: number;         // percentage in body
  prominence: number;      // 0-100 (weighted by position in doc)
  tfIdf: number;
  competitionScore: number; // 0-100, lower = less competitive
  searchVolume: number;     // estimated monthly searches
  opportunity: number;      // 0-100 composite score
  inTitle: boolean;
  inDescription: boolean;
  inHeadings: boolean;
}

export interface CompetitionAnalysis {
  keyword: string;
  difficulty: number;        // 0-100
  topRankingDomains: string[];
  avgWordCount: number;
  avgBacklinks: number;
  estimatedCtr: number;      // 0-1
  contentGaps: string[];
  analyzedAt: Date;
}

export interface SEORecommendation {
  id: string;
  contentId: string;
  type: 'title' | 'description' | 'keyword' | 'schema' | 'internal_link' | 'heading' | 'content_length' | 'image_alt' | 'canonical' | 'speed';
  priority: number;          // 0-100
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  currentValue?: string;
  suggestedValue?: string;
  expectedImpact: string;
  effort: 'low' | 'medium' | 'high';
  autoApplicable: boolean;
  applied: boolean;
  appliedAt?: Date;
  createdAt: Date;
}

export interface RankingChange {
  contentId: string;
  url: string;
  keyword: string;
  previousPosition: number;
  currentPosition: number;
  positionDelta: number;     // positive = improved
  previousDate: Date;
  currentDate: Date;
  estimatedTrafficChange: number;
  cause?: string;
}

export interface AgentResult {
  agentId: string;
  runId: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  tasksProcessed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  tasksSkipped: number;
  recommendationsGenerated: number;
  optimizationsApplied: number;
  rankingChangesDetected: number;
  avgPriorityScore: number;
  topRecommendations: SEORecommendation[];
  errors: Array<{ contentId: string; error: string }>;
}

export interface AgentStatus {
  agentId: string;
  state: 'idle' | 'running' | 'paused' | 'error';
  queueSize: number;
  processingCount: number;
  totalProcessed: number;
  totalRecommendations: number;
  lastRunAt?: Date;
  lastError?: string;
  uptime: number;   // seconds
  config: AgentConfig;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class SeoOptimizationAgent {
  private readonly agentId = 'seo-optimization-agent';
  private seo = getAIPoweredSEO();
  private queue: SEOTask[] = [];
  private recommendations = new Map<string, SEORecommendation[]>();
  private rankingHistory = new Map<string, number>();  // keyword -> last position
  private state: AgentStatus['state'] = 'idle';
  private totalProcessed = 0;
  private totalRecommendations = 0;
  private lastRunAt?: Date;
  private lastError?: string;
  private startedAt = new Date();

  private config: AgentConfig = {
    maxConcurrentTasks: 5,
    taskTimeoutMs: 30_000,
    recommendationThreshold: 20,
    rankingCheckIntervalMs: 3_600_000,
    cacheKeywordsTtlSec: 3600,
    enableAutoApply: true,
    maxQueueSize: 200,
    retryAttempts: 3,
  };

  constructor(config?: Partial<AgentConfig>) {
    if (config) this.config = { ...this.config, ...config };
    logger.info('SeoOptimizationAgent initialized', { agentId: this.agentId, config: this.config });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Enqueue content items and run a full SEO optimization cycle. */
  async run(tasks?: SEOTask[]): Promise<AgentResult> {
    if (this.state === 'running') {
      logger.warn('SeoOptimizationAgent already running, skipping', { agentId: this.agentId });
      return this.emptyResult();
    }

    const runId = `run_${Date.now()}`;
    const runStart = new Date();
    this.state = 'running';

    if (tasks?.length) {
      for (const t of tasks) this.enqueue(t);
    }

    logger.info('SeoOptimizationAgent run started', { runId, queueSize: this.queue.length });

    const errors: AgentResult['errors'] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let recommendationsGenerated = 0;
    let optimizationsApplied = 0;

    const batch = this.queue.splice(0, this.config.maxConcurrentTasks * 4);

    for (const task of batch) {
      if (task.status !== 'queued') { skipped++; continue; }
      task.status = 'processing';
      task.startedAt = new Date();

      try {
        const recs = await this.analyzeContent(task);
        const filtered = recs.filter(r => r.priority >= this.config.recommendationThreshold);

        this.recommendations.set(task.contentId, filtered);
        recommendationsGenerated += filtered.length;

        if (this.config.enableAutoApply) {
          const applied = await this.applyOptimizations(task.contentId, filtered);
          optimizationsApplied += applied;
        }

        task.status = 'completed';
        task.completedAt = new Date();
        this.totalProcessed++;
        this.totalRecommendations += filtered.length;
        succeeded++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        task.retryCount++;
        task.status = task.retryCount < this.config.retryAttempts ? 'queued' : 'failed';
        task.errorMessage = message;
        if (task.status === 'failed') {
          failed++;
          errors.push({ contentId: task.contentId, error: message });
          logger.error('SEO task failed', undefined, { contentId: task.contentId, error: message });
        } else {
          this.queue.unshift(task);
        }
      }
    }

    // Ranking monitoring
    const rankingChanges = await this.monitorRankings(batch.map(t => t.contentId));

    const completedAt = new Date();
    this.state = 'idle';
    this.lastRunAt = completedAt;

    const allRecs = batch.flatMap(t => this.recommendations.get(t.contentId) ?? []);
    const avgPriority = allRecs.length > 0
      ? allRecs.reduce((s, r) => s + r.priority, 0) / allRecs.length
      : 0;

    const result: AgentResult = {
      agentId: this.agentId,
      runId,
      startedAt: runStart,
      completedAt,
      durationMs: completedAt.getTime() - runStart.getTime(),
      tasksProcessed: batch.length,
      tasksSucceeded: succeeded,
      tasksFailed: failed,
      tasksSkipped: skipped,
      recommendationsGenerated,
      optimizationsApplied,
      rankingChangesDetected: rankingChanges.length,
      avgPriorityScore: Math.round(avgPriority * 10) / 10,
      topRecommendations: allRecs.sort((a, b) => b.priority - a.priority).slice(0, 10),
      errors,
    };

    logger.info('SeoOptimizationAgent run completed', {
      runId,
      durationMs: result.durationMs,
      succeeded,
      failed,
      recommendationsGenerated,
    });

    return result;
  }

  /** Full SEO analysis for a single content task. */
  async analyzeContent(task: SEOTask): Promise<SEORecommendation[]> {
    const cacheKey = `seo:analysis:${task.contentId}`;
    const cached = await cache.get<SEORecommendation[]>(cacheKey);
    if (cached) {
      logger.info('SEO analysis cache hit', { contentId: task.contentId });
      return cached;
    }

    logger.info('Analyzing content for SEO', { contentId: task.contentId, url: task.url });

    const doc = {
      id: task.contentId,
      url: task.url,
      title: task.title,
      description: task.description,
      body: task.body,
      headings: task.headings,
      tags: task.tags,
      author: 'agent',
      publishedAt: new Date(),
      canonicalUrl: task.url,
    };

    const analysis = this.seo.analyzeContent(doc);
    const keywords = await this.researchKeywords(task);
    const recs = await this.generateRecommendations(task, analysis, keywords);

    await cache.set(cacheKey, recs, this.config.cacheKeywordsTtlSec);
    logger.info('SEO analysis complete', { contentId: task.contentId, recCount: recs.length, score: analysis.score });
    return recs;
  }

  /** Extract, score and research keywords for a task. */
  async researchKeywords(task: SEOTask): Promise<KeywordScore[]> {
    const cacheKey = `seo:keywords:${task.contentId}`;
    const cached = await cache.get<KeywordScore[]>(cacheKey);
    if (cached) return cached;

    const words = this.tokenize(task.body + ' ' + task.title);
    const titleWords = new Set(this.tokenize(task.title));
    const descWords = new Set(this.tokenize(task.description));
    const headingWords = new Set(task.headings.flatMap(h => this.tokenize(h)));

    const freq = new Map<string, number>();
    for (const w of words) {
      if (w.length < 4 || this.isStopWord(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }

    // Build bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (words[i].length >= 3 && words[i + 1].length >= 3 && !this.isStopWord(words[i]) && !this.isStopWord(words[i + 1])) {
        freq.set(bigram, (freq.get(bigram) ?? 0) + 1);
      }
    }

    const totalWords = words.length || 1;
    const topKeywords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);

    const scores: KeywordScore[] = topKeywords.map(([keyword, frequency]) => {
      const density = (frequency / totalWords) * 100;
      const inTitle = keyword.split(' ').every(w => titleWords.has(w));
      const inDescription = keyword.split(' ').some(w => descWords.has(w));
      const inHeadings = keyword.split(' ').some(w => headingWords.has(w));

      const prominence =
        (inTitle ? 40 : 0) +
        (inDescription ? 20 : 0) +
        (inHeadings ? 20 : 0) +
        Math.min(20, frequency * 2);

      // Simulate TF-IDF, competition, search volume
      const tfIdf = (frequency / totalWords) * Math.log(1000 / (frequency + 1));
      const competitionScore = 100 - Math.min(100, Math.floor(tfIdf * 800 + Math.random() * 30));
      const searchVolume = Math.floor(100 + Math.random() * 9900);
      const opportunity = Math.round(
        (prominence * 0.3) + ((100 - competitionScore) * 0.3) + (Math.min(100, searchVolume / 100) * 0.4)
      );

      return {
        keyword,
        frequency,
        density: Math.round(density * 100) / 100,
        prominence: Math.min(100, prominence),
        tfIdf: Math.round(tfIdf * 1000) / 1000,
        competitionScore,
        searchVolume,
        opportunity: Math.min(100, opportunity),
        inTitle,
        inDescription,
        inHeadings,
      };
    });

    await cache.set(cacheKey, scores, this.config.cacheKeywordsTtlSec);
    logger.info('Keyword research complete', { contentId: task.contentId, keywordCount: scores.length });
    return scores;
  }

  /** Generate prioritized SEO recommendations from analysis data. */
  async generateRecommendations(
    task: SEOTask,
    analysis: ReturnType<typeof this.seo.analyzeContent>,
    keywords: KeywordScore[],
  ): Promise<SEORecommendation[]> {
    const recs: SEORecommendation[] = [];
    const now = new Date();
    let idSeq = 0;
    const id = () => `rec_${task.contentId}_${++idSeq}`;

    // Title recommendations
    if (task.title.length < 40 || task.title.length > 65) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'title',
        priority: 85, severity: 'high',
        title: 'Optimize title length',
        description: `Title is ${task.title.length} characters. Target 50–60 characters for best CTR.`,
        currentValue: task.title,
        suggestedValue: this.optimizeTitle(task.title, keywords[0]?.keyword),
        expectedImpact: '+5–15% CTR improvement',
        effort: 'low', autoApplicable: true, applied: false, createdAt: now,
      });
    }

    // Add focus keyword to title if missing
    const focusKw = keywords.find(k => k.opportunity > 60);
    if (focusKw && !task.title.toLowerCase().includes(focusKw.keyword)) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'title',
        priority: 78, severity: 'high',
        title: 'Add focus keyword to title',
        description: `Focus keyword "${focusKw.keyword}" not found in title.`,
        currentValue: task.title,
        suggestedValue: `${focusKw.keyword.charAt(0).toUpperCase() + focusKw.keyword.slice(1)}: ${task.title}`,
        expectedImpact: '+8–20% organic ranking boost',
        effort: 'low', autoApplicable: true, applied: false, createdAt: now,
      });
    }

    // Meta description
    if (task.description.length < 100 || task.description.length > 165) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'description',
        priority: 75, severity: 'medium',
        title: 'Optimize meta description',
        description: `Description is ${task.description.length} chars. Aim for 140–160 characters.`,
        currentValue: task.description,
        suggestedValue: this.optimizeDescription(task.description, keywords.slice(0, 3).map(k => k.keyword)),
        expectedImpact: '+3–10% CTR improvement',
        effort: 'low', autoApplicable: true, applied: false, createdAt: now,
      });
    }

    // Content length
    const wordCount = task.body.split(/\s+/).filter(Boolean).length;
    if (wordCount < 600) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'content_length',
        priority: 90, severity: 'critical',
        title: 'Expand content length',
        description: `Content has ${wordCount} words. Google favors 1,200–2,000 words for competitive topics.`,
        currentValue: `${wordCount} words`,
        suggestedValue: '1,200+ words',
        expectedImpact: 'Significant ranking improvement for competitive keywords',
        effort: 'high', autoApplicable: false, applied: false, createdAt: now,
      });
    }

    // Headings structure
    if (task.headings.length < 3) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'heading',
        priority: 60, severity: 'medium',
        title: 'Add more heading structure',
        description: `Only ${task.headings.length} heading(s) found. Use H2/H3 hierarchy to improve scannability and keyword coverage.`,
        expectedImpact: '+5–10% dwell time, better keyword coverage',
        effort: 'medium', autoApplicable: false, applied: false, createdAt: now,
      });
    }

    // Schema markup
    recs.push({
      id: id(), contentId: task.contentId, type: 'schema',
      priority: 65, severity: 'medium',
      title: 'Add Article schema markup',
      description: 'Structured data helps search engines understand content and enables rich results.',
      suggestedValue: JSON.stringify({ '@type': 'NewsArticle', headline: task.title, keywords: keywords.slice(0, 5).map(k => k.keyword).join(', ') }),
      expectedImpact: 'Eligibility for rich snippets, +10–25% CTR',
      effort: 'low', autoApplicable: true, applied: false, createdAt: now,
    });

    // Internal linking
    if (analysis.internalLinks < 3) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'internal_link',
        priority: 55, severity: 'medium',
        title: 'Add more internal links',
        description: `Found ${analysis.internalLinks} internal link(s). Add 3–5 contextual internal links.`,
        expectedImpact: 'Improved crawlability and page authority distribution',
        effort: 'medium', autoApplicable: false, applied: false, createdAt: now,
      });
    }

    // Keyword density issues
    const overDense = keywords.filter(k => k.density > 3.5);
    if (overDense.length > 0) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'keyword',
        priority: 70, severity: 'high',
        title: 'Reduce keyword stuffing',
        description: `Keywords "${overDense.map(k => k.keyword).join(', ')}" exceed 3.5% density. Keyword stuffing can trigger penalties.`,
        expectedImpact: 'Avoids manual/algorithmic penalty',
        effort: 'medium', autoApplicable: false, applied: false, createdAt: now,
      });
    }

    // Underused high-opportunity keywords
    const missed = keywords.filter(k => k.opportunity > 70 && !k.inTitle && !k.inDescription);
    if (missed.length > 0) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'keyword',
        priority: 72, severity: 'high',
        title: 'Use high-opportunity keywords in title/description',
        description: `Keywords "${missed.slice(0, 3).map(k => k.keyword).join(', ')}" have high opportunity but aren't in title or description.`,
        expectedImpact: '+10–30% ranking improvement for target keywords',
        effort: 'low', autoApplicable: true, applied: false, createdAt: now,
      });
    }

    // Image alt tags
    if (analysis.images.some(img => !img.hasAlt)) {
      const missing = analysis.images.filter(img => !img.hasAlt).length;
      recs.push({
        id: id(), contentId: task.contentId, type: 'image_alt',
        priority: 45, severity: 'low',
        title: 'Add missing image alt text',
        description: `${missing} image(s) missing alt text. Alt text aids accessibility and image search ranking.`,
        expectedImpact: 'Better accessibility, image search impressions',
        effort: 'low', autoApplicable: false, applied: false, createdAt: now,
      });
    }

    // Canonical URL
    if (!task.url) {
      recs.push({
        id: id(), contentId: task.contentId, type: 'canonical',
        priority: 80, severity: 'high',
        title: 'Set canonical URL',
        description: 'No canonical URL defined. This can cause duplicate content issues.',
        expectedImpact: 'Prevents duplicate content dilution',
        effort: 'low', autoApplicable: true, applied: false, createdAt: now,
      });
    }

    // Sort by priority desc
    recs.sort((a, b) => b.priority - a.priority);
    logger.info('Recommendations generated', { contentId: task.contentId, count: recs.length });
    return recs;
  }

  /** Apply auto-applicable optimizations and return count applied. */
  async applyOptimizations(contentId: string, recommendations: SEORecommendation[]): Promise<number> {
    const applicable = recommendations.filter(r => r.autoApplicable && !r.applied && r.priority >= this.config.recommendationThreshold);
    let applied = 0;

    for (const rec of applicable) {
      try {
        // In production this would call a CMS API / database update.
        // Here we mark the recommendation as applied and cache the result.
        rec.applied = true;
        rec.appliedAt = new Date();
        applied++;
        logger.info('Auto-applied SEO optimization', {
          contentId,
          type: rec.type,
          priority: rec.priority,
          title: rec.title,
        });
      } catch (err) {
        logger.error('Failed to apply SEO optimization', undefined, {
          contentId,
          recId: rec.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (applied > 0) {
      await cache.set(`seo:applied:${contentId}`, applicable.filter(r => r.applied), 86_400);
    }

    return applied;
  }

  /** Monitor simulated ranking changes for a list of content IDs. */
  async monitorRankings(contentIds: string[]): Promise<RankingChange[]> {
    const changes: RankingChange[] = [];

    for (const contentId of contentIds) {
      const recs = this.recommendations.get(contentId);
      if (!recs) continue;

      const keywords = recs
        .filter(r => r.type === 'keyword' || r.type === 'title')
        .slice(0, 5)
        .map(r => r.suggestedValue ?? r.currentValue ?? 'unknown');

      for (const keyword of keywords) {
        const histKey = `${contentId}:${keyword}`;
        const previousPosition = this.rankingHistory.get(histKey) ?? Math.floor(20 + Math.random() * 80);
        const delta = Math.floor(-8 + Math.random() * 12);  // -8 to +3
        const currentPosition = Math.max(1, Math.min(100, previousPosition + delta));

        if (Math.abs(delta) >= 2) {
          const change: RankingChange = {
            contentId,
            url: `/content/${contentId}`,
            keyword,
            previousPosition,
            currentPosition,
            positionDelta: previousPosition - currentPosition, // positive = moved up
            previousDate: new Date(Date.now() - this.config.rankingCheckIntervalMs),
            currentDate: new Date(),
            estimatedTrafficChange: this.estimateTrafficChange(previousPosition, currentPosition),
            cause: delta < 0 ? 'Applied SEO optimizations' : 'Algorithm fluctuation',
          };
          changes.push(change);
          logger.info('Ranking change detected', {
            contentId,
            keyword,
            previousPosition,
            currentPosition,
            delta: change.positionDelta,
          });
        }

        this.rankingHistory.set(histKey, currentPosition);
      }
    }

    return changes;
  }

  /** Get current agent status. */
  getAgentStatus(): AgentStatus {
    return {
      agentId: this.agentId,
      state: this.state,
      queueSize: this.queue.length,
      processingCount: this.queue.filter(t => t.status === 'processing').length,
      totalProcessed: this.totalProcessed,
      totalRecommendations: this.totalRecommendations,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      uptime: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      config: this.config,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private enqueue(task: SEOTask): void {
    if (this.queue.length >= this.config.maxQueueSize) {
      logger.warn('SEO task queue full, dropping task', { contentId: task.contentId });
      return;
    }
    task.status = 'queued';
    const insertIdx = this.queue.findIndex(t => this.priorityValue(t.priority) < this.priorityValue(task.priority));
    if (insertIdx === -1) this.queue.push(task);
    else this.queue.splice(insertIdx, 0, task);
  }

  private priorityValue(p: SEOTask['priority']): number {
    return { critical: 4, high: 3, medium: 2, low: 1 }[p];
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  }

  private readonly STOP_WORDS = new Set([
    'the', 'and', 'for', 'are', 'was', 'were', 'this', 'that', 'with', 'from',
    'have', 'has', 'been', 'will', 'can', 'not', 'they', 'their', 'what', 'when',
    'where', 'how', 'all', 'each', 'both', 'about', 'into', 'more', 'its', 'also',
    'than', 'then', 'some', 'such', 'our', 'your', 'you', 'but', 'use', 'used',
  ]);

  private isStopWord(word: string): boolean {
    return this.STOP_WORDS.has(word);
  }

  private optimizeTitle(title: string, focusKeyword?: string): string {
    let optimized = title.trim();
    if (optimized.length > 65) optimized = optimized.slice(0, 62) + '...';
    if (focusKeyword && !optimized.toLowerCase().includes(focusKeyword)) {
      optimized = optimized.length > 45
        ? `${focusKeyword.charAt(0).toUpperCase() + focusKeyword.slice(1)}: ${optimized.slice(0, 45)}...`
        : `${optimized} | ${focusKeyword}`;
    }
    return optimized;
  }

  private optimizeDescription(description: string, keywords: string[]): string {
    let optimized = description.trim();
    if (optimized.length > 160) optimized = optimized.slice(0, 157) + '...';
    if (optimized.length < 100) {
      const kwSuffix = keywords.filter(k => !optimized.toLowerCase().includes(k)).slice(0, 2).join(', ');
      if (kwSuffix) optimized += ` Learn about ${kwSuffix}.`;
    }
    return optimized.slice(0, 160);
  }

  private estimateTrafficChange(prev: number, current: number): number {
    // CTR drops roughly 3x per 10 positions
    const ctrPrev = 0.3 / Math.pow(1.3, prev - 1);
    const ctrCurrent = 0.3 / Math.pow(1.3, current - 1);
    return Math.round((ctrCurrent - ctrPrev) * 10_000);  // per 10k searches
  }

  private emptyResult(): AgentResult {
    const now = new Date();
    return {
      agentId: this.agentId, runId: 'skipped', startedAt: now, completedAt: now,
      durationMs: 0, tasksProcessed: 0, tasksSucceeded: 0, tasksFailed: 0,
      tasksSkipped: 0, recommendationsGenerated: 0, optimizationsApplied: 0,
      rankingChangesDetected: 0, avgPriorityScore: 0, topRecommendations: [], errors: [],
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: SeoOptimizationAgent | null = null;

export function getInstance(config?: Partial<AgentConfig>): SeoOptimizationAgent {
  if (!_instance) {
    _instance = new SeoOptimizationAgent(config);
    logger.info('SeoOptimizationAgent singleton created');
  }
  return _instance;
}

export default SeoOptimizationAgent;
