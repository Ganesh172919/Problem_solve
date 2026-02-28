/**
 * @module benchmarkingAgent
 * @description Autonomous benchmarking agent that runs scheduled benchmark
 * suites, detects performance regressions, and reports engine statistics.
 */

import { getLogger } from '../lib/logger';
import { getBenchmarkingEngine } from '../lib/performanceBenchmarkingEngine';

const logger = getLogger();

interface AgentConfig {
  monitoringIntervalMs?: number;
  regressionThresholdPercent?: number;
}

class BenchmarkingAgent {
  private readonly engine = getBenchmarkingEngine();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;
  private suitesRun = 0;
  private regressionsDetected = 0;

  constructor(config: AgentConfig = {}) {
    this.config = {
      monitoringIntervalMs: config.monitoringIntervalMs ?? 60_000,
      regressionThresholdPercent: config.regressionThresholdPercent ?? 5,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.tick(), this.config.monitoringIntervalMs);
    logger.info('BenchmarkingAgent started', { monitoringIntervalMs: this.config.monitoringIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.isRunning = false;
    logger.info('BenchmarkingAgent stopped');
  }

  private async tick(): Promise<void> {
    try {
      await this.runScheduledBenchmarks();
      this.detectRegressions();
    } catch (err) {
      logger.error('BenchmarkingAgent cycle error', err as Error);
    }
  }

  async runScheduledBenchmarks(): Promise<void> {
    const stats = this.engine.getStats();

    for (const suiteId of stats.suiteIds ?? []) {
      const suite = this.engine.getSuite(suiteId);
      if (!suite) continue;

      const results = await this.engine.runSuite(suiteId);
      this.suitesRun++;
      logger.info('Benchmark suite executed', {
        suiteId,
        benchmarks: results.length,
        suiteName: suite.name,
      });
    }
  }

  detectRegressions(): void {
    const stats = this.engine.getStats();

    for (const suiteId of stats.suiteIds ?? []) {
      const results = this.engine.getResults(suiteId);
      if (results.length < 2) continue;

      const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp);
      const current = sorted[0];
      const baseline = sorted[1];

      const comparison = this.engine.compare(baseline.id, current.id);
      if (this.engine.detectRegression(comparison, this.config.regressionThresholdPercent)) {
        this.regressionsDetected++;
        logger.warn('Performance regression detected', {
          suiteId,
          currentId: current.id,
          baselineId: baseline.id,
          changePercent: comparison.changePercent?.toFixed(1),
        });
      }
    }
  }

  getAgentStats(): {
    isRunning: boolean;
    suitesRun: number;
    regressionsDetected: number;
    engineStats: ReturnType<typeof this.engine.getStats>;
  } {
    return {
      isRunning: this.isRunning,
      suitesRun: this.suitesRun,
      regressionsDetected: this.regressionsDetected,
      engineStats: this.engine.getStats(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __benchmarkingAgent__: BenchmarkingAgent | undefined;
}

export function getBenchmarkingAgent(config?: AgentConfig): BenchmarkingAgent {
  if (!globalThis.__benchmarkingAgent__) {
    globalThis.__benchmarkingAgent__ = new BenchmarkingAgent(config);
  }
  return globalThis.__benchmarkingAgent__;
}

export { BenchmarkingAgent };
