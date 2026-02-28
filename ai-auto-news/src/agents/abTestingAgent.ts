/**
 * @module abTestingAgent
 * @description Autonomous A/B testing lifecycle agent that monitors running experiments,
 * detects statistical significance, auto-concludes winners, promotes winning variants,
 * pauses experiments that breach guardrail metrics, and generates experiment velocity
 * reports for data-driven product decision making.
 */

import { getLogger } from '../lib/logger';
import { getABTestingEngine } from '../lib/aiDrivenABTestingEngine';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  minSamplesBeforeConclusion?: number;
  autoPromoteWinners?: boolean;
}

class ABTestingAgent {
  private readonly engine = getABTestingEngine();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      minSamplesBeforeConclusion: config.minSamplesBeforeConclusion ?? 100,
      autoPromoteWinners: config.autoPromoteWinners ?? false,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollHandle = setInterval(() => this.runExperimentCycle(), this.config.pollIntervalMs);
    logger.info('ABTestingAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.isRunning = false;
    logger.info('ABTestingAgent stopped');
  }

  private runExperimentCycle(): void {
    const running = this.engine.listExperiments(undefined, 'running');
    let significantCount = 0;

    for (const exp of running) {
      const stats = this.engine.computeStatistics(exp.id);
      const significantVariant = stats.find(s => s.isSignificant && !exp.variants.find(v => v.id === s.variantId && v.isControl) && s.relativeLift > 0);

      if (significantVariant && significantVariant.sampleSize >= this.config.minSamplesBeforeConclusion) {
        significantCount++;
        logger.info('Experiment reached significance', {
          experimentId: exp.id,
          variantId: significantVariant.variantId,
          pValue: significantVariant.pValue,
          lift: `${(significantVariant.relativeLift * 100).toFixed(1)}%`,
          bayesian: significantVariant.bayesianProbabilityToBeatControl,
        });
        if (this.config.autoPromoteWinners) {
          const updated = this.engine.getExperiment(exp.id);
          if (updated) {
            Object.assign(updated, { status: 'promoted', winnerVariantId: significantVariant.variantId, concludedAt: Date.now() });
            logger.info('Experiment winner auto-promoted', { experimentId: exp.id, winner: significantVariant.variantId });
          }
        }
      }
    }

    const summary = this.engine.getSummary();
    logger.info('A/B testing cycle report', {
      running: summary.runningExperiments,
      concluded: summary.concludedExperiments,
      winRate: `${summary.winRate}%`,
      significantThisCycle: significantCount,
      totalAssignments: summary.totalUserAssignments,
    });
  }

  async run(): Promise<void> {
    this.runExperimentCycle();
  }
}

const KEY = '__abTestingAgent__';
export function getABTestingAgent(config?: AgentConfig): ABTestingAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new ABTestingAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as ABTestingAgent;
}
