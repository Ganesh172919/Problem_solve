/**
 * @module subscriptionAgent
 * @description Autonomous subscription lifecycle agent that processes trial
 * expirations, renewals, payment failures, and produces revenue reports.
 */

import { getLogger } from '../lib/logger';
import { getSubscriptionManager } from '../lib/subscriptionLifecycleManager';

const logger = getLogger();

interface AgentConfig {
  monitoringIntervalMs?: number;
}

class SubscriptionAgent {
  private readonly manager = getSubscriptionManager();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;
  private cycleCount = 0;
  private totalTrialsConverted = 0;
  private totalRenewals = 0;

  constructor(config: AgentConfig = {}) {
    this.config = {
      monitoringIntervalMs: config.monitoringIntervalMs ?? 60_000,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.tick(), this.config.monitoringIntervalMs);
    logger.info('SubscriptionAgent started', { monitoringIntervalMs: this.config.monitoringIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.isRunning = false;
    logger.info('SubscriptionAgent stopped');
  }

  private async tick(): Promise<void> {
    try {
      this.processLifecycleEvents();
      this.cycleCount++;
    } catch (err) {
      logger.error('SubscriptionAgent cycle error', err as Error);
    }
  }

  processLifecycleEvents(): void {
    // Handle trial expirations
    const trialsConverted = this.manager.processTrialExpirations();
    this.totalTrialsConverted += trialsConverted;
    if (trialsConverted > 0) {
      logger.info('Trials processed', { converted: trialsConverted });
    }

    // Handle renewals
    const renewed = this.manager.processRenewals();
    this.totalRenewals += renewed;
    if (renewed > 0) {
      logger.info('Subscriptions renewed', { count: renewed });
    }

    logger.info('Lifecycle events processed', { trialsConverted, renewed, cycle: this.cycleCount });
  }

  generateRevenueReport(): {
    mrr: number;
    arr: number;
    churnRate: number;
    totalSubscriptions: number;
    activeSubscriptions: number;
  } {
    const metrics = this.manager.getRevenueMetrics();
    const report = {
      mrr: metrics.mrr,
      arr: metrics.arr,
      churnRate: metrics.churnRate,
      totalSubscriptions: metrics.totalSubscriptions,
      activeSubscriptions: metrics.activeSubscriptions,
    };

    logger.info('Revenue report generated', {
      mrr: report.mrr.toFixed(2),
      arr: report.arr.toFixed(2),
      churnRate: `${(report.churnRate * 100).toFixed(1)}%`,
    });

    return report;
  }

  getAgentStats(): {
    isRunning: boolean;
    cycleCount: number;
    totalTrialsConverted: number;
    totalRenewals: number;
    revenueMetrics: ReturnType<typeof this.manager.getRevenueMetrics>;
  } {
    return {
      isRunning: this.isRunning,
      cycleCount: this.cycleCount,
      totalTrialsConverted: this.totalTrialsConverted,
      totalRenewals: this.totalRenewals,
      revenueMetrics: this.manager.getRevenueMetrics(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __subscriptionAgent__: SubscriptionAgent | undefined;
}

export function getSubscriptionAgent(config?: AgentConfig): SubscriptionAgent {
  if (!globalThis.__subscriptionAgent__) {
    globalThis.__subscriptionAgent__ = new SubscriptionAgent(config);
  }
  return globalThis.__subscriptionAgent__;
}

export { SubscriptionAgent };
