/**
 * @module alertCorrelationAgent
 * @description Autonomous alert correlation agent that continuously runs
 * escalation checks, resolves stale storms, generates correlation insights,
 * and produces periodic alert health summaries.
 */

import { getLogger } from '../lib/logger';
import { getAlertCorrelator } from '../lib/aiPoweredAlertCorrelator';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  escalationCheckIntervalMs?: number;
  stormResolutionWindowMs?: number;
  insightReportIntervalMs?: number;
}

class AlertCorrelationAgent {
  private readonly correlator = getAlertCorrelator();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private escalationHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      escalationCheckIntervalMs: config.escalationCheckIntervalMs ?? 30_000,
      stormResolutionWindowMs: config.stormResolutionWindowMs ?? 5 * 60_000,
      insightReportIntervalMs: config.insightReportIntervalMs ?? 300_000,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.run(), this.config.pollIntervalMs);
    this.escalationHandle = setInterval(() => this.runEscalationCheck(), this.config.escalationCheckIntervalMs);
    logger.info('AlertCorrelationAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    if (this.escalationHandle) clearInterval(this.escalationHandle);
    this.isRunning = false;
    logger.info('AlertCorrelationAgent stopped');
  }

  private runEscalationCheck(): void {
    const escalated = this.correlator.runEscalationCheck();
    if (escalated.length > 0) {
      logger.warn('Alerts auto-escalated', { count: escalated.length, alertIds: escalated.slice(0, 5) });
    }

    // Resolve storms that have been quiet
    const storms = this.correlator.listStorms(true);
    for (const storm of storms) {
      const now = Date.now();
      if (now - storm.startedAt >= this.config.stormResolutionWindowMs) {
        // Check if alert rate has dropped
        const recentAlerts = this.correlator.listAlerts(storm.tenantId, 'firing')
          .filter(a => a.serviceId === storm.serviceId && a.firedAt >= now - 60_000).length;
        if (recentAlerts < 5) {
          this.correlator.resolveStorm(storm.tenantId, storm.serviceId);
          logger.info('Alert storm auto-resolved', { tenantId: storm.tenantId, serviceId: storm.serviceId });
        }
      }
    }
  }

  async run(): Promise<void> {
    const summary = this.correlator.getSummary();
    logger.info('Alert correlation report', {
      activeAlerts: summary.activeAlerts,
      suppressedAlerts: summary.suppressedAlerts,
      openGroups: summary.openGroups,
      noiseReductionPct: `${summary.noiseReductionPct.toFixed(1)}%`,
      activeStorms: summary.alertStormsActive,
    });

    // Emit warnings for critical open groups
    const criticalGroups = this.correlator.listGroups(undefined, true)
      .filter(g => g.severity === 'critical');
    for (const group of criticalGroups.slice(0, 5)) {
      logger.error('Critical alert group open', undefined, {
        groupId: group.id,
        alertCount: group.alerts.length,
        services: group.serviceIds,
        confidence: group.confidence,
      });
    }
  }
}

const KEY = '__alertCorrelationAgent__';
export function getAlertCorrelationAgent(config?: AgentConfig): AlertCorrelationAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AlertCorrelationAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as AlertCorrelationAgent;
}
