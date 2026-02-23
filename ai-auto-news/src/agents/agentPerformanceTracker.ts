/**
 * Agent Performance Tracker
 *
 * Tracks execution time, token usage, and success rate per agent.
 * Provides historical time-series data, regression detection,
 * anomaly identification, ranking, and performance recommendations.
 */

import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionRecord {
  agentId: string;
  taskId: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  tokensUsed: number;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentStats {
  agentId: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  totalTokens: number;
  avgTokens: number;
  lastExecuted: number;
}

export interface PerformanceTrend {
  agentId: string;
  windowSize: number;
  windows: TrendWindow[];
  regressionDetected: boolean;
  regressionDetails?: string;
}

export interface TrendWindow {
  start: number;
  end: number;
  avgDurationMs: number;
  successRate: number;
  avgTokens: number;
  executionCount: number;
}

export interface AgentRanking {
  rank: number;
  agentId: string;
  compositeScore: number;
  successRate: number;
  avgDurationMs: number;
  avgTokens: number;
}

export interface Anomaly {
  agentId: string;
  taskId: string;
  type: 'duration' | 'tokens' | 'failure-spike';
  severity: 'low' | 'medium' | 'high';
  message: string;
  value: number;
  expected: number;
  timestamp: number;
}

export interface Recommendation {
  agentId: string;
  category: 'performance' | 'reliability' | 'cost' | 'general';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// AgentPerformanceTracker
// ---------------------------------------------------------------------------

export class AgentPerformanceTracker {
  private records: Map<string, ExecutionRecord[]> = new Map();
  private anomalies: Anomaly[] = [];
  private readonly maxRecordsPerAgent = 5000;
  private readonly anomalyZScore = 2.5;

  // ---- Recording -----------------------------------------------------------

  recordExecution(record: ExecutionRecord): void {
    const list = this.records.get(record.agentId) ?? [];
    list.push(record);

    // Evict oldest when over limit
    if (list.length > this.maxRecordsPerAgent) {
      list.splice(0, list.length - this.maxRecordsPerAgent);
    }
    this.records.set(record.agentId, list);

    // Inline anomaly check
    this.checkForAnomalies(record);

    logger.debug('Execution recorded', {
      agentId: record.agentId, durationMs: record.durationMs, success: record.success,
    });
  }

  startTracking(agentId: string, taskId: string): () => ExecutionRecord {
    const startTime = Date.now();
    return (success = true, tokensUsed = 0, errorMessage?: string) => {
      const endTime = Date.now();
      const record: ExecutionRecord = {
        agentId, taskId, startTime, endTime,
        durationMs: endTime - startTime,
        tokensUsed, success, errorMessage,
      };
      this.recordExecution(record);
      return record;
    };
  }

  // ---- Statistics ----------------------------------------------------------

  getStats(agentId: string): AgentStats | null {
    const recs = this.records.get(agentId);
    if (!recs || recs.length === 0) return null;

    const durations = recs.map(r => r.durationMs).sort((a, b) => a - b);
    const tokens = recs.map(r => r.tokensUsed);
    const successes = recs.filter(r => r.success).length;

    return {
      agentId,
      totalExecutions: recs.length,
      successCount: successes,
      failureCount: recs.length - successes,
      successRate: Math.round((successes / recs.length) * 10000) / 100,
      avgDurationMs: Math.round(mean(durations)),
      p50DurationMs: Math.round(percentile(durations, 50)),
      p95DurationMs: Math.round(percentile(durations, 95)),
      p99DurationMs: Math.round(percentile(durations, 99)),
      totalTokens: tokens.reduce((a, b) => a + b, 0),
      avgTokens: Math.round(mean(tokens)),
      lastExecuted: recs[recs.length - 1].endTime,
    };
  }

  getAllStats(): AgentStats[] {
    const stats: AgentStats[] = [];
    for (const agentId of this.records.keys()) {
      const s = this.getStats(agentId);
      if (s) stats.push(s);
    }
    return stats;
  }

  // ---- Trends & regression -------------------------------------------------

  getTrend(agentId: string, windowCount: number = 5): PerformanceTrend | null {
    const recs = this.records.get(agentId);
    if (!recs || recs.length < windowCount) return null;

    const windowSize = Math.floor(recs.length / windowCount);
    const windows: TrendWindow[] = [];

    for (let i = 0; i < windowCount; i++) {
      const start = i * windowSize;
      const end = i === windowCount - 1 ? recs.length : (i + 1) * windowSize;
      const slice = recs.slice(start, end);

      const durations = slice.map(r => r.durationMs);
      const tokens = slice.map(r => r.tokensUsed);
      const successes = slice.filter(r => r.success).length;

      windows.push({
        start: slice[0]?.startTime ?? 0,
        end: slice[slice.length - 1]?.endTime ?? 0,
        avgDurationMs: Math.round(mean(durations)),
        successRate: slice.length > 0 ? Math.round((successes / slice.length) * 100) : 0,
        avgTokens: Math.round(mean(tokens)),
        executionCount: slice.length,
      });
    }

    // Regression detection: compare last window to average of earlier windows
    const earlier = windows.slice(0, -1);
    const latest = windows[windows.length - 1];
    const avgEarlierDuration = mean(earlier.map(w => w.avgDurationMs));
    const avgEarlierSuccess = mean(earlier.map(w => w.successRate));

    let regressionDetected = false;
    let regressionDetails: string | undefined;

    // Duration regression: >30% increase
    if (avgEarlierDuration > 0 && latest.avgDurationMs > avgEarlierDuration * 1.3) {
      regressionDetected = true;
      regressionDetails = `Duration increased by ${Math.round(((latest.avgDurationMs / avgEarlierDuration) - 1) * 100)}% in the latest window`;
    }

    // Success rate regression: >10pp drop
    if (avgEarlierSuccess > 0 && latest.successRate < avgEarlierSuccess - 10) {
      regressionDetected = true;
      const detail = `Success rate dropped from ${Math.round(avgEarlierSuccess)}% to ${latest.successRate}%`;
      regressionDetails = regressionDetails ? `${regressionDetails}; ${detail}` : detail;
    }

    if (regressionDetected) {
      logger.warn('Performance regression detected', { agentId, details: regressionDetails });
    }

    return { agentId, windowSize, windows, regressionDetected, regressionDetails };
  }

  // ---- Ranking -------------------------------------------------------------

  getRankings(): AgentRanking[] {
    const allStats = this.getAllStats();
    if (allStats.length === 0) return [];

    // Normalize each metric to 0-1 range
    const maxDur = Math.max(...allStats.map(s => s.avgDurationMs), 1);
    const maxTok = Math.max(...allStats.map(s => s.avgTokens), 1);

    const scored = allStats.map(s => {
      const successScore = s.successRate / 100;
      const durationScore = 1 - (s.avgDurationMs / maxDur); // lower is better
      const tokenScore = 1 - (s.avgTokens / maxTok);         // lower is better
      const composite = successScore * 0.5 + durationScore * 0.3 + tokenScore * 0.2;
      return { ...s, compositeScore: Math.round(composite * 100) };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    return scored.map((s, i) => ({
      rank: i + 1,
      agentId: s.agentId,
      compositeScore: s.compositeScore,
      successRate: s.successRate,
      avgDurationMs: s.avgDurationMs,
      avgTokens: s.avgTokens,
    }));
  }

  // ---- Anomaly detection ---------------------------------------------------

  private checkForAnomalies(record: ExecutionRecord): void {
    const recs = this.records.get(record.agentId);
    if (!recs || recs.length < 10) return; // need enough data

    const previous = recs.slice(0, -1);

    // Duration anomaly
    const durations = previous.map(r => r.durationMs);
    const durMean = mean(durations);
    const durStd = stddev(durations);
    if (durStd > 0) {
      const zScore = (record.durationMs - durMean) / durStd;
      if (Math.abs(zScore) > this.anomalyZScore) {
        const anomaly: Anomaly = {
          agentId: record.agentId, taskId: record.taskId,
          type: 'duration',
          severity: Math.abs(zScore) > 4 ? 'high' : Math.abs(zScore) > 3 ? 'medium' : 'low',
          message: `Duration ${record.durationMs}ms is ${zScore > 0 ? 'above' : 'below'} normal (z=${zScore.toFixed(2)})`,
          value: record.durationMs, expected: Math.round(durMean),
          timestamp: record.endTime,
        };
        this.anomalies.push(anomaly);
        logger.warn('Anomaly detected: duration', { agentId: record.agentId, zScore: zScore.toFixed(2) });
      }
    }

    // Token anomaly
    const tokens = previous.map(r => r.tokensUsed);
    const tokMean = mean(tokens);
    const tokStd = stddev(tokens);
    if (tokStd > 0 && record.tokensUsed > 0) {
      const zScore = (record.tokensUsed - tokMean) / tokStd;
      if (Math.abs(zScore) > this.anomalyZScore) {
        this.anomalies.push({
          agentId: record.agentId, taskId: record.taskId,
          type: 'tokens',
          severity: Math.abs(zScore) > 4 ? 'high' : 'medium',
          message: `Token usage ${record.tokensUsed} deviates from mean ${Math.round(tokMean)} (z=${zScore.toFixed(2)})`,
          value: record.tokensUsed, expected: Math.round(tokMean),
          timestamp: record.endTime,
        });
      }
    }

    // Failure spike: check recent window
    const recentWindow = recs.slice(-20);
    const recentFailures = recentWindow.filter(r => !r.success).length;
    const recentFailRate = recentFailures / recentWindow.length;
    const overallFailRate = recs.filter(r => !r.success).length / recs.length;
    if (recentFailRate > overallFailRate * 2 && recentFailures >= 3) {
      // Only add if not already flagged recently
      const alreadyFlagged = this.anomalies.some(
        a => a.agentId === record.agentId && a.type === 'failure-spike' && Date.now() - a.timestamp < 60_000
      );
      if (!alreadyFlagged) {
        this.anomalies.push({
          agentId: record.agentId, taskId: record.taskId,
          type: 'failure-spike', severity: 'high',
          message: `Failure rate spike: ${Math.round(recentFailRate * 100)}% in last ${recentWindow.length} executions vs ${Math.round(overallFailRate * 100)}% overall`,
          value: recentFailRate, expected: overallFailRate,
          timestamp: Date.now(),
        });
        logger.warn('Anomaly detected: failure spike', { agentId: record.agentId, recentFailRate, overallFailRate });
      }
    }
  }

  getAnomalies(agentId?: string): Anomaly[] {
    if (agentId) return this.anomalies.filter(a => a.agentId === agentId);
    return [...this.anomalies];
  }

  // ---- Recommendations -----------------------------------------------------

  getRecommendations(agentId: string): Recommendation[] {
    const stats = this.getStats(agentId);
    if (!stats) return [];

    const recs: Recommendation[] = [];
    const trend = this.getTrend(agentId);

    // Reliability
    if (stats.successRate < 90) {
      recs.push({
        agentId, category: 'reliability', priority: 'high',
        message: `Success rate is ${stats.successRate}%. Investigate failure patterns and add retry logic or input validation.`,
      });
    } else if (stats.successRate < 97) {
      recs.push({
        agentId, category: 'reliability', priority: 'medium',
        message: `Success rate is ${stats.successRate}%. Consider adding fallback strategies.`,
      });
    }

    // Performance
    if (stats.p95DurationMs > stats.avgDurationMs * 3) {
      recs.push({
        agentId, category: 'performance', priority: 'medium',
        message: `P95 latency (${stats.p95DurationMs}ms) is ${(stats.p95DurationMs / stats.avgDurationMs).toFixed(1)}x the average. Investigate tail latency causes.`,
      });
    }

    if (stats.avgDurationMs > 30_000) {
      recs.push({
        agentId, category: 'performance', priority: 'high',
        message: `Average duration of ${stats.avgDurationMs}ms is very high. Consider task decomposition or caching.`,
      });
    }

    // Cost
    if (stats.avgTokens > 5000) {
      recs.push({
        agentId, category: 'cost', priority: 'medium',
        message: `Average token usage of ${stats.avgTokens} is high. Optimize prompts or add summarization.`,
      });
    }

    // Regression
    if (trend?.regressionDetected) {
      recs.push({
        agentId, category: 'general', priority: 'high',
        message: `Performance regression detected: ${trend.regressionDetails}`,
      });
    }

    // Low volume
    if (stats.totalExecutions < 10) {
      recs.push({
        agentId, category: 'general', priority: 'low',
        message: 'Insufficient execution data for confident analysis. Collect more samples.',
      });
    }

    return recs;
  }

  // ---- Housekeeping --------------------------------------------------------

  clearRecords(agentId?: string): void {
    if (agentId) {
      this.records.delete(agentId);
      this.anomalies = this.anomalies.filter(a => a.agentId !== agentId);
    } else {
      this.records.clear();
      this.anomalies = [];
    }
    logger.info('Performance records cleared', { agentId: agentId ?? 'all' });
  }

  getTrackedAgents(): string[] {
    return [...this.records.keys()];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__agentPerformanceTracker__';

export function getAgentPerformanceTracker(): AgentPerformanceTracker {
  const g = globalThis as unknown as Record<string, AgentPerformanceTracker>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new AgentPerformanceTracker();
    logger.info('Agent performance tracker initialized');
  }
  return g[GLOBAL_KEY];
}
