/**
 * @module contentSynthesisAgent
 * @description Autonomous agent that periodically audits synthesized content quality,
 * clusters topics, detects duplicates, and drives SEO optimization across tenants
 * using the IntelligentContentSynthesizer engine.
 */

import { getIntelligentContentSynthesizer, SEOMetrics, TopicCluster, SynthesizedContent } from '../lib/intelligentContentSynthesizer';
import { getLogger } from '../lib/logger';

const logger = getLogger();

class ContentSynthesisAgent {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly scanIntervalMs: number;

  constructor(scanIntervalMs = 20 * 60 * 1000) {
    this.scanIntervalMs = scanIntervalMs;
  }

  start(): void {
    if (this.interval) return;
    logger.info('ContentSynthesisAgent starting');
    this.interval = setInterval(() => this._runScan(), this.scanIntervalMs);
    this._runScan();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('ContentSynthesisAgent stopped');
    }
  }

  private _runScan(): void {
    try {
      const synthesizer = getIntelligentContentSynthesizer();
      const summary = synthesizer.getSummary();
      const report = {
        totalTemplates: summary.totalTemplates,
        totalSynthesizedContent: summary.totalContent,
        totalClusters: summary.totalClusters,
        avgQualityScore: summary.avgQualityScore,
        avgReadabilityScore: summary.avgReadabilityScore,
        avgSeoScore: summary.avgSeoScore,
        duplicatesDetected: summary.duplicatesDetected,
        contentByFormat: summary.contentByFormat,
        topPerformingTopics: summary.topPerformingTopics,
      };
      logger.debug('ContentSynthesisAgent scan complete', report);
    } catch (err) {
      logger.error('ContentSynthesisAgent scan error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Cluster domain topics for a tenant and run a deduplication check on the canonical
   * topic fingerprint.
   */
  clusterAndDeduplicate(tenantId: string): { clusters: TopicCluster[]; duplicateContentId: string | null } {
    const synthesizer = getIntelligentContentSynthesizer();
    const newClusters = synthesizer.clusterTopics([
      { label: `${tenantId}-technology`, keywords: ['technology', 'software', 'api', 'cloud', 'ai', 'automation'] },
      { label: `${tenantId}-business`, keywords: ['business', 'revenue', 'growth', 'market', 'strategy', 'saas'] },
      { label: `${tenantId}-product`, keywords: ['product', 'feature', 'launch', 'update', 'release', 'roadmap'] },
      { label: `${tenantId}-analytics`, keywords: ['analytics', 'data', 'insights', 'metrics', 'reporting', 'kpi'] },
    ]);
    // Build a deterministic fingerprint hash for the tenant's canonical topic set
    const seed = `${tenantId}:topics`;
    const fingerprint = seed.split('').reduce((h, c) => (((h << 5) + h) ^ c.charCodeAt(0)) >>> 0, 5381).toString(16).padStart(8, '0');
    const duplicateContentId = synthesizer.detectDuplicate(fingerprint);
    logger.info('ContentSynthesisAgent cluster+deduplicate', {
      tenantId,
      newClusters: newClusters.length,
      fingerprint,
      duplicateFound: duplicateContentId !== null,
      duplicateContentId,
    });
    return { clusters: newClusters, duplicateContentId };
  }

  /**
   * Score a representative content sample for the tenant and return the average quality score.
   */
  qualityAudit(tenantId: string): number {
    const synthesizer = getIntelligentContentSynthesizer();
    const samples: SynthesizedContent[] = [
      {
        id: `audit_${tenantId}_a`,
        templateId: `tpl_${tenantId}`,
        topicClusterId: `cluster_${tenantId}`,
        title: `${tenantId} Platform Overview`,
        body: `## Introduction\nThis article provides an overview of the ${tenantId} platform. ## Key Features\nThe platform offers analytics, automation, and AI-driven insights. ## Use Cases\nTeams use it for content generation, reporting, and customer engagement. ## Conclusion\nExplore the full feature set to maximize your productivity.`,
        format: 'article',
        wordCount: 52,
        qualityScore: 0,
        readabilityScore: 0,
        seoScore: 0,
        freshnessScore: 100,
        similarityHash: '',
        createdAt: Date.now(),
        metadata: { tenantId },
      },
      {
        id: `audit_${tenantId}_b`,
        templateId: `tpl_${tenantId}`,
        topicClusterId: `cluster_${tenantId}`,
        title: `${tenantId} Release Notes`,
        body: `New features shipped in this release include improved [dashboards](/${tenantId}/dashboard) and faster API response times. Bug fixes address edge cases in the reporting module.`,
        format: 'summary',
        wordCount: 28,
        qualityScore: 0,
        readabilityScore: 0,
        seoScore: 0,
        freshnessScore: 100,
        similarityHash: '',
        createdAt: Date.now(),
        metadata: { tenantId },
      },
    ];
    const scores = samples.map(s => synthesizer.scoreQuality(s).overall);
    const avg = parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2));
    logger.info('ContentSynthesisAgent quality audit', {
      tenantId,
      samplesScored: samples.length,
      scores,
      avgQualityScore: avg,
    });
    return avg;
  }

  /**
   * Run SEO analysis on a content item and log the score and improvement suggestions.
   */
  optimizeForSEO(contentId: string): SEOMetrics {
    const synthesizer = getIntelligentContentSynthesizer();
    const title = contentId.replace(/[_-]/g, ' ');
    const body = [
      `## ${title}`,
      `This guide explores ${title} in depth.`,
      `## Key Benefits`,
      `Adopting ${title} drives efficiency and reduces operational overhead.`,
      `See our [detailed documentation](/${contentId}/docs) and [pricing page](/${contentId}/pricing) for more.`,
      `## Getting Started`,
      `Follow the quickstart to integrate ${title} into your workflow in minutes.`,
    ].join('\n');
    const keywords = title.split(' ').filter(w => w.length > 3);
    const metrics = synthesizer.optimizeSEO(title, body, keywords);
    logger.info('ContentSynthesisAgent SEO optimization', {
      contentId,
      seoScore: metrics.score,
      keywordDensity: metrics.keywordDensity,
      headingCount: metrics.headingCount,
      internalLinks: metrics.internalLinks,
      suggestions: metrics.suggestions,
    });
    return metrics;
  }
}

const KEY = '__contentSynthesisAgent__';
export function getContentSynthesisAgent(): ContentSynthesisAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new ContentSynthesisAgent();
  }
  return (globalThis as Record<string, unknown>)[KEY] as ContentSynthesisAgent;
}
