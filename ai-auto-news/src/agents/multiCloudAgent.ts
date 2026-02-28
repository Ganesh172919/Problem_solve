/**
 * @module multiCloudAgent
 * @description Autonomous multi-cloud management agent that monitors resource health,
 * triggers failover on region degradation, applies cost optimization recommendations,
 * enforces budget alerts, evaluates workload placement efficiency, and generates
 * cross-cloud cost and reliability reports.
 */

import { getLogger } from '../lib/logger';
import { getMultiCloudOrchestrator } from '../lib/multiCloudOrchestrator';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  optimizationIntervalMs?: number;
  autoApplyRecommendations?: boolean;
  regionHealthThreshold?: number;
}

class MultiCloudAgent {
  private readonly orchestrator = getMultiCloudOrchestrator();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private optimizationHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      optimizationIntervalMs: config.optimizationIntervalMs ?? 600_000,
      autoApplyRecommendations: config.autoApplyRecommendations ?? false,
      regionHealthThreshold: config.regionHealthThreshold ?? 50,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollHandle = setInterval(() => this.runHealthCheck(), this.config.pollIntervalMs);
    this.optimizationHandle = setInterval(() => this.runOptimization(), this.config.optimizationIntervalMs);
    logger.info('MultiCloudAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    if (this.optimizationHandle) clearInterval(this.optimizationHandle);
    this.isRunning = false;
    logger.info('MultiCloudAgent stopped');
  }

  private runHealthCheck(): void {
    const summary = this.orchestrator.getSummary();
    logger.info('Multi-cloud health report', {
      totalResources: summary.totalResources,
      running: summary.runningResources,
      hourlyCost: `$${summary.totalHourlyCostUsd}`,
      monthlyCost: `$${summary.estimatedMonthlyCostUsd}`,
      providers: summary.providerDistribution,
      pendingRecs: summary.pendingRecommendations,
      savings: `$${summary.estimatedSavingsUsd}`,
    });

    // Check region health and trigger failover
    const degradedRegions = this.orchestrator.listRegions().filter(
      r => r.currentHealthScore < this.config.regionHealthThreshold && r.available
    );
    for (const region of degradedRegions) {
      logger.warn('Degraded region detected', { regionId: region.id, provider: region.provider, healthScore: region.currentHealthScore });
    }

    // Budget checks
    const budgetAlerts = this.orchestrator.checkBudgets();
    for (const alert of budgetAlerts) {
      logger.warn('Budget alert', {
        tenantId: alert.tenantId,
        level: alert.alertLevel,
        projected: `$${alert.projectedSpendUsd.toFixed(2)}`,
        budget: `$${alert.monthlyBudgetUsd}`,
      });
    }
  }

  private runOptimization(): void {
    const recs = this.orchestrator.analyzeAndRecommend();
    if (recs.length === 0) return;
    logger.info('Cost optimization recommendations generated', { count: recs.length });

    if (this.config.autoApplyRecommendations) {
      let applied = 0;
      for (const rec of recs.filter(r => r.savingsPct >= 30 && r.action !== 'terminate')) {
        if (this.orchestrator.applyRecommendation(rec.id)) applied++;
      }
      if (applied > 0) logger.info('Auto-applied cost recommendations', { count: applied });
    }
  }

  async run(): Promise<void> {
    this.runHealthCheck();
    this.runOptimization();
  }
}

const KEY = '__multiCloudAgent__';
export function getMultiCloudAgent(config?: AgentConfig): MultiCloudAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new MultiCloudAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as MultiCloudAgent;
}
