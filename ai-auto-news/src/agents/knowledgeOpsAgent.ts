/**
 * @module knowledgeOpsAgent
 * @description Knowledge operations agent that manages organizational knowledge
 * assets: automatically ingests content, extracts entities and relationships,
 * maintains a living knowledge graph, detects knowledge gaps, and proactively
 * surfaces relevant insights to users and other agents.
 */

import { getLogger } from '../lib/logger';
import { getKnowledgeDistillation, KnowledgeUnit } from '../lib/knowledgeDistillationEngine';

const logger = getLogger();

export interface KnowledgeDocument {
  id: string;
  source: string;
  title: string;
  content: string;
  domain: string;
  entities: string[];
  relations: Array<{ from: string; to: string; type: string }>;
  summary: string;
  keywords: string[];
  quality: number;
  ingestedAt: number;
  updatedAt: number;
  tenantId: string;
}

export interface KnowledgeGap {
  domain: string;
  topic: string;
  evidenceCount: number;    // how many queries hit this gap
  confidence: number;
  suggestedSources: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface KnowledgeInsight {
  id: string;
  type: 'trend' | 'anomaly' | 'connection' | 'update' | 'gap';
  title: string;
  description: string;
  domains: string[];
  relevantDocIds: string[];
  confidence: number;
  actionable: boolean;
  generatedAt: number;
}

export interface KnowledgeQuery {
  query: string;
  domain?: string;
  userId?: string;
  tenantId: string;
  topK?: number;
}

export interface KnowledgeSearchResult {
  documents: Array<{ doc: KnowledgeDocument; score: number; highlights: string[] }>;
  gaps: KnowledgeGap[];
  relatedInsights: KnowledgeInsight[];
  totalFound: number;
  queryTime: number;
}

// ── Simple TF-IDF Ranker ──────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
}

function tfIdfScore(query: string, document: string): number {
  const queryTokens = new Set(tokenize(query));
  const docTokens = tokenize(document);
  const docLength = Math.max(1, docTokens.length);

  let score = 0;
  const tokenFreq = new Map<string, number>();
  for (const t of docTokens) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);

  for (const qt of queryTokens) {
    const freq = tokenFreq.get(qt) ?? 0;
    if (freq > 0) {
      const tf = freq / docLength;
      score += tf;
    }
  }

  return score;
}

function extractHighlights(query: string, content: string, maxLen = 200): string[] {
  const queryTokens = tokenize(query);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const scored = sentences.map(s => ({
    text: s.trim(),
    score: queryTokens.filter(qt => s.toLowerCase().includes(qt)).length,
  }));
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.text.slice(0, maxLen));
}

// ── Core Agent ────────────────────────────────────────────────────────────────

export class KnowledgeOpsAgent {
  private documents = new Map<string, KnowledgeDocument>();
  private gaps = new Map<string, KnowledgeGap>();
  private insights: KnowledgeInsight[] = [];
  private queryLog: Array<{ query: string; timestamp: number; found: number }> = [];
  private distillation = getKnowledgeDistillation();
  private ingestionCount = 0;
  private maintenanceHandle: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.maintenanceHandle = setInterval(() => this.runMaintenance(), 300_000);
    logger.info('KnowledgeOpsAgent started');
  }

  stop(): void {
    if (this.maintenanceHandle) {
      clearInterval(this.maintenanceHandle);
      this.maintenanceHandle = null;
    }
    logger.info('KnowledgeOpsAgent stopped');
  }

  ingest(doc: KnowledgeDocument): void {
    this.documents.set(doc.id, doc);
    this.ingestionCount++;

    // Add to distillation knowledge bank
    const unit: KnowledgeUnit = {
      id: doc.id,
      domain: doc.domain,
      input: doc.title,
      teacherOutput: doc.summary || doc.content.slice(0, 500),
      softLabels: [],
      features: [],
      attention: [],
      quality: doc.quality,
      timestamp: doc.ingestedAt,
    };
    this.distillation.addKnowledgeUnit(unit);

    // Close relevant gap if exists
    this.closeGap(doc.domain, doc.keywords);

    logger.debug('Document ingested', { id: doc.id, domain: doc.domain });
  }

  ingestBatch(docs: KnowledgeDocument[]): void {
    for (const doc of docs) this.ingest(doc);
    logger.info('Batch ingested', { count: docs.length });
  }

  search(query: KnowledgeQuery): KnowledgeSearchResult {
    const start = Date.now();
    const topK = query.topK ?? 10;

    // Filter by tenant and optionally domain
    let candidates = Array.from(this.documents.values())
      .filter(d => d.tenantId === query.tenantId);
    if (query.domain) {
      candidates = candidates.filter(d => d.domain === query.domain);
    }

    // Score documents
    const scored = candidates.map(doc => {
      const titleScore = tfIdfScore(query.query, doc.title) * 3;
      const contentScore = tfIdfScore(query.query, doc.content);
      const summaryScore = tfIdfScore(query.query, doc.summary) * 2;
      const keywordScore = doc.keywords.filter(k =>
        query.query.toLowerCase().includes(k.toLowerCase())
      ).length * 0.5;

      const score = (titleScore + contentScore + summaryScore + keywordScore) * doc.quality;
      return { doc, score, highlights: extractHighlights(query.query, doc.content) };
    });

    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK).filter(r => r.score > 0);

    // Log query
    this.queryLog.push({ query: query.query, timestamp: Date.now(), found: topResults.length });
    if (this.queryLog.length > 10000) this.queryLog.shift();

    // Detect gaps when few results found
    if (topResults.length < 3) {
      this.recordGap(query.query, query.domain ?? 'general');
    }

    const relatedInsights = this.insights
      .filter(i => i.domains.some(d => !query.domain || d === query.domain))
      .slice(0, 3);

    return {
      documents: topResults,
      gaps: Array.from(this.gaps.values()).slice(0, 5),
      relatedInsights,
      totalFound: topResults.length,
      queryTime: Date.now() - start,
    };
  }

  private recordGap(query: string, domain: string): void {
    const key = `${domain}:${tokenize(query).slice(0, 3).join('_')}`;
    const existing = this.gaps.get(key);
    if (existing) {
      existing.evidenceCount++;
      if (existing.evidenceCount > 10 && existing.priority !== 'critical') {
        existing.priority = 'high';
      }
    } else {
      this.gaps.set(key, {
        domain,
        topic: query.slice(0, 100),
        evidenceCount: 1,
        confidence: 0.6,
        suggestedSources: [],
        priority: 'low',
      });
    }
  }

  private closeGap(domain: string, keywords: string[]): void {
    for (const [key, gap] of this.gaps.entries()) {
      if (gap.domain === domain && keywords.some(k => gap.topic.toLowerCase().includes(k.toLowerCase()))) {
        gap.confidence = Math.max(0, gap.confidence - 0.3);
        if (gap.confidence < 0.1) this.gaps.delete(key);
      }
    }
  }

  private runMaintenance(): void {
    // Generate insights from recent activity
    this.generateInsights();

    // Expire old query logs
    const cutoff = Date.now() - 86400_000;
    while (this.queryLog.length > 0 && this.queryLog[0]!.timestamp < cutoff) {
      this.queryLog.shift();
    }

    logger.debug('KnowledgeOps maintenance completed', {
      documents: this.documents.size,
      gaps: this.gaps.size,
      insights: this.insights.length,
    });
  }

  private generateInsights(): void {
    // Trend: domain with most recent activity
    const domainCounts = new Map<string, number>();
    for (const doc of this.documents.values()) {
      if (Date.now() - doc.ingestedAt < 86400_000) {
        domainCounts.set(doc.domain, (domainCounts.get(doc.domain) ?? 0) + 1);
      }
    }

    const topDomain = Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1])[0];

    if (topDomain && topDomain[1] > 5) {
      this.insights.push({
        id: `insight_${Date.now()}`,
        type: 'trend',
        title: `High activity in '${topDomain[0]}' domain`,
        description: `${topDomain[1]} new documents ingested in the last 24 hours`,
        domains: [topDomain[0]],
        relevantDocIds: [],
        confidence: 0.8,
        actionable: true,
        generatedAt: Date.now(),
      });
    }

    // Gap insights
    const criticalGaps = Array.from(this.gaps.values()).filter(g => g.priority === 'critical');
    for (const gap of criticalGaps.slice(0, 3)) {
      this.insights.push({
        id: `insight_gap_${Date.now()}`,
        type: 'gap',
        title: `Knowledge gap detected: ${gap.topic}`,
        description: `${gap.evidenceCount} queries failed to find relevant content in '${gap.domain}'`,
        domains: [gap.domain],
        relevantDocIds: [],
        confidence: gap.confidence,
        actionable: true,
        generatedAt: Date.now(),
      });
    }

    // Keep only recent insights
    this.insights = this.insights.slice(-200);
  }

  getGaps(): KnowledgeGap[] {
    return Array.from(this.gaps.values()).sort((a, b) => b.evidenceCount - a.evidenceCount);
  }

  getInsights(): KnowledgeInsight[] {
    return this.insights.slice(-50);
  }

  getStats(): {
    totalDocuments: number;
    ingestionCount: number;
    knowledgeGaps: number;
    insights: number;
    queries24h: number;
    domains: number;
  } {
    const cutoff = Date.now() - 86400_000;
    return {
      totalDocuments: this.documents.size,
      ingestionCount: this.ingestionCount,
      knowledgeGaps: this.gaps.size,
      insights: this.insights.length,
      queries24h: this.queryLog.filter(q => q.timestamp > cutoff).length,
      domains: new Set(Array.from(this.documents.values()).map(d => d.domain)).size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __knowledgeOpsAgent__: KnowledgeOpsAgent | undefined;
}

export function getKnowledgeOpsAgent(): KnowledgeOpsAgent {
  if (!globalThis.__knowledgeOpsAgent__) {
    globalThis.__knowledgeOpsAgent__ = new KnowledgeOpsAgent();
  }
  return globalThis.__knowledgeOpsAgent__;
}
