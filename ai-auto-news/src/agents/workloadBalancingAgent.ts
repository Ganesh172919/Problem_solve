/**
 * @module workloadBalancingAgent
 * @description Autonomous workload balancing agent that continuously monitors node health,
 * triggers rebalancing on hotspot detection, schedules pending tasks, adjusts default
 * balancing algorithms based on observed performance, and generates periodic capacity reports.
 */

import { getLogger } from '../lib/logger';
import { getWorkloadBalancer } from '../lib/intelligentWorkloadBalancer';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  rebalanceIntervalMs?: number;
  hotspotCpuThresholdPct?: number;
  hotspotMemThresholdPct?: number;
  autoScheduleEnabled?: boolean;
}

class WorkloadBalancingAgent {
  private readonly balancer = getWorkloadBalancer();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private rebalanceHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      rebalanceIntervalMs: config.rebalanceIntervalMs ?? 300_000,
      hotspotCpuThresholdPct: config.hotspotCpuThresholdPct ?? 80,
      hotspotMemThresholdPct: config.hotspotMemThresholdPct ?? 80,
      autoScheduleEnabled: config.autoScheduleEnabled ?? true,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollHandle = setInterval(() => this.runHealthReport(), this.config.pollIntervalMs);
    this.rebalanceHandle = setInterval(() => this.runRebalance(), this.config.rebalanceIntervalMs);
    logger.info('WorkloadBalancingAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    if (this.rebalanceHandle) clearInterval(this.rebalanceHandle);
    this.isRunning = false;
    logger.info('WorkloadBalancingAgent stopped');
  }

  private runHealthReport(): void {
    const summary = this.balancer.getSummary();
    logger.info('Workload balancer health report', {
      nodes: summary.totalNodes,
      healthy: summary.healthyNodes,
      activeTasks: summary.totalActiveTasks,
      queueDepth: summary.queueDepth,
      avgCpuPct: `${summary.avgNodeCpuPct}%`,
      avgMemPct: `${summary.avgNodeMemPct}%`,
      sloViolations: summary.sloViolations,
    });

    // Auto-schedule queued tasks
    if (this.config.autoScheduleEnabled && summary.queueDepth > 0) {
      let scheduled = 0;
      for (let i = 0; i < Math.min(summary.queueDepth, 20); i++) {
        const decision = this.balancer.scheduleNextTask();
        if (!decision) break;
        scheduled++;
      }
      if (scheduled > 0) logger.debug('Auto-scheduled queued tasks', { count: scheduled });
    }

    // Hotspot detection
    const hotspots = this.balancer.getHotspotNodes();
    if (hotspots.length > 0) {
      logger.warn('Hotspot nodes detected', {
        nodeIds: hotspots.map(n => n.id),
        count: hotspots.length,
      });
    }
  }

  private runRebalance(): void {
    const hotspots = this.balancer.getHotspotNodes();
    if (hotspots.length > 0) {
      const event = this.balancer.rebalance('hotspot');
      logger.info('Scheduled rebalance triggered due to hotspots', {
        hotspots: hotspots.length,
        tasksRelocated: event.tasksRelocated,
      });
    }
  }

  async run(): Promise<void> {
    this.runHealthReport();
    this.runRebalance();
  }
}

const KEY = '__workloadBalancingAgent__';
export function getWorkloadBalancingAgent(config?: AgentConfig): WorkloadBalancingAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new WorkloadBalancingAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as WorkloadBalancingAgent;
}
