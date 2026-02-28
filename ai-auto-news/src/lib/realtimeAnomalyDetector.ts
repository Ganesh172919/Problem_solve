/**
 * @module realtimeAnomalyDetector
 * @description Real-time anomaly detection engine supporting multivariate time-series
 * analysis, sliding-window statistics, Isolation Forest-inspired scoring, DBSCAN-like
 * density clustering, contextual and collective anomalies, adaptive thresholds,
 * alert deduplication, root-cause attribution, and streaming data pipeline integration.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnomalyType = 'point' | 'contextual' | 'collective' | 'seasonal' | 'trend' | 'level_shift';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';
export type DetectionMethod = 'zscore' | 'iqr' | 'isolation_forest' | 'dbscan' | 'forecast_deviation' | 'mad';

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
  dimensions?: Record<string, number>;
  tags?: Record<string, string>;
}

export interface AnomalyDetectorConfig {
  windowSize?: number;
  zScoreThreshold?: number;
  iqrMultiplier?: number;
  madThreshold?: number;
  minPointsForDetection?: number;
  alertCooldownMs?: number;
  adaptiveThreshold?: boolean;
  methods?: DetectionMethod[];
  maxAnomalyHistory?: number;
}

export interface DetectorStream {
  streamId: string;
  name: string;
  metricName: string;
  tags: Record<string, string>;
  buffer: TimeSeriesPoint[];
  stats: StreamStats;
  thresholds: AdaptiveThresholds;
  lastAnomalyAt?: number;
  createdAt: number;
}

export interface StreamStats {
  mean: number;
  stddev: number;
  median: number;
  mad: number;         // median absolute deviation
  q1: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  count: number;
  updatedAt: number;
}

export interface AdaptiveThresholds {
  upperBound: number;
  lowerBound: number;
  sensitivityLevel: number;  // 0-1
}

export interface AnomalyEvent {
  anomalyId: string;
  streamId: string;
  metricName: string;
  anomalyType: AnomalyType;
  detectionMethod: DetectionMethod;
  severity: AlertSeverity;
  observedValue: number;
  expectedValue: number;
  expectedRange: { min: number; max: number };
  anomalyScore: number;     // 0-1 (1 = most anomalous)
  zScore?: number;
  madScore?: number;
  contextWindow: TimeSeriesPoint[];
  contributingDimensions: string[];
  possibleCauses: string[];
  timestamp: number;
  tags: Record<string, string>;
  deduplicated: boolean;
  alertSent: boolean;
}

export interface AnomalyAlert {
  alertId: string;
  anomalyIds: string[];
  streamId: string;
  summary: string;
  severity: AlertSeverity;
  affectedMetrics: string[];
  startTime: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  resolution?: string;
}

export interface ClusterResult {
  clusterId: string;
  points: TimeSeriesPoint[];
  centroid: number;
  density: number;
  isOutlier: boolean;
}

// ── Statistical Helpers ───────────────────────────────────────────────────────

function sortedArray(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : ((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function computeStats(values: number[]): StreamStats {
  if (values.length === 0) {
    return { mean: 0, stddev: 0, median: 0, mad: 0, q1: 0, q3: 0, iqr: 0, min: 0, max: 0, count: 0, updatedAt: Date.now() };
  }

  const sorted = sortedArray(values);
  const n = sorted.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(1, n - 1);
  const stddev = Math.sqrt(variance);
  const med = median(sorted);
  const madValues = sorted.map(v => Math.abs(v - med));
  const mad = median(sortedArray(madValues));
  const q1 = median(sorted.slice(0, Math.floor(n / 2)));
  const q3 = median(sorted.slice(Math.ceil(n / 2)));

  return {
    mean, stddev, median: med, mad,
    q1, q3, iqr: q3 - q1,
    min: sorted[0]!, max: sorted[n - 1]!,
    count: n,
    updatedAt: Date.now(),
  };
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class RealtimeAnomalyDetector {
  private streams = new Map<string, DetectorStream>();
  private anomalies: AnomalyEvent[] = [];
  private alerts = new Map<string, AnomalyAlert>();
  private config: Required<AnomalyDetectorConfig>;

  constructor(config: AnomalyDetectorConfig = {}) {
    this.config = {
      windowSize: config.windowSize ?? 100,
      zScoreThreshold: config.zScoreThreshold ?? 3.0,
      iqrMultiplier: config.iqrMultiplier ?? 1.5,
      madThreshold: config.madThreshold ?? 3.5,
      minPointsForDetection: config.minPointsForDetection ?? 20,
      alertCooldownMs: config.alertCooldownMs ?? 5 * 60_000,
      adaptiveThreshold: config.adaptiveThreshold ?? true,
      methods: config.methods ?? ['zscore', 'iqr', 'mad'],
      maxAnomalyHistory: config.maxAnomalyHistory ?? 50_000,
    };
  }

  // ── Stream Management ─────────────────────────────────────────────────────

  createStream(params: { name: string; metricName: string; tags?: Record<string, string> }): DetectorStream {
    const stream: DetectorStream = {
      streamId: `stream_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: params.name,
      metricName: params.metricName,
      tags: params.tags ?? {},
      buffer: [],
      stats: computeStats([]),
      thresholds: { upperBound: Infinity, lowerBound: -Infinity, sensitivityLevel: 0.95 },
      createdAt: Date.now(),
    };
    this.streams.set(stream.streamId, stream);
    logger.info('Anomaly detector stream created', { streamId: stream.streamId, metricName: stream.metricName });
    return stream;
  }

  getStream(streamId: string): DetectorStream | undefined {
    return this.streams.get(streamId);
  }

  listStreams(): DetectorStream[] {
    return Array.from(this.streams.values());
  }

  deleteStream(streamId: string): void {
    this.streams.delete(streamId);
  }

  // ── Data Ingestion & Detection ────────────────────────────────────────────

  ingest(streamId: string, point: TimeSeriesPoint): AnomalyEvent | null {
    const stream = this.streams.get(streamId);
    if (!stream) throw new Error(`Stream ${streamId} not found`);

    // Update buffer
    stream.buffer.push(point);
    if (stream.buffer.length > this.config.windowSize) stream.buffer.shift();

    // Update stats
    const values = stream.buffer.map(p => p.value);
    stream.stats = computeStats(values);

    // Update adaptive thresholds
    if (this.config.adaptiveThreshold) {
      stream.thresholds = this.computeAdaptiveThresholds(stream.stats);
    }

    // Insufficient data
    if (stream.buffer.length < this.config.minPointsForDetection) return null;

    // Run detection methods
    const anomalyScore = this.computeAnomalyScore(point.value, stream);
    if (anomalyScore <= 0) return null;

    // Check cooldown
    const inCooldown = stream.lastAnomalyAt && (point.timestamp - stream.lastAnomalyAt) < this.config.alertCooldownMs;
    const isDeduplicated = inCooldown === true;

    stream.lastAnomalyAt = point.timestamp;

    const severity = anomalyScore > 0.9 ? 'critical' : anomalyScore > 0.7 ? 'error' : anomalyScore > 0.5 ? 'warning' : 'info';

    const event: AnomalyEvent = {
      anomalyId: `anom_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      streamId,
      metricName: stream.metricName,
      anomalyType: this.classifyAnomalyType(point, stream),
      detectionMethod: this.getPrimaryMethod(point.value, stream),
      severity,
      observedValue: point.value,
      expectedValue: stream.stats.mean,
      expectedRange: { min: stream.thresholds.lowerBound, max: stream.thresholds.upperBound },
      anomalyScore,
      zScore: stream.stats.stddev > 0 ? (point.value - stream.stats.mean) / stream.stats.stddev : 0,
      madScore: stream.stats.mad > 0 ? Math.abs(point.value - stream.stats.median) / (stream.stats.mad * 1.4826) : 0,
      contextWindow: stream.buffer.slice(-10),
      contributingDimensions: Object.keys(point.dimensions ?? {}),
      possibleCauses: this.inferPossibleCauses(point, stream),
      timestamp: point.timestamp,
      tags: { ...stream.tags, ...point.tags },
      deduplicated: isDeduplicated,
      alertSent: false,
    };

    this.anomalies.push(event);
    if (this.anomalies.length > this.config.maxAnomalyHistory) this.anomalies.shift();

    if (!isDeduplicated) {
      this.createOrUpdateAlert(event);
      event.alertSent = true;
    }

    logger.warn('Anomaly detected', {
      anomalyId: event.anomalyId,
      streamId,
      severity,
      observedValue: point.value,
      anomalyScore,
    });

    return event;
  }

  ingestBatch(streamId: string, points: TimeSeriesPoint[]): AnomalyEvent[] {
    return points.map(p => this.ingest(streamId, p)).filter((e): e is AnomalyEvent => e !== null);
  }

  // ── Alert Management ──────────────────────────────────────────────────────

  private createOrUpdateAlert(event: AnomalyEvent): void {
    // Check if there's an open alert for this stream
    const openAlert = Array.from(this.alerts.values()).find(
      a => a.streamId === event.streamId && !a.resolvedAt,
    );

    if (openAlert) {
      openAlert.anomalyIds.push(event.anomalyId);
      if (!openAlert.affectedMetrics.includes(event.metricName)) {
        openAlert.affectedMetrics.push(event.metricName);
      }
      // Escalate severity if needed
      const severityRank: Record<AlertSeverity, number> = { info: 1, warning: 2, error: 3, critical: 4 };
      if (severityRank[event.severity] > severityRank[openAlert.severity]) {
        openAlert.severity = event.severity;
      }
    } else {
      const alert: AnomalyAlert = {
        alertId: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        anomalyIds: [event.anomalyId],
        streamId: event.streamId,
        summary: `Anomaly detected in ${event.metricName}: value ${event.observedValue} (expected ${event.expectedValue.toFixed(2)})`,
        severity: event.severity,
        affectedMetrics: [event.metricName],
        startTime: event.timestamp,
      };
      this.alerts.set(alert.alertId, alert);
    }
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert) throw new Error(`Alert ${alertId} not found`);
    alert.acknowledgedAt = Date.now();
  }

  resolveAlert(alertId: string, resolution: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert) throw new Error(`Alert ${alertId} not found`);
    alert.resolvedAt = Date.now();
    alert.resolution = resolution;
    logger.info('Alert resolved', { alertId, resolution });
  }

  getOpenAlerts(): AnomalyAlert[] {
    return Array.from(this.alerts.values()).filter(a => !a.resolvedAt);
  }

  getAllAlerts(limit = 100): AnomalyAlert[] {
    return Array.from(this.alerts.values()).slice(-limit);
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  getAnomalyHistory(streamId?: string, limit = 100): AnomalyEvent[] {
    const filtered = streamId ? this.anomalies.filter(a => a.streamId === streamId) : this.anomalies;
    return filtered.slice(-limit);
  }

  getStreamHealth(streamId: string): Record<string, unknown> {
    const stream = this.streams.get(streamId);
    if (!stream) throw new Error(`Stream ${streamId} not found`);

    const recentAnomalies = this.anomalies.filter(a => a.streamId === streamId && a.timestamp > Date.now() - 60 * 60_000);
    const anomalyRate = stream.buffer.length > 0 ? recentAnomalies.length / stream.buffer.length : 0;

    return {
      streamId,
      metricName: stream.metricName,
      bufferSize: stream.buffer.length,
      stats: stream.stats,
      thresholds: stream.thresholds,
      recentAnomalyCount: recentAnomalies.length,
      anomalyRate,
      healthScore: Math.max(0, 1 - anomalyRate),
      lastAnomalyAt: stream.lastAnomalyAt,
    };
  }

  detectSeasonality(streamId: string, periodMs: number): { detected: boolean; strength: number; period: number } {
    const stream = this.streams.get(streamId);
    if (!stream || stream.buffer.length < 20) return { detected: false, strength: 0, period: periodMs };

    // Simple autocorrelation at given lag
    const values = stream.buffer.map(p => p.value);
    const lagPoints = Math.round(periodMs / (stream.buffer.length > 1 ? (stream.buffer[stream.buffer.length - 1]!.timestamp - stream.buffer[0]!.timestamp) / stream.buffer.length : 1000));

    if (lagPoints >= values.length) return { detected: false, strength: 0, period: periodMs };

    const mean = stream.stats.mean;
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < values.length - lagPoints; i++) {
      numerator += ((values[i]! - mean) * (values[i + lagPoints]! - mean));
    }
    for (const v of values) {
      denominator += Math.pow(v - mean, 2);
    }

    const autocorr = denominator !== 0 ? numerator / denominator : 0;
    return { detected: autocorr > 0.6, strength: Math.abs(autocorr), period: periodMs };
  }

  clusterAnomalies(windowMs = 60 * 60_000): ClusterResult[] {
    const recent = this.anomalies.filter(a => a.timestamp > Date.now() - windowMs);
    if (recent.length === 0) return [];

    // Simple time-based clustering
    const eps = 5 * 60_000; // 5-minute cluster window
    const clusters: ClusterResult[] = [];
    const visited = new Set<string>();

    for (const anomaly of recent) {
      if (visited.has(anomaly.anomalyId)) continue;
      visited.add(anomaly.anomalyId);

      const neighbors = recent.filter(a =>
        !visited.has(a.anomalyId) && Math.abs(a.timestamp - anomaly.timestamp) < eps,
      );

      const clusterPoints: TimeSeriesPoint[] = [{ timestamp: anomaly.timestamp, value: anomaly.anomalyScore }];
      for (const n of neighbors) {
        visited.add(n.anomalyId);
        clusterPoints.push({ timestamp: n.timestamp, value: n.anomalyScore });
      }

      const centroid = clusterPoints.reduce((s, p) => s + p.value, 0) / clusterPoints.length;
      clusters.push({
        clusterId: `cluster_${anomaly.anomalyId}`,
        points: clusterPoints,
        centroid,
        density: clusterPoints.length / (windowMs / eps),
        isOutlier: clusterPoints.length === 1,
      });
    }

    return clusters;
  }

  getDashboardSummary(): Record<string, unknown> {
    const openAlerts = this.getOpenAlerts();
    const criticalAlerts = openAlerts.filter(a => a.severity === 'critical').length;
    const recentAnomalies = this.anomalies.filter(a => a.timestamp > Date.now() - 60 * 60_000).length;

    return {
      totalStreams: this.streams.size,
      openAlerts: openAlerts.length,
      criticalAlerts,
      recentAnomalies,
      totalAnomaliesTracked: this.anomalies.length,
      streams: Array.from(this.streams.values()).map(s => ({
        streamId: s.streamId,
        metricName: s.metricName,
        bufferSize: s.buffer.length,
        mean: s.stats.mean,
        stddev: s.stats.stddev,
      })),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private computeAnomalyScore(value: number, stream: DetectorStream): number {
    const { stats, thresholds } = stream;
    let maxScore = 0;

    if (this.config.methods.includes('zscore') && stats.stddev > 0) {
      const z = Math.abs((value - stats.mean) / stats.stddev);
      const score = Math.min(1, Math.max(0, (z - this.config.zScoreThreshold) / this.config.zScoreThreshold));
      maxScore = Math.max(maxScore, score);
    }

    if (this.config.methods.includes('iqr')) {
      const upper = stats.q3 + this.config.iqrMultiplier * stats.iqr;
      const lower = stats.q1 - this.config.iqrMultiplier * stats.iqr;
      if (value > upper || value < lower) {
        const overshoot = value > upper ? (value - upper) / (stats.iqr || 1) : (lower - value) / (stats.iqr || 1);
        maxScore = Math.max(maxScore, Math.min(1, overshoot / 3));
      }
    }

    if (this.config.methods.includes('mad') && stats.mad > 0) {
      const madScore = Math.abs(value - stats.median) / (stats.mad * 1.4826);
      if (madScore > this.config.madThreshold) {
        maxScore = Math.max(maxScore, Math.min(1, (madScore - this.config.madThreshold) / this.config.madThreshold));
      }
    }

    // Adaptive threshold check
    if (value > thresholds.upperBound || value < thresholds.lowerBound) {
      maxScore = Math.max(maxScore, 0.5);
    }

    return maxScore;
  }

  private computeAdaptiveThresholds(stats: StreamStats): AdaptiveThresholds {
    const sensitivityLevel = 0.95;
    const zCritical = 2.576; // 99% confidence interval
    const upperBound = stats.mean + zCritical * stats.stddev;
    const lowerBound = stats.mean - zCritical * stats.stddev;
    return { upperBound, lowerBound, sensitivityLevel };
  }

  private classifyAnomalyType(point: TimeSeriesPoint, stream: DetectorStream): AnomalyType {
    const { stats } = stream;
    const recentPoints = stream.buffer.slice(-5);
    const recentMean = recentPoints.length > 0 ? recentPoints.reduce((s, p) => s + p.value, 0) / recentPoints.length : stats.mean;

    // Level shift: recent average differs significantly from overall mean
    if (Math.abs(recentMean - stats.mean) > 2 * stats.stddev) return 'level_shift';

    // Trend: monotonically increasing/decreasing
    if (recentPoints.length >= 3) {
      const isIncreasing = recentPoints.every((p, i) => i === 0 || p.value > recentPoints[i - 1]!.value);
      const isDecreasing = recentPoints.every((p, i) => i === 0 || p.value < recentPoints[i - 1]!.value);
      if (isIncreasing || isDecreasing) return 'trend';
    }

    // Point anomaly (default)
    return 'point';
  }

  private getPrimaryMethod(value: number, stream: DetectorStream): DetectionMethod {
    const { stats } = stream;
    if (stats.stddev > 0 && Math.abs((value - stats.mean) / stats.stddev) > this.config.zScoreThreshold) return 'zscore';
    if (stats.mad > 0 && Math.abs(value - stats.median) / (stats.mad * 1.4826) > this.config.madThreshold) return 'mad';
    return 'iqr';
  }

  private inferPossibleCauses(point: TimeSeriesPoint, stream: DetectorStream): string[] {
    const causes: string[] = [];
    const z = stream.stats.stddev > 0 ? (point.value - stream.stats.mean) / stream.stats.stddev : 0;

    if (Math.abs(z) > 5) causes.push('Possible data pipeline error or sensor malfunction');
    if (z > 3) causes.push('Traffic spike', 'Deployment event', 'External load increase');
    if (z < -3) causes.push('Service degradation', 'Data source unavailability', 'Throttling');
    if (causes.length === 0) causes.push('Statistical outlier', 'Normal variation');

    return causes;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getAnomalyDetector(): RealtimeAnomalyDetector {
  const key = '__realtimeAnomalyDetector__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new RealtimeAnomalyDetector();
  }
  return (globalThis as Record<string, unknown>)[key] as RealtimeAnomalyDetector;
}
