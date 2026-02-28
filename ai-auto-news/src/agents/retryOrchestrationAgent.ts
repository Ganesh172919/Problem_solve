/**
 * @module retryOrchestrationAgent
 * @description Autonomous retry orchestration agent that monitors for retry storms,
 * requeues high-value DLQ entries, applies recommendations, and generates
 * periodic retry health reports.
 */

import { getLogger } from '../lib/logger';
import { getRetryOrchestrator } from '../lib/intelligentRetryOrchestrator';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  autoRequeueDlqEnabled?: boolean;
  maxAutoRequeueCount?: number;
  stormAlertIntervalMs?: number;
}

class RetryOrchestrationAgent {
  private readonly orchestrator = getRetryOrchestrator();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      autoRequeueDlqEnabled: config.autoRequeueDlqEnabled ?? true,
      maxAutoRequeueCount: config.maxAutoRequeueCount ?? 5,
      stormAlertIntervalMs: config.stormAlertIntervalMs ?? 30_000,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.run(), this.config.pollIntervalMs);
    logger.info('RetryOrchestrationAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.isRunning = false;
    logger.info('RetryOrchestrationAgent stopped');
  }

  async run(): Promise<void> {
    const summary = this.orchestrator.getSummary();
    logger.info('Retry orchestration report', {
      totalOperations: summary.totalOperations,
      pending: summary.pendingOperations,
      dlqDepth: summary.dlqDepth,
      poisonMessages: summary.poisonMessages,
      activeStorms: summary.activeStorms,
      successRate: `${summary.overallSuccessRate.toFixed(1)}%`,
    });

    // Alert on active retry storms
    if (summary.activeStorms > 0) {
      logger.warn('Active retry storms detected', { count: summary.activeStorms });
    }

    // Alert on poison messages
    if (summary.poisonMessages > 0) {
      logger.warn('Quarantined poison messages detected', { count: summary.poisonMessages });
      const poisons = this.orchestrator.listPoisonMessages();
      for (const p of poisons.filter(x => x.quarantined).slice(0, 3)) {
        logger.error('Poison message quarantined', undefined, {
          operationId: p.operationId,
          errorPattern: p.errorPattern,
          consecutiveFailures: p.consecutiveFailures,
        });
      }
    }

    // Auto-requeue eligible DLQ entries (not poisoned, low requeueCount)
    if (this.config.autoRequeueDlqEnabled) {
      const dlqEntries = this.orchestrator.listDlq()
        .filter(e => !e.requeued && e.requeueCount < this.config.maxAutoRequeueCount);
      for (const entry of dlqEntries.slice(0, 10)) {
        try {
          this.orchestrator.requeueDlqEntry(entry.id);
          logger.info('DLQ entry auto-requeued', { dlqId: entry.id, operationId: entry.operationId });
        } catch (err) {
          logger.warn('Failed to requeue DLQ entry', { dlqId: entry.id, error: String(err) });
        }
      }
    }
  }
}

const KEY = '__retryOrchestrationAgent__';
export function getRetryOrchestrationAgent(config?: AgentConfig): RetryOrchestrationAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new RetryOrchestrationAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as RetryOrchestrationAgent;
}
