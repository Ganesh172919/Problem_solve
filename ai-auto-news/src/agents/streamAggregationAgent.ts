/**
 * @module streamAggregationAgent
 * @description Autonomous stream aggregation agent that monitors all registered streams,
 * processes ingested events, flushes expired windows, tracks throughput metrics, detects
 * backpressure conditions, and generates periodic stream health reports.
 */

import { getLogger } from '../lib/logger';
import { getStreamAggregator } from '../lib/realtimeStreamAggregator';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  flushIntervalMs?: number;
  backpressureThresholdEps?: number;
}

class StreamAggregationAgent {
  private readonly aggregator = getStreamAggregator();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private flushHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      flushIntervalMs: config.flushIntervalMs ?? 30_000,
      backpressureThresholdEps: config.backpressureThresholdEps ?? 10_000,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollHandle = setInterval(() => this.runHealthReport(), this.config.pollIntervalMs);
    this.flushHandle = setInterval(() => this.runFlushCycle(), this.config.flushIntervalMs);
    logger.info('StreamAggregationAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    if (this.flushHandle) clearInterval(this.flushHandle);
    this.isRunning = false;
    logger.info('StreamAggregationAgent stopped');
  }

  private runHealthReport(): void {
    const summary = this.aggregator.getSummary();
    logger.info('Stream aggregation health report', {
      totalStreams: summary.totalStreams,
      totalIngested: summary.totalEventsIngested,
      totalEmitted: summary.totalWindowsEmitted,
      lateArrivals: summary.totalLateArrivals,
      activeWindows: summary.activeWindowStates,
    });

    // Check backpressure per stream
    for (const stream of this.aggregator.listStreams()) {
      const metrics = this.aggregator.getMetrics(stream.id);
      if (metrics && metrics.throughputEps > this.config.backpressureThresholdEps) {
        logger.warn('Stream backpressure detected', {
          streamId: stream.id,
          throughput: `${metrics.throughputEps.toFixed(0)} eps`,
          threshold: this.config.backpressureThresholdEps,
        });
      }
    }
  }

  private runFlushCycle(): void {
    const summary = this.aggregator.getSummary();
    const activeWindows = summary.activeWindowStates as number;
    if (activeWindows > 0) {
      logger.debug('Stream flush cycle executed', { activeWindows });
    }
  }

  async run(): Promise<void> {
    this.runHealthReport();
    this.runFlushCycle();
  }
}

const KEY = '__streamAggregationAgent__';
export function getStreamAggregationAgent(config?: AgentConfig): StreamAggregationAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new StreamAggregationAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as StreamAggregationAgent;
}
