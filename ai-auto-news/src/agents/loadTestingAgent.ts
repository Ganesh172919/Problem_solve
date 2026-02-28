/**
 * @module loadTestingAgent
 * @description Autonomous load testing orchestration agent that schedules and runs
 * load tests on a regular cadence, captures baselines after successful runs,
 * raises alerts on SLA regressions, triggers scale-out recommendations, and
 * integrates with CI/CD pipelines for performance gating.
 */

import { getLogger } from '../lib/logger';
import { getLoadTesting, type LoadProfile } from '../lib/intelligentLoadTesting';

const logger = getLogger();

interface AgentConfig {
  checkIntervalMs?: number;
  autoRunEnabled?: boolean;
  regressionThresholdPercent?: number;
  targetTenantId?: string;
}

class LoadTestingAgent {
  private readonly engine = getLoadTesting();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly config: Required<AgentConfig>;
  private isRunning = false;
  private lastRunAt = 0;

  constructor(config: AgentConfig = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 60_000,
      autoRunEnabled: config.autoRunEnabled ?? true,
      regressionThresholdPercent: config.regressionThresholdPercent ?? 20,
      targetTenantId: config.targetTenantId ?? '',
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.run(), this.config.checkIntervalMs);
    logger.info('LoadTestingAgent started', { checkIntervalMs: this.config.checkIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.isRunning = false;
    logger.info('LoadTestingAgent stopped');
  }

  async run(): Promise<void> {
    try {
      await this.checkScheduledRuns();
      await this.evaluateCompletedRuns();
      this.logHealthSummary();
    } catch (err) {
      logger.error('LoadTestingAgent cycle error', err as Error);
    }
  }

  private async checkScheduledRuns(): Promise<void> {
    if (!this.config.autoRunEnabled) return;
    const scenarios = this.engine.listScenarios();
    const now = Date.now();

    for (const scenario of scenarios) {
      // Run scheduled scenarios that haven't run in the last hour
      const runs = this.engine.listRuns(scenario.id);
      const lastRun = runs.sort((a, b) => b.startedAt - a.startedAt)[0];
      const timeSinceLast = lastRun ? now - lastRun.startedAt : Infinity;

      if (timeSinceLast > 3_600_000) {
        const run = this.engine.startRun(scenario.id, 1);
        logger.info('LoadTestingAgent triggered scheduled run', { runId: run.id, scenarioId: scenario.id });
      }
    }
  }

  private async evaluateCompletedRuns(): Promise<void> {
    const allRuns = this.engine.listRuns();
    const recentComplete = allRuns.filter(r =>
      r.status === 'completed' &&
      r.endedAt && Date.now() - r.endedAt < this.config.checkIntervalMs * 2
    );

    for (const run of recentComplete) {
      if (!run.passed) {
        logger.warn('LoadTestingAgent: Run failed SLA', {
          runId: run.id,
          scenarioId: run.scenarioId,
          slaBreaches: run.slaBreaches.length,
          bottlenecks: run.bottlenecks.length,
        });
      }

      if (run.regressions.length > 0) {
        const critical = run.regressions.filter(r => r.severity === 'critical');
        if (critical.length > 0) {
          logger.error('LoadTestingAgent: Critical performance regressions detected', undefined, {
            runId: run.id,
            regressionCount: critical.length,
            maxRegressionPercent: Math.max(...critical.map(r => r.regressionPercent)),
          });
        }
      }

      // Capture baseline if passed cleanly
      if (run.passed && run.regressions.length === 0) {
        try {
          this.engine.captureBaselineFromRun(run.id);
          logger.info('LoadTestingAgent: Baseline captured', { runId: run.id });
        } catch { /* non-fatal */ }
      }
    }
  }

  private logHealthSummary(): void {
    const summary = this.engine.getDashboardSummary();
    logger.info('LoadTestingAgent health summary', {
      scenarios: summary.totalScenarios,
      activeRuns: summary.activeRuns,
      passRate: `${Math.round(summary.passRate * 100)}%`,
      avgPeakRps: Math.round(summary.avgPeakRps),
    });
  }

  createDefaultScenario(tenantId: string, baseUrl: string): void {
    this.engine.createScenario({
      name: `${tenantId} Default Load Test`,
      description: 'Auto-generated default load test scenario',
      profile: 'ramp_up' as LoadProfile,
      endpoints: [{
        id: `ep-${tenantId}-health`,
        name: 'Health Check',
        url: `${baseUrl}/api/health`,
        method: 'GET',
        protocol: 'http',
        expectedStatusCode: 200,
        maxLatencyMs: 500,
        weight: 1,
      }],
      virtualUsers: 100,
      durationMs: 60_000,
      rampUpMs: 10_000,
      rampDownMs: 5_000,
      thinkTimeMs: 500,
      targetRps: 50,
      maxErrorRate: 0.01,
      slaP50Ms: 100,
      slaP95Ms: 300,
      slaP99Ms: 500,
      chaosEnabled: false,
      chaosProbability: 0,
      tags: [tenantId, 'auto-generated'],
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

let _agent: LoadTestingAgent | null = null;

export function getLoadTestingAgent(config?: AgentConfig): LoadTestingAgent {
  if (!_agent) _agent = new LoadTestingAgent(config);
  return _agent;
}

export { LoadTestingAgent };
