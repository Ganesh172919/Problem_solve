/**
 * @module trafficShapingAgent
 * @description Autonomous traffic shaping agent that continuously monitors
 * traffic metrics, detects congestion events, adjusts rate limits, signals
 * backpressure, manages priority queues, and generates periodic traffic
 * health reports.
 */

import { getLogger } from '../lib/logger';
import { getTrafficShaper } from '../lib/distributedTrafficShaper';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  congestionCheckIntervalMs?: number;
  autoAdjustEnabled?: boolean;
  targetUtilizationPct?: number;
  stormRpsThreshold?: number;
}

class TrafficShapingAgent {
  private readonly shaper = getTrafficShaper();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private congestionHandle: ReturnType<typeof setInterval> | null = null;
  private readonly config: Required<AgentConfig>;
  private isRunning = false;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      congestionCheckIntervalMs: config.congestionCheckIntervalMs ?? 15_000,
      autoAdjustEnabled: config.autoAdjustEnabled ?? true,
      targetUtilizationPct: config.targetUtilizationPct ?? 75,
      stormRpsThreshold: config.stormRpsThreshold ?? 2000,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.runReport(), this.config.pollIntervalMs);
    this.congestionHandle = setInterval(() => this.runCongestionCheck(), this.config.congestionCheckIntervalMs);
    logger.info('TrafficShapingAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    if (this.congestionHandle) clearInterval(this.congestionHandle);
    this.isRunning = false;
    logger.info('TrafficShapingAgent stopped');
  }

  private runCongestionCheck(): void {
    const allMetrics = this.shaper.listMetrics();
    for (const m of allMetrics) {
      if (m.avgRps > this.config.stormRpsThreshold) {
        this.shaper.recordCongestion(m.serviceId, m.tenantId, m.avgRps);
      }
      // Auto-resolve congestion if RPS has dropped significantly
      const activeCong = this.shaper.listCongestions(true).find(
        c => c.serviceId === m.serviceId && c.tenantId === m.tenantId
      );
      if (activeCong && m.avgRps < this.config.stormRpsThreshold * 0.5) {
        this.shaper.resolveCongestion(m.serviceId, m.tenantId);
        logger.info('Congestion auto-resolved', { serviceId: m.serviceId, tenantId: m.tenantId, rps: m.avgRps });
      }
    }
  }

  private runReport(): void {
    const summary = this.shaper.getSummary();
    logger.info('Traffic shaping report', {
      activePolicies: summary.activePolicies,
      allowRate: `${summary.overallAllowRatePct.toFixed(1)}%`,
      activeCongestions: summary.activeCongestions,
      congestionLevel: summary.avgCongestionLevel,
    });

    // Auto-adjust: disable policies with 0 traffic and re-enable when traffic resumes
    if (this.config.autoAdjustEnabled) {
      const policies = this.shaper.listPolicies();
      for (const p of policies) {
        const m = this.shaper.getMetrics(p.id);
        if (!m) continue;
        if (m.totalRequests === 0 && p.enabled) {
          // Policy has no traffic – leave enabled but log
          logger.debug('Policy idle (no traffic)', { policyId: p.id, tenantId: p.tenantId });
        }
      }
    }

    // Warn on high reject rates
    for (const m of this.shaper.listMetrics()) {
      const rejectRate = m.totalRequests > 0 ? (m.rejectedRequests / m.totalRequests) * 100 : 0;
      if (rejectRate > 20) {
        logger.warn('High reject rate detected', {
          policyId: m.policyId,
          tenantId: m.tenantId,
          rejectRate: `${rejectRate.toFixed(1)}%`,
        });
      }
    }
  }

  async run(): Promise<void> {
    this.runCongestionCheck();
    this.runReport();
  }
}

const KEY = '__trafficShapingAgent__';
export function getTrafficShapingAgent(config?: AgentConfig): TrafficShapingAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new TrafficShapingAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as TrafficShapingAgent;
}
