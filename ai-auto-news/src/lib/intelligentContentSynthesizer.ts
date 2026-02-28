/**
 * @module intelligentContentSynthesizer
 * @description AI content synthesis engine with semantic topic clustering, content template
 * management, personalized content generation, deduplication via similarity hashing,
 * quality scoring, readability analysis, SEO optimization, freshness decay, multi-format
 * output, and content performance feedback loop.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContentTemplate {
  id: string;
  name: string;
  format: 'article' | 'summary' | 'snippet' | 'headline' | 'social';
  structure: string[];
  variables: string[];
  minWords: number;
  maxWords: number;
  tone: 'formal' | 'casual' | 'technical' | 'marketing';
  createdAt: number;
}

export interface SynthesizedContent {
  id: string;
  templateId: string;
  topicClusterId: string;
  title: string;
  body: string;
  format: ContentTemplate['format'];
  wordCount: number;
  qualityScore: number;
  readabilityScore: number;
  seoScore: number;
  freshnessScore: number;
  similarityHash: string;
  createdAt: number;
  publishedAt?: number;
  metadata: Record<string, unknown>;
}

export interface ContentQualityScore {
  contentId: string;
  overall: number;
  clarity: number;
  depth: number;
  accuracy: number;
  engagement: number;
  originality: number;
  penalties: string[];
  bonuses: string[];
  computedAt: number;
}

export interface TopicCluster {
  id: string;
  label: string;
  keywords: string[];
  centroidVector: number[];
  documentCount: number;
  avgQuality: number;
  lastUpdated: number;
}

export interface ContentPerformance {
  contentId: string;
  views: number;
  clicks: number;
  shares: number;
  avgTimeOnPage: number;
  bounceRate: number;
  ctr: number;
  engagementScore: number;
  updatedAt: number;
}

export interface ReadabilityMetrics {
  fleschKincaidGrade: number;
  fleschReadingEase: number;
  avgSentenceLength: number;
  avgWordLength: number;
  complexWordRatio: number;
  score: number;
}

export interface SEOMetrics {
  keywordDensity: number;
  titleLength: number;
  headingCount: number;
  internalLinks: number;
  metaDescriptionLength: number;
  score: number;
  suggestions: string[];
}

export interface ContentSynthesizerSummary {
  totalTemplates: number;
  totalContent: number;
  totalClusters: number;
  avgQualityScore: number;
  avgReadabilityScore: number;
  avgSeoScore: number;
  duplicatesDetected: number;
  topPerformingTopics: string[];
  contentByFormat: Record<string, number>;
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class IntelligentContentSynthesizer {
  private templates: Map<string, ContentTemplate> = new Map();
  private content: Map<string, SynthesizedContent> = new Map();
  private clusters: Map<string, TopicCluster> = new Map();
  private performance: Map<string, ContentPerformance> = new Map();
  private hashIndex: Map<string, string> = new Map(); // hash -> contentId
  private duplicateCount = 0;
  private readonly FRESHNESS_DECAY_RATE = 0.02; // per hour
  private readonly SIMILARITY_THRESHOLD = 0.85;

  constructor() {
    logger.info('[IntelligentContentSynthesizer] Initialized content synthesis engine');
  }

  /**
   * Register a content template for use in synthesis.
   */
  createTemplate(template: ContentTemplate): void {
    this.templates.set(template.id, { ...template, createdAt: template.createdAt || Date.now() });
    logger.info(`[IntelligentContentSynthesizer] Template '${template.id}' registered (${template.format})`);
  }

  /**
   * Synthesize content from a template and topic cluster with variable substitution.
   */
  synthesizeContent(
    templateId: string,
    clusterId: string,
    variables: Record<string, string>,
    personalizationContext?: Record<string, unknown>,
  ): SynthesizedContent {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);
    const cluster = this.clusters.get(clusterId);

    // Build body by filling template structure with variables
    const bodyParts = template.structure.map(section => {
      return template.variables.reduce((acc, v) => {
        const val = variables[v] ?? `[${v}]`;
        return acc.replace(new RegExp(`\\{\\{${v}\\}\\}`, 'g'), val);
      }, section);
    });

    const body = bodyParts.join(' ');
    const title = variables['title'] ?? (cluster?.label ?? 'Untitled');
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    const similarityHash = this.computeSimilarityHash(title + body);

    // Check for duplicates
    const existing = this.detectDuplicate(similarityHash);
    if (existing) {
      this.duplicateCount++;
      logger.warn(`[IntelligentContentSynthesizer] Duplicate detected for template ${templateId}`);
    }

    const readability = this.computeReadability(body);
    const seoMetrics = this.optimizeSEO(title, body, cluster?.keywords ?? []);
    const qualityScore = this.scoreQuality({
      id: 'temp',
      templateId,
      topicClusterId: clusterId,
      title,
      body,
      format: template.format,
      wordCount,
      qualityScore: 0,
      readabilityScore: readability.score,
      seoScore: seoMetrics.score,
      freshnessScore: 100,
      similarityHash,
      createdAt: Date.now(),
      metadata: personalizationContext ?? {},
    }).overall;

    const id = `content_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const synthesized: SynthesizedContent = {
      id,
      templateId,
      topicClusterId: clusterId,
      title,
      body,
      format: template.format,
      wordCount,
      qualityScore,
      readabilityScore: readability.score,
      seoScore: seoMetrics.score,
      freshnessScore: 100,
      similarityHash,
      createdAt: Date.now(),
      metadata: personalizationContext ?? {},
    };

    this.content.set(id, synthesized);
    this.hashIndex.set(similarityHash, id);

    if (cluster) {
      cluster.documentCount++;
      cluster.avgQuality = (cluster.avgQuality * (cluster.documentCount - 1) + qualityScore) / cluster.documentCount;
      cluster.lastUpdated = Date.now();
    }

    logger.info(`[IntelligentContentSynthesizer] Synthesized content ${id} (${wordCount} words, quality=${qualityScore})`);
    return synthesized;
  }

  /**
   * Score content quality across multiple dimensions.
   */
  scoreQuality(content: SynthesizedContent): ContentQualityScore {
    const penalties: string[] = [];
    const bonuses: string[] = [];
    let score = 50;

    // Word count scoring
    const template = this.templates.get(content.templateId);
    if (template) {
      if (content.wordCount < template.minWords) {
        penalties.push('too_short');
        score -= 15;
      } else if (content.wordCount > template.maxWords) {
        penalties.push('too_long');
        score -= 5;
      } else {
        bonuses.push('optimal_length');
        score += 10;
      }
    }

    // Readability
    const readability = this.computeReadability(content.body);
    const readabilityBonus = readability.score > 70 ? 15 : readability.score > 50 ? 8 : 0;
    score += readabilityBonus;
    if (readabilityBonus > 10) bonuses.push('high_readability');

    // Unique words ratio (originality proxy)
    const words = content.body.toLowerCase().split(/\s+/).filter(Boolean);
    const uniqueRatio = words.length > 0 ? new Set(words).size / words.length : 0;
    if (uniqueRatio > 0.6) { bonuses.push('high_originality'); score += 10; }
    else if (uniqueRatio < 0.3) { penalties.push('low_originality'); score -= 10; }

    // Freshness decay
    const ageHours = (Date.now() - content.createdAt) / (1000 * 60 * 60);
    const freshness = Math.max(0, 100 - ageHours * this.FRESHNESS_DECAY_RATE * 100);
    if (freshness < 50) { penalties.push('stale_content'); score -= 10; }

    const finalScore = Math.max(0, Math.min(100, score));
    const result: ContentQualityScore = {
      contentId: content.id,
      overall: parseFloat(finalScore.toFixed(1)),
      clarity: parseFloat(readability.score.toFixed(1)),
      depth: parseFloat(Math.min(100, (content.wordCount / 10)).toFixed(1)),
      accuracy: 75, // static without external fact-checking
      engagement: parseFloat((uniqueRatio * 100).toFixed(1)),
      originality: parseFloat((uniqueRatio * 100).toFixed(1)),
      penalties,
      bonuses,
      computedAt: Date.now(),
    };

    logger.debug(`[IntelligentContentSynthesizer] Quality score for ${content.id}: ${result.overall}`);
    return result;
  }

  /**
   * Cluster topics using keyword-based centroid grouping.
   */
  clusterTopics(topics: Array<{ label: string; keywords: string[] }>): TopicCluster[] {
    const clusters: TopicCluster[] = [];

    for (const topic of topics) {
      // Represent keywords as a simple term-frequency vector
      const vector = this.buildTermVector(topic.keywords);
      const existingCluster = this.findNearestCluster(vector);

      if (existingCluster && this.cosineSimilarity(existingCluster.centroidVector, vector) > this.SIMILARITY_THRESHOLD) {
        // Merge into existing
        existingCluster.keywords = [...new Set([...existingCluster.keywords, ...topic.keywords])];
        existingCluster.centroidVector = this.averageVectors(existingCluster.centroidVector, vector);
        existingCluster.documentCount++;
        existingCluster.lastUpdated = Date.now();
      } else {
        const id = `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const cluster: TopicCluster = {
          id,
          label: topic.label,
          keywords: [...topic.keywords],
          centroidVector: vector,
          documentCount: 1,
          avgQuality: 0,
          lastUpdated: Date.now(),
        };
        this.clusters.set(id, cluster);
        clusters.push(cluster);
      }
    }

    logger.info(`[IntelligentContentSynthesizer] Clustered ${topics.length} topics into ${this.clusters.size} clusters`);
    return clusters;
  }

  /**
   * Check if content is a duplicate by similarity hash.
   */
  detectDuplicate(similarityHash: string): string | null {
    return this.hashIndex.get(similarityHash) ?? null;
  }

  /**
   * Compute Flesch readability metrics for a piece of text.
   */
  computeReadability(text: string): ReadabilityMetrics {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(Boolean);
    const syllableCount = words.reduce((sum, w) => sum + this.countSyllables(w), 0);

    const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;
    const avgSyllablesPerWord = words.length > 0 ? syllableCount / words.length : 0;
    const avgWordLength = words.length > 0
      ? words.reduce((s, w) => s + w.length, 0) / words.length
      : 0;
    const complexWords = words.filter(w => this.countSyllables(w) >= 3).length;
    const complexWordRatio = words.length > 0 ? complexWords / words.length : 0;

    // Flesch Reading Ease formula
    const fleschReadingEase = Math.max(0, Math.min(100,
      206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord,
    ));

    // Flesch-Kincaid Grade Level
    const fleschKincaidGrade = Math.max(0,
      0.39 * avgSentenceLength + 11.8 * avgSyllablesPerWord - 15.59,
    );

    const score = Math.min(100, fleschReadingEase);

    return {
      fleschKincaidGrade: parseFloat(fleschKincaidGrade.toFixed(1)),
      fleschReadingEase: parseFloat(fleschReadingEase.toFixed(1)),
      avgSentenceLength: parseFloat(avgSentenceLength.toFixed(1)),
      avgWordLength: parseFloat(avgWordLength.toFixed(1)),
      complexWordRatio: parseFloat(complexWordRatio.toFixed(4)),
      score: parseFloat(score.toFixed(1)),
    };
  }

  /**
   * Compute SEO score and return optimization suggestions.
   */
  optimizeSEO(title: string, body: string, targetKeywords: string[]): SEOMetrics {
    const suggestions: string[] = [];
    const words = body.toLowerCase().split(/\s+/).filter(Boolean);
    const totalWords = words.length;

    let keywordDensity = 0;
    if (targetKeywords.length > 0 && totalWords > 0) {
      const kwHits = targetKeywords.reduce((cnt, kw) => {
        return cnt + words.filter(w => w.includes(kw.toLowerCase())).length;
      }, 0);
      keywordDensity = kwHits / totalWords;
    }

    if (keywordDensity < 0.01) suggestions.push('increase_keyword_density');
    if (keywordDensity > 0.05) suggestions.push('reduce_keyword_stuffing');

    const titleLength = title.length;
    if (titleLength < 30) suggestions.push('title_too_short');
    if (titleLength > 70) suggestions.push('title_too_long');

    const headingCount = (body.match(/#{1,3}\s/g) ?? []).length;
    if (headingCount === 0) suggestions.push('add_subheadings');

    const internalLinks = (body.match(/\[.+?\]\(.+?\)/g) ?? []).length;
    if (internalLinks === 0) suggestions.push('add_internal_links');

    const metaDescriptionLength = Math.min(body.length, 160);

    let score = 50;
    if (keywordDensity >= 0.01 && keywordDensity <= 0.05) score += 20;
    if (titleLength >= 30 && titleLength <= 70) score += 15;
    if (headingCount > 0) score += 10;
    if (internalLinks > 0) score += 5;

    return {
      keywordDensity: parseFloat(keywordDensity.toFixed(4)),
      titleLength,
      headingCount,
      internalLinks,
      metaDescriptionLength,
      score: Math.min(100, score),
      suggestions,
    };
  }

  /**
   * Update performance metrics for a piece of content and refresh its quality score.
   */
  recordPerformanceFeedback(
    contentId: string,
    views: number,
    clicks: number,
    shares: number,
    avgTimeOnPage: number,
    bounceRate: number,
  ): void {
    const ctr = views > 0 ? clicks / views : 0;
    const engagementScore = parseFloat(
      (ctr * 40 + (1 - bounceRate) * 30 + Math.min(1, avgTimeOnPage / 300) * 30).toFixed(2),
    );

    this.performance.set(contentId, {
      contentId, views, clicks, shares, avgTimeOnPage, bounceRate, ctr,
      engagementScore,
      updatedAt: Date.now(),
    });

    const item = this.content.get(contentId);
    if (item) {
      item.qualityScore = parseFloat(
        (item.qualityScore * 0.7 + engagementScore * 100 * 0.3).toFixed(1),
      );
    }

    logger.debug(`[IntelligentContentSynthesizer] Performance feedback for ${contentId}: CTR=${ctr.toFixed(3)}`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private computeSimilarityHash(text: string): string {
    // Simple rolling polynomial hash (not cryptographic)
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) + h) ^ text.charCodeAt(i);
      h = h >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  private countSyllables(word: string): number {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  private buildTermVector(keywords: string[]): number[] {
    const len = 32;
    const vec = new Array<number>(len).fill(0);
    for (const kw of keywords) {
      let h = 0;
      for (let i = 0; i < kw.length; i++) h = (h * 31 + kw.charCodeAt(i)) % len;
      vec[h]++;
    }
    return vec;
  }

  private findNearestCluster(vector: number[]): TopicCluster | null {
    let best: TopicCluster | null = null;
    let bestSim = -1;
    for (const cluster of this.clusters.values()) {
      const sim = this.cosineSimilarity(cluster.centroidVector, vector);
      if (sim > bestSim) { bestSim = sim; best = cluster; }
    }
    return best;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom > 0 ? dot / denom : 0;
  }

  private averageVectors(a: number[], b: number[]): number[] {
    const len = Math.max(a.length, b.length);
    return Array.from({ length: len }, (_, i) => ((a[i] ?? 0) + (b[i] ?? 0)) / 2);
  }

  /**
   * Return a high-level summary of the synthesis engine state.
   */
  getSummary(): ContentSynthesizerSummary {
    const allContent = Array.from(this.content.values());
    const avgQuality = allContent.length > 0
      ? allContent.reduce((s, c) => s + c.qualityScore, 0) / allContent.length : 0;
    const avgReadability = allContent.length > 0
      ? allContent.reduce((s, c) => s + c.readabilityScore, 0) / allContent.length : 0;
    const avgSeo = allContent.length > 0
      ? allContent.reduce((s, c) => s + c.seoScore, 0) / allContent.length : 0;

    const contentByFormat: Record<string, number> = {};
    for (const c of allContent) {
      contentByFormat[c.format] = (contentByFormat[c.format] ?? 0) + 1;
    }

    const topClusters = Array.from(this.clusters.values())
      .sort((a, b) => b.avgQuality - a.avgQuality)
      .slice(0, 5)
      .map(c => c.label);

    const summary: ContentSynthesizerSummary = {
      totalTemplates: this.templates.size,
      totalContent: this.content.size,
      totalClusters: this.clusters.size,
      avgQualityScore: parseFloat(avgQuality.toFixed(2)),
      avgReadabilityScore: parseFloat(avgReadability.toFixed(2)),
      avgSeoScore: parseFloat(avgSeo.toFixed(2)),
      duplicatesDetected: this.duplicateCount,
      topPerformingTopics: topClusters,
      contentByFormat,
    };

    logger.info(`[IntelligentContentSynthesizer] Summary: ${summary.totalContent} items, avgQuality=${summary.avgQualityScore}`);
    return summary;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__intelligentContentSynthesizer__';
export function getIntelligentContentSynthesizer(): IntelligentContentSynthesizer {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new IntelligentContentSynthesizer();
  }
  return (globalThis as Record<string, unknown>)[KEY] as IntelligentContentSynthesizer;
}
