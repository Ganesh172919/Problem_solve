/**
 * @module dynamicPricingAgent
 * @description Autonomous dynamic pricing agent that continuously ingests demand signals,
 * triggers price optimization across all active policies, monitors experiment results,
 * concludes statistically significant price tests, and generates revenue impact reports.
 */

import { getLogger } from '../lib/logger';
import { getDynamicPricingOptimizer } from '../lib/dynamicPricingOptimizer';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  experimentCheckIntervalMs?: number;
  autoOptimizeEnabled?: boolean;
}

class DynamicPricingAgent {
  private readonly optimizer = getDynamicPricingOptimizer();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private experimentHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      experimentCheckIntervalMs: config.experimentCheckIntervalMs ?? 300_000,
      autoOptimizeEnabled: config.autoOptimizeEnabled ?? true,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollHandle = setInterval(() => this.runOptimizationCycle(), this.config.pollIntervalMs);
    this.experimentHandle = setInterval(() => this.runExperimentReview(), this.config.experimentCheckIntervalMs);
    logger.info('DynamicPricingAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    if (this.experimentHandle) clearInterval(this.experimentHandle);
    this.isRunning = false;
    logger.info('DynamicPricingAgent stopped');
  }

  private runOptimizationCycle(): void {
    if (!this.config.autoOptimizeEnabled) return;
    const policies = this.optimizer.listPolicies();
    let adjusted = 0;
    for (const policy of policies.filter(p => p.adjustmentEnabled)) {
      const event = this.optimizer.optimizePrice(policy.id);
      if (event) {
        adjusted++;
        logger.info('Price auto-adjusted', {
          policyId: policy.id, from: event.previousPriceCents, to: event.newPriceCents,
          reason: event.reason, confidence: event.confidence,
        });
      }
    }
    const summary = this.optimizer.getSummary();
    logger.info('Pricing cycle report', {
      totalPolicies: summary.totalPolicies,
      adjustmentsThisCycle: adjusted,
      activeExperiments: summary.activeExperiments,
      avgDeviation: `${summary.avgBaselineDeviation}%`,
      revenueImpact: `$${summary.estimatedRevenueImpactUsd}`,
    });
  }

  private runExperimentReview(): void {
    const running = this.optimizer.listExperiments('running');
    for (const exp of running) {
      // Auto-conclude if there is enough data (both arms have 200+ conversions)
      const minSamples = 200;
      const hasEnoughData = exp.controlConversions >= minSamples && exp.variantConversions >= minSamples;
      if (hasEnoughData) {
        const concluded = this.optimizer.concludeExperiment(exp.id);
        if (concluded) {
          const controlRpv = concluded.controlConversions > 0
            ? (concluded.controlRevenueCents / concluded.controlConversions).toFixed(0)
            : '0';
          const variantRpv = concluded.variantConversions > 0
            ? (concluded.variantRevenueCents / concluded.variantConversions).toFixed(0)
            : '0';
          logger.info('Price experiment auto-concluded', {
            experimentId: concluded.id,
            winner: concluded.winner,
            controlRpv,
            variantRpv,
          });
        }
      }
    }
  }

  async run(): Promise<void> {
    this.runOptimizationCycle();
    this.runExperimentReview();
  }
}

const KEY = '__dynamicPricingAgent__';
export function getDynamicPricingAgent(config?: AgentConfig): DynamicPricingAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new DynamicPricingAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as DynamicPricingAgent;
}
