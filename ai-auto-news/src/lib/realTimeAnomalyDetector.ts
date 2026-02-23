import { logger } from '@/lib/logger';

// --- Types ---

type AnomalySeverity = 'info' | 'warning' | 'critical';
type DetectionMethod = 'zscore' | 'iqr';

interface MetricConfig {
  name: string;
  method: DetectionMethod;
  /** Z-score threshold (default 3.0) */
  zScoreThreshold?: number;
  /** IQR multiplier (default 1.5) */
  iqrMultiplier?: number;
  /** Sliding window size in data points */
  windowSize: number;
  /** Min data points before anomaly detection activates */
  minSamples?: number;
  severityThresholds?: { warning: number; critical: number };
}

interface MetricDataPoint {
  value: number;
  timestamp: number;
}

interface Anomaly {
  id: string;
  metric: string;
  value: number;
  expected: number;
  deviation: number;
  severity: AnomalySeverity;
  method: DetectionMethod;
  timestamp: number;
  detectedAt: number;
}

interface MetricState {
  config: MetricConfig;
  window: MetricDataPoint[];
  baseline: { mean: number; stdDev: number; q1: number; q3: number } | null;
  anomalies: Anomaly[];
}

interface AnomalyCorrelation {
  metricA: string;
  metricB: string;
  anomalyCountA: number;
  anomalyCountB: number;
  coOccurrences: number;
  correlationScore: number;
}

type RemediationHandler = (anomaly: Anomaly) => void | Promise<void>;

// --- Helpers ---

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `anomaly_${ts}_${rand}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], mu: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function quartiles(sorted: number[]): { q1: number; median: number; q3: number } {
  const n = sorted.length;
  if (n === 0) return { q1: 0, median: 0, q3: 0 };

  const mid = Math.floor(n / 2);
  const medianVal = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const lowerHalf = sorted.slice(0, mid);
  const upperHalf = n % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);

  const q1 = lowerHalf.length > 0
    ? lowerHalf.length % 2 === 0
      ? (lowerHalf[lowerHalf.length / 2 - 1] + lowerHalf[lowerHalf.length / 2]) / 2
      : lowerHalf[Math.floor(lowerHalf.length / 2)]
    : medianVal;

  const q3 = upperHalf.length > 0
    ? upperHalf.length % 2 === 0
      ? (upperHalf[upperHalf.length / 2 - 1] + upperHalf[upperHalf.length / 2]) / 2
      : upperHalf[Math.floor(upperHalf.length / 2)]
    : medianVal;

  return { q1, median: medianVal, q3 };
}

// --- Detector ---

class RealTimeAnomalyDetector {
  private metrics = new Map<string, MetricState>();
  private deduplicationWindowMs: number;
  private remediationHandlers = new Map<string, RemediationHandler>();
  private globalRemediationHandler: RemediationHandler | null = null;
  private readonly maxAnomaliesPerMetric: number;

  constructor(deduplicationWindowMs = 300_000, maxAnomaliesPerMetric = 10_000) {
    this.deduplicationWindowMs = deduplicationWindowMs;
    this.maxAnomaliesPerMetric = maxAnomaliesPerMetric;
    logger.info('RealTimeAnomalyDetector initialized', { deduplicationWindowMs });
  }

  registerMetric(config: MetricConfig): void {
    if (config.windowSize < 3) {
      throw new Error('Window size must be at least 3');
    }
    this.metrics.set(config.name, {
      config: {
        zScoreThreshold: 3.0,
        iqrMultiplier: 1.5,
        minSamples: 10,
        severityThresholds: { warning: 2.0, critical: 3.5 },
        ...config,
      },
      window: [],
      baseline: null,
      anomalies: [],
    });
    logger.info('Anomaly metric registered', { metric: config.name, method: config.method });
  }

  removeMetric(name: string): boolean {
    return this.metrics.delete(name);
  }

  registerRemediation(metricName: string, handler: RemediationHandler): void {
    this.remediationHandlers.set(metricName, handler);
  }

  setGlobalRemediation(handler: RemediationHandler): void {
    this.globalRemediationHandler = handler;
  }

  ingestBaseline(metricName: string, data: MetricDataPoint[]): void {
    const state = this.metrics.get(metricName);
    if (!state) {
      logger.warn('Baseline for unknown metric', { metric: metricName });
      return;
    }
    const values = data.map((d) => d.value);
    const mu = mean(values);
    const sd = stdDev(values, mu);
    const sorted = [...values].sort((a, b) => a - b);
    const q = quartiles(sorted);

    state.baseline = { mean: mu, stdDev: sd, q1: q.q1, q3: q.q3 };
    logger.info('Baseline learned', { metric: metricName, mean: mu, stdDev: sd });
  }

  addDataPoint(metricName: string, value: number, timestamp?: number): Anomaly | null {
    const state = this.metrics.get(metricName);
    if (!state) {
      logger.warn('Data point for unknown metric', { metric: metricName });
      return null;
    }

    const ts = timestamp ?? Date.now();
    state.window.push({ value, timestamp: ts });

    // Trim window
    if (state.window.length > state.config.windowSize) {
      state.window = state.window.slice(state.window.length - state.config.windowSize);
    }

    // Update rolling baseline
    this.updateBaseline(state);

    const minSamples = state.config.minSamples ?? 10;
    if (state.window.length < minSamples || !state.baseline) {
      return null;
    }

    const anomaly = this.detectAnomaly(state, value, ts);
    if (anomaly) {
      this.handleAnomaly(state, anomaly);
    }
    return anomaly;
  }

  private updateBaseline(state: MetricState): void {
    const values = state.window.map((d) => d.value);
    if (values.length < 3) return;

    const mu = mean(values);
    const sd = stdDev(values, mu);
    const sorted = [...values].sort((a, b) => a - b);
    const q = quartiles(sorted);

    state.baseline = { mean: mu, stdDev: sd, q1: q.q1, q3: q.q3 };
  }

  private detectAnomaly(state: MetricState, value: number, timestamp: number): Anomaly | null {
    const baseline = state.baseline!;
    const config = state.config;
    let deviation = 0;
    let isAnomaly = false;

    if (config.method === 'zscore') {
      if (baseline.stdDev === 0) return null;
      deviation = Math.abs((value - baseline.mean) / baseline.stdDev);
      isAnomaly = deviation > (config.zScoreThreshold ?? 3.0);
    } else {
      const iqr = baseline.q3 - baseline.q1;
      if (iqr === 0) return null;
      const multiplier = config.iqrMultiplier ?? 1.5;
      const lowerBound = baseline.q1 - multiplier * iqr;
      const upperBound = baseline.q3 + multiplier * iqr;
      isAnomaly = value < lowerBound || value > upperBound;
      deviation = value < lowerBound
        ? (lowerBound - value) / iqr
        : value > upperBound
          ? (value - upperBound) / iqr
          : 0;
    }

    if (!isAnomaly) return null;

    // Deduplication: skip if similar anomaly exists within window
    if (this.isDuplicate(state, timestamp)) return null;

    const severity = this.classifySeverity(deviation, config.severityThresholds!);

    return {
      id: generateId(),
      metric: config.name,
      value,
      expected: baseline.mean,
      deviation: parseFloat(deviation.toFixed(3)),
      severity,
      method: config.method,
      timestamp,
      detectedAt: Date.now(),
    };
  }

  private isDuplicate(state: MetricState, timestamp: number): boolean {
    return state.anomalies.some(
      (a) => Math.abs(a.timestamp - timestamp) < this.deduplicationWindowMs,
    );
  }

  private classifySeverity(
    deviation: number,
    thresholds: { warning: number; critical: number },
  ): AnomalySeverity {
    if (deviation >= thresholds.critical) return 'critical';
    if (deviation >= thresholds.warning) return 'warning';
    return 'info';
  }

  private handleAnomaly(state: MetricState, anomaly: Anomaly): void {
    state.anomalies.push(anomaly);
    if (state.anomalies.length > this.maxAnomaliesPerMetric) {
      state.anomalies = state.anomalies.slice(state.anomalies.length - this.maxAnomaliesPerMetric);
    }

    logger.warn('Anomaly detected', {
      metric: anomaly.metric,
      severity: anomaly.severity,
      value: anomaly.value,
      expected: anomaly.expected,
      deviation: anomaly.deviation,
    });

    // Trigger remediation
    const handler = this.remediationHandlers.get(anomaly.metric) ?? this.globalRemediationHandler;
    if (handler) {
      try {
        const result = handler(anomaly);
        if (result instanceof Promise) {
          result.catch((err) =>
            logger.error('Remediation handler failed', err instanceof Error ? err : new Error(String(err))),
          );
        }
      } catch (err) {
        logger.error('Remediation handler threw', err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  getAnomalies(metricName?: string, since?: number): Anomaly[] {
    const result: Anomaly[] = [];
    for (const [name, state] of this.metrics) {
      if (metricName && name !== metricName) continue;
      for (const a of state.anomalies) {
        if (since && a.timestamp < since) continue;
        result.push(a);
      }
    }
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }

  getAnomaliesBySeverity(severity: AnomalySeverity, since?: number): Anomaly[] {
    return this.getAnomalies(undefined, since).filter((a) => a.severity === severity);
  }

  correlateAnomalies(windowMs = 60_000, since?: number): AnomalyCorrelation[] {
    const metricNames = Array.from(this.metrics.keys());
    const correlations: AnomalyCorrelation[] = [];

    for (let i = 0; i < metricNames.length; i++) {
      for (let j = i + 1; j < metricNames.length; j++) {
        const nameA = metricNames[i];
        const nameB = metricNames[j];
        const anomaliesA = this.getAnomalies(nameA, since);
        const anomaliesB = this.getAnomalies(nameB, since);

        if (anomaliesA.length === 0 || anomaliesB.length === 0) continue;

        let coOccurrences = 0;
        for (const a of anomaliesA) {
          for (const b of anomaliesB) {
            if (Math.abs(a.timestamp - b.timestamp) <= windowMs) {
              coOccurrences++;
              break;
            }
          }
        }

        const maxPossible = Math.min(anomaliesA.length, anomaliesB.length);
        const score = maxPossible > 0 ? parseFloat((coOccurrences / maxPossible).toFixed(3)) : 0;

        if (coOccurrences > 0) {
          correlations.push({
            metricA: nameA,
            metricB: nameB,
            anomalyCountA: anomaliesA.length,
            anomalyCountB: anomaliesB.length,
            coOccurrences,
            correlationScore: score,
          });
        }
      }
    }

    return correlations.sort((a, b) => b.correlationScore - a.correlationScore);
  }

  getMetricSummary(metricName: string): {
    name: string;
    dataPoints: number;
    baseline: MetricState['baseline'];
    anomalyCount: number;
    lastAnomaly: Anomaly | null;
  } | null {
    const state = this.metrics.get(metricName);
    if (!state) return null;

    return {
      name: metricName,
      dataPoints: state.window.length,
      baseline: state.baseline,
      anomalyCount: state.anomalies.length,
      lastAnomaly: state.anomalies.length > 0 ? state.anomalies[state.anomalies.length - 1] : null,
    };
  }

  listMetrics(): string[] {
    return Array.from(this.metrics.keys());
  }

  clearAnomalies(metricName?: string): void {
    if (metricName) {
      const state = this.metrics.get(metricName);
      if (state) state.anomalies = [];
    } else {
      for (const state of this.metrics.values()) {
        state.anomalies = [];
      }
    }
    logger.info('Anomalies cleared', { metric: metricName ?? 'all' });
  }

  setDeduplicationWindow(ms: number): void {
    this.deduplicationWindowMs = ms;
  }
}

// --- Singleton ---

const GLOBAL_KEY = '__realTimeAnomalyDetector__';

export function getRealTimeAnomalyDetector(): RealTimeAnomalyDetector {
  const g = globalThis as unknown as Record<string, RealTimeAnomalyDetector>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new RealTimeAnomalyDetector();
  }
  return g[GLOBAL_KEY];
}

export type {
  MetricConfig,
  MetricDataPoint,
  Anomaly,
  AnomalySeverity,
  DetectionMethod,
  AnomalyCorrelation,
  RemediationHandler,
};
