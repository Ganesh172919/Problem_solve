/**
 * @module documentationAgent
 * @description Autonomous documentation generation and maintenance agent that
 * continuously detects stale pages, triggers regeneration, audits quality scores,
 * and generates periodic documentation health reports.
 */

import { getLogger } from '../lib/logger';
import { getDocumentationEngine } from '../lib/aiDrivenDocumentation';

const logger = getLogger();

interface AgentConfig {
  checkIntervalMs?: number;
  staleThresholdDays?: number;
  minQualityScore?: number;
  targetTenantId?: string;
}

class DocumentationAgent {
  private readonly engine = getDocumentationEngine();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly config: Required<AgentConfig>;
  private isRunning = false;

  constructor(config: AgentConfig = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 300_000,
      staleThresholdDays: config.staleThresholdDays ?? 90,
      minQualityScore: config.minQualityScore ?? 60,
      targetTenantId: config.targetTenantId ?? '',
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.run(), this.config.checkIntervalMs);
    logger.info('DocumentationAgent started', { checkIntervalMs: this.config.checkIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.isRunning = false;
    logger.info('DocumentationAgent stopped');
  }

  async run(): Promise<void> {
    try {
      await this.detectAndFlagStalePages();
      await this.auditQuality();
      this.logHealthSummary();
    } catch (err) {
      logger.error('DocumentationAgent cycle error', err as Error);
    }
  }

  private async detectAndFlagStalePages(): Promise<void> {
    const tenantId = this.config.targetTenantId;
    if (!tenantId) return;

    const stale = this.engine.detectStalePages(tenantId, this.config.staleThresholdDays);
    if (stale.length > 0) {
      logger.warn('DocumentationAgent: Stale pages detected', {
        tenantId,
        count: stale.length,
        titles: stale.slice(0, 5).map(p => p.title),
      });
    }
  }

  private async auditQuality(): Promise<void> {
    const tenantId = this.config.targetTenantId;
    const pages = this.engine.listPages(tenantId || undefined, undefined, 'published');

    let lowQualityCount = 0;
    for (const page of pages.slice(0, 20)) {
      const report = this.engine.auditQuality(page.id);
      if (report.overallScore < this.config.minQualityScore) {
        lowQualityCount++;
        logger.warn('Low quality documentation page', {
          pageId: page.id,
          title: page.title,
          score: report.overallScore,
          suggestions: report.suggestions,
        });
      }
    }

    if (lowQualityCount > 0) {
      logger.info('DocumentationAgent: Quality audit complete', { lowQualityPages: lowQualityCount, reviewed: Math.min(20, pages.length) });
    }
  }

  private logHealthSummary(): void {
    const summary = this.engine.getDashboardSummary();
    logger.info('DocumentationAgent health summary', {
      totalPages: summary.totalPages,
      publishedPages: summary.publishedPages,
      stalePages: summary.stalePages,
      avgQualityScore: summary.avgQualityScore,
      runbooks: summary.totalRunbooks,
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      engineSummary: this.engine.getDashboardSummary(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _agent: DocumentationAgent | null = null;

export function getDocumentationAgent(config?: AgentConfig): DocumentationAgent {
  if (!_agent) _agent = new DocumentationAgent(config);
  return _agent;
}

export { DocumentationAgent };
